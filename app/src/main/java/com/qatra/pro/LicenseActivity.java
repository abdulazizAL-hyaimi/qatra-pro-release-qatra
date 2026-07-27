package com.qatra.pro;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
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
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Arabic information, contact and activation center opened explicitly from the More screen.
 */
public final class LicenseActivity extends Activity {
    private static final int OPEN_LICENSE_REQ = 7101;
    private static final String SUPPORT_PHONE_DISPLAY = "774777164";
    private static final String SUPPORT_PHONE_INTL = "967774777164";
    private static final String SUPPORT_EMAIL = "abdulazizgh033@gmail.com";

    private static final int NAVY = Color.rgb(16, 42, 67);
    private static final int BLUE = Color.rgb(30, 115, 190);
    private static final int AQUA = Color.rgb(44, 196, 199);
    private static final int GOLD = Color.rgb(176, 141, 87);
    private static final int CREAM = Color.rgb(246, 241, 231);
    private static final int TEXT = Color.rgb(35, 48, 58);

    private QatraLicenseManager licenseManager;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        getWindow().setStatusBarColor(NAVY);
        getWindow().setNavigationBarColor(NAVY);
        licenseManager = new QatraLicenseManager(getApplicationContext(), BuildConfig.APP_ROLE);
        render();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (licenseManager != null) render();
    }

    private void render() {
        QatraLicenseManager.Snapshot snapshot = licenseManager.ensureInitialized();

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        content.setPadding(dp(24), dp(24), dp(24), dp(30));
        content.setBackgroundColor(CREAM);

        ImageView mark = new ImageView(this);
        mark.setImageResource(com.qatra.pro.R.drawable.ic_launcher_round);
        mark.setContentDescription("شعار قطرة برو");
        content.addView(mark, new LinearLayout.LayoutParams(dp(112), dp(112)));

        TextView brand = text("QATRA PRO", 30, true, NAVY);
        brand.setLetterSpacing(0.08f);
        brand.setGravity(Gravity.CENTER);
        content.addView(brand, matchWrap(dp(10)));

        TextView descriptor = text("نظام إدارة خدمات المياه", 14, true, BLUE);
        descriptor.setGravity(Gravity.CENTER);
        content.addView(descriptor, matchWrap(dp(4)));

        TextView tagline = text("موثوق • فعّال • آمن • متصل", 12, false, GOLD);
        tagline.setGravity(Gravity.CENTER);
        content.addView(tagline, matchWrap(dp(22)));

        TextView status = text(statusTitle(snapshot), 18, true,
                snapshot.operationalAllowed() ? Color.rgb(54, 94, 75) : Color.rgb(153, 27, 27));
        status.setGravity(Gravity.CENTER);
        status.setPadding(dp(14), dp(14), dp(14), dp(14));
        status.setBackground(card(Color.WHITE, GOLD, 1f, 14f));
        content.addView(status, matchWrap(dp(12)));

        TextView details = text(statusDetails(snapshot), 14, false, TEXT);
        details.setTextIsSelectable(true);
        details.setPadding(dp(16), dp(14), dp(16), dp(14));
        details.setBackground(card(Color.WHITE, Color.rgb(214, 205, 190), 1f, 12f));
        content.addView(details, matchWrap(dp(12)));

        String request = activationRequest();
        Button copy = button("نسخ طلب التجربة أو التفعيل", BLUE);
        copy.setEnabled(!request.isEmpty());
        copy.setOnClickListener(v -> copyRequest(request));
        content.addView(copy, matchWrap(dp(18)));

        TextView purchaseTitle = text("التواصل وطلب الترخيص", 16, true, NAVY);
        purchaseTitle.setGravity(Gravity.CENTER);
        content.addView(purchaseTitle, matchWrap(dp(6)));

        TextView purchaseInfo = text(
                "واتساب أو اتصال: " + SUPPORT_PHONE_DISPLAY + "\nالبريد الإلكتروني: " + SUPPORT_EMAIL,
                14, false, TEXT);
        purchaseInfo.setGravity(Gravity.CENTER);
        purchaseInfo.setTextIsSelectable(true);
        content.addView(purchaseInfo, matchWrap(dp(10)));

        LinearLayout contactRow = new LinearLayout(this);
        contactRow.setOrientation(LinearLayout.HORIZONTAL);
        contactRow.setGravity(Gravity.CENTER);
        Button whatsapp = compactButton("واتساب", Color.rgb(54, 94, 75));
        Button call = compactButton("اتصال", BLUE);
        Button email = compactButton("بريد", Color.rgb(109, 69, 40));
        whatsapp.setOnClickListener(v -> openWhatsApp(request, snapshot));
        call.setOnClickListener(v -> openUri("tel:" + SUPPORT_PHONE_DISPLAY, "لا يوجد تطبيق اتصال متاح."));
        email.setOnClickListener(v -> openEmail(request, snapshot));
        contactRow.addView(whatsapp, weightedButton());
        contactRow.addView(call, weightedButton());
        contactRow.addView(email, weightedButton());
        content.addView(contactRow, matchWrap(dp(20)));

        TextView activateTitle = text("إدخال منحة التجربة أو مفتاح التفعيل", 16, true, NAVY);
        activateTitle.setGravity(Gravity.CENTER);
        content.addView(activateTitle, matchWrap(dp(8)));

        EditText activation = new EditText(this);
        activation.setHint("الصق رمز التفعيل هنا");
        activation.setMinLines(3);
        activation.setMaxLines(7);
        activation.setGravity(Gravity.TOP | Gravity.START);
        activation.setTextColor(TEXT);
        activation.setHintTextColor(Color.rgb(117, 117, 117));
        activation.setInputType(InputType.TYPE_CLASS_TEXT
                | InputType.TYPE_TEXT_FLAG_MULTI_LINE
                | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        activation.setPadding(dp(14), dp(12), dp(14), dp(12));
        activation.setBackground(card(Color.WHITE, GOLD, 1f, 12f));
        content.addView(activation, matchWrap(dp(10)));

        Button activate = button("تفعيل قطرة برو", NAVY);
        activate.setOnClickListener(v -> activate(activation));
        content.addView(activate, matchWrap(dp(10)));

        Button openFile = button("فتح ملف تفعيل .qlicense", Color.rgb(14, 116, 144));
        openFile.setOnClickListener(v -> openLicenseFile());
        content.addView(openFile, matchWrap(dp(10)));

        if (snapshot.operationalAllowed()) {
            Button continueButton = button(
                    snapshot.status == QatraLicenseManager.Status.LICENSED
                            ? "العودة إلى قطرة برو" : "متابعة الفترة التجريبية",
                    Color.rgb(54, 94, 75));
            continueButton.setOnClickListener(v -> openApplication());
            content.addView(continueButton, matchWrap(dp(8)));
        } else {
            TextView blocked = text(
                    "التشغيل موقوف حتى استيراد منحة تجربة موقعة أو تفعيل دائم. بيانات التطبيق محفوظة ولا تُحذف.",
                    13, false, Color.rgb(153, 27, 27));
            blocked.setGravity(Gravity.CENTER);
            content.addView(blocked, matchWrap(dp(10)));

            Button close = button("إغلاق التطبيق", Color.rgb(91, 91, 91));
            close.setOnClickListener(v -> finishAffinity());
            content.addView(close, matchWrap(0));
        }

        TextView footer = text("قطرة برو — الإصدار " + BuildConfig.VERSION_NAME + " — " + roleArabic(), 11, true, GOLD);
        footer.setGravity(Gravity.CENTER);
        content.addView(footer, matchWrap(0));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(content, new ScrollView.LayoutParams(-1, -2));
        setContentView(scroll);
    }

    private String statusTitle(QatraLicenseManager.Snapshot snapshot) {
        if (snapshot.status == QatraLicenseManager.Status.LICENSED) return "قطرة برو مفعّل دائمًا";
        if (snapshot.status == QatraLicenseManager.Status.TRIAL_REQUIRED) return "يلزم إصدار منحة تجربة";
        if (snapshot.status == QatraLicenseManager.Status.TRIAL_ACTIVE) {
            return "الفترة التجريبية — متبقي " + snapshot.remainingDays() + " يومًا";
        }
        if (snapshot.status == QatraLicenseManager.Status.CLOCK_TAMPER) return "يلزم تصحيح تاريخ الجهاز";
        if (snapshot.status == QatraLicenseManager.Status.STATE_TAMPER) return "تعذر التحقق من حالة الترخيص";
        return "انتهت الفترة التجريبية";
    }

    private String statusDetails(QatraLicenseManager.Snapshot snapshot) {
        StringBuilder out = new StringBuilder();
        if (snapshot.status == QatraLicenseManager.Status.LICENSED) {
            out.append("العميل: ").append(value(snapshot.customerName)).append('\n');
            out.append("رقم الرخصة: ").append(value(snapshot.licenseId)).append('\n');
        } else if (snapshot.status == QatraLicenseManager.Status.TRIAL_REQUIRED) {
            out.append("أرسل طلب الجهاز إلى المالك لإصدار منحة تجربة واحدة مدتها 30 يومًا.\n");
            out.append("حذف التطبيق وإعادة تثبيته لا ينشئ تجربة جديدة.\n");
        } else if (snapshot.status == QatraLicenseManager.Status.TRIAL_ACTIVE) {
            out.append("منحة التجربة الموقعة فعّالة لمدة 30 يومًا من تاريخ إصدارها.\n");
        } else if (snapshot.status == QatraLicenseManager.Status.CLOCK_TAMPER) {
            out.append("صحح تاريخ ووقت الجهاز ثم افتح قطرة برو مجددًا.\n");
        } else if (snapshot.status == QatraLicenseManager.Status.STATE_TAMPER) {
            out.append("تعذر التحقق من حالة الترخيص المحمية. تواصل مع الدعم.\n");
        } else {
            out.append("انتهت تجربة الثلاثين يومًا. أدخل مفتاح التفعيل الدائم للاستمرار.\n");
        }
        out.append("هوية المنشأة: ").append(value(snapshot.organizationId)).append('\n');
        out.append("رمز الجهاز: ").append(value(snapshot.deviceCode)).append('\n');
        out.append("نسخة التطبيق: ").append(roleArabic());
        return out.toString();
    }

    private String activationRequest() {
        try {
            return licenseManager.activationRequest();
        } catch (Exception ignored) {
            return "";
        }
    }

    private void copyRequest(String request) {
        if (request == null || request.isEmpty()) {
            toast("تعذر إنشاء طلب التفعيل.");
            return;
        }
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null) {
            toast("الحافظة غير متاحة.");
            return;
        }
        clipboard.setPrimaryClip(ClipData.newPlainText("طلب تفعيل قطرة برو", request));
        toast("تم نسخ طلب التفعيل.");
    }

    private void activate(EditText input) {
        String token = input.getText() == null ? "" : input.getText().toString().trim();
        if (token.isEmpty()) {
            input.setError("ألصق رمز التفعيل أولًا.");
            return;
        }
        try {
            QatraLicenseManager.Snapshot licensed = licenseManager.activate(token);
            input.setText("");
            toast(licensed.status == QatraLicenseManager.Status.LICENSED
                    ? "تم التفعيل الدائم بنجاح" : "تم اعتماد منحة التجربة بنجاح");
            render();
        } catch (Exception error) {
            input.setError(error.getMessage() == null ? "رمز التفعيل غير صالح." : error.getMessage());
            input.requestFocus();
        }
    }

    private void openApplication() {
        QatraLicenseManager.Snapshot snapshot = licenseManager.current();
        if (!snapshot.operationalAllowed()) {
            render();
            return;
        }
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
        finish();
    }

    private void openLicenseFile() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "application/vnd.qatra.license+json", "application/json", "text/plain",
                "application/octet-stream"});
        startActivityForResult(Intent.createChooser(intent, "اختر ملف التفعيل"), OPEN_LICENSE_REQ);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != OPEN_LICENSE_REQ || resultCode != RESULT_OK
                || data == null || data.getData() == null) return;
        try (InputStream input = getContentResolver().openInputStream(data.getData())) {
            if (input == null) throw new IllegalStateException("تعذر فتح ملف التفعيل");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > 64 * 1024) throw new SecurityException("ملف التفعيل أكبر من الحد المسموح");
                output.write(buffer, 0, read);
            }
            QatraLicenseManager.Snapshot activated = licenseManager.activate(
                    new String(output.toByteArray(), StandardCharsets.UTF_8));
            toast(activated.status == QatraLicenseManager.Status.LICENSED
                    ? "تم التفعيل الدائم بنجاح" : "تم اعتماد منحة التجربة بنجاح");
            render();
        } catch (Exception error) {
            toast("تعذر اعتماد ملف التفعيل: " + (error.getMessage() == null ? "ملف غير صالح" : error.getMessage()));
        }
    }

    private void openWhatsApp(String request, QatraLicenseManager.Snapshot snapshot) {
        String message = purchaseMessage(request, snapshot);
        openUri("https://wa.me/" + SUPPORT_PHONE_INTL + "?text=" + Uri.encode(message),
                "تعذر فتح واتساب.");
    }

    private void openEmail(String request, QatraLicenseManager.Snapshot snapshot) {
        String uri = "mailto:" + SUPPORT_EMAIL
                + "?subject=" + Uri.encode("طلب تفعيل قطرة برو")
                + "&body=" + Uri.encode(purchaseMessage(request, snapshot));
        openUri(uri, "لا يوجد تطبيق بريد إلكتروني متاح.");
    }

    private String purchaseMessage(String request, QatraLicenseManager.Snapshot snapshot) {
        return "مرحبًا، أريد إصدار منحة تجربة أو تفعيل قطرة برو.\n"
                + "نسخة التطبيق: " + roleArabic() + "\n"
                + "هوية المنشأة: " + value(snapshot.organizationId) + "\n"
                + "رمز الجهاز: " + value(snapshot.deviceCode) + "\n"
                + "طلب التفعيل: " + value(request);
    }

    private String roleArabic() {
        if ("ADMIN".equals(BuildConfig.APP_ROLE)) return "الإدارة";
        if ("READER".equals(BuildConfig.APP_ROLE)) return "الكاشف";
        if ("COLLECTOR".equals(BuildConfig.APP_ROLE)) return "المحصل";
        if ("CASHIER".equals(BuildConfig.APP_ROLE)) return "الصندوق";
        return BuildConfig.APP_ROLE;
    }

    private void openUri(String value, String errorMessage) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(value));
            startActivity(intent);
        } catch (Exception error) {
            toast(errorMessage);
        }
    }

    private TextView text(String value, int sizeSp, boolean bold, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        view.setTypeface(Typeface.create("serif", bold ? Typeface.BOLD : Typeface.NORMAL));
        view.setLineSpacing(0f, 1.15f);
        return view;
    }

    private Button button(String label, int color) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14f);
        button.setAllCaps(false);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setBackground(card(color, GOLD, 1f, 12f));
        button.setMinHeight(dp(52));
        return button;
    }

    private Button compactButton(String label, int color) {
        Button button = button(label, color);
        button.setTextSize(12f);
        button.setMinHeight(dp(48));
        return button;
    }

    private LinearLayout.LayoutParams matchWrap(int bottomMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.setMargins(0, 0, 0, bottomMargin);
        return params;
    }

    private LinearLayout.LayoutParams weightedButton() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(50), 1f);
        params.setMargins(dp(3), 0, dp(3), 0);
        return params;
    }

    private GradientDrawable card(int fill, int stroke, float strokeWidthDp, float radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radiusDp));
        drawable.setStroke(Math.max(1, dp(strokeWidthDp)), stroke);
        return drawable;
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static String value(String text) {
        return text == null || text.trim().isEmpty() ? "-" : text.trim();
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }
}
