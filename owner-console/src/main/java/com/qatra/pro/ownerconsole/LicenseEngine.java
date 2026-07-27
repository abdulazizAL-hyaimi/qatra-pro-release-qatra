package com.qatra.pro.ownerconsole;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

final class LicenseEngine {
    static final String LICENSE_SCHEMA = "QATRA_LICENSE_V1";
    static final String TRIAL_SCHEMA = "QATRA_TRIAL_GRANT_V1";
    static final String REQUEST_SCHEMA = "QATRA_LICENSE_REQUEST_V1";
    static final long TRIAL_DURATION_MS = 30L * 24L * 60L * 60L * 1000L;
    static final List<String> ALL_ROLES = Collections.unmodifiableList(
            java.util.Arrays.asList("ADMIN", "READER", "COLLECTOR", "CASHIER"));
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "qatra.owner.console.signing.ec.v1";

    static final class Request {
        final String organizationId;
        final String deviceCode;
        final List<String> requestedRoles;
        final String requestingRole;
        final boolean productionBuild;

        Request(String organizationId, String deviceCode, List<String> requestedRoles,
                String requestingRole, boolean productionBuild) {
            this.organizationId = organizationId;
            this.deviceCode = deviceCode;
            this.requestedRoles = requestedRoles;
            this.requestingRole = requestingRole;
            this.productionBuild = productionBuild;
        }
    }

    static void ensureSigningKey() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return;
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE);
        generator.initialize(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(false)
                .build());
        generator.generateKeyPair();
    }

    static PublicKey publicKey() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        java.security.cert.Certificate cert = store.getCertificate(KEY_ALIAS);
        if (cert == null) throw new IllegalStateException("مفتاح التوقيع غير مهيأ");
        return cert.getPublicKey();
    }

    static PrivateKey privateKey() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        java.security.Key key = store.getKey(KEY_ALIAS, null);
        if (!(key instanceof PrivateKey)) throw new IllegalStateException("المفتاح الخاص غير متاح");
        return (PrivateKey) key;
    }

    static String publicKeyBase64() throws Exception {
        return Base64.encodeToString(publicKey().getEncoded(), Base64.NO_WRAP);
    }

    static String publicKeyFingerprint() throws Exception {
        byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(publicKey().getEncoded());
        StringBuilder out = new StringBuilder();
        for (byte value : digest) {
            if (out.length() > 0) out.append(':');
            out.append(String.format(Locale.US, "%02X", value & 0xff));
        }
        return out.toString();
    }

    static Request parseRequest(String rawValue) throws Exception {
        String raw = rawValue == null ? "" : rawValue.replaceAll("\\s+", "").trim();
        if (!raw.startsWith("QLR1.")) throw new SecurityException("طلب التفعيل يجب أن يبدأ بـ QLR1.");
        byte[] decoded;
        try {
            decoded = Base64.decode(raw.substring(5), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        } catch (Exception error) {
            throw new SecurityException("طلب التفعيل تالف");
        }
        JSONObject in = new JSONObject(new String(decoded, StandardCharsets.UTF_8));
        if (!REQUEST_SCHEMA.equals(in.optString("schema", ""))) throw new SecurityException("إصدار طلب التفعيل غير مدعوم");
        String organizationId = in.optString("organizationId", "").trim().toUpperCase(Locale.ROOT);
        String deviceCode = in.optString("deviceCode", "").trim().toUpperCase(Locale.ROOT);
        if (!organizationId.matches("ORG-[A-Z0-9]{16,40}")) throw new SecurityException("هوية المنشأة غير صالحة");
        if (!deviceCode.matches("QTR-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}")) throw new SecurityException("رمز الجهاز غير صالح");
        JSONArray rolesArray = in.optJSONArray("requestedRoles");
        if (rolesArray == null || rolesArray.length() == 0) throw new SecurityException("الطلب لا يحتوي تطبيقات مطلوبة");
        LinkedHashSet<String> roleSet = new LinkedHashSet<>();
        for (int i = 0; i < rolesArray.length(); i++) {
            String role = cleanRole(rolesArray.optString(i, ""));
            if (!ALL_ROLES.contains(role)) throw new SecurityException("الطلب يحتوي تطبيقًا غير معروف");
            roleSet.add(role);
        }
        return new Request(organizationId, deviceCode, new ArrayList<>(roleSet),
                cleanRole(in.optString("requestingRole", "")), in.optBoolean("productionBuild", false));
    }

    static JSONObject signLicense(Request request, String customerName, String licenseId,
                                  Set<String> selectedRoles) throws Exception {
        String customer = customerName == null ? "" : customerName.trim();
        if (customer.length() < 2 || customer.length() > 120) throw new SecurityException("اسم العميل يجب أن يكون بين 2 و120 محرفًا");
        String id = licenseId == null || licenseId.trim().isEmpty() ? newLicenseId() : licenseId.trim().toUpperCase(Locale.ROOT);
        if (!id.matches("LIC-[A-Z0-9-]{8,64}")) throw new SecurityException("رقم الرخصة يجب أن يبدأ بـ LIC-");
        TreeSet<String> roles = new TreeSet<>();
        for (String role : selectedRoles) {
            String clean = cleanRole(role);
            if (!ALL_ROLES.contains(clean) || !request.requestedRoles.contains(clean)) {
                throw new SecurityException("لا يمكن إصدار صلاحية غير موجودة في طلب الجهاز");
            }
            roles.add(clean);
        }
        if (roles.isEmpty()) throw new SecurityException("اختر تطبيقًا واحدًا على الأقل");

        JSONObject license = new JSONObject();
        license.put("schema", LICENSE_SCHEMA);
        license.put("licenseId", id);
        license.put("organizationId", request.organizationId);
        license.put("customerName", customer);
        license.put("deviceCode", request.deviceCode);
        license.put("allowedRoles", new JSONArray(roles));
        license.put("perpetual", true);
        license.put("issuedAt", System.currentTimeMillis());

        Signature signer = Signature.getInstance("SHA256withECDSA");
        signer.initSign(privateKey());
        signer.update(canonical(license, roles).getBytes(StandardCharsets.UTF_8));
        license.put("signature", Base64.encodeToString(signer.sign(),
                Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING));
        return license;
    }

    static JSONObject signTrialGrant(Request request, String customerName,
                                     Set<String> selectedRoles) throws Exception {
        String customer = customerName == null ? "" : customerName.trim();
        if (customer.length() < 2 || customer.length() > 120) {
            throw new SecurityException("اسم العميل يجب أن يكون بين 2 و120 محرفًا");
        }
        TreeSet<String> roles = selectedRoles(request, selectedRoles);
        long issuedAt = System.currentTimeMillis();
        JSONObject grant = new JSONObject();
        grant.put("schema", TRIAL_SCHEMA);
        grant.put("trialId", newTrialId());
        grant.put("organizationId", request.organizationId);
        grant.put("customerName", customer);
        grant.put("deviceCode", request.deviceCode);
        grant.put("allowedRoles", new JSONArray(roles));
        grant.put("issuedAt", issuedAt);
        grant.put("expiresAt", issuedAt + TRIAL_DURATION_MS);

        Signature signer = Signature.getInstance("SHA256withECDSA");
        signer.initSign(privateKey());
        signer.update(canonicalTrial(grant, roles).getBytes(StandardCharsets.UTF_8));
        grant.put("signature", Base64.encodeToString(signer.sign(),
                Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING));
        return grant;
    }

    static boolean verifyLicense(JSONObject license) throws Exception {
        if (TRIAL_SCHEMA.equals(license.optString("schema", ""))) {
            TreeSet<String> roles = roles(license.optJSONArray("allowedRoles"));
            if (license.optLong("expiresAt", 0L) - license.optLong("issuedAt", 0L)
                    != TRIAL_DURATION_MS) return false;
            Signature verifier = Signature.getInstance("SHA256withECDSA");
            verifier.initVerify(publicKey());
            verifier.update(canonicalTrial(license, roles).getBytes(StandardCharsets.UTF_8));
            byte[] signature = Base64.decode(license.optString("signature", ""),
                    Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            return verifier.verify(signature);
        }
        if (!LICENSE_SCHEMA.equals(license.optString("schema", ""))) return false;
        TreeSet<String> roles = roles(license.optJSONArray("allowedRoles"));
        Signature verifier = Signature.getInstance("SHA256withECDSA");
        verifier.initVerify(publicKey());
        verifier.update(canonical(license, roles).getBytes(StandardCharsets.UTF_8));
        byte[] signature = Base64.decode(license.optString("signature", ""),
                Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        return verifier.verify(signature);
    }

    static String compactToken(JSONObject license) {
        return "QL1." + Base64.encodeToString(license.toString().getBytes(StandardCharsets.UTF_8),
                Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static String canonical(JSONObject license, TreeSet<String> roles) {
        return LICENSE_SCHEMA + "\n"
                + license.optString("licenseId", "").trim() + "\n"
                + license.optString("organizationId", "").trim() + "\n"
                + license.optString("customerName", "").trim() + "\n"
                + license.optString("deviceCode", "").trim().toUpperCase(Locale.ROOT) + "\n"
                + join(roles) + "\n"
                + license.optBoolean("perpetual", false) + "\n"
                + license.optLong("issuedAt", 0L);
    }

    private static String canonicalTrial(JSONObject grant, TreeSet<String> roles) {
        return TRIAL_SCHEMA + "\n"
                + grant.optString("trialId", "").trim() + "\n"
                + grant.optString("organizationId", "").trim() + "\n"
                + grant.optString("customerName", "").trim() + "\n"
                + grant.optString("deviceCode", "").trim().toUpperCase(Locale.ROOT) + "\n"
                + join(roles) + "\n"
                + grant.optLong("issuedAt", 0L) + "\n"
                + grant.optLong("expiresAt", 0L);
    }

    private static TreeSet<String> selectedRoles(Request request, Set<String> selectedRoles)
            throws Exception {
        TreeSet<String> roles = new TreeSet<>();
        for (String role : selectedRoles) {
            String clean = cleanRole(role);
            if (!ALL_ROLES.contains(clean) || !request.requestedRoles.contains(clean)) {
                throw new SecurityException("لا يمكن إصدار صلاحية غير موجودة في طلب الجهاز");
            }
            roles.add(clean);
        }
        if (roles.isEmpty()) throw new SecurityException("اختر تطبيقًا واحدًا على الأقل");
        return roles;
    }

    private static TreeSet<String> roles(JSONArray values) throws Exception {
        if (values == null || values.length() == 0) throw new SecurityException("الرخصة لا تحتوي صلاحيات");
        TreeSet<String> roles = new TreeSet<>();
        for (int i = 0; i < values.length(); i++) {
            String role = cleanRole(values.optString(i, ""));
            if (!ALL_ROLES.contains(role)) throw new SecurityException("صلاحية غير معروفة");
            roles.add(role);
        }
        return roles;
    }

    private static String join(TreeSet<String> roles) {
        StringBuilder out = new StringBuilder();
        for (String role : roles) {
            if (out.length() > 0) out.append(',');
            out.append(role);
        }
        return out.toString();
    }

    private static String cleanRole(String value) {
        return value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
    }

    private static String newLicenseId() {
        String date = new SimpleDateFormat("yyyyMMdd", Locale.US).format(new Date());
        return "LIC-" + date + "-" + UUID.randomUUID().toString().replace("-", "")
                .substring(0, 10).toUpperCase(Locale.ROOT);
    }

    private static String newTrialId() {
        String date = new SimpleDateFormat("yyyyMMdd", Locale.US).format(new Date());
        return "TRY-" + date + "-" + UUID.randomUUID().toString().replace("-", "")
                .substring(0, 10).toUpperCase(Locale.ROOT);
    }

    private LicenseEngine() { }
}
