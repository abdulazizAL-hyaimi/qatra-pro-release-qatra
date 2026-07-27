package com.qatra.pro;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

/** Durable encrypted outbox/inbox used by the user-selected shared Drive folder. */
final class QatraDriveSyncStore {
    private static final String PREFS = "qatra_drive_sync_v1";
    private static final String PREF_TREE_URI = "tree_uri";
    private static final String PREF_LAST_UPLOAD = "last_upload";
    private static final String PREF_LAST_DOWNLOAD = "last_download";
    private static final String PREF_LAST_ERROR = "last_error";
    private static final int MAX_PACKAGE_BYTES = 30 * 1024 * 1024;

    private final Context context;
    private final SharedPreferences prefs;
    private final File outbox;
    private final File inbox;

    QatraDriveSyncStore(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        File root = new File(this.context.getFilesDir(), "drive-sync-v1");
        this.outbox = new File(root, "outbox");
        this.inbox = new File(root, "inbox");
        ensureDirectory(outbox);
        ensureDirectory(inbox);
    }

    synchronized void setTreeUri(Uri uri) {
        if (uri == null) throw new IllegalArgumentException("مجلد المزامنة غير صالح");
        if (!prefs.edit().putString(PREF_TREE_URI, uri.toString()).commit()) {
            throw new IllegalStateException("تعذر حفظ مجلد المزامنة");
        }
    }

    synchronized Uri treeUri() {
        String raw = prefs.getString(PREF_TREE_URI, "");
        return raw == null || raw.trim().isEmpty() ? null : Uri.parse(raw);
    }

    synchronized void clearTreeUri() {
        if (!prefs.edit().remove(PREF_TREE_URI).commit()) {
            throw new IllegalStateException("تعذر إلغاء مجلد المزامنة السابق");
        }
    }

    synchronized boolean enqueueOutgoing(QatraCrypto.EncryptedPackage pack, String filename)
            throws Exception {
        if (pack == null || pack.bytes == null) throw new IllegalArgumentException("حزمة المزامنة فارغة");
        String id = safeId(pack.packageId);
        File data = dataFile(outbox, id);
        File meta = metaFile(outbox, id);
        if (data.isFile() && meta.isFile()) return false;
        JSONObject metadata = new JSONObject();
        metadata.put("packageId", pack.packageId);
        metadata.put("operationId", pack.operationId);
        metadata.put("senderRole", pack.senderRole);
        metadata.put("targetRole", pack.targetRole);
        metadata.put("operationType", pack.operationType);
        metadata.put("payloadHash", pack.payloadHash);
        metadata.put("filename", safeFilename(filename, pack.packageId));
        metadata.put("queuedAt", System.currentTimeMillis());
        writeAtomic(data, pack.bytes);
        try {
            writeAtomic(meta, metadata.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception error) {
            data.delete();
            throw error;
        }
        return true;
    }

    synchronized List<Item> outgoing() throws Exception {
        return readItems(outbox);
    }

    synchronized void markUploaded(String packageId) {
        String id = safeId(packageId);
        dataFile(outbox, id).delete();
        metaFile(outbox, id).delete();
    }

    synchronized boolean enqueueIncoming(QatraCrypto.EncryptedPackage pack, String filename,
                                         String remoteUri) throws Exception {
        if (pack == null || pack.bytes == null) throw new IllegalArgumentException("حزمة المزامنة فارغة");
        String id = safeId(pack.packageId);
        File data = dataFile(inbox, id);
        File meta = metaFile(inbox, id);
        if (data.isFile() && meta.isFile()) return false;
        JSONObject metadata = new JSONObject();
        metadata.put("packageId", pack.packageId);
        metadata.put("operationId", pack.operationId);
        metadata.put("senderRole", pack.senderRole);
        metadata.put("targetRole", pack.targetRole);
        metadata.put("operationType", pack.operationType);
        metadata.put("payloadHash", pack.payloadHash);
        metadata.put("filename", safeFilename(filename, pack.packageId));
        metadata.put("remoteUri", remoteUri == null ? "" : remoteUri);
        metadata.put("queuedAt", System.currentTimeMillis());
        writeAtomic(data, pack.bytes);
        try {
            writeAtomic(meta, metadata.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception error) {
            data.delete();
            throw error;
        }
        return true;
    }

    synchronized Item nextIncoming() throws Exception {
        List<Item> items = readItems(inbox);
        return items.isEmpty() ? null : items.get(0);
    }

    synchronized void consumeIncoming(String packageId) {
        String id = safeId(packageId);
        String remote = "";
        try {
            File meta = metaFile(inbox, id);
            if (meta.isFile()) remote = readJson(meta).optString("remoteUri", "");
        } catch (Exception ignored) { }
        dataFile(inbox, id).delete();
        metaFile(inbox, id).delete();
        if (!remote.isEmpty()) {
            try { context.getContentResolver().delete(Uri.parse(remote), null, null); }
            catch (Exception ignored) { }
        }
    }

    synchronized int outgoingCount() { return countMetadata(outbox); }
    synchronized int incomingCount() { return countMetadata(inbox); }

    synchronized void markUploadSuccess() {
        prefs.edit().putLong(PREF_LAST_UPLOAD, System.currentTimeMillis()).remove(PREF_LAST_ERROR).apply();
    }

    synchronized void markDownloadSuccess() {
        prefs.edit().putLong(PREF_LAST_DOWNLOAD, System.currentTimeMillis()).remove(PREF_LAST_ERROR).apply();
    }

    synchronized void markError(String message) {
        prefs.edit().putString(PREF_LAST_ERROR, safeText(message)).apply();
    }

    synchronized JSONObject status(String role, boolean keyReady) throws Exception {
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("role", role);
        out.put("configured", treeUri() != null);
        out.put("keyReady", keyReady);
        out.put("pendingUpload", outgoingCount());
        out.put("pendingReview", incomingCount());
        out.put("lastUploadAt", prefs.getLong(PREF_LAST_UPLOAD, 0L));
        out.put("lastDownloadAt", prefs.getLong(PREF_LAST_DOWNLOAD, 0L));
        out.put("lastError", prefs.getString(PREF_LAST_ERROR, ""));
        return out;
    }

    private List<Item> readItems(File directory) throws Exception {
        File[] metadata = directory.listFiles((dir, name) -> name.endsWith(".json"));
        if (metadata == null || metadata.length == 0) return new ArrayList<>();
        Arrays.sort(metadata, new Comparator<File>() {
            @Override public int compare(File left, File right) {
                return Long.compare(left.lastModified(), right.lastModified());
            }
        });
        List<Item> items = new ArrayList<>();
        for (File meta : metadata) {
            JSONObject json;
            try { json = readJson(meta); }
            catch (Exception broken) { continue; }
            String packageId = json.optString("packageId", "");
            if (!validId(packageId)) continue;
            File data = dataFile(directory, safeId(packageId));
            if (!data.isFile() || data.length() <= 0 || data.length() > MAX_PACKAGE_BYTES) continue;
            items.add(new Item(json, readLimited(data)));
        }
        return items;
    }

    private static JSONObject readJson(File file) throws Exception {
        return new JSONObject(new String(readLimited(file), StandardCharsets.UTF_8));
    }

    private static byte[] readLimited(File file) throws Exception {
        try (InputStream input = new FileInputStream(file);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16_384];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_PACKAGE_BYTES) throw new SecurityException("حزمة المزامنة أكبر من الحد المسموح");
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private static void writeAtomic(File target, byte[] bytes) throws Exception {
        if (bytes == null || bytes.length == 0 || bytes.length > MAX_PACKAGE_BYTES) {
            throw new SecurityException("حجم حزمة المزامنة غير صالح");
        }
        ensureDirectory(target.getParentFile());
        File temp = new File(target.getParentFile(), target.getName() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temp, false)) {
            output.write(bytes);
            output.flush();
            output.getFD().sync();
        }
        if (target.exists() && !target.delete()) throw new IllegalStateException("تعذر تحديث طابور المزامنة");
        if (!temp.renameTo(target)) {
            temp.delete();
            throw new IllegalStateException("تعذر تثبيت حزمة المزامنة");
        }
    }

    private static int countMetadata(File directory) {
        File[] files = directory.listFiles((dir, name) -> name.endsWith(".json"));
        return files == null ? 0 : files.length;
    }

    private static void ensureDirectory(File directory) {
        if (directory == null) throw new IllegalStateException("مسار طابور المزامنة غير صالح");
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IllegalStateException("تعذر إنشاء طابور المزامنة المحلي");
        }
    }

    private static File dataFile(File directory, String id) { return new File(directory, id + ".qsync"); }
    private static File metaFile(File directory, String id) { return new File(directory, id + ".json"); }

    private static boolean validId(String value) {
        return value != null && value.matches("(?:PKG|BKP)-[0-9a-fA-F-]{36}");
    }

    private static String safeId(String value) {
        if (!validId(value)) throw new SecurityException("معرّف حزمة المزامنة غير صالح");
        return value;
    }

    private static String safeFilename(String value, String packageId) {
        String clean = value == null ? "" : value.replaceAll("[^A-Za-z0-9._-]", "-");
        if (clean.length() > 120) clean = clean.substring(0, 120);
        if (!clean.toLowerCase().endsWith(".qsync") && !clean.toLowerCase().matches(".*\\.q(?:admin|reader|collector|cashier)$")) {
            clean = clean.replaceAll("\\.[^.]+$", "") + ".qsync";
        }
        return clean.isEmpty() ? packageId + ".qsync" : clean;
    }

    private static String safeText(String value) {
        String clean = value == null ? "" : value.trim();
        return clean.length() > 500 ? clean.substring(0, 500) : clean;
    }

    static final class Item {
        final String packageId;
        final String operationId;
        final String senderRole;
        final String targetRole;
        final String operationType;
        final String filename;
        final String remoteUri;
        final byte[] bytes;

        Item(JSONObject meta, byte[] bytes) {
            this.packageId = meta.optString("packageId", "");
            this.operationId = meta.optString("operationId", "");
            this.senderRole = meta.optString("senderRole", "");
            this.targetRole = meta.optString("targetRole", "");
            this.operationType = meta.optString("operationType", "");
            this.filename = meta.optString("filename", packageId + ".qsync");
            this.remoteUri = meta.optString("remoteUri", "");
            this.bytes = bytes == null ? new byte[0] : Arrays.copyOf(bytes, bytes.length);
        }
    }
}
