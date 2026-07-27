package com.qatra.pro;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Stores the cloud session encrypted with a non-exportable Android Keystore key. */
final class QatraSecretStore {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "qatra.cloud.session.v1";
    private static final String PREFS = "qatra_cloud_secrets";
    private static final String PREF_SESSION = "session_v1";
    private static final int TAG_BITS = 128;

    private final Context context;

    QatraSecretStore(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized void saveSession(JSONObject session) throws Exception {
        if (session == null || !session.has("accessToken")) {
            throw new IllegalArgumentException("جلسة المزامنة غير صالحة");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(true));
        JSONObject envelope = new JSONObject();
        envelope.put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
        envelope.put("ciphertext", Base64.encodeToString(
                cipher.doFinal(session.toString().getBytes(StandardCharsets.UTF_8)),
                Base64.NO_WRAP));
        boolean ok = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(PREF_SESSION, envelope.toString())
                .commit();
        if (!ok) throw new IllegalStateException("تعذر حفظ جلسة المزامنة");
    }

    synchronized JSONObject loadSession() throws Exception {
        String encoded = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(PREF_SESSION, null);
        if (encoded == null || encoded.trim().isEmpty()) return null;
        JSONObject envelope = new JSONObject(encoded);
        byte[] iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP);
        byte[] ciphertext = Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP);
        if (iv.length != 12 || ciphertext.length < 17) {
            throw new SecurityException("جلسة المزامنة المحلية تالفة");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(TAG_BITS, iv));
        return new JSONObject(new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8));
    }

    synchronized void clearSession() {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .remove(PREF_SESSION)
                .apply();
    }

    private SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        if (!create) throw new SecurityException("مفتاح حماية جلسة المزامنة غير موجود");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }
}
