package com.qatra.pro.ownerconsole;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.text.InputType;
import android.util.Base64;
import android.widget.EditText;
import android.widget.LinearLayout;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;

import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;

final class OwnerGuard {
    private static final String PREFS = "qatra_owner_guard";
    private static final String SALT = "salt_v1";
    private static final String DIGEST = "digest_v1";
    private static final String FAILURES = "failures";
    private static final String LOCK_UNTIL = "lock_until";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "qatra.owner.console.pin.hmac.v1";

    private final Activity activity;
    private final SharedPreferences prefs;

    OwnerGuard(Activity activity) {
        this.activity = activity;
        this.prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    void requireUnlock(Runnable onUnlocked) {
        if (prefs.contains(SALT) && prefs.contains(DIGEST)) showUnlock(onUnlocked);
        else showEnrollment(onUnlocked);
    }

    private void showEnrollment(Runnable onUnlocked) {
        EditText pin = pinInput("رمز المالك من 6 إلى 12 رقمًا");
        EditText confirm = pinInput("تأكيد رمز المالك");
        LinearLayout box = form(pin, confirm);
        AlertDialog dialog = new AlertDialog.Builder(activity)
                .setTitle("تهيئة حماية أداة المالك")
                .setMessage("أنشئ رمزًا خاصًا بك. لا تستخدم رمز عميل أو رمز تطبيقات قطرة برو.")
                .setView(box)
                .setCancelable(false)
                .setPositiveButton("حفظ وفتح", null)
                .setNegativeButton("إغلاق", (d, w) -> activity.finishAffinity())
                .create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            try {
                String value = pin.getText().toString();
                if (!value.matches("[0-9]{6,12}")) throw new SecurityException("استخدم من 6 إلى 12 رقمًا");
                if (!value.equals(confirm.getText().toString())) throw new SecurityException("الرمزان غير متطابقين");
                if (value.matches("([0-9])\\1+") || "123456789012".contains(value) || "987654321098".contains(value)) {
                    throw new SecurityException("اختر رمزًا غير متكرر أو متسلسل");
                }
                byte[] salt = new byte[24];
                new SecureRandom().nextBytes(salt);
                byte[] digest = digest(value, salt, true);
                prefs.edit()
                        .putString(SALT, Base64.encodeToString(salt, Base64.NO_WRAP))
                        .putString(DIGEST, Base64.encodeToString(digest, Base64.NO_WRAP))
                        .remove(FAILURES).remove(LOCK_UNTIL).commit();
                dialog.dismiss();
                onUnlocked.run();
            } catch (Exception error) {
                pin.setError(error.getMessage() == null ? "تعذر حفظ الرمز" : error.getMessage());
            }
        }));
        dialog.show();
    }

    private void showUnlock(Runnable onUnlocked) {
        EditText pin = pinInput("رمز المالك");
        AlertDialog dialog = new AlertDialog.Builder(activity)
                .setTitle("Qatra Pro Owner Console")
                .setMessage("أدخل رمز المالك لفتح أداة إصدار التراخيص.")
                .setView(form(pin))
                .setCancelable(false)
                .setPositiveButton("فتح", null)
                .setNegativeButton("إغلاق", (d, w) -> activity.finishAffinity())
                .create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            try {
                long remaining = prefs.getLong(LOCK_UNTIL, 0L) - System.currentTimeMillis();
                if (remaining > 0L) throw new SecurityException("انتظر " + ((remaining + 999L) / 1000L) + " ثانية");
                byte[] salt = Base64.decode(prefs.getString(SALT, ""), Base64.NO_WRAP);
                byte[] expected = Base64.decode(prefs.getString(DIGEST, ""), Base64.NO_WRAP);
                byte[] actual = digest(pin.getText().toString(), salt, false);
                if (!MessageDigest.isEqual(expected, actual)) {
                    int failures = prefs.getInt(FAILURES, 0) + 1;
                    long lock = failures < 5 ? 0L : Math.min(15L * 60_000L, 30_000L * (1L << Math.min(5, failures - 5)));
                    prefs.edit().putInt(FAILURES, failures).putLong(LOCK_UNTIL, System.currentTimeMillis() + lock).commit();
                    throw new SecurityException(lock > 0 ? "محاولات كثيرة. حاول لاحقًا" : "رمز المالك غير صحيح");
                }
                prefs.edit().remove(FAILURES).remove(LOCK_UNTIL).commit();
                dialog.dismiss();
                onUnlocked.run();
            } catch (Exception error) {
                pin.setText("");
                pin.setError(error.getMessage() == null ? "تعذر التحقق" : error.getMessage());
            }
        }));
        dialog.show();
    }

    private EditText pinInput(String hint) {
        EditText input = new EditText(activity);
        input.setHint(hint);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        return input;
    }

    private LinearLayout form(EditText... inputs) {
        LinearLayout box = new LinearLayout(activity);
        box.setOrientation(LinearLayout.VERTICAL);
        int p = Math.round(20 * activity.getResources().getDisplayMetrics().density);
        box.setPadding(p, p / 2, p, 0);
        for (EditText input : inputs) box.addView(input);
        return box;
    }

    private byte[] digest(String pin, byte[] salt, boolean createKey) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(getKey(createKey));
        mac.update(salt);
        mac.update((byte) 0);
        return mac.doFinal((pin == null ? "" : pin).getBytes(StandardCharsets.UTF_8));
    }

    private SecretKey getKey(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        if (!create) throw new SecurityException("مفتاح حماية أداة المالك غير موجود");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                .setDigests(KeyProperties.DIGEST_SHA256).build());
        return generator.generateKey();
    }
}
