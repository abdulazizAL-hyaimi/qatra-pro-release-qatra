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
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;

/** Google Drive REST storage for encrypted, role-scoped SQLite snapshots. */
final class QatraDriveBackupManager {
    static final String DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
    static final String DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
    static final String PREFS = "qatra_drive_backup";
    static final String PREF_ENABLED = "schedule_enabled_v1";
    static final String PREF_FREQUENCY_DAYS = "frequency_days_v1";
    static final String PREF_HOUR = "schedule_hour_v1";
    static final String PREF_MINUTE = "schedule_minute_v1";
    static final String PREF_LAST_SUCCESS = "last_success_v1";
    static final String PREF_LAST_ERROR = "last_error_v1";
    static final String PREF_LAST_FILE = "last_file_v1";
    static final String PREF_FOLDER_ID = "drive_folder_id_v1";
    static final String PREF_LAST_AUTHORIZED = "last_authorized_v1";
    static final String PREF_GOOGLE_ACCOUNT = "google_account_v1";
    static final int RETENTION_COUNT = 10;
    private static final String FOLDER_NAME = "Qatra Pro Backups";
    private static final String BACKUP_MIME = "application/vnd.qatra.drive-backup";
    private static final String RECOVERY_MIME = "application/vnd.qatra.drive-recovery-key";
    private static final String BACKUP_FORMAT = "QATRA_DRIVE_BACKUP_V2";
    private static final String LEGACY_BACKUP_FORMAT = "QATRA_DRIVE_BACKUP_V1";
    private static final String RECOVERY_FORMAT = "QATRA_DRIVE_RECOVERY_KEY_V1";
    private static final int CONNECT_TIMEOUT_MS = 20_000;
    private static final int READ_TIMEOUT_MS = 60_000;
    private static final int MAX_DOWNLOAD_BYTES = 25_000_000;

    private final Context context;
    private final String role;
    private final SharedPreferences prefs;
    private final QatraDriveBackupCrypto crypto;
    private final QatraDatabase database;

    QatraDriveBackupManager(Context context) {
        this.context = context.getApplicationContext();
        this.role = BuildConfig.APP_ROLE;
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.crypto = new QatraDriveBackupCrypto(this.context, role);
        this.database = new QatraDatabase(this.context);
    }

    boolean isConfigured() {
        String selected = selectedGoogleAccount();
        String bound = prefs.getString(PREF_GOOGLE_ACCOUNT, "");
        return crypto.isConfigured() && !selected.isEmpty() && selected.equals(bound);
    }

    boolean isPasswordlessConfigured() {
        return isConfigured() && crypto.isPasswordlessConfigured();
    }

    String configuredUsername() { return crypto.configuredUsername(); }

    void recordAuthorizationSuccess() {
        prefs.edit().putLong(PREF_LAST_AUTHORIZED, System.currentTimeMillis()).commit();
    }

    void onGoogleAccountChanged() {
        prefs.edit()
                .remove(PREF_GOOGLE_ACCOUNT)
                .remove(PREF_FOLDER_ID)
                .remove(PREF_LAST_AUTHORIZED)
                .remove(PREF_LAST_SUCCESS)
                .remove(PREF_LAST_FILE)
                .remove(PREF_LAST_ERROR)
                .putBoolean(PREF_ENABLED, false)
                .putInt(PREF_FREQUENCY_DAYS, 0)
                .commit();
        QatraDriveBackupScheduler.cancel(context);
    }

    void configurePasswordless(String accessToken, String username, int frequencyDays,
                               int hour, int minute)
            throws Exception {
        requireToken(accessToken);
        validateSchedule(frequencyDays, hour, minute);
        // Verify both requested Drive spaces before creating a recovery key or mutating the local
        // configuration. This prevents a half-configured state when OAuth succeeds but Drive API,
        // drive.file, or drive.appdata is not available for the selected account.
        verifyRequiredDriveAccess(accessToken);
        byte[] recoveryKey = loadRecoveryKey(accessToken, username, true);
        try {
            crypto.configurePasswordless(username, recoveryKey);
        } finally {
            QatraDriveBackupCrypto.wipe(recoveryKey);
        }
        bindSelectedGoogleAccount();
        saveSchedule(frequencyDays, hour, minute);
    }

    private static void validateSchedule(int frequencyDays, int hour, int minute) {
        if (frequencyDays != 0 && frequencyDays != 1 && frequencyDays != 7) {
            throw new SecurityException("فترة النسخ التلقائي غير مدعومة");
        }
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            throw new SecurityException("وقت النسخ التلقائي غير صالح");
        }
    }

    private void saveSchedule(int frequencyDays, int hour, int minute) {
        boolean saved = prefs.edit()
                .putBoolean(PREF_ENABLED, frequencyDays > 0)
                .putInt(PREF_FREQUENCY_DAYS, frequencyDays)
                .putInt(PREF_HOUR, hour)
                .putInt(PREF_MINUTE, minute)
                .commit();
        if (!saved) throw new IllegalStateException("تعذر حفظ جدول النسخ التلقائي");
        QatraDriveBackupScheduler.schedule(context);
    }

    void disableSchedule() {
        prefs.edit().putBoolean(PREF_ENABLED, false).putInt(PREF_FREQUENCY_DAYS, 0).commit();
        QatraDriveBackupScheduler.cancel(context);
    }

    boolean scheduleEnabled() {
        return isConfigured() && prefs.getBoolean(PREF_ENABLED, false)
                && frequencyDays() > 0;
    }

    int frequencyDays() { return prefs.getInt(PREF_FREQUENCY_DAYS, 0); }
    int scheduleHour() { return prefs.getInt(PREF_HOUR, 2); }
    int scheduleMinute() { return prefs.getInt(PREF_MINUTE, 0); }

    JSONObject status() throws Exception {
        JSONObject out = new JSONObject();
        out.put("configured", isConfigured());
        out.put("passwordless", isPasswordlessConfigured());
        out.put("username", configuredUsername());
        out.put("role", role);
        out.put("scheduleEnabled", scheduleEnabled());
        out.put("frequencyDays", frequencyDays());
        out.put("hour", scheduleHour());
        out.put("minute", scheduleMinute());
        out.put("lastSuccessAt", prefs.getLong(PREF_LAST_SUCCESS, 0L));
        out.put("lastAuthorizedAt", prefs.getLong(PREF_LAST_AUTHORIZED, 0L));
        out.put("lastError", prefs.getString(PREF_LAST_ERROR, ""));
        out.put("lastFile", prefs.getString(PREF_LAST_FILE, ""));
        return out;
    }

    JSONObject uploadNow(String accessToken, String source) throws Exception {
        requireToken(accessToken);
        if (!isConfigured()) throw new SecurityException("أكمل ربط حساب النسخ السحابية أولاً");
        String username = configuredUsername();
        byte[] encrypted = crypto.encrypt(database.exportPortableBackup(role, null).toString());
        String folderId = ensureFolder(accessToken);
        String usernameHash = crypto.usernameHash(username);
        String format = crypto.currentFormat();
        String filename = backupFilename(usernameHash);
        JSONObject uploaded = resumableUpload(
                accessToken, folderId, filename, usernameHash, format, encrypted);
        cleanupOldBackups(accessToken, folderId, usernameHash, format);
        prefs.edit()
                .putLong(PREF_LAST_SUCCESS, System.currentTimeMillis())
                .putString(PREF_LAST_FILE, filename)
                .remove(PREF_LAST_ERROR)
                .commit();
        uploaded.put("source", source == null ? "manual" : source);
        uploaded.put("filename", filename);
        uploaded.put("bytes", encrypted.length);
        return uploaded;
    }

    JSONObject latestMetadata(String accessToken, String username, String format) throws Exception {
        requireToken(accessToken);
        String normalized = QatraDriveBackupCrypto.normalizeUsername(username);
        String folderId = ensureFolder(accessToken);
        JSONArray files = listBackups(
                accessToken, folderId, crypto.usernameHash(normalized), format, 1);
        if (files.length() == 0) {
            throw new SecurityException("لا توجد نسخة احتياطية لهذا المستخدم والدور في Google Drive");
        }
        return files.getJSONObject(0);
    }

    RestoreResult restoreLatest(String accessToken, String username, String selectedRole)
            throws Exception {
        JSONObject file = latestMetadata(accessToken, username, BACKUP_FORMAT);
        byte[] encrypted = download(accessToken, file.getString("id"));
        byte[] recoveryKey = loadRecoveryKey(accessToken, username, false);
        QatraDriveBackupCrypto.DecryptedBackup backup;
        try {
            backup = crypto.decryptPasswordless(encrypted, username, selectedRole, recoveryKey);
            // Refresh the Keystore-wrapped device copy before mutating SQLite. A failure leaves the
            // current database untouched and scheduled backups can resume after the user enables them.
            crypto.configurePasswordless(backup.username, recoveryKey);
        } finally {
            QatraDriveBackupCrypto.wipe(recoveryKey);
        }
        bindSelectedGoogleAccount();
        database.restorePortableBackup(role, backup.payloadJson);
        finishRestore(file);
        return restoreResult(file, backup);
    }

    RestoreResult restoreLatestLegacy(String accessToken, String username, String password,
                                      String selectedRole) throws Exception {
        JSONObject file = latestMetadata(accessToken, username, LEGACY_BACKUP_FORMAT);
        byte[] encrypted = download(accessToken, file.getString("id"));
        QatraDriveBackupCrypto.DecryptedBackup backup =
                crypto.decryptLegacy(encrypted, username, password, selectedRole);
        byte[] recoveryKey = loadRecoveryKey(accessToken, backup.username, true);
        try {
            crypto.configurePasswordless(backup.username, recoveryKey);
        } finally {
            QatraDriveBackupCrypto.wipe(recoveryKey);
        }
        bindSelectedGoogleAccount();
        database.restorePortableBackup(role, backup.payloadJson);
        finishRestore(file);
        // Best-effort migration: a transient upload failure must not undo a successful restore.
        try {
            uploadNow(accessToken, "legacy-migration");
        } catch (Exception migrationError) {
            recordFailure(migrationError);
        }
        return restoreResult(file, backup);
    }

    private void finishRestore(JSONObject file) {
        prefs.edit()
                .putBoolean(PREF_ENABLED, false)
                .putInt(PREF_FREQUENCY_DAYS, 0)
                .putLong(PREF_LAST_SUCCESS, System.currentTimeMillis())
                .putString(PREF_LAST_FILE, file.optString("name", ""))
                .remove(PREF_LAST_ERROR)
                .commit();
        QatraDriveBackupScheduler.cancel(context);
    }

    private String selectedGoogleAccount() {
        return new QatraGoogleDriveAccount(context).selectedEmail();
    }

    private void bindSelectedGoogleAccount() {
        String selected = selectedGoogleAccount();
        if (selected.isEmpty()) {
            throw new SecurityException("اختر حساب Google الموحد قبل متابعة النسخ");
        }
        if (!prefs.edit().putString(PREF_GOOGLE_ACCOUNT, selected).commit()) {
            throw new IllegalStateException("تعذر ربط إعداد النسخ بحساب Google المحدد");
        }
    }

    private static RestoreResult restoreResult(
            JSONObject file, QatraDriveBackupCrypto.DecryptedBackup backup) {
        return new RestoreResult(
                file.optString("name", ""),
                backup.createdAt,
                backup.packageId,
                backup.username,
                backup.role);
    }

    void recordFailure(Exception error) {
        String message = error == null || error.getMessage() == null
                ? "فشل النسخ السحابي" : error.getMessage();
        if (message.length() > 500) message = message.substring(0, 500);
        prefs.edit().putString(PREF_LAST_ERROR, message).commit();
    }

    /** Confirms that the token can access both spaces required by the backup design. */
    private void verifyRequiredDriveAccess(String token) throws Exception {
        requestJson("GET",
                "https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=1"
                        + "&fields=files(id)", null, token, 200);
        requestJson("GET",
                "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=1"
                        + "&fields=files(id)", null, token, 200);
    }

    private String ensureFolder(String token) throws Exception {
        String cached = prefs.getString(PREF_FOLDER_ID, "");
        if (!cached.isEmpty()) {
            try {
                requestJson("GET", "https://www.googleapis.com/drive/v3/files/" + encode(cached)
                        + "?fields=id%2Ctrashed", null, token, 200);
                return cached;
            } catch (Exception stale) {
                prefs.edit().remove(PREF_FOLDER_ID).commit();
            }
        }
        String query = "mimeType='application/vnd.google-apps.folder' and name='"
                + FOLDER_NAME.replace("'", "\\'") + "' and trashed=false";
        JSONObject found = requestJson("GET",
                "https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=10"
                        + "&fields=files(id%2Cname)&q=" + encode(query), null, token, 200);
        JSONArray files = found.optJSONArray("files");
        String id;
        if (files != null && files.length() > 0) {
            id = files.getJSONObject(0).getString("id");
        } else {
            JSONObject metadata = new JSONObject();
            metadata.put("name", FOLDER_NAME);
            metadata.put("mimeType", "application/vnd.google-apps.folder");
            id = requestJson("POST", "https://www.googleapis.com/drive/v3/files?fields=id",
                    metadata.toString().getBytes(StandardCharsets.UTF_8), token, 200, 201)
                    .getString("id");
        }
        prefs.edit().putString(PREF_FOLDER_ID, id).commit();
        return id;
    }

    private JSONObject resumableUpload(String token, String folderId, String filename,
                                       String usernameHash, String format, byte[] bytes)
            throws Exception {
        JSONObject metadata = new JSONObject();
        metadata.put("name", filename);
        metadata.put("mimeType", BACKUP_MIME);
        metadata.put("parents", new JSONArray().put(folderId));
        JSONObject properties = new JSONObject();
        properties.put("qatraFormat", format);
        properties.put("role", role);
        properties.put("usernameHash", usernameHash);
        properties.put("appVersion", BuildConfig.VERSION_NAME);
        metadata.put("appProperties", properties);

        HttpURLConnection init = connection(
                "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable"
                        + "&fields=id%2Cname%2CcreatedTime", "POST", token);
        init.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        init.setRequestProperty("X-Upload-Content-Type", BACKUP_MIME);
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
        upload.setRequestProperty("Content-Type", BACKUP_MIME);
        upload.setFixedLengthStreamingMode(bytes.length);
        write(upload, bytes);
        int code = upload.getResponseCode();
        if (code != 200 && code != 201) throw httpError(upload, code);
        JSONObject result = readJson(upload);
        upload.disconnect();
        return result;
    }

    private JSONArray listBackups(String token, String folderId, String usernameHash,
                                  String format, int pageSize)
            throws Exception {
        String query = "'" + folderId.replace("'", "\\'") + "' in parents"
                + " and trashed=false"
                + " and appProperties has { key='qatraFormat' and value='" + format + "' }"
                + " and appProperties has { key='role' and value='" + role + "' }"
                + " and appProperties has { key='usernameHash' and value='" + usernameHash + "' }";
        JSONObject response = requestJson("GET",
                "https://www.googleapis.com/drive/v3/files?spaces=drive"
                        + "&orderBy=createdTime%20desc&pageSize=" + Math.max(1, Math.min(100, pageSize))
                        + "&fields=files(id%2Cname%2CcreatedTime%2Csize)&q=" + encode(query),
                null, token, 200);
        JSONArray files = response.optJSONArray("files");
        return files == null ? new JSONArray() : files;
    }

    private void cleanupOldBackups(String token, String folderId, String usernameHash,
                                   String format)
            throws Exception {
        JSONArray files = listBackups(token, folderId, usernameHash, format, 100);
        for (int i = RETENTION_COUNT; i < files.length(); i++) {
            String id = files.optJSONObject(i) == null ? "" : files.optJSONObject(i).optString("id", "");
            if (id.isEmpty()) continue;
            HttpURLConnection request = connection(
                    "https://www.googleapis.com/drive/v3/files/" + encode(id), "DELETE", token);
            int code = request.getResponseCode();
            if (code != 204 && code != 200 && code != 404) throw httpError(request, code);
            drain(request);
            request.disconnect();
        }
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

    /** Reads or creates the passwordless recovery key in Drive's hidden appDataFolder. */
    private byte[] loadRecoveryKey(String token, String username, boolean create) throws Exception {
        requireToken(token);
        String normalized = QatraDriveBackupCrypto.normalizeUsername(username);
        String usernameHash = crypto.usernameHash(normalized);
        String filename = recoveryFilename(usernameHash);
        String query = "name='" + filename.replace("'", "\\'") + "' and trashed=false"
                + " and appProperties has { key='qatraFormat' and value='" + RECOVERY_FORMAT + "' }"
                + " and appProperties has { key='role' and value='" + role + "' }"
                + " and appProperties has { key='usernameHash' and value='" + usernameHash + "' }";
        JSONObject response = requestJson("GET",
                "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=10"
                        + "&fields=files(id%2Cname%2CcreatedTime%2Csize)&q=" + encode(query),
                null, token, 200);
        JSONArray files = response.optJSONArray("files");
        if (files != null && files.length() > 0) {
            return crypto.decodeRecoveryKey(
                    download(token, files.getJSONObject(0).getString("id")), normalized);
        }
        if (!create) {
            throw new SecurityException(
                    "لا يوجد مفتاح استعادة سريعة لهذا المستخدم في حساب Google المحدد");
        }
        byte[] key = crypto.newRecoveryKey();
        try {
            byte[] envelope = crypto.encodeRecoveryKey(normalized, key);
            try {
                uploadRecoveryKey(token, filename, usernameHash, envelope);
            } finally {
                QatraDriveBackupCrypto.wipe(envelope);
            }
            return key.clone();
        } finally {
            QatraDriveBackupCrypto.wipe(key);
        }
    }

    private void uploadRecoveryKey(String token, String filename, String usernameHash,
                                   byte[] bytes) throws Exception {
        JSONObject metadata = new JSONObject();
        metadata.put("name", filename);
        metadata.put("mimeType", RECOVERY_MIME);
        metadata.put("parents", new JSONArray().put("appDataFolder"));
        JSONObject properties = new JSONObject();
        properties.put("qatraFormat", RECOVERY_FORMAT);
        properties.put("role", role);
        properties.put("usernameHash", usernameHash);
        metadata.put("appProperties", properties);

        HttpURLConnection init = connection(
                "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
                "POST", token);
        init.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        init.setRequestProperty("X-Upload-Content-Type", RECOVERY_MIME);
        init.setRequestProperty("X-Upload-Content-Length", String.valueOf(bytes.length));
        write(init, metadata.toString().getBytes(StandardCharsets.UTF_8));
        int initCode = init.getResponseCode();
        if (initCode != 200 && initCode != 201) throw httpError(init, initCode);
        String location = init.getHeaderField("Location");
        drain(init);
        init.disconnect();
        if (location == null || !location.startsWith("https://www.googleapis.com/")) {
            throw new SecurityException("لم يُرجع Google Drive رابط حفظ مفتاح صالحًا");
        }
        HttpURLConnection upload = connection(location, "PUT", token);
        upload.setRequestProperty("Content-Type", RECOVERY_MIME);
        upload.setFixedLengthStreamingMode(bytes.length);
        write(upload, bytes);
        int code = upload.getResponseCode();
        if (code != 200 && code != 201) throw httpError(upload, code);
        drain(upload);
        upload.disconnect();
    }

    private String backupFilename(String usernameHash) {
        SimpleDateFormat stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US);
        stamp.setTimeZone(TimeZone.getTimeZone("UTC"));
        return "qatra-pro-" + role.toLowerCase(Locale.ROOT) + "-"
                + usernameHash.substring(0, 16) + "-" + stamp.format(new Date()) + ".qbackup";
    }

    private String recoveryFilename(String usernameHash) {
        return "qatra-pro-recovery-" + role.toLowerCase(Locale.ROOT) + "-"
                + usernameHash.substring(0, 16) + ".json";
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
        if (data.length == 0) return new JSONObject();
        return new JSONObject(new String(data, StandardCharsets.UTF_8));
    }

    private static byte[] readLimited(InputStream input, int max) throws Exception {
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
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

        String reason = driveErrorReason(details);
        String lower = (reason + " " + details).toLowerCase(Locale.ROOT);
        if (code == 401) {
            return new DriveApiException(code, reason, true,
                    "انتهت صلاحية جلسة Google أو أصبح رمزها غير صالح. سيحذف التطبيق الرمز المؤقت ويطلب تفويضًا جديدًا تلقائيًا.");
        }
        if (code == 403) {
            if (containsAny(lower, "accessnotconfigured", "service_disabled", "servicedisabled",
                    "api has not been used", "drive.googleapis.com has not been used")) {
                return new DriveApiException(code, reason, false,
                        "Google Drive API غير مفعّلة في مشروع Google Cloud المرتبط بهذا التطبيق. فعّل Google Drive API في المشروع نفسه، وانتظر بضع دقائق، ثم أعد المحاولة.");
            }
            if (containsAny(lower, "insufficientpermissions", "insufficient_permissions",
                    "insufficient_scope", "request had insufficient authentication scopes")) {
                return new DriveApiException(code, reason, true,
                        "لم يحصل قطرة برو على صلاحيتي drive.file وdrive.appdata كاملتين. سيحدّث التطبيق رمز التفويض ويطلب الصلاحيات الناقصة مرة أخرى.");
            }
            if (containsAny(lower, "domainpolicy", "domain_policy")) {
                return new DriveApiException(code, reason, false,
                        "سياسة حساب Google Workspace تمنع تطبيقات Drive. استخدم حسابًا مسموحًا أو اطلب من مشرف النطاق السماح لقطرة برو.");
            }
            if (containsAny(lower, "storagequotaexceeded", "storage_quota_exceeded")) {
                return new DriveApiException(code, reason, false,
                        "مساحة Google Drive ممتلئة. حرّر مساحة في الحساب ثم أعد رفع النسخة.");
            }
            if (containsAny(lower, "ratelimitexceeded", "rate_limit_exceeded",
                    "userratelimitexceeded", "dailylimitexceeded", "quota")) {
                return new DriveApiException(code, reason, false,
                        "تجاوز Google Drive حد الاستخدام مؤقتًا. انتظر قليلًا ثم أعد المحاولة.");
            }
            return new DriveApiException(code, reason, false,
                    "رفض Google Drive الطلب"
                            + (reason.isEmpty() ? ". تأكد من تفعيل Drive API ومن صلاحيات الحساب."
                            : " (" + safeReason(reason) + ")."));
        }
        String suffix = reason.isEmpty() ? "" : " (" + safeReason(reason) + ")";
        return new IllegalStateException("Google Drive HTTP " + code + suffix);
    }

    private static String driveErrorReason(String details) {
        if (details == null || details.trim().isEmpty()) return "";
        try {
            JSONObject root = new JSONObject(details);
            JSONObject error = root.optJSONObject("error");
            if (error == null) return "";
            JSONArray errors = error.optJSONArray("errors");
            if (errors != null && errors.length() > 0 && errors.optJSONObject(0) != null) {
                String reason = errors.optJSONObject(0).optString("reason", "");
                if (!reason.isEmpty()) return reason;
            }
            JSONArray nested = error.optJSONArray("details");
            if (nested != null) {
                for (int i = 0; i < nested.length(); i++) {
                    JSONObject item = nested.optJSONObject(i);
                    if (item == null) continue;
                    String reason = item.optString("reason", "");
                    if (!reason.isEmpty()) return reason;
                }
            }
            String status = error.optString("status", "");
            if (!status.isEmpty()) return status;
            return error.optString("message", "");
        } catch (Exception ignored) {
            return "";
        }
    }

    private static boolean containsAny(String value, String... needles) {
        for (String needle : needles) if (value.contains(needle)) return true;
        return false;
    }

    private static String safeReason(String reason) {
        String clean = reason == null ? "" : reason.replaceAll("[^A-Za-z0-9_. -]", "").trim();
        if (clean.length() > 80) clean = clean.substring(0, 80);
        return clean;
    }

    static boolean requiresFreshAuthorization(Exception error) {
        return error instanceof DriveApiException
                && ((DriveApiException) error).requiresFreshAuthorization;
    }

    private static final class DriveApiException extends SecurityException {
        final int statusCode;
        final String reason;
        final boolean requiresFreshAuthorization;

        DriveApiException(int statusCode, String reason, boolean requiresFreshAuthorization,
                          String message) {
            super(message);
            this.statusCode = statusCode;
            this.reason = reason == null ? "" : reason;
            this.requiresFreshAuthorization = requiresFreshAuthorization;
        }
    }

    private static void drain(HttpURLConnection connection) {
        try {
            InputStream input = connection.getInputStream();
            if (input != null) input.close();
        } catch (Exception ignored) { }
    }

    private static String encode(String value) throws Exception {
        return URLEncoder.encode(value, "UTF-8").replace("+", "%20");
    }

    private static void requireToken(String token) {
        if (token == null || token.length() < 20 || token.length() > 4096) {
            throw new SecurityException("رمز تفويض Google Drive غير صالح");
        }
    }

    static final class RestoreResult {
        final String filename;
        final long createdAt;
        final String packageId;
        final String username;
        final String role;

        RestoreResult(String filename, long createdAt, String packageId,
                      String username, String role) {
            this.filename = filename;
            this.createdAt = createdAt;
            this.packageId = packageId;
            this.username = username;
            this.role = role;
        }
    }
}
