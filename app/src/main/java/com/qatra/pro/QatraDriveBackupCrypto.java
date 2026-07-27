package com.qatra.pro;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

import javax.crypto.BadPaddingException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Authenticated encryption for Google Drive backups.
 *
 * New backups use a random data key whose recovery copy is stored separately in Drive's hidden
 * appDataFolder. Only this OAuth application, after the user selects the same Google account, can
 * read that recovery copy. The device copy is wrapped by Android Keystore for scheduled backups.
 * Version 1 password envelopes remain readable so existing users are not locked out during the
 * migration to passwordless recovery.
 */
final class QatraDriveBackupCrypto {
    private static final String FORMAT = "QATRA_DRIVE_BACKUP_V2";
    private static final String LEGACY_FORMAT = "QATRA_DRIVE_BACKUP_V1";
    private static final String RECOVERY_FORMAT = "QATRA_DRIVE_RECOVERY_KEY_V1";
    private static final int VERSION = 2;
    private static final int LEGACY_VERSION = 1;
    private static final int GCM_TAG_BITS = 128;
    private static final int PBKDF2_ITERATIONS = 600_000;
    private static final int MAX_BACKUP_BYTES = 24_000_000;
    private static final String KDF = "PBKDF2WithHmacSHA1";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String LOCAL_ALIAS = "qatra.drive.backup.local.v1";
    private static final String PREFS = "qatra_drive_backup";
    private static final String PREF_USERNAME = "username_v1";
    private static final String PREF_CREDENTIAL_WRAP = "credential_wrap_v1";
    private static final String PREF_LOCAL_WRAP = "local_wrap_v1";
    private static final String PREF_MODE = "protection_mode_v2";
    private static final String MODE_GOOGLE_ACCOUNT = "google_account_v2";
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Set<String> ROLES = new HashSet<>(Arrays.asList(
            "ADMIN", "READER", "COLLECTOR", "CASHIER"));

    private final Context context;
    private final String role;
    private final SharedPreferences prefs;

    QatraDriveBackupCrypto(Context context, String role) {
        this.context = context.getApplicationContext();
        this.role = normalizeRole(role);
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        validateRole(this.role);
    }

    boolean isConfigured() {
        if (configuredUsername().isEmpty() || !prefs.contains(PREF_LOCAL_WRAP)) return false;
        return MODE_GOOGLE_ACCOUNT.equals(prefs.getString(PREF_MODE, ""))
                || prefs.contains(PREF_CREDENTIAL_WRAP);
    }

    boolean isPasswordlessConfigured() {
        return isConfigured() && MODE_GOOGLE_ACCOUNT.equals(prefs.getString(PREF_MODE, ""));
    }

    String configuredUsername() {
        return normalizeUsername(prefs.getString(PREF_USERNAME, ""));
    }

    String usernameHash(String username) throws Exception {
        return sha256(normalizeAndValidateUsername(username));
    }

    /** Migrates an existing password backup or reads a version 1 backup. */
    void configureLegacy(String username, String password) throws Exception {
        String normalized = normalizeAndValidateUsername(username);
        validatePassword(password);
        byte[] backupKey = null;
        try {
            String existingCredential = prefs.getString(PREF_CREDENTIAL_WRAP, "");
            if (!existingCredential.isEmpty() && normalized.equals(configuredUsername())) {
                backupKey = unwrapCredentialKey(new JSONObject(existingCredential), normalized, password);
            } else {
                backupKey = randomBytes(32);
                existingCredential = wrapCredentialKey(backupKey, normalized, password).toString();
            }
            JSONObject localWrap = wrapLocalKey(backupKey);
            boolean saved = prefs.edit()
                    .putString(PREF_USERNAME, normalized)
                    .putString(PREF_CREDENTIAL_WRAP, existingCredential)
                    .putString(PREF_LOCAL_WRAP, localWrap.toString())
                    .remove(PREF_MODE)
                    .commit();
            if (!saved) throw new IllegalStateException("تعذر حفظ إعداد حماية النسخ السحابية");
        } finally {
            wipe(backupKey);
        }
    }

    /** Stores only a Keystore-wrapped device copy; the recovery copy lives in Drive appData. */
    void configurePasswordless(String username, byte[] backupKey) throws Exception {
        String normalized = normalizeAndValidateUsername(username);
        requireBackupKey(backupKey);
        JSONObject localWrap = wrapLocalKey(backupKey);
        boolean saved = prefs.edit()
                .putString(PREF_USERNAME, normalized)
                .putString(PREF_LOCAL_WRAP, localWrap.toString())
                .putString(PREF_MODE, MODE_GOOGLE_ACCOUNT)
                .remove(PREF_CREDENTIAL_WRAP)
                .commit();
        if (!saved) throw new IllegalStateException("تعذر حفظ إعداد حماية النسخ السحابية");
    }

    String currentFormat() {
        return isPasswordlessConfigured() ? FORMAT : LEGACY_FORMAT;
    }

    byte[] encrypt(String payloadJson) throws Exception {
        if (!isConfigured()) throw new SecurityException("اربط حساب النسخ السحابية أولاً");
        byte[] payload = payloadJson == null ? new byte[0] : payloadJson.getBytes(StandardCharsets.UTF_8);
        if (payload.length == 0 || payload.length > MAX_BACKUP_BYTES) {
            throw new SecurityException("حجم النسخة الاحتياطية غير صالح");
        }
        new JSONObject(payloadJson);
        String username = configuredUsername();
        String usernameHash = sha256(username);
        byte[] key = null;
        try {
            key = unwrapLocalKey(new JSONObject(prefs.getString(PREF_LOCAL_WRAP, "{}")));
            String format = currentFormat();
            JSONObject header = new JSONObject();
            header.put("format", format);
            header.put("version", FORMAT.equals(format) ? VERSION : LEGACY_VERSION);
            header.put("packageId", "DRV-" + UUID.randomUUID());
            header.put("role", role);
            header.put("usernameHash", usernameHash);
            header.put("createdAt", System.currentTimeMillis());
            header.put("payloadHash", sha256(payloadJson));
            byte[] headerBytes = header.toString().getBytes(StandardCharsets.UTF_8);

            byte[] iv = randomBytes(12);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(GCM_TAG_BITS, iv));
            cipher.updateAAD(headerBytes);

            JSONObject envelope = new JSONObject();
            envelope.put("format", format);
            envelope.put("header", b64(headerBytes));
            if (LEGACY_FORMAT.equals(format)) {
                envelope.put("credential", new JSONObject(
                        prefs.getString(PREF_CREDENTIAL_WRAP, "{}")));
            }
            envelope.put("iv", b64(iv));
            envelope.put("ciphertext", b64(cipher.doFinal(payload)));
            return envelope.toString().getBytes(StandardCharsets.UTF_8);
        } finally {
            wipe(key);
        }
    }

    DecryptedBackup decryptLegacy(byte[] bytes, String username, String password, String selectedRole)
            throws Exception {
        String normalized = normalizeAndValidateUsername(username);
        validatePassword(password);
        String cleanRole = normalizeRole(selectedRole);
        validateRole(cleanRole);
        if (!role.equals(cleanRole)) {
            throw new SecurityException("نوع المستخدم المختار لا يطابق نسخة التطبيق المثبتة");
        }
        if (bytes == null || bytes.length < 180 || bytes.length > MAX_BACKUP_BYTES + 16_384) {
            throw new SecurityException("حجم ملف النسخة السحابية غير صالح");
        }

        JSONObject envelope = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        if (!LEGACY_FORMAT.equals(envelope.optString("format"))) {
            throw new SecurityException("النسخة ليست من النوع القديم المحمي بكلمة مرور");
        }
        byte[] headerBytes = fromB64(envelope.getString("header"));
        if (headerBytes.length < 120 || headerBytes.length > 4096) {
            throw new SecurityException("ترويسة النسخة السحابية غير صالحة");
        }
        JSONObject header = new JSONObject(new String(headerBytes, StandardCharsets.UTF_8));
        if (!LEGACY_FORMAT.equals(header.optString("format"))
                || header.optInt("version") != LEGACY_VERSION
                || !role.equals(header.optString("role"))) {
            throw new SecurityException("النسخة السحابية لا تطابق نوع التطبيق");
        }
        String expectedUsernameHash = header.optString("usernameHash", "");
        if (!constantTimeEquals(expectedUsernameHash, sha256(normalized))) {
            throw new SecurityException("اسم المستخدم أو كلمة المرور أو نوع المستخدم غير صحيح");
        }

        byte[] key = null;
        try {
            key = unwrapCredentialKey(envelope.getJSONObject("credential"), normalized, password);
            byte[] iv = fromB64(envelope.getString("iv"));
            byte[] ciphertext = fromB64(envelope.getString("ciphertext"));
            if (iv.length != 12 || ciphertext.length < 17 || ciphertext.length > MAX_BACKUP_BYTES + 16) {
                throw new SecurityException("بنية النسخة السحابية المشفرة غير صالحة");
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(GCM_TAG_BITS, iv));
            cipher.updateAAD(headerBytes);
            final String payload;
            try {
                payload = new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
            } catch (BadPaddingException wrongCredentials) {
                throw new SecurityException("اسم المستخدم أو كلمة المرور أو نوع المستخدم غير صحيح");
            }
            new JSONObject(payload);
            if (!constantTimeEquals(header.optString("payloadHash", ""), sha256(payload))) {
                throw new SecurityException("فشل التحقق من سلامة بيانات النسخة السحابية");
            }
            return new DecryptedBackup(
                    payload,
                    header.optLong("createdAt", 0L),
                    header.optString("packageId", ""),
                    normalized,
                    role);
        } finally {
            wipe(key);
        }
    }

    DecryptedBackup decryptPasswordless(byte[] bytes, String username, String selectedRole,
                                        byte[] recoveryKey) throws Exception {
        String normalized = normalizeAndValidateUsername(username);
        String cleanRole = normalizeRole(selectedRole);
        validateRole(cleanRole);
        requireBackupKey(recoveryKey);
        if (!role.equals(cleanRole)) {
            throw new SecurityException("نوع المستخدم المختار لا يطابق نسخة التطبيق المثبتة");
        }
        if (bytes == null || bytes.length < 160 || bytes.length > MAX_BACKUP_BYTES + 16_384) {
            throw new SecurityException("حجم ملف النسخة السحابية غير صالح");
        }
        JSONObject envelope = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        if (!FORMAT.equals(envelope.optString("format"))) {
            throw new SecurityException("هذه نسخة قديمة؛ اختر خيار استعادة نسخة قديمة");
        }
        byte[] headerBytes = fromB64(envelope.getString("header"));
        if (headerBytes.length < 120 || headerBytes.length > 4096) {
            throw new SecurityException("ترويسة النسخة السحابية غير صالحة");
        }
        JSONObject header = new JSONObject(new String(headerBytes, StandardCharsets.UTF_8));
        if (!FORMAT.equals(header.optString("format"))
                || header.optInt("version") != VERSION
                || !role.equals(header.optString("role"))) {
            throw new SecurityException("النسخة السحابية لا تطابق نوع التطبيق");
        }
        if (!constantTimeEquals(header.optString("usernameHash", ""), sha256(normalized))) {
            throw new SecurityException("اسم المستخدم أو نوع المستخدم غير صحيح");
        }
        byte[] iv = fromB64(envelope.getString("iv"));
        byte[] ciphertext = fromB64(envelope.getString("ciphertext"));
        if (iv.length != 12 || ciphertext.length < 17 || ciphertext.length > MAX_BACKUP_BYTES + 16) {
            throw new SecurityException("بنية النسخة السحابية المشفرة غير صالحة");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(recoveryKey, "AES"),
                new GCMParameterSpec(GCM_TAG_BITS, iv));
        cipher.updateAAD(headerBytes);
        final String payload;
        try {
            payload = new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch (BadPaddingException wrongAccountOrKey) {
            throw new SecurityException("تعذر فتح النسخة بهذا الحساب؛ اختر حساب Google الذي أنشأها");
        }
        new JSONObject(payload);
        if (!constantTimeEquals(header.optString("payloadHash", ""), sha256(payload))) {
            throw new SecurityException("فشل التحقق من سلامة بيانات النسخة السحابية");
        }
        return new DecryptedBackup(
                payload,
                header.optLong("createdAt", 0L),
                header.optString("packageId", ""),
                normalized,
                role);
    }

    byte[] newRecoveryKey() {
        return randomBytes(32);
    }

    byte[] encodeRecoveryKey(String username, byte[] recoveryKey) throws Exception {
        String normalized = normalizeAndValidateUsername(username);
        requireBackupKey(recoveryKey);
        JSONObject envelope = new JSONObject();
        envelope.put("format", RECOVERY_FORMAT);
        envelope.put("version", 1);
        envelope.put("role", role);
        envelope.put("usernameHash", sha256(normalized));
        envelope.put("key", b64(recoveryKey));
        envelope.put("keyHash", sha256(b64(recoveryKey)));
        envelope.put("createdAt", System.currentTimeMillis());
        return envelope.toString().getBytes(StandardCharsets.UTF_8);
    }

    byte[] decodeRecoveryKey(byte[] bytes, String username) throws Exception {
        String normalized = normalizeAndValidateUsername(username);
        if (bytes == null || bytes.length < 120 || bytes.length > 4096) {
            throw new SecurityException("ملف مفتاح الاستعادة السريعة غير صالح");
        }
        JSONObject envelope = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        if (!RECOVERY_FORMAT.equals(envelope.optString("format"))
                || envelope.optInt("version") != 1
                || !role.equals(envelope.optString("role"))
                || !constantTimeEquals(envelope.optString("usernameHash", ""), sha256(normalized))) {
            throw new SecurityException("مفتاح الاستعادة لا يطابق المستخدم أو نوع التطبيق");
        }
        byte[] key = fromB64(envelope.getString("key"));
        requireBackupKey(key);
        if (!constantTimeEquals(envelope.optString("keyHash", ""), sha256(b64(key)))) {
            wipe(key);
            throw new SecurityException("ملف مفتاح الاستعادة السريعة تالف");
        }
        return key;
    }

    private JSONObject wrapCredentialKey(byte[] key, String username, String password) throws Exception {
        byte[] salt = randomBytes(16);
        byte[] iv = randomBytes(12);
        SecretKey credentialKey = derive(password, salt, PBKDF2_ITERATIONS, KDF);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, credentialKey, new GCMParameterSpec(GCM_TAG_BITS, iv));
        cipher.updateAAD(credentialAad(username));
        JSONObject out = new JSONObject();
        out.put("kdf", KDF);
        out.put("iterations", PBKDF2_ITERATIONS);
        out.put("salt", b64(salt));
        out.put("iv", b64(iv));
        out.put("wrappedKey", b64(cipher.doFinal(key)));
        return out;
    }

    private byte[] unwrapCredentialKey(JSONObject wrapped, String username, String password)
            throws Exception {
        int iterations = wrapped.optInt("iterations", 0);
        String kdf = wrapped.optString("kdf", "");
        if (iterations < 300_000 || iterations > 1_200_000
                || !("PBKDF2WithHmacSHA1".equals(kdf)
                || "PBKDF2WithHmacSHA256".equals(kdf))) {
            throw new SecurityException("إعدادات حماية النسخة السحابية غير صالحة");
        }
        byte[] salt = fromB64(wrapped.getString("salt"));
        byte[] iv = fromB64(wrapped.getString("iv"));
        byte[] ciphertext = fromB64(wrapped.getString("wrappedKey"));
        if (salt.length != 16 || iv.length != 12 || ciphertext.length != 48) {
            throw new SecurityException("حاوية مفتاح النسخة السحابية تالفة");
        }
        SecretKey credentialKey = derive(password, salt, iterations, kdf);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, credentialKey, new GCMParameterSpec(GCM_TAG_BITS, iv));
        cipher.updateAAD(credentialAad(username));
        try {
            byte[] key = cipher.doFinal(ciphertext);
            if (key.length != 32) throw new SecurityException("مفتاح النسخة السحابية غير صالح");
            return key;
        } catch (BadPaddingException wrongCredentials) {
            throw new SecurityException("اسم المستخدم أو كلمة المرور أو نوع المستخدم غير صحيح");
        }
    }

    private JSONObject wrapLocalKey(byte[] key) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, localWrappingKey(true));
        JSONObject out = new JSONObject();
        out.put("iv", b64(cipher.getIV()));
        out.put("wrappedKey", b64(cipher.doFinal(key)));
        return out;
    }

    private byte[] unwrapLocalKey(JSONObject wrapped) throws Exception {
        byte[] iv = fromB64(wrapped.getString("iv"));
        byte[] ciphertext = fromB64(wrapped.getString("wrappedKey"));
        if (iv.length != 12 || ciphertext.length != 48) {
            throw new SecurityException("حاوية مفتاح النسخ التلقائي تالفة");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, localWrappingKey(false),
                new GCMParameterSpec(GCM_TAG_BITS, iv));
        try {
            byte[] key = cipher.doFinal(ciphertext);
            if (key.length != 32) throw new SecurityException("مفتاح النسخ التلقائي تالف");
            return key;
        } catch (BadPaddingException lostKeystoreKey) {
            throw new SecurityException("أعد ربط Google Drive بعد إعادة تثبيت التطبيق");
        }
    }

    private SecretKey localWrappingKey(boolean create) throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(LOCAL_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(LOCAL_ALIAS, null)).getSecretKey();
        }
        if (!create) throw new SecurityException("مفتاح Android Keystore للنسخ التلقائي غير موجود");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
                LOCAL_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    private byte[] credentialAad(String username) throws Exception {
        return (LEGACY_FORMAT + "|" + role + "|" + sha256(username))
                .getBytes(StandardCharsets.US_ASCII);
    }

    private static SecretKey derive(String password, byte[] salt, int iterations, String kdf)
            throws Exception {
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, iterations, 256);
        try {
            return new SecretKeySpec(SecretKeyFactory.getInstance(kdf)
                    .generateSecret(spec).getEncoded(), "AES");
        } finally {
            spec.clearPassword();
        }
    }

    static String normalizeUsername(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private static String normalizeAndValidateUsername(String value) {
        String username = normalizeUsername(value);
        if (!username.matches("[a-z0-9_.-]{3,32}")) {
            throw new SecurityException("اسم المستخدم من 3 إلى 32 حرفًا إنجليزيًا أو رقمًا دون مسافات");
        }
        return username;
    }

    static void validatePassword(String password) {
        if (password == null || password.length() < 10 || password.length() > 64
                || !password.matches(".*[A-Za-z].*") || !password.matches(".*[0-9].*")) {
            throw new SecurityException("استخدم كلمة مرور من 10 إلى 64 محرفًا وتحتوي حرفًا ورقمًا");
        }
    }

    private static void requireBackupKey(byte[] key) {
        if (key == null || key.length != 32) {
            throw new SecurityException("مفتاح النسخة السحابية غير صالح");
        }
    }

    private static String normalizeRole(String value) {
        return value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
    }

    private static void validateRole(String value) {
        if (!ROLES.contains(value)) throw new SecurityException("نوع المستخدم غير معروف");
    }

    private static String sha256(String value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest((value == null ? "" : value).getBytes(StandardCharsets.UTF_8));
        StringBuilder out = new StringBuilder(64);
        for (byte b : digest) out.append(String.format(Locale.US, "%02x", b & 0xff));
        return out.toString();
    }

    private static boolean constantTimeEquals(String left, String right) {
        return MessageDigest.isEqual(
                (left == null ? "" : left).toLowerCase(Locale.ROOT).getBytes(StandardCharsets.US_ASCII),
                (right == null ? "" : right).toLowerCase(Locale.ROOT).getBytes(StandardCharsets.US_ASCII));
    }

    private static byte[] randomBytes(int length) {
        byte[] value = new byte[length];
        RANDOM.nextBytes(value);
        return value;
    }

    private static String b64(byte[] bytes) {
        return Base64.encodeToString(bytes, Base64.NO_WRAP);
    }

    private static byte[] fromB64(String value) {
        return Base64.decode(value, Base64.NO_WRAP);
    }

    static void wipe(byte[] value) {
        if (value != null) Arrays.fill(value, (byte) 0);
    }

    static final class DecryptedBackup {
        final String payloadJson;
        final long createdAt;
        final String packageId;
        final String username;
        final String role;

        DecryptedBackup(String payloadJson, long createdAt, String packageId,
                        String username, String role) {
            this.payloadJson = payloadJson;
            this.createdAt = createdAt;
            this.packageId = packageId;
            this.username = username;
            this.role = role;
        }
    }
}
