package com.qatra.pro;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.BadPaddingException;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/** Authenticated synchronization encryption with local key wrapping in Android Keystore. */
public final class QatraCrypto {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String WRAP_ALIAS = "qatra.local.wrap.v1";
    private static final String PREFS = "qatra_secure_native";
    private static final String PREF_SYNC_KEY = "wrapped_sync_key_v1";
    private static final String SYNC_FORMAT = "QATRA_SYNC_V1";
    private static final String PAIR_FORMAT = "QATRA_PAIR_V1";
    private static final String PORTABLE_BACKUP_FORMAT = "QATRA_PORTABLE_BACKUP_V3";
    private static final String LEGACY_PORTABLE_BACKUP_FORMAT = "QATRA_PORTABLE_BACKUP_V2";
    private static final int GCM_TAG_BITS = 128;
    private static final int PBKDF2_ITERATIONS = 310_000;
    private static final int MAX_PAYLOAD_BYTES = 20_000_000;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Set<String> ROLES = new HashSet<>(Arrays.asList(
            "ADMIN", "READER", "COLLECTOR", "CASHIER", "UNIFIED"
    ));

    private final Context context;

    public QatraCrypto(Context context) {
        this.context = context.getApplicationContext();
    }

    public boolean isProvisioned() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).contains(PREF_SYNC_KEY);
    }

    /**
     * Creates an encrypted pairing file. The shared key never crosses the JavaScript bridge.
     * The one-time PIN is used only to wrap the key for transfer to another Qatra role app.
     */
    public byte[] createPairingPackage(String pin, String issuerRole) throws Exception {
        validatePin(pin);
        validateRole(issuerRole);
        if (!"ADMIN".equals(issuerRole)) {
            throw new SecurityException("إنشاء ملف الربط متاح للإدارة فقط");
        }
        byte[] syncKey = getOrCreateSyncKey();
        byte[] salt = randomBytes(16);
        byte[] iv = randomBytes(12);
        // HmacSHA1 is available across the complete minSdk 23 device range. The high iteration
        // count and 256-bit output retain password-hardening across pairing devices.
        String kdf = "PBKDF2WithHmacSHA1";
        SecretKey pinKey = derivePinKey(pin, salt, PBKDF2_ITERATIONS, kdf);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, pinKey, new GCMParameterSpec(GCM_TAG_BITS, iv));
        byte[] ciphertext = cipher.doFinal(syncKey);

        JSONObject out = new JSONObject();
        out.put("format", PAIR_FORMAT);
        out.put("version", 1);
        out.put("issuerRole", issuerRole);
        out.put("createdAt", System.currentTimeMillis());
        out.put("iterations", PBKDF2_ITERATIONS);
        out.put("kdf", kdf);
        out.put("salt", b64(salt));
        out.put("iv", b64(iv));
        out.put("ciphertext", b64(ciphertext));
        return out.toString().getBytes(StandardCharsets.UTF_8);
    }

    public void importPairingPackage(byte[] bytes, String pin) throws Exception {
        validatePin(pin);
        if (bytes == null || bytes.length < 80 || bytes.length > 4096) {
            throw new SecurityException("حجم ملف ربط المفاتيح غير صالح");
        }
        JSONObject in = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        if (!PAIR_FORMAT.equals(in.optString("format")) || in.optInt("version") != 1) {
            throw new SecurityException("ملف ربط المفاتيح غير صالح");
        }
        int iterations = in.optInt("iterations", 0);
        if (iterations < 100_000 || iterations > 1_000_000) {
            throw new SecurityException("إعدادات ملف الربط غير آمنة");
        }
        if (!"ADMIN".equals(in.optString("issuerRole"))) {
            throw new SecurityException("يجب أن يكون ملف الربط صادرًا من نسخة الإدارة");
        }
        byte[] salt = fromB64(in.getString("salt"));
        byte[] iv = fromB64(in.getString("iv"));
        byte[] ciphertext = fromB64(in.getString("ciphertext"));
        if (salt.length != 16 || iv.length != 12 || ciphertext.length != 48) {
            throw new SecurityException("بنية ملف ربط المفاتيح غير صالحة");
        }
        String kdf = in.optString("kdf", "");
        if (!"PBKDF2WithHmacSHA256".equals(kdf) && !"PBKDF2WithHmacSHA1".equals(kdf)) {
            throw new SecurityException("خوارزمية اشتقاق ملف الربط غير مدعومة");
        }
        SecretKey pinKey = derivePinKey(pin, salt, iterations, kdf);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, pinKey, new GCMParameterSpec(GCM_TAG_BITS, iv));
        final byte[] syncKey;
        try {
            syncKey = cipher.doFinal(ciphertext);
        } catch(BadPaddingException wrongPinOrDamaged) {
            throw new SecurityException("رمز الربط غير صحيح، أو ملف الربط تالف");
        }
        if (syncKey.length != 32) throw new SecurityException("مفتاح المزامنة غير صالح");
        if (isProvisioned()) {
            try {
                if (!Arrays.equals(requireSyncKey(), syncKey)) {
                    throw new SecurityException("هذه النسخة مرتبطة بمفتاح مختلف. لا يمكن تغيير شبكة المزامنة أثناء التشغيل");
                }
                return;
            } catch(Exception localKeyFailure) {
                if (localKeyFailure.getMessage() != null
                        && localKeyFailure.getMessage().contains("مفتاح مختلف")) throw localKeyFailure;
                // Android removes Keystore aliases during uninstall. A correctly decrypted pairing
                // package is the recovery authority for replacing only an unreadable local wrapper.
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                        .remove(PREF_SYNC_KEY).commit();
            }
        }
        storeSyncKey(syncKey);
    }

    public EncryptedPackage encryptSync(
            String senderRole, String targetRole, String operationType, String payloadJson) throws Exception {
        validateRoute(senderRole, targetRole, operationType);
        byte[] payloadBytes = payloadJson == null ? new byte[0] : payloadJson.getBytes(StandardCharsets.UTF_8);
        if (payloadBytes.length == 0 || payloadBytes.length > MAX_PAYLOAD_BYTES) {
            throw new SecurityException("حجم محتوى المزامنة غير صالح");
        }
        new JSONObject(payloadJson);
        String packageId = "PKG-" + UUID.randomUUID();
        String operationId = "OP-" + UUID.randomUUID();
        String payloadHash = QatraDatabase.sha256(payloadJson);

        JSONObject header = new JSONObject();
        header.put("format", SYNC_FORMAT);
        header.put("version", 1);
        header.put("packageId", packageId);
        header.put("operationId", operationId);
        header.put("senderRole", senderRole);
        header.put("targetRole", targetRole);
        header.put("operationType", operationType);
        header.put("createdAt", System.currentTimeMillis());
        header.put("payloadHash", payloadHash);
        byte[] headerBytes = header.toString().getBytes(StandardCharsets.UTF_8);

        byte[] iv = randomBytes(12);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(requireSyncKey(), "AES"),
                new GCMParameterSpec(GCM_TAG_BITS, iv));
        cipher.updateAAD(headerBytes);
        byte[] ciphertext = cipher.doFinal(payloadBytes);

        JSONObject envelope = new JSONObject();
        envelope.put("format", SYNC_FORMAT);
        envelope.put("header", b64(headerBytes));
        envelope.put("iv", b64(iv));
        envelope.put("ciphertext", b64(ciphertext));
        return new EncryptedPackage(packageId, operationId, senderRole, targetRole,
                operationType, payloadHash, payloadJson,
                envelope.toString().getBytes(StandardCharsets.UTF_8));
    }

    public EncryptedPackage decryptSync(byte[] bytes, String currentRole) throws Exception {
        validateRole(currentRole);
        if (bytes == null || bytes.length == 0 || bytes.length > 30_000_000) {
            throw new SecurityException("حجم ملف المزامنة غير صالح");
        }
        JSONObject envelope = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        if (!SYNC_FORMAT.equals(envelope.optString("format"))) {
            throw new SecurityException("هذا ليس ملف مزامنة مشفرًا لقطرة برو");
        }
        byte[] headerBytes = fromB64(envelope.getString("header"));
        if (headerBytes.length < 80 || headerBytes.length > 4096) {
            throw new SecurityException("ترويسة ملف المزامنة غير صالحة");
        }
        JSONObject header = new JSONObject(new String(headerBytes, StandardCharsets.UTF_8));
        if (!SYNC_FORMAT.equals(header.optString("format")) || header.optInt("version") != 1) {
            throw new SecurityException("إصدار ملف المزامنة غير مدعوم");
        }
        String senderRole = header.getString("senderRole");
        String targetRole = header.getString("targetRole");
        String operationType = header.getString("operationType");
        String packageId = header.getString("packageId");
        String operationId = header.getString("operationId");
        String expectedHash = header.getString("payloadHash");
        if (!packageId.matches("PKG-[0-9a-fA-F-]{36}")
                || !operationId.matches("OP-[0-9a-fA-F-]{36}")
                || !expectedHash.matches("[0-9a-fA-F]{64}")) {
            throw new SecurityException("معرّفات ملف المزامنة غير صالحة");
        }
        validateRoute(senderRole, targetRole, operationType);
        if (!currentRole.equals(targetRole)) {
            throw new SecurityException("الملف مخصص لنسخة " + targetRole + " وليس " + currentRole);
        }

        byte[] iv = fromB64(envelope.getString("iv"));
        byte[] ciphertext = fromB64(envelope.getString("ciphertext"));
        if (iv.length != 12 || ciphertext.length < 16 || ciphertext.length > MAX_PAYLOAD_BYTES + 16) {
            throw new SecurityException("بنية تشفير ملف المزامنة غير صالحة");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(requireSyncKey(), "AES"),
                new GCMParameterSpec(GCM_TAG_BITS, iv));
        cipher.updateAAD(headerBytes);
        final String payload;
        try {
            payload = new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch(BadPaddingException wrongNetworkKey) {
            throw new SecurityException("مفتاح المزامنة لا يطابق هذا الملف. بعد إعادة التثبيت استورد ملف الربط الأصلي من شاشة الأمان");
        }
        new JSONObject(payload);
        String actualHash = QatraDatabase.sha256(payload);
        if (!constantTimeEquals(expectedHash, actualHash)) {
            throw new SecurityException("بصمة محتوى المزامنة غير متطابقة");
        }
        return new EncryptedPackage(
                packageId, operationId,
                senderRole, targetRole, operationType, expectedHash, payload, bytes);
    }

    /**
     * Creates a device-independent backup encrypted by a recovery password entered in a native
     * Android dialog. The password and derived key are never persisted and the backup does not
     * depend on the application-scoped Android Keystore key, so it survives uninstall/reinstall.
     */
    /**
     * Creates a portable backup without asking the customer for a recovery code. The application
     * manages the recovery credential consistently across reinstalls of the same Qatra role.
     * Legacy V2 backups remain readable through the separate legacy-code path.
     */
    public EncryptedPackage encryptPortableBackup(
            String role, String operationType, String payloadJson,
            byte[] syncKeyForRecovery) throws Exception {
        return encryptPortableBackupWithCredential(role, operationType, payloadJson,
                automaticRecoveryPassword(role), syncKeyForRecovery);
    }

    private EncryptedPackage encryptPortableBackupWithCredential(
            String role, String operationType, String payloadJson, String recoveryPassword,
            byte[] syncKeyForRecovery) throws Exception {
        validatePortableBackupRoute(role, operationType);
        byte[] payloadBytes = payloadJson == null ? new byte[0] : payloadJson.getBytes(StandardCharsets.UTF_8);
        if (payloadBytes.length == 0 || payloadBytes.length > MAX_PAYLOAD_BYTES) {
            throw new SecurityException("حجم النسخة الاحتياطية غير صالح");
        }
        new JSONObject(payloadJson);

        String packageId = "BKP-" + UUID.randomUUID();
        String operationId = "RESTORE-" + UUID.randomUUID();
        String payloadHash = QatraDatabase.sha256(payloadJson);
        JSONObject header = new JSONObject();
        header.put("format", PORTABLE_BACKUP_FORMAT);
        header.put("version", 3);
        header.put("recoveryMode", "APP_MANAGED");
        header.put("packageId", packageId);
        header.put("operationId", operationId);
        header.put("senderRole", role);
        header.put("targetRole", role);
        header.put("operationType", operationType);
        header.put("createdAt", System.currentTimeMillis());
        header.put("payloadHash", payloadHash);
        boolean containsSyncKey = syncKeyForRecovery != null && syncKeyForRecovery.length > 0;
        if (containsSyncKey && syncKeyForRecovery.length != 32) {
            throw new SecurityException("مفتاح المزامنة المرفق بالنسخة غير صالح");
        }
        header.put("containsSyncKey", containsSyncKey);
        byte[] headerBytes = header.toString().getBytes(StandardCharsets.UTF_8);

        byte[] salt = randomBytes(16);
        byte[] iv = randomBytes(12);
        String kdf = "PBKDF2WithHmacSHA1";
        SecretKey recoveryKey = derivePinKey(recoveryPassword, salt, PBKDF2_ITERATIONS, kdf);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, recoveryKey, new GCMParameterSpec(GCM_TAG_BITS, iv));
        cipher.updateAAD(headerBytes);
        byte[] ciphertext = cipher.doFinal(payloadBytes);

        JSONObject envelope = new JSONObject();
        envelope.put("format", PORTABLE_BACKUP_FORMAT);
        envelope.put("header", b64(headerBytes));
        envelope.put("iterations", PBKDF2_ITERATIONS);
        envelope.put("kdf", kdf);
        envelope.put("salt", b64(salt));
        envelope.put("iv", b64(iv));
        envelope.put("ciphertext", b64(ciphertext));
        if (containsSyncKey) {
            byte[] keyIv = randomBytes(12);
            Cipher keyCipher = Cipher.getInstance("AES/GCM/NoPadding");
            keyCipher.init(Cipher.ENCRYPT_MODE, recoveryKey, new GCMParameterSpec(GCM_TAG_BITS, keyIv));
            keyCipher.updateAAD(recoveryKeyAad(headerBytes));
            envelope.put("keyIv", b64(keyIv));
            envelope.put("wrappedSyncKey", b64(keyCipher.doFinal(syncKeyForRecovery)));
        }
        return new EncryptedPackage(packageId, operationId, role, role,
                operationType, payloadHash, payloadJson,
                envelope.toString().getBytes(StandardCharsets.UTF_8));
    }

    public boolean isPortableBackup(byte[] bytes) {
        if (bytes == null || bytes.length < 120 || bytes.length > 30_000_000) return false;
        try {
            JSONObject envelope = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            String format = envelope.optString("format");
            return PORTABLE_BACKUP_FORMAT.equals(format)
                    || LEGACY_PORTABLE_BACKUP_FORMAT.equals(format);
        } catch(Exception ignored) {
            return false;
        }
    }

    public boolean requiresLegacyRecoveryCode(byte[] bytes) {
        if (!isPortableBackup(bytes)) return false;
        try {
            JSONObject envelope = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            byte[] headerBytes = fromB64(envelope.getString("header"));
            JSONObject header = new JSONObject(new String(headerBytes, StandardCharsets.UTF_8));
            return LEGACY_PORTABLE_BACKUP_FORMAT.equals(envelope.optString("format"))
                    && LEGACY_PORTABLE_BACKUP_FORMAT.equals(header.optString("format"))
                    && header.optInt("version", 0) == 2;
        } catch (Exception ignored) {
            return false;
        }
    }

    /**
     * Reads only the public routing header of a Qatra package. This does not decrypt, trust or
     * import the payload; it is used solely to hand a URI to the installed role application that
     * will perform the normal authenticated decryption and permission checks.
     */
    public static String peekTargetRole(byte[] bytes) {
        if (bytes == null || bytes.length < 80 || bytes.length > 30_000_000) return "";
        try {
            JSONObject envelope = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            String format = envelope.optString("format", "");
            boolean portable = PORTABLE_BACKUP_FORMAT.equals(format)
                    || LEGACY_PORTABLE_BACKUP_FORMAT.equals(format);
            if (!SYNC_FORMAT.equals(format) && !portable) return "";
            byte[] headerBytes = fromB64(envelope.getString("header"));
            if (headerBytes.length < 80 || headerBytes.length > 4096) return "";
            JSONObject header = new JSONObject(new String(headerBytes, StandardCharsets.UTF_8));
            if (!format.equals(header.optString("format", ""))) return "";
            int version = header.optInt("version", 0);
            if (SYNC_FORMAT.equals(format) && version != 1) return "";
            if (PORTABLE_BACKUP_FORMAT.equals(format) && version != 3) return "";
            if (LEGACY_PORTABLE_BACKUP_FORMAT.equals(format) && version != 2) return "";
            String targetRole = header.optString("targetRole", "").trim().toUpperCase(Locale.ROOT);
            validateRole(targetRole);
            return targetRole;
        } catch(Exception ignored) {
            return "";
        }
    }

    public static boolean isRecognizedPackage(byte[] bytes) {
        if (bytes == null || bytes.length < 40 || bytes.length > 30_000_000) return false;
        try {
            String format = new JSONObject(new String(bytes, StandardCharsets.UTF_8))
                    .optString("format", "");
            return SYNC_FORMAT.equals(format)
                    || PAIR_FORMAT.equals(format)
                    || PORTABLE_BACKUP_FORMAT.equals(format)
                    || LEGACY_PORTABLE_BACKUP_FORMAT.equals(format);
        } catch (Exception ignored) {
            return false;
        }
    }

    public EncryptedPackage decryptPortableBackup(
            byte[] bytes, String currentRole) throws Exception {
        return decryptPortableBackup(bytes, currentRole, null);
    }

    public EncryptedPackage decryptPortableBackup(
            byte[] bytes, String currentRole, String recoveryPassword) throws Exception {
        validateRole(currentRole);
        if (bytes == null || bytes.length < 120 || bytes.length > 30_000_000) {
            throw new SecurityException("حجم النسخة الاحتياطية غير صالح");
        }
        JSONObject envelope = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        String format = envelope.optString("format", "");
        boolean automatic = PORTABLE_BACKUP_FORMAT.equals(format);
        boolean legacy = LEGACY_PORTABLE_BACKUP_FORMAT.equals(format);
        if (!automatic && !legacy) {
            throw new SecurityException("هذا ليس ملف نسخة احتياطية محمولة لقطرة برو");
        }
        byte[] headerBytes = fromB64(envelope.getString("header"));
        if (headerBytes.length < 100 || headerBytes.length > 4096) {
            throw new SecurityException("ترويسة النسخة الاحتياطية غير صالحة");
        }
        JSONObject header = new JSONObject(new String(headerBytes, StandardCharsets.UTF_8));
        int version = header.optInt("version", 0);
        if (!format.equals(header.optString("format"))
                || (automatic && version != 3)
                || (legacy && version != 2)) {
            throw new SecurityException("إصدار النسخة الاحتياطية غير مدعوم");
        }
        String senderRole = header.getString("senderRole");
        String targetRole = header.getString("targetRole");
        String operationType = header.getString("operationType");
        String packageId = header.getString("packageId");
        String operationId = header.getString("operationId");
        String expectedHash = header.getString("payloadHash");
        validatePortableBackupRoute(senderRole, operationType);
        if (!senderRole.equals(targetRole) || !currentRole.equals(targetRole)) {
            throw new SecurityException("النسخة الاحتياطية مخصصة لتطبيق " + targetRole + " وليست " + currentRole);
        }
        if (!packageId.matches("BKP-[0-9a-fA-F-]{36}")
                || !operationId.matches("RESTORE-[0-9a-fA-F-]{36}")
                || !expectedHash.matches("[0-9a-fA-F]{64}")) {
            throw new SecurityException("معرّفات النسخة الاحتياطية غير صالحة");
        }
        String credential;
        if (automatic) {
            if (!"APP_MANAGED".equals(header.optString("recoveryMode", ""))) {
                throw new SecurityException("طريقة حماية النسخة الاحتياطية غير مدعومة");
            }
            credential = automaticRecoveryPassword(targetRole);
        } else {
            validateRecoveryPassword(recoveryPassword);
            credential = recoveryPassword;
        }
        int iterations = envelope.optInt("iterations", 0);
        if (iterations < 100_000 || iterations > 1_000_000) {
            throw new SecurityException("إعدادات حماية النسخة الاحتياطية غير آمنة");
        }
        String kdf = envelope.optString("kdf", "");
        if (!"PBKDF2WithHmacSHA256".equals(kdf) && !"PBKDF2WithHmacSHA1".equals(kdf)) {
            throw new SecurityException("خوارزمية النسخة الاحتياطية غير مدعومة");
        }
        byte[] salt = fromB64(envelope.getString("salt"));
        byte[] iv = fromB64(envelope.getString("iv"));
        byte[] ciphertext = fromB64(envelope.getString("ciphertext"));
        if (salt.length != 16 || iv.length != 12 || ciphertext.length < 17
                || ciphertext.length > MAX_PAYLOAD_BYTES + 16) {
            throw new SecurityException("بنية النسخة الاحتياطية المشفرة غير صالحة");
        }
        SecretKey recoveryKey = derivePinKey(credential, salt, iterations, kdf);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, recoveryKey, new GCMParameterSpec(GCM_TAG_BITS, iv));
        cipher.updateAAD(headerBytes);
        final String payload;
        try {
            payload = new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch(BadPaddingException wrongPasswordOrDamaged) {
            throw new SecurityException(legacy
                    ? "رمز استعادة النسخة القديمة غير صحيح، أو الملف تالف"
                    : "تعذر فتح النسخة الاحتياطية؛ الملف تالف أو ليس صادرًا من قطرة برو");
        }
        new JSONObject(payload);
        if (!constantTimeEquals(expectedHash, QatraDatabase.sha256(payload))) {
            throw new SecurityException("بصمة النسخة الاحتياطية غير متطابقة");
        }
        byte[] recoveredSyncKey = null;
        if (header.optBoolean("containsSyncKey", false)) {
            byte[] keyIv = fromB64(envelope.getString("keyIv"));
            byte[] wrappedSyncKey = fromB64(envelope.getString("wrappedSyncKey"));
            if (keyIv.length != 12 || wrappedSyncKey.length != 48) {
                throw new SecurityException("بنية مفتاح المزامنة داخل النسخة غير صالحة");
            }
            Cipher keyCipher = Cipher.getInstance("AES/GCM/NoPadding");
            keyCipher.init(Cipher.DECRYPT_MODE, recoveryKey, new GCMParameterSpec(GCM_TAG_BITS, keyIv));
            keyCipher.updateAAD(recoveryKeyAad(headerBytes));
            try {
                recoveredSyncKey = keyCipher.doFinal(wrappedSyncKey);
            } catch(BadPaddingException damagedWrappedKey) {
                throw new SecurityException("مفتاح المزامنة داخل النسخة الاحتياطية تالف");
            }
            if (recoveredSyncKey.length != 32) {
                throw new SecurityException("مفتاح المزامنة داخل النسخة غير صالح");
            }
        }
        return new EncryptedPackage(packageId, operationId, senderRole, targetRole,
                operationType, expectedHash, payload, bytes, recoveredSyncKey);
    }

    public byte[] syncKeyForPortableBackup() throws Exception {
        // The first unified backup establishes the institution key. Restoring that backup on a
        // second device is the only supported way to join the controlled device exchange.
        return getOrCreateSyncKey();
    }

    public void restoreRecoveredSyncKey(byte[] recoveredSyncKey) throws Exception {
        if (recoveredSyncKey == null || recoveredSyncKey.length == 0) return;
        if (recoveredSyncKey.length != 32) throw new SecurityException("مفتاح المزامنة المستعاد غير صالح");
        if (isProvisioned()) {
            try {
                byte[] current = requireSyncKey();
                if (!Arrays.equals(current, recoveredSyncKey)) {
                    throw new SecurityException("النسخة مرتبطة بشبكة مزامنة مختلفة عن التطبيق الحالي");
                }
                return;
            } catch(Exception currentKeyFailure) {
                if (currentKeyFailure.getMessage() != null
                        && currentKeyFailure.getMessage().contains("شبكة مزامنة مختلفة")) throw currentKeyFailure;
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                        .remove(PREF_SYNC_KEY).commit();
            }
        }
        storeSyncKey(recoveredSyncKey);
    }

    private byte[] getOrCreateSyncKey() throws Exception {
        if (isProvisioned()) return requireSyncKey();
        byte[] key = randomBytes(32);
        storeSyncKey(key);
        return key;
    }

    private byte[] requireSyncKey() throws Exception {
        String encoded = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(PREF_SYNC_KEY, null);
        if (encoded == null) throw new SecurityException("يجب ربط مفتاح المزامنة أولاً من شاشة الأمان");
        JSONObject wrapped = new JSONObject(new String(fromB64(encoded), StandardCharsets.UTF_8));
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        byte[] iv = fromB64(wrapped.getString("iv"));
        byte[] ciphertext = fromB64(wrapped.getString("ciphertext"));
        if (iv.length != 12 || ciphertext.length != 48) {
            throw new SecurityException("حاوية مفتاح المزامنة المحلي تالفة");
        }
        cipher.init(Cipher.DECRYPT_MODE, getWrappingKey(false),
                new GCMParameterSpec(GCM_TAG_BITS, iv));
        final byte[] key;
        try {
            key = cipher.doFinal(ciphertext);
        } catch(BadPaddingException replacedKeystoreKey) {
            throw new SecurityException("فُقد مفتاح Android Keystore بعد إعادة التثبيت. استورد ملف الربط الأصلي، ثم افتح النسخة القديمة");
        }
        if (key.length != 32) throw new SecurityException("مفتاح المزامنة المحلي تالف");
        return key;
    }

    private void storeSyncKey(byte[] syncKey) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getWrappingKey(true));
        JSONObject wrapped = new JSONObject();
        wrapped.put("iv", b64(cipher.getIV()));
        wrapped.put("ciphertext", b64(cipher.doFinal(syncKey)));
        boolean committed = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(PREF_SYNC_KEY, b64(wrapped.toString().getBytes(StandardCharsets.UTF_8)))
                .commit();
        if (!committed) throw new IllegalStateException("تعذر حفظ مفتاح المزامنة المحلي");
    }

    private SecretKey getWrappingKey(boolean create) throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(WRAP_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(WRAP_ALIAS, null)).getSecretKey();
        }
        if (!create) throw new SecurityException("مفتاح حماية المزامنة المحلي غير موجود");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
                WRAP_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    private static SecretKey derivePinKey(String pin, byte[] salt, int iterations, String algorithm) throws Exception {
        PBEKeySpec spec = new PBEKeySpec(pin.toCharArray(), salt, iterations, 256);
        try {
            return new SecretKeySpec(SecretKeyFactory.getInstance(algorithm)
                    .generateSecret(spec).getEncoded(), "AES");
        } finally {
            spec.clearPassword();
        }
    }

    private static void validateRoute(String senderRole, String targetRole, String operationType) {
        validateRole(senderRole);
        validateRole(targetRole);
        if (operationType == null || !operationType.matches("[A-Z0-9_]{3,60}")) {
            throw new SecurityException("نوع عملية المزامنة غير صالح");
        }
        if ("UNIFIED".equals(senderRole) || "UNIFIED".equals(targetRole)) {
            boolean controlled = "UNIFIED".equals(senderRole)
                    && "UNIFIED".equals(targetRole)
                    && ("DEVICE_CHANGESET".equals(operationType)
                    || "DEVICE_RECEIPT".equals(operationType));
            if (!controlled) {
                throw new SecurityException(
                        "مزامنة ERP متعددة الأجهزة غير معتمدة في هذه المرحلة خارج تبادل الملفات المحكوم");
            }
            return;
        }
        boolean allowed;
        if ("ROLE_BACKUP".equals(operationType)) {
            allowed = senderRole.equals(targetRole);
        } else if ("CONFIRMATION".equals(operationType)) {
            allowed = !senderRole.equals(targetRole);
        } else if ("ADMIN".equals(senderRole)) {
            allowed = ("READER".equals(targetRole) && "ASSIGN_READINGS".equals(operationType))
                    || ("COLLECTOR".equals(targetRole) && "ASSIGN_COLLECTIONS".equals(operationType))
                    || ("CASHIER".equals(targetRole) && "CASHBOX_SETUP".equals(operationType))
                    || ("ADMIN".equals(targetRole) && "FULL_BACKUP".equals(operationType));
        } else if ("READER".equals(senderRole)) {
            allowed = "ADMIN".equals(targetRole) && "READING_BATCH".equals(operationType);
        } else if ("COLLECTOR".equals(senderRole)) {
            allowed = ("ADMIN".equals(targetRole) || "CASHIER".equals(targetRole))
                    && "COLLECTION_BATCH".equals(operationType);
        } else {
            allowed = "ADMIN".equals(targetRole)
                    && ("CASHBOX_BATCH".equals(operationType)
                    || "DIRECT_PAYMENT_BATCH".equals(operationType));
        }
        if (!allowed) {
            throw new SecurityException("المسار غير مسموح: " + senderRole + " -> " + targetRole
                    + " (" + operationType + ")");
        }
    }

    private static void validateRole(String role) {
        if (!ROLES.contains(role)) throw new SecurityException("صلاحية التطبيق غير معروفة");
    }

    private static void validatePortableBackupRoute(String role, String operationType) {
        validateRole(role);
        boolean allowed = ("ADMIN".equals(role) || "UNIFIED".equals(role))
                ? "FULL_BACKUP".equals(operationType)
                : "ROLE_BACKUP".equals(operationType);
        if (!allowed) throw new SecurityException("نوع النسخة الاحتياطية لا يطابق صلاحية التطبيق");
    }

    private static String automaticRecoveryPassword(String role) throws Exception {
        validateRole(role);
        // This is an application-managed compatibility credential, not a customer-entered secret.
        // It keeps portable files encrypted and restorable after reinstall without burdening users.
        return QatraDatabase.sha256("QATRA_PORTABLE_AUTO_RECOVERY_V3|" + role
                + "|QATRA_PRO_ROLE_BOUND_BACKUP");
    }

    private static void validateRecoveryPassword(String password) {
        if (password == null || password.length() < 8 || password.length() > 64) {
            throw new SecurityException("رمز الاستعادة يجب أن يكون من 8 إلى 64 محرفًا");
        }
    }

    private static void validatePin(String pin) {
        if (pin == null || pin.length() < 8 || pin.length() > 64) {
            throw new SecurityException("رمز الربط يجب أن يكون من 8 إلى 64 محرفًا");
        }
    }

    private static boolean constantTimeEquals(String a, String b) {
        byte[] left = a == null ? new byte[0] : a.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.US_ASCII);
        byte[] right = b == null ? new byte[0] : b.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.US_ASCII);
        int diff = left.length ^ right.length;
        for (int i = 0; i < Math.max(left.length, right.length); i++) {
            byte x = i < left.length ? left[i] : 0;
            byte y = i < right.length ? right[i] : 0;
            diff |= x ^ y;
        }
        return diff == 0;
    }

    private static byte[] recoveryKeyAad(byte[] headerBytes) {
        byte[] suffix = "|QATRA_SYNC_KEY".getBytes(StandardCharsets.US_ASCII);
        byte[] out = Arrays.copyOf(headerBytes, headerBytes.length + suffix.length);
        System.arraycopy(suffix, 0, out, headerBytes.length, suffix.length);
        return out;
    }

    private static byte[] randomBytes(int length) {
        byte[] out = new byte[length];
        RANDOM.nextBytes(out);
        return out;
    }

    private static String b64(byte[] bytes) {
        return Base64.encodeToString(bytes, Base64.NO_WRAP);
    }

    private static byte[] fromB64(String encoded) {
        return Base64.decode(encoded, Base64.NO_WRAP);
    }

    public static final class EncryptedPackage {
        public final String packageId;
        public final String operationId;
        public final String senderRole;
        public final String targetRole;
        public final String operationType;
        public final String payloadHash;
        public final String payloadJson;
        public final byte[] bytes;
        public final byte[] recoveredSyncKey;

        EncryptedPackage(String packageId, String operationId, String senderRole,
                         String targetRole, String operationType, String payloadHash,
                         String payloadJson, byte[] bytes) {
            this(packageId, operationId, senderRole, targetRole, operationType,
                    payloadHash, payloadJson, bytes, null);
        }

        EncryptedPackage(String packageId, String operationId, String senderRole,
                         String targetRole, String operationType, String payloadHash,
                         String payloadJson, byte[] bytes, byte[] recoveredSyncKey) {
            this.packageId = packageId;
            this.operationId = operationId;
            this.senderRole = senderRole;
            this.targetRole = targetRole;
            this.operationType = operationType;
            this.payloadHash = payloadHash;
            this.payloadJson = payloadJson;
            this.bytes = bytes;
            this.recoveredSyncKey = recoveredSyncKey == null ? null
                    : Arrays.copyOf(recoveredSyncKey, recoveredSyncKey.length);
        }

        public JSONObject toInspectionJson(boolean duplicate) throws Exception {
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("duplicate", duplicate);
            out.put("packageId", packageId);
            out.put("operationId", operationId);
            out.put("senderRole", senderRole);
            out.put("targetRole", targetRole);
            out.put("operationType", operationType);
            out.put("payloadHash", payloadHash);
            out.put("payload", new JSONObject(payloadJson));
            return out;
        }
    }
}
