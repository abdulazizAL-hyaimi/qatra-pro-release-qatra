package com.qatra.pro;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Manual encrypted synchronization through a shared folder selected from Google Drive/SAF. */
final class QatraDriveSyncTransport {
    private static final int MAX_REMOTE_FILES = 300;
    private static final int MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;
    private static final String DIRECTORY_MIME = DocumentsContract.Document.MIME_TYPE_DIR;

    private final Context context;
    private final ContentResolver resolver;
    private final String role;
    private final QatraCrypto crypto;
    private final QatraDatabase database;
    private final QatraDriveSyncStore store;

    QatraDriveSyncTransport(Context context) {
        this.context = context.getApplicationContext();
        this.resolver = this.context.getContentResolver();
        this.role = BuildConfig.APP_ROLE;
        this.crypto = new QatraCrypto(this.context);
        this.database = new QatraDatabase(this.context);
        this.store = new QatraDriveSyncStore(this.context);
    }

    void configure(Uri treeUri, int flags) {
        if (treeUri == null) throw new IllegalArgumentException("اختر مجلد QatraPro-Sync");
        int persist = flags & (android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
                | android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        resolver.takePersistableUriPermission(treeUri, persist);
        store.setTreeUri(treeUri);
    }

    void clearConfiguration() {
        Uri previous = store.treeUri();
        store.clearTreeUri();
        if (previous == null) return;
        try {
            resolver.releasePersistableUriPermission(previous,
                    android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
                            | android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignored) { }
    }

    JSONObject status() throws Exception {
        return store.status(role, crypto.isProvisioned());
    }

    JSONObject uploadPending() throws Exception {
        requireReady();
        Uri tree = requireTree();
        List<QatraDriveSyncStore.Item> items = store.outgoing();
        Map<String, Uri> roleFolders = new HashMap<>();
        int uploaded = 0;
        int alreadyThere = 0;
        try {
            for (QatraDriveSyncStore.Item item : items) {
                Uri folder = roleFolders.get(item.targetRole);
                if (folder == null) {
                    folder = ensureDirectory(tree, directoryForRole(item.targetRole));
                    roleFolders.put(item.targetRole, folder);
                }
                String remoteName = remoteFilename(item);
                Uri existing = findChild(tree, folder, remoteName, false);
                if (existing == null) {
                    Uri target = DocumentsContract.createDocument(
                            resolver, folder, "application/octet-stream", remoteName);
                    if (target == null) throw new IllegalStateException("تعذر إنشاء ملف داخل المجلد المشترك");
                    try (OutputStream output = resolver.openOutputStream(target, "w")) {
                        if (output == null) throw new IllegalStateException("تعذر فتح ملف المزامنة للكتابة");
                        output.write(item.bytes);
                        output.flush();
                    }
                    uploaded++;
                } else {
                    alreadyThere++;
                }
                store.markUploaded(item.packageId);
            }
            store.markUploadSuccess();
        } catch (Exception error) {
            store.markError(message(error));
            throw error;
        }
        JSONObject out = status();
        out.put("uploaded", uploaded);
        out.put("alreadyThere", alreadyThere);
        out.put("message", items.isEmpty()
                ? "لا توجد تحديثات جديدة بانتظار الرفع"
                : "تم رفع التحديثات المشفرة إلى المجلد المشترك");
        return out;
    }

    JSONObject downloadUpdates() throws Exception {
        requireReady();
        Uri tree = requireTree();
        Uri folder = findChild(tree, rootDocument(tree), directoryForRole(role), true);
        int downloaded = 0;
        int duplicates = 0;
        int rejected = 0;
        int scanned = 0;
        if (folder != null) {
            try {
                for (RemoteDocument document : listChildren(tree, folder)) {
                    if (scanned++ >= MAX_REMOTE_FILES) break;
                    if (document.directory || !document.name.toLowerCase(Locale.ROOT).endsWith(".qsync")) continue;
                    try {
                        byte[] bytes = readLimited(document.uri);
                        QatraCrypto.EncryptedPackage pack = crypto.decryptSync(bytes, role);
                        if (database.isProcessed(pack.packageId, pack.operationId)) {
                            deleteQuietly(document.uri);
                            duplicates++;
                            continue;
                        }
                        if (store.enqueueIncoming(pack, document.name, document.uri.toString())) {
                            downloaded++;
                        } else {
                            duplicates++;
                        }
                    } catch (Exception invalid) {
                        rejected++;
                    }
                }
                store.markDownloadSuccess();
            } catch (Exception error) {
                store.markError(message(error));
                throw error;
            }
        } else {
            store.markDownloadSuccess();
        }
        JSONObject out = status();
        out.put("downloaded", downloaded);
        out.put("duplicates", duplicates);
        out.put("rejected", rejected);
        out.put("scanned", scanned);
        out.put("message", downloaded > 0
                ? "تم تنزيل التحديثات. ارجع إلى التطبيق لمراجعتها ودمجها"
                : "لا توجد تحديثات جديدة مخصصة لهذا التطبيق");
        return out;
    }

    private void requireReady() {
        if (!crypto.isProvisioned()) {
            throw new SecurityException("استورد ملف ربط المزامنة من الإدارة أولًا، ثم أعد المحاولة");
        }
    }

    private Uri requireTree() {
        Uri tree = store.treeUri();
        if (tree == null) throw new IllegalStateException("اختر مجلد Google Drive المشترك أولًا");
        return tree;
    }

    private Uri ensureDirectory(Uri tree, String name) throws Exception {
        Uri root = rootDocument(tree);
        Uri existing = findChild(tree, root, name, true);
        if (existing != null) return existing;
        Uri created = DocumentsContract.createDocument(resolver, root, DIRECTORY_MIME, name);
        if (created == null) throw new IllegalStateException("تعذر إنشاء مجلد " + name);
        return created;
    }

    private Uri rootDocument(Uri tree) {
        return DocumentsContract.buildDocumentUriUsingTree(
                tree, DocumentsContract.getTreeDocumentId(tree));
    }

    private Uri findChild(Uri tree, Uri parent, String expectedName, boolean directory)
            throws Exception {
        for (RemoteDocument child : listChildren(tree, parent)) {
            if (expectedName.equals(child.name) && child.directory == directory) return child.uri;
        }
        return null;
    }

    private List<RemoteDocument> listChildren(Uri tree, Uri parent) throws Exception {
        String parentId = DocumentsContract.getDocumentId(parent);
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
        String[] projection = {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE
        };
        List<RemoteDocument> out = new ArrayList<>();
        try (Cursor cursor = resolver.query(children, projection, null, null, null)) {
            if (cursor == null) throw new IllegalStateException("تعذر قراءة المجلد المشترك");
            int idIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int mimeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
            int sizeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
            while (cursor.moveToNext() && out.size() < MAX_REMOTE_FILES) {
                String id = idIndex >= 0 ? cursor.getString(idIndex) : "";
                if (id == null || id.isEmpty()) continue;
                String name = nameIndex >= 0 ? cursor.getString(nameIndex) : "";
                String mime = mimeIndex >= 0 ? cursor.getString(mimeIndex) : "";
                long size = sizeIndex >= 0 && !cursor.isNull(sizeIndex) ? cursor.getLong(sizeIndex) : -1L;
                Uri uri = DocumentsContract.buildDocumentUriUsingTree(tree, id);
                out.add(new RemoteDocument(uri, name == null ? "" : name,
                        DIRECTORY_MIME.equals(mime), size));
            }
        }
        return out;
    }

    private byte[] readLimited(Uri uri) throws Exception {
        try (InputStream input = resolver.openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IllegalStateException("تعذر فتح ملف التحديث");
            byte[] buffer = new byte[16_384];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_DOWNLOAD_BYTES) throw new SecurityException("ملف التحديث أكبر من الحد المسموح");
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private void deleteQuietly(Uri uri) {
        try { resolver.delete(uri, null, null); } catch (Exception ignored) { }
    }

    private static String directoryForRole(String value) {
        String clean = value == null ? "" : value.toUpperCase(Locale.ROOT);
        if (!clean.matches("ADMIN|READER|COLLECTOR|CASHIER")) {
            throw new SecurityException("صلاحية هدف المزامنة غير صالحة");
        }
        return "to-" + clean.toLowerCase(Locale.ROOT);
    }

    private static String remoteFilename(QatraDriveSyncStore.Item item) {
        String operation = item.operationType.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9_-]", "-");
        return "qatra-" + item.senderRole.toLowerCase(Locale.ROOT)
                + "-to-" + item.targetRole.toLowerCase(Locale.ROOT)
                + "-" + operation + "-" + item.packageId + ".qsync";
    }

    private static String message(Exception error) {
        String value = error == null ? "خطأ غير معروف" : error.getMessage();
        return value == null || value.trim().isEmpty() ? error.getClass().getSimpleName() : value;
    }

    private static final class RemoteDocument {
        final Uri uri;
        final String name;
        final boolean directory;
        final long size;

        RemoteDocument(Uri uri, String name, boolean directory, long size) {
            this.uri = uri;
            this.name = name;
            this.directory = directory;
            this.size = size;
        }
    }
}
