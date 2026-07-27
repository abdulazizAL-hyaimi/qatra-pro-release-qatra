package com.qatra.pro;

import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.text.InputType;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Locale;

import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;

/**
 * Native username + PIN boundary shared by the four Qatra Pro role applications.
 *
 * <p>The screen is intentionally native: PIN values never enter the WebView. The classic Qatra
 * Pro identity, role accent and biometric fallback are rendered consistently for
 * Administration, Field Reader, Collector and Cashier.</p>
 */
final class QatraAccessControl {
    interface Callback { void onUnlocked(String username); }

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "qatra.access.hmac.v1";
    private static final String PREFS = "qatra_native_access";
    private static final String PREF_USERNAME = "username_v2";
    private static final String PREF_SALT = "pin_salt_v1";
    private static final String PREF_DIGEST = "pin_digest_v1";
    private static final String PREF_FAILED = "failed_attempts";
    private static final String PREF_LOCK_UNTIL = "lock_until";
    private static final String PREF_BIOMETRIC_ENABLED = "biometric_enabled_v1";
    private static final String PREF_BIOMETRIC_OFFERED = "biometric_offered_v1";
    private static final int BIOMETRIC_AUTHENTICATORS =
            BiometricManager.Authenticators.BIOMETRIC_STRONG;
    private static final SecureRandom RANDOM = new SecureRandom();

    private static final int NAVY = Color.rgb(16, 42, 67);
    private static final int BLUE = Color.rgb(30, 115, 190);
    private static final int AQUA = Color.rgb(44, 196, 199);
    private static final int GOLD = Color.rgb(176, 141, 87);
    private static final int CREAM = Color.rgb(246, 241, 231);
    private static final int BODY_TEXT = Color.rgb(35, 48, 58);
    private static final int MUTED = Color.rgb(94, 109, 120);

    private final FragmentActivity activity;
    private final String role;
    private final SharedPreferences prefs;
    private final Runnable driveRestoreLauncher;
    private AlertDialog activeDialog;
    private BiometricPrompt activeBiometricPrompt;
    private boolean biometricPromptActive;
    private String currentUsername = "";
    private String requiredEnrollmentUsername = "";

    QatraAccessControl(FragmentActivity activity, String role, Runnable driveRestoreLauncher) {
        this.activity = activity;
        this.role = role == null ? "UNKNOWN" : role.toUpperCase(Locale.ROOT);
        this.driveRestoreLauncher = driveRestoreLauncher;
        this.prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    void requireEnrollmentUsername(String username) {
        String normalized = normalizeUsername(username);
        if (normalized.matches("[a-z0-9_.-]{3,32}")) requiredEnrollmentUsername = normalized;
    }

    void showGate(Callback callback) {
        if (activity.isFinishing() || activeDialog != null || biometricPromptActive) return;
        activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        try {
            if (hasStoredVerifier() && !hasKeystoreKey()) {
                showFatal("تعذر العثور على مفتاح حماية الدخول. أوقف استخدام النسخة وأعد تهيئتها بإشراف الإدارة.");
                return;
            }
            if (!hasStoredVerifier()) showEnrollment(callback);
            else if (!hasStoredUsername()) showLegacyUpgrade(callback);
            else showUnlock(callback, biometricEnabled() && !biometricAvailable()
                    ? "البصمة غير متاحة حاليًا. استخدم اسم المستخدم ورمز PIN."
                    : "أدخل بيانات حسابك لفتح التطبيق.");
        } catch (Exception error) {
            showFatal("تعذر تشغيل حماية الدخول: " + safeMessage(error));
        }
    }

    void showAccessSettings() {
        if (activeDialog != null || biometricPromptActive || activity.isFinishing()) return;
        final boolean enabled = biometricEnabled();
        final String biometricAction = enabled ? "إيقاف الدخول بالبصمة" : "تفعيل الدخول بالبصمة";
        final String status = enabled
                ? "البصمة مفعّلة لهذا الجهاز، وPIN متاح دائمًا كخيار احتياطي."
                : "البصمة غير مفعّلة. لن يتم حفظ رمز PIN عند تفعيلها.";
        activeDialog = new AlertDialog.Builder(activity)
                .setTitle("حماية الحساب")
                .setMessage(status)
                .setItems(new String[]{"تغيير رمز PIN", biometricAction},
                        (dialog, which) -> {
                            clearActive();
                            activity.getWindow().getDecorView().post(() -> {
                                if (which == 0) showChangePin();
                                else if (which == 1 && enabled) showDisableBiometric();
                                else if (which == 1) enableBiometricFromSettings();
                            });
                        })
                .setNegativeButton("إغلاق", (dialog, which) -> clearActive())
                .create();
        activeDialog.setOnDismissListener(dialog -> clearActive());
        activeDialog.show();
    }

    void showChangePin() {
        if (activeDialog != null || activity.isFinishing()) return;
        final String username = storedUsername();
        if (username.isEmpty()) {
            showFatal("هوية المستخدم غير مهيأة. اقفل التطبيق وأكمل ترقية شاشة الدخول.");
            return;
        }
        final EditText current = pinInput("رمز PIN الحالي");
        final EditText next = pinInput("رمز PIN الجديد");
        final EditText confirm = pinInput("تأكيد الرمز الجديد");
        LinearLayout root = brandedCard("", "حماية الحساب",
                "اسم المستخدم: " + username + "\nغيّر رمز الدخول دون التأثير على البيانات.");
        addInput(root, current);
        addInput(root, next);
        addInput(root, confirm);
        Button save = primaryButton("تغيير رمز الدخول");
        save.setOnClickListener(v -> {
            try {
                requireNotLocked();
                if (!verify(username, current.getText().toString())) {
                    registerFailure();
                    current.setText("");
                    current.setError("اسم المستخدم أو رمز PIN غير صحيح");
                    return;
                }
                String value = next.getText().toString();
                validateNewPin(value, confirm.getText().toString());
                storeVerifier(username, value, false);
                resetFailures();
                dismissActive();
                toast("تم تغيير رمز PIN بنجاح");
            } catch (Exception error) {
                next.setError(safeMessage(error));
            }
        });
        root.addView(save, buttonParams(12));
        root.addView(secondaryButton("إلغاء", v -> dismissActive()), buttonParams(8));
        displayCard(root, true);
    }

    String getCurrentUsername() { return currentUsername; }

    void clearSession() {
        currentUsername = "";
        if (activeBiometricPrompt != null && biometricPromptActive) {
            activeBiometricPrompt.cancelAuthentication();
        }
        biometricPromptActive = false;
        activeBiometricPrompt = null;
    }

    private void showEnrollment(Callback callback) {
        final EditText username = usernameInput("اسم المستخدم");
        if (!requiredEnrollmentUsername.isEmpty()) {
            username.setText(requiredEnrollmentUsername);
            username.setEnabled(false);
        }
        final EditText pin = pinInput("رمز PIN جديد من ٦ إلى ١٢ رقمًا");
        final EditText confirm = pinInput("تأكيد رمز PIN");
        String message = requiredEnrollmentUsername.isEmpty()
                ? "هذه أول مرة تُفتح فيها نسخة " + roleArabic()
                    + ". أنشئ حساب دخول آمن أو استعد بياناتك من Google Drive."
                : "تمت استعادة بيانات المستخدم " + requiredEnrollmentUsername
                    + ". أنشئ رمز PIN جديدًا لهذا الجهاز.";
        LinearLayout root = brandedCard("", "إنشاء حساب الدخول", message);
        addInput(root, username);
        addInput(root, pin);
        addInput(root, confirm);
        Button save = primaryButton("حفظ وفتح التطبيق");
        save.setOnClickListener(v -> {
            try {
                String normalized = validateUsername(username.getText().toString());
                String value = pin.getText().toString();
                validateNewPin(value, confirm.getText().toString());
                storeVerifier(normalized, value, true);
                requiredEnrollmentUsername = "";
                resetFailures();
                completeUnlock(normalized, callback, true);
            } catch (Exception error) {
                if (!isUsernameValid(username.getText().toString())) username.setError(safeMessage(error));
                else pin.setError(safeMessage(error));
            }
        });
        root.addView(save, buttonParams(12));
        if (driveRestoreLauncher != null && requiredEnrollmentUsername.isEmpty()) {
            root.addView(secondaryButton("استعادة من Google Drive", v -> {
                dismissActive();
                activity.getWindow().getDecorView().post(driveRestoreLauncher);
            }), buttonParams(8));
        }
        root.addView(textButton("إغلاق التطبيق",
                v -> activity.finishAffinity()), buttonParams(4));
        displayCard(root, false);
    }

    /** Upgrades the previous one-PIN gate without deleting application data. */
    private void showLegacyUpgrade(Callback callback) {
        final EditText username = usernameInput("اسم المستخدم");
        final EditText pin = pinInput("رمز الدخول الحالي");
        LinearLayout root = brandedCard("", "ترقية تسجيل الدخول",
                "تحديث أمني لمرة واحدة: أضف اسم المستخدم إلى رمزك الحالي. لن تُمسح أي بيانات.");
        addInput(root, username);
        addInput(root, pin);
        Button upgrade = primaryButton("ترقية وفتح التطبيق");
        upgrade.setOnClickListener(v -> {
            try {
                requireNotLocked();
                String normalized = validateUsername(username.getText().toString());
                if (!verifyLegacy(pin.getText().toString())) {
                    long seconds = registerFailure();
                    pin.setText("");
                    pin.setError(seconds > 0 ? "محاولات كثيرة. حاول بعد " + seconds + " ثانية"
                            : "رمز الدخول الحالي غير صحيح");
                    return;
                }
                storeVerifier(normalized, pin.getText().toString(), false);
                resetFailures();
                completeUnlock(normalized, callback, true);
            } catch (Exception error) {
                if (!isUsernameValid(username.getText().toString())) username.setError(safeMessage(error));
                else pin.setError(safeMessage(error));
            }
        });
        root.addView(upgrade, buttonParams(12));
        root.addView(textButton("إغلاق التطبيق",
                v -> activity.finishAffinity()), buttonParams(4));
        displayCard(root, false);
    }

    private void showUnlock(Callback callback, String message) {
        if (activeDialog != null || activity.isFinishing()) return;
        final EditText username = usernameInput("اسم المستخدم");
        username.setText(storedUsername());
        username.setSelection(username.length());
        final EditText pin = pinInput("رمز PIN");
        LinearLayout root = brandedCard("", "تسجيل الدخول", message);
        addInput(root, username);
        addInput(root, pin);

        Button signIn = primaryButton("تسجيل الدخول");
        signIn.setOnClickListener(v -> {
            try {
                requireNotLocked();
                String normalized = normalizeUsername(username.getText().toString());
                if (!verify(normalized, pin.getText().toString())) {
                    long seconds = registerFailure();
                    pin.setText("");
                    pin.setError(seconds > 0
                            ? "محاولات كثيرة. حاول بعد " + seconds + " ثانية"
                            : "اسم المستخدم أو رمز PIN غير صحيح");
                    return;
                }
                resetFailures();
                completeUnlock(normalized, callback, true);
            } catch (Exception error) {
                pin.setError(safeMessage(error));
            }
        });
        root.addView(signIn, buttonParams(12));

        if (biometricAvailable()) {
            root.addView(secondaryButton("الدخول باستخدام البصمة", v -> {
                dismissActive();
                activity.getWindow().getDecorView().post(() -> showBiometricUnlock(callback));
            }), buttonParams(8));
        }
        root.addView(textButton("إغلاق التطبيق",
                v -> activity.finishAffinity()), buttonParams(2));
        displayCard(root, false);
    }

    private void completeUnlock(String username, Callback callback, boolean mayOfferBiometric) {
        currentUsername = username;
        dismissActive();
        callback.onUnlocked(username);
        if (mayOfferBiometric) maybeOfferBiometric();
    }

    private boolean biometricEnabled() {
        return prefs.getBoolean(PREF_BIOMETRIC_ENABLED, false);
    }

    private int biometricStatus() {
        return BiometricManager.from(activity).canAuthenticate(BIOMETRIC_AUTHENTICATORS);
    }

    private boolean biometricAvailable() {
        return biometricStatus() == BiometricManager.BIOMETRIC_SUCCESS;
    }

    private void showBiometricUnlock(Callback callback) {
        if (biometricPromptActive || activity.isFinishing()) return;
        biometricPromptActive = true;
        authenticateBiometric(
                "قطرة برو — " + roleArabic(),
                "استخدم البصمة لفتح نسخة " + roleArabic(),
                () -> {
                    biometricPromptActive = false;
                    activeBiometricPrompt = null;
                    resetFailures();
                    completeUnlock(storedUsername(), callback, false);
                },
                message -> {
                    biometricPromptActive = false;
                    activeBiometricPrompt = null;
                    showUnlock(callback, message + " استخدم اسم المستخدم ورمز PIN.");
                }
        );
    }

    private void maybeOfferBiometric() {
        if (biometricEnabled() || prefs.getBoolean(PREF_BIOMETRIC_OFFERED, false)
                || !biometricAvailable() || activity.isFinishing()) return;
        prefs.edit().putBoolean(PREF_BIOMETRIC_OFFERED, true).apply();
        activity.getWindow().getDecorView().post(() -> {
            if (activeDialog != null || biometricPromptActive || activity.isFinishing()) return;
            activeDialog = new AlertDialog.Builder(activity)
                    .setTitle("دخول أسرع وآمن")
                    .setMessage("هل تريد تفعيل الدخول بالبصمة؟ سيبقى اسم المستخدم وPIN متاحين، ولن يُحفظ PIN داخل التطبيق.")
                    .setPositiveButton("تفعيل البصمة", (dialog, which) -> {
                        clearActive();
                        activity.getWindow().getDecorView().post(this::enableBiometricFromSettings);
                    })
                    .setNegativeButton("ليس الآن", (dialog, which) -> clearActive())
                    .create();
            activeDialog.setOnDismissListener(dialog -> clearActive());
            activeDialog.show();
        });
    }

    private void enableBiometricFromSettings() {
        if (biometricPromptActive || activity.isFinishing()) return;
        int status = biometricStatus();
        if (status != BiometricManager.BIOMETRIC_SUCCESS) {
            showBiometricUnavailable(status);
            return;
        }
        biometricPromptActive = true;
        authenticateBiometric(
                "تفعيل الدخول بالبصمة",
                "أكد بصمتك لحماية نسخة " + roleArabic(),
                () -> {
                    biometricPromptActive = false;
                    activeBiometricPrompt = null;
                    prefs.edit().putBoolean(PREF_BIOMETRIC_ENABLED, true).commit();
                    toast("تم تفعيل الدخول بالبصمة. يبقى PIN خيارًا احتياطيًا.");
                },
                message -> {
                    biometricPromptActive = false;
                    activeBiometricPrompt = null;
                    toast(message + " لم يتم تفعيل البصمة.");
                }
        );
    }

    private void showDisableBiometric() {
        if (activeDialog != null || activity.isFinishing()) return;
        final EditText pin = pinInput("رمز PIN الحالي");
        LinearLayout root = brandedCard("", "إيقاف البصمة",
                "أدخل رمز PIN لإيقاف الدخول بالبصمة على هذا الجهاز.");
        addInput(root, pin);
        Button disable = primaryButton("إيقاف الدخول بالبصمة");
        disable.setOnClickListener(v -> {
            try {
                requireNotLocked();
                if (!verify(storedUsername(), pin.getText().toString())) {
                    long seconds = registerFailure();
                    pin.setText("");
                    pin.setError(seconds > 0 ? "محاولات كثيرة. حاول بعد " + seconds + " ثانية"
                            : "رمز PIN غير صحيح");
                    return;
                }
                resetFailures();
                prefs.edit().putBoolean(PREF_BIOMETRIC_ENABLED, false).commit();
                dismissActive();
                toast("تم إيقاف الدخول بالبصمة");
            } catch (Exception error) {
                pin.setError(safeMessage(error));
            }
        });
        root.addView(disable, buttonParams(12));
        root.addView(secondaryButton("إلغاء", v -> dismissActive()), buttonParams(8));
        displayCard(root, true);
    }

    private interface BiometricSuccess { void run(); }
    private interface BiometricFallback { void run(String message); }

    private void authenticateBiometric(String title, String subtitle,
                                       BiometricSuccess success, BiometricFallback fallback) {
        if (activity.isFinishing()) {
            biometricPromptActive = false;
            return;
        }
        activeBiometricPrompt = new BiometricPrompt(activity,
                ContextCompat.getMainExecutor(activity),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override public void onAuthenticationSucceeded(
                            BiometricPrompt.AuthenticationResult result) {
                        super.onAuthenticationSucceeded(result);
                        if (!biometricPromptActive) return;
                        success.run();
                    }

                    @Override public void onAuthenticationError(int errorCode, CharSequence errorText) {
                        super.onAuthenticationError(errorCode, errorText);
                        if (!biometricPromptActive) return;
                        String message = (errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                                || errorCode == BiometricPrompt.ERROR_USER_CANCELED
                                || errorCode == BiometricPrompt.ERROR_CANCELED)
                                ? "تم اختيار الدخول البديل."
                                : "تعذر التحقق بالبصمة: " + String.valueOf(errorText) + ".";
                        fallback.run(message);
                    }

                    @Override public void onAuthenticationFailed() {
                        super.onAuthenticationFailed();
                        toast("البصمة غير مطابقة. حاول مرة أخرى أو استخدم PIN.");
                    }
                });
        BiometricPrompt.PromptInfo prompt = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(subtitle)
                .setAllowedAuthenticators(BIOMETRIC_AUTHENTICATORS)
                .setNegativeButtonText("استخدام اسم المستخدم وPIN")
                .setConfirmationRequired(true)
                .build();
        activeBiometricPrompt.authenticate(prompt);
    }

    private void showBiometricUnavailable(int status) {
        String message;
        boolean canOpenSettings = false;
        if (status == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) {
            message = "لا توجد بصمة مسجلة على الجهاز. سجل بصمة من إعدادات Android ثم عد إلى التطبيق.";
            canOpenSettings = true;
        } else if (status == BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE) {
            message = "هذا الجهاز لا يحتوي على مستشعر بصمة متوافق.";
        } else if (status == BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE) {
            message = "مستشعر البصمة غير متاح مؤقتًا. حاول لاحقًا.";
        } else {
            message = "تعذر استخدام البصمة على هذا الجهاز. سيبقى الدخول باسم المستخدم وPIN متاحًا.";
        }
        AlertDialog.Builder builder = new AlertDialog.Builder(activity)
                .setTitle("البصمة غير متاحة")
                .setMessage(message)
                .setNegativeButton("إغلاق", null);
        if (canOpenSettings) {
            builder.setPositiveButton("فتح إعدادات الجهاز", (dialog, which) -> openBiometricSettings());
        }
        activeDialog = builder.create();
        activeDialog.setOnDismissListener(dialog -> clearActive());
        activeDialog.show();
    }

    private void openBiometricSettings() {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= 30) {
                intent = new Intent(Settings.ACTION_BIOMETRIC_ENROLL);
                intent.putExtra(Settings.EXTRA_BIOMETRIC_AUTHENTICATORS_ALLOWED,
                        BIOMETRIC_AUTHENTICATORS);
            } else {
                intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            }
            activity.startActivity(intent);
        } catch (Exception error) {
            toast("افتح إعدادات Android وسجل بصمة أولًا");
        }
    }

    private void showFatal(String message) {
        activeDialog = new AlertDialog.Builder(activity)
                .setTitle("تعذر فتح التطبيق بأمان")
                .setMessage(message)
                .setCancelable(false)
                .setPositiveButton("إغلاق", (d, w) -> activity.finishAffinity())
                .create();
        activeDialog.setOnDismissListener(d -> clearActive());
        activeDialog.show();
    }

    private boolean hasStoredVerifier() {
        return prefs.contains(PREF_SALT) && prefs.contains(PREF_DIGEST);
    }

    private boolean hasStoredUsername() { return !storedUsername().isEmpty(); }

    private String storedUsername() {
        return normalizeUsername(prefs.getString(PREF_USERNAME, ""));
    }

    private boolean hasKeystoreKey() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        return store.containsAlias(KEY_ALIAS);
    }

    private SecretKey getKey(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        if (!create) throw new SecurityException("مفتاح حماية الدخول غير موجود");
        KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_HMAC_SHA256, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
                .setDigests(KeyProperties.DIGEST_SHA256)
                .build());
        return generator.generateKey();
    }

    private byte[] digest(String username, String pin, byte[] salt, boolean createKey)
            throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(getKey(createKey));
        mac.update(salt);
        mac.update((byte) 0);
        mac.update(role.getBytes(StandardCharsets.UTF_8));
        mac.update((byte) 0);
        mac.update(normalizeUsername(username).getBytes(StandardCharsets.UTF_8));
        mac.update((byte) 0);
        return mac.doFinal((pin == null ? "" : pin).getBytes(StandardCharsets.UTF_8));
    }

    private byte[] legacyDigest(String pin, byte[] salt) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(getKey(false));
        mac.update(salt);
        mac.update((byte) 0);
        mac.update(role.getBytes(StandardCharsets.UTF_8));
        mac.update((byte) 0);
        return mac.doFinal((pin == null ? "" : pin).getBytes(StandardCharsets.UTF_8));
    }

    private boolean verify(String username, String pin) throws Exception {
        if (!hasStoredVerifier() || !hasStoredUsername()) return false;
        byte[] salt = Base64.decode(prefs.getString(PREF_SALT, ""), Base64.NO_WRAP);
        byte[] expected = Base64.decode(prefs.getString(PREF_DIGEST, ""), Base64.NO_WRAP);
        byte[] actual = digest(username, pin, salt, false);
        return MessageDigest.isEqual(expected, actual)
                && storedUsername().equals(normalizeUsername(username));
    }

    private boolean verifyLegacy(String pin) throws Exception {
        if (!hasStoredVerifier()) return false;
        byte[] salt = Base64.decode(prefs.getString(PREF_SALT, ""), Base64.NO_WRAP);
        byte[] expected = Base64.decode(prefs.getString(PREF_DIGEST, ""), Base64.NO_WRAP);
        return MessageDigest.isEqual(expected, legacyDigest(pin, salt));
    }

    private void storeVerifier(String username, String pin, boolean createKey) throws Exception {
        String normalized = validateUsername(username);
        byte[] salt = new byte[24];
        RANDOM.nextBytes(salt);
        byte[] value = digest(normalized, pin, salt, createKey);
        boolean committed = prefs.edit()
                .putString(PREF_USERNAME, normalized)
                .putString(PREF_SALT, Base64.encodeToString(salt, Base64.NO_WRAP))
                .putString(PREF_DIGEST, Base64.encodeToString(value, Base64.NO_WRAP))
                .commit();
        if (!committed) throw new IllegalStateException("تعذر حفظ إعداد حماية الدخول");
    }

    private String validateUsername(String value) {
        String username = normalizeUsername(value);
        if (!username.matches("[a-z0-9_.-]{3,32}")) {
            throw new SecurityException(
                    "اسم المستخدم من 3 إلى 32 حرفًا إنجليزيًا أو رقمًا دون مسافات");
        }
        return username;
    }

    private boolean isUsernameValid(String value) {
        return normalizeUsername(value).matches("[a-z0-9_.-]{3,32}");
    }

    private String normalizeUsername(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private void validateNewPin(String pin, String confirmation) {
        if (pin == null || !pin.matches("[0-9]{6,12}")) {
            throw new SecurityException("استخدم من 6 إلى 12 رقمًا");
        }
        if (!pin.equals(confirmation)) throw new SecurityException("رمزا PIN غير متطابقين");
        if (pin.matches("([0-9])\\1+") || "123456789012".contains(pin)
                || "987654321098".contains(pin) || "000000".equals(pin)
                || "123456".equals(pin) || "111111".equals(pin)) {
            throw new SecurityException("اختر رمزًا غير متكرر أو متسلسل");
        }
    }

    private void requireNotLocked() {
        long remaining = prefs.getLong(PREF_LOCK_UNTIL, 0L) - System.currentTimeMillis();
        if (remaining > 0) {
            throw new SecurityException(
                    "انتظر " + ((remaining + 999L) / 1000L) + " ثانية قبل المحاولة");
        }
    }

    /** Returns lock duration in seconds, or zero when the next retry is still allowed. */
    private long registerFailure() {
        int failures = prefs.getInt(PREF_FAILED, 0) + 1;
        long lockMs = failures < 5 ? 0L : Math.min(15L * 60_000L,
                30_000L * (1L << Math.min(5, failures - 5)));
        prefs.edit().putInt(PREF_FAILED, failures)
                .putLong(PREF_LOCK_UNTIL, System.currentTimeMillis() + lockMs).commit();
        return lockMs / 1000L;
    }

    private void resetFailures() {
        prefs.edit().remove(PREF_FAILED).remove(PREF_LOCK_UNTIL).commit();
    }

    private EditText usernameInput(String hint) {
        EditText input = baseInput(hint);
        input.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        input.setTextDirection(View.TEXT_DIRECTION_LTR);
        input.setInputType(InputType.TYPE_CLASS_TEXT
                | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        if (Build.VERSION.SDK_INT >= 26) {
            input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }
        return input;
    }

    private EditText pinInput(String hint) {
        EditText input = baseInput(hint);
        input.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        if (Build.VERSION.SDK_INT >= 26) {
            input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }
        return input;
    }

    private EditText baseInput(String hint) {
        EditText input = new EditText(activity);
        input.setHint(hint);
        input.setHintTextColor(Color.rgb(127, 143, 155));
        input.setTextColor(BODY_TEXT);
        input.setTextSize(15f);
        input.setSingleLine(true);
        input.setPadding(dp(16), 0, dp(16), 0);
        input.setBackground(roundRect(Color.WHITE, Color.rgb(207, 219, 228), 1f, 12f));
        return input;
    }

    private LinearLayout brandedCard(String titleEnglish, String titleArabic, String message) {
        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.setPadding(dp(18), 0, dp(18), dp(18));
        root.setBackground(roundRect(CREAM, GOLD, 1f, 20f));

        LinearLayout header = new LinearLayout(activity);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setGravity(Gravity.CENTER_HORIZONTAL);
        header.setPadding(dp(18), dp(18), dp(18), dp(16));
        header.setBackground(roundRect(NAVY, NAVY, 0f, 18f));

        ImageView logo = new ImageView(activity);
        logo.setImageResource(R.drawable.ic_launcher);
        logo.setContentDescription("شعار قطرة برو");
        header.addView(logo, new LinearLayout.LayoutParams(dp(96), dp(96)));

        TextView brand = text("QATRA PRO", 27f, true, Color.WHITE);
        brand.setTypeface(Typeface.create("serif", Typeface.BOLD));
        brand.setLetterSpacing(.08f);
        brand.setGravity(Gravity.CENTER);
        header.addView(brand, matchWrap(8));

        TextView descriptor = text("نظام إدارة خدمات المياه", 12f, true,
                Color.rgb(214, 234, 242));
        descriptor.setGravity(Gravity.CENTER);
        header.addView(descriptor, matchWrap(5));

        View accent = new View(activity);
        accent.setBackgroundColor(roleAccent());
        header.addView(accent, new LinearLayout.LayoutParams(dp(118), dp(3)));
        root.addView(header, new LinearLayout.LayoutParams(-1, -2));

        TextView roleTitle = text(roleArabic(), 18f, true, NAVY);
        roleTitle.setGravity(Gravity.CENTER);
        roleTitle.setTypeface(Typeface.create("serif", Typeface.BOLD));
        root.addView(roleTitle, matchWrap(16));

        TextView pageTitle = text(titleArabic, 16f, true, NAVY);
        pageTitle.setGravity(Gravity.CENTER);
        root.addView(pageTitle, matchWrap(10));

        TextView messageView = text(message, 13.5f, false, BODY_TEXT);
        messageView.setGravity(Gravity.CENTER);
        messageView.setLineSpacing(0f, 1.18f);
        root.addView(messageView, matchWrap(14));
        return root;
    }

    private void addInput(LinearLayout root, EditText input) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(54));
        params.setMargins(0, dp(7), 0, 0);
        root.addView(input, params);
    }

    private Button primaryButton(String label) {
        Button button = new Button(activity);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14f);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        button.setBackground(roundRect(roleAccent(), roleAccent(), 0f, 12f));
        return button;
    }

    private Button secondaryButton(String label, View.OnClickListener listener) {
        Button button = new Button(activity);
        button.setText(label);
        button.setTextColor(NAVY);
        button.setTextSize(13f);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        button.setBackground(roundRect(Color.WHITE, roleAccent(), 1f, 12f));
        button.setOnClickListener(listener);
        return button;
    }

    private Button textButton(String label, View.OnClickListener listener) {
        Button button = new Button(activity);
        button.setText(label);
        button.setTextColor(MUTED);
        button.setTextSize(12f);
        button.setAllCaps(false);
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setOnClickListener(listener);
        return button;
    }

    private LinearLayout.LayoutParams buttonParams(int topMarginDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(50));
        params.setMargins(0, dp(topMarginDp), 0, 0);
        return params;
    }

    private LinearLayout.LayoutParams matchWrap(int topMarginDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.setMargins(0, dp(topMarginDp), 0, 0);
        return params;
    }

    private TextView text(String value, float size, boolean bold, int color) {
        TextView view = new TextView(activity);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setTypeface(Typeface.DEFAULT, bold ? Typeface.BOLD : Typeface.NORMAL);
        return view;
    }

    private TextView smallText(String value, int color) {
        return text(value, 11.5f, false, color);
    }

    private GradientDrawable roundRect(int fill, int stroke, float strokeWidthDp,
                                       float radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radiusDp));
        if (strokeWidthDp > 0f) drawable.setStroke(dp(strokeWidthDp), stroke);
        return drawable;
    }

    private void displayCard(LinearLayout root, boolean cancelable) {
        ScrollView scroll = new ScrollView(activity);
        scroll.setFillViewport(true);
        scroll.setPadding(dp(12), dp(12), dp(12), dp(12));
        scroll.setBackgroundColor(Color.rgb(238, 245, 248));
        scroll.addView(root, new ScrollView.LayoutParams(-1, -2));
        activeDialog = new AlertDialog.Builder(activity)
                .setView(scroll)
                .setCancelable(cancelable)
                .create();
        activeDialog.setOnDismissListener(dialog -> clearActive());
        activeDialog.setOnShowListener(dialog -> {
            Window window = activeDialog.getWindow();
            if (window != null) {
                window.setBackgroundDrawableResource(android.R.color.transparent);
                window.setLayout((int) (activity.getResources().getDisplayMetrics().widthPixels * .94f),
                        WindowManager.LayoutParams.WRAP_CONTENT);
            }
        });
        activeDialog.show();
    }

    private int roleAccent() {
        if ("READER".equals(role)) return Color.rgb(11, 143, 198);
        if ("COLLECTOR".equals(role)) return Color.rgb(24, 183, 160);
        if ("CASHIER".equals(role)) return Color.rgb(216, 161, 22);
        return BLUE;
    }

    private String roleEnglish() {
        if ("ADMIN".equals(role)) return "Administration";
        if ("READER".equals(role)) return "Field Reader";
        if ("COLLECTOR".equals(role)) return "Collector";
        if ("CASHIER".equals(role)) return "Cashier";
        return role;
    }

    private String roleArabic() {
        if ("ADMIN".equals(role)) return "الإدارة";
        if ("READER".equals(role)) return "الكاشف";
        if ("COLLECTOR".equals(role)) return "المحصل";
        if ("CASHIER".equals(role)) return "الصندوق";
        return role;
    }

    private int dp(float value) {
        return (int) (value * activity.getResources().getDisplayMetrics().density + .5f);
    }

    private void dismissActive() {
        AlertDialog dialog = activeDialog;
        activeDialog = null;
        if (dialog != null) dialog.dismiss();
    }

    private void clearActive() { activeDialog = null; }

    private void toast(String message) {
        Toast.makeText(activity, message, Toast.LENGTH_LONG).show();
    }

    private static String safeMessage(Exception error) {
        return error == null || error.getMessage() == null ? "حدث خطأ أمني" : error.getMessage();
    }
}
