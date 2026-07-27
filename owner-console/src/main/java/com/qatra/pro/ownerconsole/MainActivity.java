package com.qatra.pro.ownerconsole;

import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.fragment.app.FragmentActivity;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

public final class MainActivity extends FragmentActivity {
    private static final int SAVE_REQ = 7001;
    private static final int OPEN_REQ = 7002;
    private static final int NAVY = Color.rgb(16, 42, 67);
    private static final int BLUE = Color.rgb(30, 115, 190);
    private static final int AQUA = Color.rgb(44, 196, 199);
    private static final int GOLD = Color.rgb(176, 141, 87);
    private static final int CREAM = Color.rgb(246, 241, 231);

    private EditText requestInput;
    private EditText customerInput;
    private EditText idInput;
    private TextView details;
    private TextView result;
    private CheckBox admin;
    private CheckBox reader;
    private CheckBox collector;
    private CheckBox cashier;
    private LicenseEngine.Request parsed;
    private String pendingJson;
    private String pendingName;
    private Uri lastSaved;
    private SharedPreferences trialLedger;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        getWindow().setStatusBarColor(NAVY);
        getWindow().setNavigationBarColor(NAVY);
        trialLedger = getSharedPreferences("qatra_owner_trial_ledger_v1", MODE_PRIVATE);
        try {
            LicenseEngine.ensureSigningKey();
            new OwnerGuard(this).requireUnlock(this::showHome);
        } catch (Exception error) {
            fatal("تعذر تهيئة أداة المالك: " + message(error));
        }
    }

    private void showHome() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(16), dp(16), dp(16), dp(28));
        root.setBackgroundColor(CREAM);
        scroll.addView(root);

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(16), dp(14), dp(16), dp(14));
        header.setBackground(shape(NAVY, GOLD, 18));
        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.ic_qatra_owner);
        header.addView(mark, new LinearLayout.LayoutParams(dp(72), dp(72)));
        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        copy.setPadding(dp(12), 0, 0, 0);
        copy.addView(label("QATRA PRO", 27, true, Color.WHITE));
        copy.addView(label("OWNER LICENSE CONSOLE", 12, true, AQUA));
        copy.addView(label("إصدار تراخيص العملاء الدائمة", 12, false, Color.rgb(235, 217, 175)));
        header.addView(copy, new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(header, margins(dp(12)));

        LinearLayout keyCard = card(root, "هوية مفتاح المالك");
        TextView key = label("", 11, false, Color.DKGRAY);
        key.setTextIsSelectable(true);
        try {
            key.setText("SHA-256\n" + LicenseEngine.publicKeyFingerprint() + "\n\nPublic Key Base64\n" + LicenseEngine.publicKeyBase64());
        } catch (Exception error) {
            key.setText("تعذر قراءة المفتاح العام: " + message(error));
        }
        keyCard.addView(key);
        keyCard.addView(action("نسخ المفتاح العام", BLUE, v -> copyPublicKey()), margins(dp(8)));

        LinearLayout requestCard = card(root, "1. طلب العميل");
        requestInput = input("ألصق طلب QLR1 هنا", true);
        requestCard.addView(requestInput);
        LinearLayout requestButtons = row();
        requestButtons.addView(action("لصق", BLUE, v -> paste()), weight());
        requestButtons.addView(action("تحليل", NAVY, v -> analyze()), weight());
        requestCard.addView(requestButtons, margins(dp(8)));
        details = label("لم يتم تحليل طلب بعد.", 12, false, Color.DKGRAY);
        details.setTextIsSelectable(true);
        requestCard.addView(details);

        LinearLayout customerCard = card(root, "2. بيانات الترخيص");
        customerInput = input("اسم العميل أو المشروع", false);
        customerCard.addView(customerInput, margins(dp(6)));
        idInput = input("رقم الرخصة اختياري — LIC-2026-00001", false);
        idInput.setTextDirection(View.TEXT_DIRECTION_LTR);
        customerCard.addView(idInput, margins(dp(8)));
        admin = role("Administration — الإدارة");
        reader = role("Field Reader — الكاشف");
        collector = role("Collector — المحصل");
        cashier = role("Cashier — الصندوق");
        customerCard.addView(admin); customerCard.addView(reader);
        customerCard.addView(collector); customerCard.addView(cashier);
        customerCard.addView(action("إصدار تفعيل دائم", NAVY, v -> generate(false)), margins(dp(10)));
        customerCard.addView(action("إصدار تجربة موقعة لمدة 30 يومًا", Color.rgb(5, 150, 105),
                v -> generate(true)), margins(dp(8)));
        TextView trialNote = label("لكل جهاز منحة تجربة واحدة فقط. عند طلبها مجددًا يعاد إصدار الملف الأصلي بنفس تاريخ الانتهاء، ولا تبدأ مدة جديدة.", 12, true, Color.rgb(133, 77, 14));
        customerCard.addView(trialNote, margins(dp(4)));

        LinearLayout verifyCard = card(root, "3. التحقق والمشاركة");
        LinearLayout verifyButtons = row();
        verifyButtons.addView(action("فتح ملف للتحقق", BLUE, v -> openForVerify()), weight());
        verifyButtons.addView(action("مشاركة آخر ملف", Color.rgb(54, 94, 75), v -> shareLast()), weight());
        verifyCard.addView(verifyButtons);
        result = label("لم يتم إنشاء أو فحص ملف بعد.", 12, false, Color.DKGRAY);
        result.setTextIsSelectable(true);
        verifyCard.addView(result, margins(dp(8)));

        TextView warning = label("المفتاح الخاص يبقى داخل Android Keystore. يجب نسخ المفتاح العام إلى إعداد بناء تطبيقات Qatra Pro قبل إصدار نسخ العملاء.", 12, true, Color.rgb(133, 77, 14));
        warning.setPadding(dp(12), dp(12), dp(12), dp(12));
        warning.setBackground(shape(Color.rgb(255, 249, 230), Color.rgb(224, 188, 106), 14));
        root.addView(warning);
        setContentView(scroll);
    }

    private void paste() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null || clipboard.getPrimaryClip() == null || clipboard.getPrimaryClip().getItemCount() == 0) {
            toast("الحافظة فارغة"); return;
        }
        CharSequence value = clipboard.getPrimaryClip().getItemAt(0).coerceToText(this);
        requestInput.setText(value == null ? "" : value.toString().trim());
        analyze();
    }

    private void analyze() {
        try {
            parsed = LicenseEngine.parseRequest(requestInput.getText().toString());
            details.setText("المنشأة: " + parsed.organizationId + "\nالجهاز: " + parsed.deviceCode
                    + "\nالطالب: " + parsed.requestingRole + "\nالنوع: "
                    + (parsed.productionBuild ? "Production" : "Debug / Test")
                    + "\nالمطلوب: " + parsed.requestedRoles);
            setRole(admin, parsed.requestedRoles.contains("ADMIN"));
            setRole(reader, parsed.requestedRoles.contains("READER"));
            setRole(collector, parsed.requestedRoles.contains("COLLECTOR"));
            setRole(cashier, parsed.requestedRoles.contains("CASHIER"));
        } catch (Exception error) {
            parsed = null;
            details.setText("طلب غير صالح: " + message(error));
            requestInput.setError(message(error));
        }
    }

    private void generate(boolean trial) {
        analyze();
        if (parsed == null) return;
        try {
            JSONObject license;
            if (trial) {
                String ledgerKey = "grant." + parsed.deviceCode;
                String existing = trialLedger.getString(ledgerKey, "");
                if (existing != null && !existing.isEmpty()) {
                    license = new JSONObject(existing);
                    if (!LicenseEngine.verifyLicense(license)) {
                        throw new SecurityException("سجل منحة التجربة المحفوظ غير صالح");
                    }
                } else {
                    license = LicenseEngine.signTrialGrant(parsed, customerInput.getText().toString(),
                            selectedRoles());
                    if (!trialLedger.edit().putString(ledgerKey, license.toString()).commit()) {
                        throw new IllegalStateException("تعذر تثبيت منحة التجربة في سجل المالك");
                    }
                }
            } else {
                license = LicenseEngine.signLicense(parsed, customerInput.getText().toString(),
                        idInput.getText().toString(), selectedRoles());
            }
            if (!LicenseEngine.verifyLicense(license)) throw new SecurityException("فشل التحقق الذاتي");
            pendingJson = license.toString(2) + "\n";
            String id = trial ? license.getString("trialId") : license.getString("licenseId");
            pendingName = "qatra-" + id.toLowerCase(Locale.ROOT) + ".qlicense";
            result.setText((trial ? "تم تجهيز منحة التجربة الأصلية بنفس تاريخ الانتهاء."
                    : "تم إنشاء ترخيص دائم صحيح.") + "\n\n" + pendingJson);
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/vnd.qatra.license+json");
            intent.putExtra(Intent.EXTRA_TITLE, pendingName);
            startActivityForResult(intent, SAVE_REQ);
        } catch (Exception error) {
            result.setText("تعذر إنشاء الترخيص: " + message(error));
        }
    }

    private void openForVerify() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(intent, OPEN_REQ);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        if (requestCode == SAVE_REQ && pendingJson != null) {
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IllegalStateException("تعذر فتح الملف");
                out.write(pendingJson.getBytes(StandardCharsets.UTF_8));
                out.flush();
                lastSaved = uri;
                toast("تم حفظ ملف التجربة أو الترخيص");
                new AlertDialog.Builder(this).setTitle("تم الحفظ")
                        .setMessage("تم إنشاء " + pendingName)
                        .setPositiveButton("مشاركة", (d, w) -> share(uri))
                        .setNegativeButton("إغلاق", null).show();
            } catch (Exception error) { result.setText("فشل الحفظ: " + message(error)); }
        } else if (requestCode == OPEN_REQ) verify(uri);
    }

    private void verify(Uri uri) {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IllegalStateException("تعذر فتح الملف");
            String raw = new String(read(in, 65536), StandardCharsets.UTF_8).trim();
            if (raw.startsWith("QL1.")) raw = new String(android.util.Base64.decode(raw.substring(4),
                    android.util.Base64.URL_SAFE | android.util.Base64.NO_WRAP | android.util.Base64.NO_PADDING), StandardCharsets.UTF_8);
            JSONObject license = new JSONObject(raw);
            result.setText((LicenseEngine.verifyLicense(license) ? "الترخيص صحيح." : "الترخيص غير صحيح أو صادر بمفتاح آخر.")
                    + "\n\n" + license.toString(2));
        } catch (Exception error) { result.setText("تعذر التحقق: " + message(error)); }
    }

    private void copyPublicKey() {
        try {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (clipboard == null) throw new IllegalStateException("الحافظة غير متاحة");
            clipboard.setPrimaryClip(ClipData.newPlainText("Qatra public key", LicenseEngine.publicKeyBase64()));
            toast("تم نسخ المفتاح العام");
        } catch (Exception error) { toast("تعذر النسخ: " + message(error)); }
    }

    private void shareLast() {
        if (lastSaved == null) { toast("احفظ ملفًا أولًا في هذه الجلسة"); return; }
        share(lastSaved);
    }

    private void share(Uri uri) {
        Intent intent = new Intent(Intent.ACTION_SEND);
        intent.setType("application/vnd.qatra.license+json");
        intent.putExtra(Intent.EXTRA_STREAM, uri);
        intent.setClipData(ClipData.newUri(getContentResolver(), "Qatra license", uri));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(intent, "إرسال ملف الترخيص"));
    }

    private Set<String> selectedRoles() {
        Set<String> roles = new LinkedHashSet<>();
        if (admin.isChecked()) roles.add("ADMIN");
        if (reader.isChecked()) roles.add("READER");
        if (collector.isChecked()) roles.add("COLLECTOR");
        if (cashier.isChecked()) roles.add("CASHIER");
        return roles;
    }

    private void setRole(CheckBox box, boolean enabled) { box.setEnabled(enabled); box.setChecked(enabled); }
    private CheckBox role(String text) { CheckBox box = new CheckBox(this); box.setText(text); box.setTextSize(14f); return box; }
    private LinearLayout row() { LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL); return row; }
    private LinearLayout.LayoutParams weight() { LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(48), 1f); p.setMargins(dp(4), 0, dp(4), 0); return p; }
    private LinearLayout.LayoutParams margins(int bottom) { LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2); p.setMargins(0, 0, 0, bottom); return p; }

    private LinearLayout card(LinearLayout root, String title) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(15), dp(15), dp(15), dp(15));
        card.setBackground(shape(Color.WHITE, Color.rgb(214, 224, 230), 16));
        card.addView(label(title, 17, true, NAVY), margins(dp(10)));
        root.addView(card, margins(dp(12)));
        return card;
    }

    private EditText input(String hint, boolean multiline) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setPadding(dp(12), dp(11), dp(12), dp(11));
        input.setBackground(shape(Color.rgb(250, 252, 253), Color.rgb(198, 212, 221), 12));
        if (multiline) {
            input.setMinLines(4); input.setMaxLines(8); input.setGravity(Gravity.TOP | Gravity.START);
            input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        } else input.setSingleLine(true);
        return input;
    }

    private Button action(String text, int color, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(text); button.setTextColor(Color.WHITE); button.setAllCaps(false);
        button.setTypeface(Typeface.DEFAULT_BOLD); button.setBackground(shape(color, GOLD, 12));
        button.setOnClickListener(listener); return button;
    }

    private TextView label(String text, int size, boolean bold, int color) {
        TextView view = new TextView(this);
        view.setText(text); view.setTextSize(size); view.setTextColor(color);
        view.setTypeface(Typeface.create("sans", bold ? Typeface.BOLD : Typeface.NORMAL));
        view.setLineSpacing(0f, 1.18f); return view;
    }

    private GradientDrawable shape(int fill, int stroke, int radius) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(fill); shape.setCornerRadius(dp(radius)); shape.setStroke(dp(1), stroke); return shape;
    }

    private static byte[] read(InputStream in, int max) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int total = 0; int count;
        while ((count = in.read(buffer)) != -1) { total += count; if (total > max) throw new SecurityException("الملف كبير جدًا"); out.write(buffer, 0, count); }
        return out.toByteArray();
    }

    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void toast(String value) { Toast.makeText(this, value, Toast.LENGTH_LONG).show(); }
    private void fatal(String value) { new AlertDialog.Builder(this).setTitle("تعذر فتح أداة المالك").setMessage(value).setCancelable(false).setPositiveButton("إغلاق", (d, w) -> finishAffinity()).show(); }
    private static String message(Exception error) { return error == null || error.getMessage() == null ? "حدث خطأ" : error.getMessage(); }
}
