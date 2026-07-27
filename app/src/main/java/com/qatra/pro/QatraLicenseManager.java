package com.qatra.pro;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.SignatureException;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.TreeSet;
import java.util.UUID;

import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;

/**
 * Native commercial-license boundary shared by the four role applications.
 *
 * <p>The 30-day trial and last trusted device time are authenticated with a key held by Android
 * Keystore. Permanent activation is verified with an embedded public key. The corresponding
 * private key is intentionally absent from the APK and repository.</p>
 */
final class QatraLicenseManager {
    enum Status {
        TRIAL_REQUIRED,
        TRIAL_ACTIVE,
        TRIAL_EXPIRED,
        LICENSED,
        CLOCK_TAMPER,
        STATE_TAMPER
    }

    static final long TRIAL_DURATION_MS = 30L * 24L * 60L * 60L * 1000L;
    private static final long CLOCK_ROLLBACK_TOLERANCE_MS = 5L * 60L * 1000L;
    private static final long TRUSTED_TIME_WRITE_INTERVAL_MS = 60L * 1000L;
    private static final String PREFS = "qatra_native_license";
    private static final String PREF_STATE = "state_v1";
    private static final String PREF_STATE_MAC = "state_mac_v1";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "qatra.license.state.hmac.v1";
    private static final String LICENSE_SCHEMA = "QATRA_LICENSE_V1";
    private static final String TRIAL_SCHEMA = "QATRA_TRIAL_GRANT_V1";
    private static final String REQUEST_SCHEMA = "QATRA_LICENSE_REQUEST_V1";
    private static final String PROVISIONING_SCHEMA = "QATRA_TRIAL_PROVISIONING_V1";
    private static final List<String> ALL_ROLES = Collections.unmodifiableList(
            Arrays.asList("ADMIN", "READER", "COLLECTOR", "CASHIER"));

    static final class Snapshot {
        final Status status;
        final String organizationId;
        final String customerName;
        final String licenseId;
        final String deviceCode;
        final long trialStartedAt;
        final long trialExpiresAt;
        final long remainingMs;
        final String message;

        Snapshot(Status status, State state, String deviceCode, long now, String message) {
            this.status = status;
            this.organizationId = state == null ? "" : state.organizationId;
            this.customerName = state == null ? "" : state.customerName;
            this.licenseId = state == null ? "" : state.licenseId;
            this.deviceCode = deviceCode == null ? "" : deviceCode;
            this.trialStartedAt = state == null ? 0L : state.trialStartedAt;
            this.trialExpiresAt = state == null ? 0L : state.trialExpiresAt;
            this.remainingMs = state == null ? 0L : Math.max(0L, state.trialExpiresAt - now);
            this.message = message == null ? "" : message;
        }

        boolean operationalAllowed() {
            return status == Status.TRIAL_ACTIVE || status == Status.LICENSED;
        }

        int remainingDays() {
            if (status != Status.TRIAL_ACTIVE || remainingMs <= 0L) return 0;
            return (int) Math.max(1L, (remainingMs + 86_399_999L) / 86_400_000L);
        }

        JSONObject toJson() throws Exception {
            JSONObject out = new JSONObject();
            out.put("status", status.name());
            out.put("operationalAllowed", operationalAllowed());
            out.put("organizationId", organizationId);
            out.put("customerName", customerName);
            out.put("licenseId", licenseId);
            out.put("deviceCode", deviceCode);
            out.put("trialStartedAt", trialStartedAt);
            out.put("trialExpiresAt", trialExpiresAt);
            out.put("remainingDays", remainingDays());
            out.put("perpetual", status == Status.LICENSED);
            out.put("message", message);
            return out;
        }
    }

    static final class Provisioning {
        final String organizationId;
        final long trialStartedAt;
        final long trialExpiresAt;

        Provisioning(String organizationId, long trialStartedAt, long trialExpiresAt) {
            this.organizationId = organizationId;
            this.trialStartedAt = trialStartedAt;
            this.trialExpiresAt = trialExpiresAt;
        }
    }

    private static final class State {
        String organizationId;
        long trialStartedAt;
        long trialExpiresAt;
        long lastTrustedWallAt;
        long lastElapsedAt;
        boolean provisionedByAdmin;
        boolean trialGrantRequired;
        String licenseToken;
        String licenseId;
        String customerName;

        JSONObject toJson() throws Exception {
            JSONObject out = new JSONObject();
            out.put("schema", 1);
            out.put("organizationId", organizationId);
            out.put("trialStartedAt", trialStartedAt);
            out.put("trialExpiresAt", trialExpiresAt);
            out.put("lastTrustedWallAt", lastTrustedWallAt);
            out.put("lastElapsedAt", lastElapsedAt);
            out.put("provisionedByAdmin", provisionedByAdmin);
            out.put("trialGrantRequired", trialGrantRequired);
            out.put("licenseToken", licenseToken == null ? "" : licenseToken);
            out.put("licenseId", licenseId == null ? "" : licenseId);
            out.put("customerName", customerName == null ? "" : customerName);
            return out;
        }

        static State fromJson(String json) throws Exception {
            JSONObject in = new JSONObject(json);
            if (in.optInt("schema", 0) != 1) throw new SecurityException("إصدار حالة الترخيص غير معروف");
            State state = new State();
            state.organizationId = in.optString("organizationId", "");
            state.trialStartedAt = in.optLong("trialStartedAt", 0L);
            state.trialExpiresAt = in.optLong("trialExpiresAt", 0L);
            state.lastTrustedWallAt = in.optLong("lastTrustedWallAt", 0L);
            state.lastElapsedAt = in.optLong("lastElapsedAt", 0L);
            state.provisionedByAdmin = in.optBoolean("provisionedByAdmin", false);
            state.trialGrantRequired = in.optBoolean("trialGrantRequired", false);
            state.licenseToken = in.optString("licenseToken", "");
            state.licenseId = in.optString("licenseId", "");
            state.customerName = in.optString("customerName", "");
            validateOrganizationId(state.organizationId);
            if (state.trialStartedAt <= 0L
                    || state.trialExpiresAt - state.trialStartedAt != TRIAL_DURATION_MS) {
                throw new SecurityException("مدة التجربة المحلية غير صالحة");
            }
            return state;
        }
    }

    private final Context context;
    private final String role;
    private final SharedPreferences prefs;
    private final String deviceCode;

    QatraLicenseManager(Context context, String role) {
        this.context = context.getApplicationContext();
        this.role = cleanRole(role);
        if (!ALL_ROLES.contains(this.role)) throw new IllegalArgumentException("صلاحية التطبيق غير معروفة");
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.deviceCode = buildDeviceCode();
    }

    synchronized Snapshot ensureInitialized() {
        try {
            if (!prefs.contains(PREF_STATE) && !prefs.contains(PREF_STATE_MAC)) {
                long now = System.currentTimeMillis();
                State state = new State();
                state.organizationId = newOrganizationId();
                state.trialStartedAt = now;
                state.trialExpiresAt = now + TRIAL_DURATION_MS;
                state.lastTrustedWallAt = now;
                state.lastElapsedAt = SystemClock.elapsedRealtime();
                state.provisionedByAdmin = "ADMIN".equals(role);
                // A new installation must import an owner-signed, device-bound trial grant.
                // This state survives upgrades, while reinstalling cannot mint a fresh 30 days.
                state.trialGrantRequired = true;
                state.licenseToken = "";
                state.licenseId = "";
                state.customerName = "";
                storeVerifiedState(state);
            }
            return evaluateVerifiedState(true);
        } catch (Exception error) {
            return tamperSnapshot(error);
        }
    }

    synchronized Snapshot current() {
        try {
            if (!prefs.contains(PREF_STATE) && !prefs.contains(PREF_STATE_MAC)) {
                return ensureInitialized();
            }
            return evaluateVerifiedState(true);
        } catch (Exception error) {
            return tamperSnapshot(error);
        }
    }

    synchronized Snapshot activate(String rawToken) throws Exception {
        JSONObject token = parseLicenseToken(rawToken);
        boolean permanent = LICENSE_SCHEMA.equals(token.optString("schema", ""));
        if (permanent) verifyLicenseToken(token);
        else verifyTrialGrant(token);
        String organizationId = token.getString("organizationId");
        State state = null;
        try {
            state = loadVerifiedState();
        } catch (Exception ignored) { }
        if (state == null) {
            long now = System.currentTimeMillis();
            state = new State();
            state.organizationId = organizationId;
            state.trialStartedAt = now;
            state.trialExpiresAt = now + TRIAL_DURATION_MS;
            state.lastTrustedWallAt = now;
            state.lastElapsedAt = SystemClock.elapsedRealtime();
            state.provisionedByAdmin = !"ADMIN".equals(role);
        }
        // A valid owner-signed, device-bound token is authoritative. This permits the same paid
        // activation file to recover a customer after uninstall, when local trial preferences
        // were recreated with a new random organization id.
        state.organizationId = organizationId;
        state.licenseToken = token.toString();
        state.licenseId = permanent ? token.getString("licenseId") : token.getString("trialId");
        state.customerName = token.getString("customerName");
        state.trialGrantRequired = false;
        if (!permanent) {
            state.trialStartedAt = token.getLong("issuedAt");
            state.trialExpiresAt = token.getLong("expiresAt");
        }
        state.lastTrustedWallAt = Math.max(state.lastTrustedWallAt, System.currentTimeMillis());
        state.lastElapsedAt = SystemClock.elapsedRealtime();
        storeVerifiedState(state);
        return evaluateVerifiedState(false);
    }

    synchronized String activationRequest() throws Exception {
        State state = loadVerifiedState();
        JSONObject request = new JSONObject();
        request.put("schema", REQUEST_SCHEMA);
        request.put("organizationId", state.organizationId);
        request.put("deviceCode", deviceCode);
        request.put("requestedRoles", new JSONArray(ALL_ROLES));
        request.put("requestingRole", role);
        request.put("productionBuild", BuildConfig.PRODUCTION_BUILD);
        request.put("createdAt", System.currentTimeMillis());
        return "QLR1." + Base64.encodeToString(request.toString().getBytes(StandardCharsets.UTF_8),
                Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    synchronized String attachProvisioning(String operationType, String payloadJson) throws Exception {
        if (!"ADMIN".equals(role) || !isSetupOperation(operationType)) return payloadJson;
        State state = loadVerifiedState();
        JSONObject payload = new JSONObject(payloadJson);
        JSONObject provisioning = new JSONObject();
        provisioning.put("schema", PROVISIONING_SCHEMA);
        provisioning.put("organizationId", state.organizationId);
        provisioning.put("trialStartedAt", state.trialStartedAt);
        provisioning.put("trialExpiresAt", state.trialExpiresAt);
        payload.put("licenseProvisioning", provisioning);
        return payload.toString();
    }

    synchronized Provisioning validateProvisioning(
            String senderRole, String operationType, String payloadJson) throws Exception {
        if ("ADMIN".equals(role) || !"ADMIN".equals(cleanRole(senderRole))
                || !isSetupOperation(operationType)) return null;
        JSONObject payload = new JSONObject(payloadJson);
        JSONObject in = payload.optJSONObject("licenseProvisioning");
        if (in == null) throw new SecurityException("ملف الإعداد لا يحتوي هوية تجربة المنشأة");
        if (!PROVISIONING_SCHEMA.equals(in.optString("schema", ""))) {
            throw new SecurityException("إصدار تهيئة تجربة المنشأة غير صالح");
        }
        String organizationId = in.optString("organizationId", "");
        long startedAt = in.optLong("trialStartedAt", 0L);
        long expiresAt = in.optLong("trialExpiresAt", 0L);
        validateOrganizationId(organizationId);
        if (startedAt <= 0L || expiresAt - startedAt != TRIAL_DURATION_MS
                || startedAt > System.currentTimeMillis() + 24L * 60L * 60L * 1000L) {
            throw new SecurityException("تواريخ تجربة المنشأة في ملف الإعداد غير صالحة");
        }
        State current = loadVerifiedState();
        if (current.provisionedByAdmin && !current.organizationId.equals(organizationId)) {
            throw new SecurityException("هذا الجهاز مرتبط بمنشأة أخرى");
        }
        if (current.licenseToken != null && !current.licenseToken.isEmpty()
                && !current.organizationId.equals(organizationId)) {
            throw new SecurityException("الرخصة الحالية لا تخص المنشأة المرسلة");
        }
        return new Provisioning(organizationId, startedAt, expiresAt);
    }

    synchronized void adoptProvisioning(Provisioning provisioning) throws Exception {
        if (provisioning == null) return;
        State state = loadVerifiedState();
        state.organizationId = provisioning.organizationId;
        state.trialStartedAt = provisioning.trialStartedAt;
        state.trialExpiresAt = provisioning.trialExpiresAt;
        state.provisionedByAdmin = true;
        state.trialGrantRequired = false;
        state.lastTrustedWallAt = Math.max(state.lastTrustedWallAt, System.currentTimeMillis());
        state.lastElapsedAt = SystemClock.elapsedRealtime();
        storeVerifiedState(state);
    }

    private Snapshot evaluateVerifiedState(boolean persistTrustedTime) throws Exception {
        State state = loadVerifiedState();
        long now = System.currentTimeMillis();
        long elapsed = SystemClock.elapsedRealtime();

        if (state.licenseToken != null && !state.licenseToken.isEmpty()) {
            JSONObject token = parseLicenseToken(state.licenseToken);
            boolean permanent = LICENSE_SCHEMA.equals(token.optString("schema", ""));
            if (permanent) verifyLicenseToken(token);
            else verifyTrialGrant(token);
            if (!state.organizationId.equals(token.getString("organizationId"))) {
                throw new SignatureException("هوية الرخصة لا تطابق المنشأة");
            }
            if (permanent) {
                return new Snapshot(Status.LICENSED, state, deviceCode, now,
                        "تفعيل دائم موثّق بالتوقيع الرقمي");
            }
            if (state.trialStartedAt != token.getLong("issuedAt")
                    || state.trialExpiresAt != token.getLong("expiresAt")) {
                throw new SignatureException("تواريخ التجربة لا تطابق المنحة الموقعة");
            }
        }

        if (state.trialGrantRequired) {
            return new Snapshot(Status.TRIAL_REQUIRED, state, deviceCode, now,
                    "يلزم استيراد منحة تجربة موقعة من المالك. إعادة التثبيت لا تبدأ تجربة جديدة.");
        }

        if (now + CLOCK_ROLLBACK_TOLERANCE_MS < state.lastTrustedWallAt) {
            return new Snapshot(Status.CLOCK_TAMPER, state, deviceCode, now,
                    "تم رصد إرجاع ساعة الجهاز إلى الخلف. صحح التاريخ والوقت ثم أعد فتح التطبيق.");
        }
        if (persistTrustedTime && now - state.lastTrustedWallAt >= TRUSTED_TIME_WRITE_INTERVAL_MS) {
            state.lastTrustedWallAt = now;
            state.lastElapsedAt = elapsed;
            storeVerifiedState(state);
        }
        if (now >= state.trialExpiresAt) {
            return new Snapshot(Status.TRIAL_EXPIRED, state, deviceCode, now,
                    "انتهت تجربة قطرة برو لمدة 30 يومًا. البيانات محفوظة ولم تُحذف.");
        }
        return new Snapshot(Status.TRIAL_ACTIVE, state, deviceCode, now,
                "الفترة التجريبية فعّالة");
    }

    private State loadVerifiedState() throws Exception {
        String json = prefs.getString(PREF_STATE, "");
        String storedMac = prefs.getString(PREF_STATE_MAC, "");
        if (json.isEmpty() || storedMac.isEmpty()) throw new SecurityException("حالة الترخيص غير مكتملة");
        SecretKey key = stateKey(false);
        if (key == null) throw new SecurityException("مفتاح حماية الترخيص غير موجود");
        String actualMac = stateMac(key, json);
        if (!MessageDigest.isEqual(actualMac.getBytes(StandardCharsets.US_ASCII),
                storedMac.getBytes(StandardCharsets.US_ASCII))) {
            throw new SecurityException("تم تعديل حالة الترخيص المحلية");
        }
        return State.fromJson(json);
    }

    private void storeVerifiedState(State state) throws Exception {
        String json = state.toJson().toString();
        String mac = stateMac(stateKey(true), json);
        if (!prefs.edit().putString(PREF_STATE, json).putString(PREF_STATE_MAC, mac).commit()) {
            throw new IllegalStateException("تعذر حفظ حالة الترخيص المحمية");
        }
    }

    private SecretKey stateKey(boolean create) throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        }
        if (!create) return null;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                .setDigests(KeyProperties.DIGEST_SHA256)
                .build());
        return generator.generateKey();
    }

    private static String stateMac(SecretKey key, String json) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(key);
        return Base64.encodeToString(mac.doFinal(json.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
    }

    private JSONObject parseLicenseToken(String raw) throws Exception {
        String value = raw == null ? "" : raw.trim();
        if (value.startsWith("QL1.")) {
            value = new String(Base64.decode(value.substring(4),
                    Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING), StandardCharsets.UTF_8);
        }
        if (value.length() < 40 || value.length() > 16_000) {
            throw new SecurityException("رمز التفعيل غير صالح");
        }
        return new JSONObject(value);
    }

    private void verifyTrialGrant(JSONObject token) throws Exception {
        if (!TRIAL_SCHEMA.equals(token.optString("schema", ""))) {
            throw new SecurityException("إصدار ملف التفعيل غير مدعوم");
        }
        String trialId = token.optString("trialId", "").trim();
        String organizationId = token.optString("organizationId", "").trim();
        String customerName = token.optString("customerName", "").trim();
        String requestedDevice = token.optString("deviceCode", "").trim().toUpperCase(Locale.ROOT);
        long issuedAt = token.optLong("issuedAt", 0L);
        long expiresAt = token.optLong("expiresAt", 0L);
        if (!trialId.matches("TRY-[A-Z0-9-]{8,64}")) throw new SecurityException("رقم منحة التجربة غير صالح");
        validateOrganizationId(organizationId);
        if (customerName.length() < 2 || customerName.length() > 120) {
            throw new SecurityException("اسم العميل في منحة التجربة غير صالح");
        }
        if (!deviceCode.equals(requestedDevice)) throw new SecurityException("منحة التجربة صادرة لجهاز آخر");
        if (issuedAt <= 0L || issuedAt > System.currentTimeMillis() + 24L * 60L * 60L * 1000L
                || expiresAt - issuedAt != TRIAL_DURATION_MS) {
            throw new SecurityException("مدة منحة التجربة يجب أن تكون 30 يومًا بالضبط");
        }
        TreeSet<String> allowedRoles = roles(token.optJSONArray("allowedRoles"));
        if (!allowedRoles.contains(role)) throw new SecurityException("منحة التجربة لا تشمل هذا التطبيق");
        java.security.Signature verifier = java.security.Signature.getInstance("SHA256withECDSA");
        verifier.initVerify(licensePublicKey());
        verifier.update(canonicalTrial(token, allowedRoles).getBytes(StandardCharsets.UTF_8));
        byte[] signatureBytes;
        try {
            signatureBytes = Base64.decode(token.optString("signature", ""),
                    Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        } catch (Exception error) {
            throw new SignatureException("توقيع منحة التجربة غير صالح");
        }
        if (!verifier.verify(signatureBytes)) throw new SignatureException("تعذر التحقق من توقيع منحة التجربة");
    }

    private void verifyLicenseToken(JSONObject token) throws Exception {
        if (!LICENSE_SCHEMA.equals(token.optString("schema", ""))) {
            throw new SecurityException("إصدار الرخصة غير مدعوم");
        }
        String licenseId = token.optString("licenseId", "").trim();
        String organizationId = token.optString("organizationId", "").trim();
        String customerName = token.optString("customerName", "").trim();
        String requestedDevice = token.optString("deviceCode", "").trim().toUpperCase(Locale.ROOT);
        boolean perpetual = token.optBoolean("perpetual", false);
        long issuedAt = token.optLong("issuedAt", 0L);
        String signatureValue = token.optString("signature", "");
        if (!licenseId.matches("LIC-[A-Z0-9-]{8,64}")) throw new SecurityException("رقم الرخصة غير صالح");
        validateOrganizationId(organizationId);
        if (customerName.length() < 2 || customerName.length() > 120) throw new SecurityException("اسم العميل في الرخصة غير صالح");
        if (!deviceCode.equals(requestedDevice)) throw new SecurityException("الرخصة صادرة لجهاز آخر");
        if (!perpetual) throw new SecurityException("هذه النسخة تتطلب رخصة تفعيل دائم");
        if (issuedAt <= 0L || issuedAt > System.currentTimeMillis() + 24L * 60L * 60L * 1000L) {
            throw new SecurityException("تاريخ إصدار الرخصة غير صالح");
        }
        TreeSet<String> allowedRoles = roles(token.optJSONArray("allowedRoles"));
        if (!allowedRoles.contains(role)) throw new SecurityException("الرخصة لا تشمل هذا التطبيق");

        java.security.Signature verifier = java.security.Signature.getInstance("SHA256withECDSA");
        verifier.initVerify(licensePublicKey());
        verifier.update(canonicalLicense(token, allowedRoles).getBytes(StandardCharsets.UTF_8));
        byte[] signatureBytes;
        try {
            signatureBytes = Base64.decode(signatureValue,
                    Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        } catch (Exception error) {
            throw new SignatureException("توقيع الرخصة غير صالح");
        }
        if (!verifier.verify(signatureBytes)) throw new SignatureException("تعذر التحقق من توقيع الرخصة");
    }

    private PublicKey licensePublicKey() throws Exception {
        byte[] der = Base64.decode(BuildConfig.LICENSE_PUBLIC_KEY_BASE64, Base64.DEFAULT);
        return KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(der));
    }

    private static String canonicalLicense(JSONObject token, TreeSet<String> roles) {
        return LICENSE_SCHEMA + "\n"
                + token.optString("licenseId", "").trim() + "\n"
                + token.optString("organizationId", "").trim() + "\n"
                + token.optString("customerName", "").trim() + "\n"
                + token.optString("deviceCode", "").trim().toUpperCase(Locale.ROOT) + "\n"
                + join(roles) + "\n"
                + token.optBoolean("perpetual", false) + "\n"
                + token.optLong("issuedAt", 0L);
    }

    private static String canonicalTrial(JSONObject token, TreeSet<String> roles) {
        return TRIAL_SCHEMA + "\n"
                + token.optString("trialId", "").trim() + "\n"
                + token.optString("organizationId", "").trim() + "\n"
                + token.optString("customerName", "").trim() + "\n"
                + token.optString("deviceCode", "").trim().toUpperCase(Locale.ROOT) + "\n"
                + join(roles) + "\n"
                + token.optLong("issuedAt", 0L) + "\n"
                + token.optLong("expiresAt", 0L);
    }

    private static TreeSet<String> roles(JSONArray values) throws Exception {
        if (values == null || values.length() == 0 || values.length() > ALL_ROLES.size()) {
            throw new SecurityException("صلاحيات تطبيقات الرخصة غير صالحة");
        }
        TreeSet<String> roles = new TreeSet<>();
        for (int i = 0; i < values.length(); i++) {
            String role = cleanRole(values.optString(i, ""));
            if (!ALL_ROLES.contains(role)) throw new SecurityException("تحتوي الرخصة على صلاحية غير معروفة");
            roles.add(role);
        }
        return roles;
    }

    private String buildDeviceCode() {
        try {
            String androidId = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
            if (androidId == null || androidId.trim().isEmpty()) androidId = "NO_ANDROID_ID";
            String material = "QATRA_LICENSE_DEVICE_V1|" + androidId + "|" + signingCertificateHash();
            String hex = hex(MessageDigest.getInstance("SHA-256").digest(material.getBytes(StandardCharsets.UTF_8)))
                    .substring(0, 32).toUpperCase(Locale.ROOT);
            return "QTR-" + hex.substring(0, 8) + "-" + hex.substring(8, 16) + "-"
                    + hex.substring(16, 24) + "-" + hex.substring(24, 32);
        } catch (Exception error) {
            throw new IllegalStateException("تعذر إنشاء هوية الجهاز للرخصة", error);
        }
    }

    @SuppressWarnings("deprecation")
    private String signingCertificateHash() throws Exception {
        PackageManager manager = context.getPackageManager();
        PackageInfo info;
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= 28) {
            info = manager.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
            if (info.signingInfo == null) throw new SecurityException("توقيع APK غير متاح");
            signatures = info.signingInfo.hasMultipleSigners()
                    ? info.signingInfo.getApkContentsSigners()
                    : info.signingInfo.getSigningCertificateHistory();
        } else {
            info = manager.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNATURES);
            signatures = info.signatures;
        }
        if (signatures == null || signatures.length == 0) throw new SecurityException("توقيع APK غير متاح");
        return hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray()));
    }

    private Snapshot tamperSnapshot(Exception error) {
        String message = error == null || error.getMessage() == null
                ? "تعذر التحقق من حالة الترخيص" : error.getMessage();
        return new Snapshot(Status.STATE_TAMPER, null, deviceCode, System.currentTimeMillis(), message);
    }

    private static boolean isSetupOperation(String operationType) {
        String operation = operationType == null ? "" : operationType.trim().toUpperCase(Locale.ROOT);
        return "ASSIGN_READINGS".equals(operation)
                || "ASSIGN_COLLECTIONS".equals(operation)
                || "CASHBOX_SETUP".equals(operation);
    }

    private static String cleanRole(String value) {
        return value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
    }

    private static String newOrganizationId() {
        return "ORG-" + UUID.randomUUID().toString().replace("-", "").substring(0, 24).toUpperCase(Locale.ROOT);
    }

    private static void validateOrganizationId(String value) {
        if (value == null || !value.matches("ORG-[A-Z0-9]{16,40}")) {
            throw new SecurityException("هوية المنشأة غير صالحة");
        }
    }

    private static String join(TreeSet<String> values) {
        StringBuilder out = new StringBuilder();
        for (String value : values) {
            if (out.length() > 0) out.append(',');
            out.append(value);
        }
        return out.toString();
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) out.append(String.format(Locale.US, "%02x", value & 0xff));
        return out.toString();
    }
}
