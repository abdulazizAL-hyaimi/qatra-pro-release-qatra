package com.qatra.pro;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Direct Google Drive API transport for encrypted Qatra synchronization packages.
 * It deliberately does not depend on Android DocumentsUI or Drive's DocumentsProvider,
 * because some Samsung Android 9 devices do not expose Drive in the system file picker.
 */
final class QatraDriveApiSyncTransport {
    static final String DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

    private static final String PREFS = "qatra_drive_sync_api_v1";
    private static final String PREF_FOLDER_ID = "root_folder_id";
    private static final String PREF_GOOGLE_ACCOUNT = "google_account";
    private static final String ROOT_FOLDER_NAME = "QatraPro-Sync";
    private static final String DIRECTORY_MIME = "application/vnd.google-apps.folder";
    private static final String PACKAGE_MIME = "application/vnd.qatra.sync+binary";
    private static final String ROOT_FORMAT = "QATRA_SYNC_ROOT_V1";
    private static final String PACKAGE_FORMAT = "QATRA_SYNC_PACKAGE_V1";
    private static final int CONNECT_TIMEOUT_MS = 20_000;
    private static final int READ_TIMEOUT_MS = 60_000;
    private static final int MAX_REMOTE_FILES = 300;
    private static final int MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;

    private final Context context;
    private final String role;
    private final SharedPreferences prefs;
    private final QatraCrypto crypto;
    private final QatraDatabase database;
    private final QatraDriveSyncStore store;

    QatraDriveApiSyncTransport(Context context) {
        this.context = context.getApplicationContext();
        this.role = BuildConfig.APP_ROLE;
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.crypto = new QatraCrypto(this.context);
        this.database = new QatraDatabase(this.context);
        this.store = new QatraDriveSyncStore(this.context);
    }

    JSONObject configure(String accessToken) throws Exception {
        requireToken(accessToken);
        String account = selectedAccount();
        if (account.isEmpty()) throw new SecurityException("اختر حساب Google الموحد أولًا");
        verifyDriveAccess(accessToken);
        String folderId = ensureRootFolder(accessToken, true);
        if (!prefs.edit()
                .putString(PREF_FOLDER_ID, folderId)
                .putString(PREF_GOOGLE_ACCOUNT, account)
                .commit()) {
            throw new IllegalStateException("تعذر حفظ ربط Google Drive");
        }
        // Retire any legacy SAF tree grant. Direct API transport is now authoritative.
        try { new QatraDriveSyncTransport(context).clearConfiguration(); }
        catch (Exception ignored) { }
        JSONObject out = status();
        out.put("message", "تم ربط Google Drive مباشرة وإنشاء/اعتماد مجلد " + ROOT_FOLDER_NAME);
        return out;
    }

    void clearConfiguration() {
        prefs.edit().remove(PREF_FOLDER_ID).remove(PREF_GOOGLE_ACCOUNT).commit();
        try { new QatraDriveSyncTransport(context).clearConfiguration(); }
        catch (Exception ignored) { }
    }

    boolean isConfigured() {
        String folder = prefs.getString(PREF_FOLDER_ID, "");
        String bound = normalizeEmail(prefs.getString(PREF_GOOGLE_ACCOUNT, ""));
        String selected = selectedAccount();
        return folder != null && !folder.trim().isEmpty()
                && !bound.isEmpty() && bound.equals(selected);
    }

    JSONObject status() throws Exception {
        JSONObject out = store.status(role, crypto.isProvisioned());
        out.put("configured", isConfigured());
        out.put("transport", "google-drive-api");
        out.put("folderName", ROOT_FOLDER_NAME);
        out.put("boundAccount", normalizeEmail(prefs.getString(PREF_GOOGLE_ACCOUNT, "")));
        return out;
    }

    JSONObject uploadPending(String accessToken) throws Exception {
        requireReady(accessToken);
        String rootId = ensureRootFolder(accessToken, false);
        List<QatraDriveSyncStore.Item> items = store.outgoing();
        Map<String, String> roleFolders = new HashMap<>();
        int uploaded = 0;
        int alreadyThere = 0;
        try {
            for (QatraDriveSyncStore.Item item : items) {
                String folderId = roleFolders.get(item.targetRole);
                if (folderId == null) {
                    folderId = ensureDirectory(accessToken, rootId,
                            directoryForRole(item.targetRole));
                    roleFolders.put(item.targetRole, folderId);
                }
                String remoteName = remoteFilename(item);
                String existing = findFile(accessToken, folderId, remoteName);
                if (existing == null) {
                    resumableUpload(accessToken, folderId, remoteName, item, item.bytes);
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
                : "تم رفع التحديثات المشفرة مباشرة إلى Google Drive");
        return out;
    }

    JSONObject downloadUpdates(String accessToken) throws Exception {
        requireReady(accessToken);
        String rootId = ensureRootFolder(accessToken, false);
        String folderId = ensureDirectory(accessToken, rootId, directoryForRole(role));
        JSONArray files = listFiles(accessToken, folderId);
        int downloaded = 0;
        int duplicates = 0;
        int rejected = 0;
        int scanned = 0;
        try {
            for (int i = 0; i < files.length() && scanned < MAX_REMOTE_FILES; i++) {
                JSONObject file = files.optJSONObject(i);
                if (file == null) continue;
                scanned++;
                String id = file.optString("id", "");
                String name = file.optString("name", "");
                if (id.isEmpty() || !name.toLowerCase(Locale.ROOT).endsWith(".qsync")) continue;
                try {
                    byte[] bytes = download(accessToken, id);
                    QatraCrypto.EncryptedPackage pack = crypto.decryptSync(bytes, role);
                    if (database.isProcessed(pack.packageId, pack.operationId)) {
                        deleteQuietly(accessToken, id);
                        duplicates++;
                        continue;
                    }
                    if (store.enqueueIncoming(pack, name, "gdrive:" + id)) {
                        downloaded++;
                    } else {
                        // The local encrypted inbox already has a durable copy.
                        deleteQuietly(accessToken, id);
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

    private void requireReady(String token) throws Exception {
        requireToken(token);
        if (!crypto.isProvisioned()) {
            throw new SecurityException("استورد ملف ربط المزامنة من الإدارة أولًا، ثم أعد المحاولة");
        }
        if (!isConfigured()) {
            throw new SecurityException("اضغط «ربط Google Drive» أولًا على الحساب المحدد");
        }
    }

    private void verifyDriveAccess(String token) throws Exception {
        requestJson("GET",
                "https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=1&fields=files(id)",
                null, token, 200);
    }

    private String ensureRootFolder(String token, boolean allowCreate) throws Exception {
        String cached = prefs.getString(PREF_FOLDER_ID, "");
        if (cached != null && !cached.trim().isEmpty()) {
            try {
                JSONObject found = requestJson("GET",
                        "https://www.googleapis.com/drive/v3/files/" + encode(cached)
                                + "?fields=id%2Ctrashed%2CmimeType",
                        null, token, 200);
                if (!found.optBoolean("trashed", false)
                        && DIRECTORY_MIME.equals(found.optString("mimeType", ""))) {
                    return cached;
                }
            } catch (Exception stale) {
                prefs.edit().remove(PREF_FOLDER_ID).commit();
            }
        }
        String query = "mimeType='" + DIRECTORY_MIME + "' and name='"
                + escapeQuery(ROOT_FOLDER_NAME) + "' and trashed=false"
                + " and appProperties has { key='qatraFormat' and value='" + ROOT_FORMAT + "' }";
        JSONObject response = requestJson("GET",
                "https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=10"
                        + "&fields=files(id%2Cname)&q=" + encode(query),
                null, token, 200);
        JSONArray files = response.optJSONArray("files");
        if (files != null && files.length() > 0) {
            return files.getJSONObject(0).getString("id");
        }
        if (!allowCreate) {
            throw new IllegalStateException("تعذر العثور على مجلد " + ROOT_FOLDER_NAME
                    + ". أعد تنفيذ الربط مرة واحدة.");
        }
        JSONObject metadata = new JSONObject();
        metadata.put("name", ROOT_FOLDER_NAME);
        metadata.put("mimeType", DIRECTORY_MIME);
        metadata.put("appProperties", new JSONObject().put("qatraFormat", ROOT_FORMAT));
        return requestJson("POST", "https://www.googleapis.com/drive/v3/files?fields=id",
                metadata.toString().getBytes(StandardCharsets.UTF_8), token, 200, 201)
                .getString("id");
    }

    private String ensureDirectory(String token, String parentId, String name) throws Exception {
        String query = "mimeType='" + DIRECTORY_MIME + "' and name='" + escapeQuery(name)
                + "' and '" + escapeQuery(parentId) + "' in parents and trashed=false";
        JSONObject response = requestJson("GET",
                "https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=10"
                        + "&fields=files(id%2Cname)&q=" + encode(query),
                null, token, 200);
        JSONArray files = response.optJSONArray("files");
        if (files != null && files.length() > 0) {
            return files.getJSONObject(0).getString("id");
        }
        JSONObject metadata = new JSONObject();
        metadata.put("name", name);
        metadata.put("mimeType", DIRECTORY_MIME);
        metadata.put("parents", new JSONArray().put(parentId));
        metadata.put("appProperties", new JSONObject()
                .put("qatraFormat", ROOT_FORMAT)
                .put("roleFolder", name));
        return requestJson("POST", "https://www.googleapis.com/drive/v3/files?fields=id",
                metadata.toString().getBytes(StandardCharsets.UTF_8), token, 200, 201)
                .getString("id");
    }

    private String findFile(String token, String parentId, String name) throws Exception {
        String query = "name='" + escapeQuery(name) + "' and '" + escapeQuery(parentId)
                + "' in parents and trashed=false";
        JSONObject response = requestJson("GET",
                "https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=2"
                        + "&fields=files(id%2Cname)&q=" + encode(query),
                null, token, 200);
        JSONArray files = response.optJSONArray("files");
        return files == null || files.length() == 0
                ? null : files.getJSONObject(0).optString("id", null);
    }

    private JSONArray listFiles(String token, String parentId) throws Exception {
        String query = "'" + escapeQuery(parentId) + "' in parents and trashed=false";
        JSONObject response = requestJson("GET",
                "https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=" + MAX_REMOTE_FILES
                        + "&orderBy=createdTime%20asc"
                        + "&fields=files(id%2Cname%2Csize%2CmimeType%2CcreatedTime)&q="
                        + encode(query), null, token, 200);
        JSONArray files = response.optJSONArray("files");
        return files == null ? new JSONArray() : files;
    }

    private void resumableUpload(String token, String folderId, String filename,
                                 QatraDriveSyncStore.Item item, byte[] bytes) throws Exception {
        if (bytes == null || bytes.length == 0 || bytes.length > MAX_DOWNLOAD_BYTES) {
            throw new SecurityException("حجم حزمة المزامنة غير صالح");
        }
        JSONObject metadata = new JSONObject();
        metadata.put("name", filename);
        metadata.put("mimeType", PACKAGE_MIME);
        metadata.put("parents", new JSONArray().put(folderId));
        metadata.put("appProperties", new JSONObject()
                .put("qatraFormat", PACKAGE_FORMAT)
                .put("packageId", item.packageId)
                .put("operationId", item.operationId)
                .put("senderRole", item.senderRole)
                .put("targetRole", item.targetRole));

        HttpURLConnection init = connection(
                "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable"
                        + "&fields=id%2Cname%2CcreatedTime", "POST", token);
        init.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        init.setRequestProperty("X-Upload-Content-Type", PACKAGE_MIME);
        init.setRequestProperty("X-Upload-Content-Length", String.valueOf(bytes.length));
        write(init, metadata.toString().getBytes(StandardCharsets.UTF_8));
        int initCode = init.getResponseCode();
        if (initCode != 200 && initCode != 201) throw httpError(init, initCode);
        String location = init.getHeaderField("Location");
        drain(init);
        init.disconnect();
        if (location == null || !location.startsWith("https://www.googleapis.com/")) {
            throw new SecurityException("لم يُرجع Google Drive رابط رفع صالحًا");
        }

        HttpURLConnection upload = connection(location, "PUT", token);
        upload.setRequestProperty("Content-Type", PACKAGE_MIME);
        upload.setFixedLengthStreamingMode(bytes.length);
        write(upload, bytes);
        int code = upload.getResponseCode();
        if (code != 200 && code != 201) throw httpError(upload, code);
        drain(upload);
        upload.disconnect();
    }

    private byte[] download(String token, String fileId) throws Exception {
        HttpURLConnection request = connection(
                "https://www.googleapis.com/drive/v3/files/" + encode(fileId) + "?alt=media",
                "GET", token);
        int code = request.getResponseCode();
        if (code != 200) throw httpError(request, code);
        byte[] bytes = readLimited(request.getInputStream(), MAX_DOWNLOAD_BYTES);
        request.disconnect();
        return bytes;
    }

    private void deleteQuietly(String token, String fileId) {
        try {
            HttpURLConnection request = connection(
                    "https://www.googleapis.com/drive/v3/files/" + encode(fileId),
                    "DELETE", token);
            int code = request.getResponseCode();
            if (code != 204 && code != 200 && code != 404) throw httpError(request, code);
            drain(request);
            request.disconnect();
        } catch (Exception ignored) { }
    }

    private String selectedAccount() {
        return new QatraGoogleDriveAccount(context).selectedEmail();
    }

    private static String directoryForRole(String value) {
        String clean = value == null ? "" : value.toUpperCase(Locale.ROOT);
        if (!clean.matches("ADMIN|READER|COLLECTOR|CASHIER")) {
            throw new SecurityException("صلاحية هدف المزامنة غير صالحة");
        }
        return "to-" + clean.toLowerCase(Locale.ROOT);
    }

    private static String remoteFilename(QatraDriveSyncStore.Item item) {
        String operation = item.operationType.toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9_-]", "-");
        return "qatra-" + item.senderRole.toLowerCase(Locale.ROOT)
                + "-to-" + item.targetRole.toLowerCase(Locale.ROOT)
                + "-" + operation + "-" + item.packageId + ".qsync";
    }

    private static JSONObject requestJson(String method, String url, byte[] body,
                                          String token, int... accepted) throws Exception {
        HttpURLConnection request = connection(url, method, token);
        if (body != null) {
            request.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            write(request, body);
        }
        int code = request.getResponseCode();
        boolean ok = false;
        for (int value : accepted) if (code == value) ok = true;
        if (!ok) throw httpError(request, code);
        JSONObject result = readJson(request);
        request.disconnect();
        return result;
    }

    private static HttpURLConnection connection(String url, String method, String token)
            throws Exception {
        requireToken(token);
        URL parsed = new URL(url);
        if (!"https".equalsIgnoreCase(parsed.getProtocol())
                || !("www.googleapis.com".equalsIgnoreCase(parsed.getHost())
                || "www.googleapisusercontent.com".equalsIgnoreCase(parsed.getHost()))) {
            throw new SecurityException("تم رفض عنوان Google Drive غير موثوق");
        }
        HttpURLConnection connection = (HttpURLConnection) parsed.openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setUseCaches(false);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Accept", "application/json");
        return connection;
    }

    private static void write(HttpURLConnection connection, byte[] bytes) throws Exception {
        connection.setDoOutput(true);
        if (bytes.length < 1_000_000) connection.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(bytes);
        }
    }

    private static JSONObject readJson(HttpURLConnection connection) throws Exception {
        byte[] data = readLimited(connection.getInputStream(), 2_000_000);
        return data.length == 0 ? new JSONObject()
                : new JSONObject(new String(data, StandardCharsets.UTF_8));
    }

    private static byte[] readLimited(InputStream input, int max) throws Exception {
        try (InputStream source = input;
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16_384];
            int total = 0;
            int read;
            while ((read = source.read(buffer)) != -1) {
                total += read;
                if (total > max) throw new SecurityException("حجم استجابة Google Drive تجاوز الحد المسموح");
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private static Exception httpError(HttpURLConnection connection, int code) {
        String details = "";
        try {
            InputStream error = connection.getErrorStream();
            if (error != null) {
                details = new String(readLimited(error, 16_384), StandardCharsets.UTF_8);
            }
        } catch (Exception ignored) { }
        String lower = details.toLowerCase(Locale.ROOT);
        if (code == 401 || (code == 403 && (lower.contains("insufficient")
                || lower.contains("authentication") || lower.contains("scope")))) {
            return new RequiresAuthorizationException(
                    "انتهت جلسة Google أو لم تُمنح صلاحية Drive. سيطلب التطبيق التفويض مرة أخرى.");
        }
        if (code == 403 && (lower.contains("accessnotconfigured")
                || lower.contains("service_disabled") || lower.contains("has not been used"))) {
            return new SecurityException("Google Drive API غير مفعّلة في مشروع Google Cloud المرتبط بالتطبيق");
        }
        if (code == 403 && lower.contains("quota")) {
            return new SecurityException("تعذر استخدام Google Drive بسبب حد الاستخدام أو امتلاء المساحة");
        }
        return new IllegalStateException("Google Drive HTTP " + code);
    }

    static boolean requiresFreshAuthorization(Exception error) {
        return error instanceof RequiresAuthorizationException;
    }

    private static final class RequiresAuthorizationException extends SecurityException {
        RequiresAuthorizationException(String message) { super(message); }
    }

    private static void drain(HttpURLConnection connection) {
        try {
            InputStream input = connection.getInputStream();
            if (input != null) input.close();
        } catch (Exception ignored) { }
    }

    private static String escapeQuery(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("'", "\\'");
    }

    private static String encode(String value) throws Exception {
        return URLEncoder.encode(value, "UTF-8").replace("+", "%20");
    }

    private static void requireToken(String token) {
        if (token == null || token.length() < 20 || token.length() > 4096) {
            throw new SecurityException("رمز تفويض Google Drive غير صالح");
        }
    }

    private static String normalizeEmail(String value) {
        String email = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        return email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+") ? email : "";
    }

    private static String message(Exception error) {
        String value = error == null ? "خطأ غير معروف" : error.getMessage();
        return value == null || value.trim().isEmpty()
                ? error.getClass().getSimpleName() : value;
    }
}
