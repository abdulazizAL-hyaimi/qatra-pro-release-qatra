package com.qatra.pro;

import android.app.AlertDialog;
import android.content.Intent;
import android.content.IntentSender;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.fragment.app.FragmentActivity;

import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Scope;

import org.json.JSONObject;

import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.text.DateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** Native Google Drive setup, scheduled backup, and Google-account recovery screen. */
public final class QatraDriveBackupActivity extends FragmentActivity {
    static final String EXTRA_SESSION_USERNAME = "qatra.session.username";
    static final String EXTRA_RESTORED = "qatra.drive.restored";
    static final String EXTRA_RESTORED_USERNAME = "qatra.drive.restored.username";
    private static final int AUTHORIZATION_REQUEST = 7401;
    private static final String[] ROLE_CODES = {"ADMIN", "READER", "COLLECTOR", "CASHIER"};
    private static final String[] ROLE_LABELS = {"مدير", "كاشف", "محصل", "صندوق"};

    private EditText usernameInput;
    private EditText legacyPasswordInput;
    private EditText hourInput;
    private EditText minuteInput;
    private Spinner roleSpinner;
    private Spinner frequencySpinner;
    private TextView statusView;
    private ProgressBar progress;
    private Button accountButton;
    private Button connectButton;
    private Button uploadButton;
    private Button restoreButton;
    private Button disableButton;
    private Button legacyRestoreButton;
    private QatraDriveBackupManager manager;
    private QatraGoogleDriveAccount googleAccount;
    private PendingAction pendingAction;
    private String sessionUsername = "";
    private boolean legacyRestoreMode;
    private boolean tokenRefreshAttempted;

    private enum PendingAction { CONFIGURE_AND_UPLOAD, UPLOAD, RESTORE }

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        manager = new QatraDriveBackupManager(getApplicationContext());
        googleAccount = new QatraGoogleDriveAccount(getApplicationContext());
        sessionUsername = QatraDriveBackupCrypto.normalizeUsername(
                getIntent().getStringExtra(EXTRA_SESSION_USERNAME));
        setTitle("النسخ الاحتياطي على Google Drive");
        buildUi();
        renderStatus();
    }

    private void buildUi() {
        int pad = dp(16);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, dp(36));
        root.setBackgroundColor(Color.rgb(244, 248, 251));
        scroll.addView(root, new ScrollView.LayoutParams(-1, -2));

        TextView title = text("نسخة آمنة على Google Drive", 24, true);
        title.setTextColor(Color.rgb(7, 89, 133));
        root.addView(title);
        TextView intro = text(
                "يحفظ قطرة برو نسخة SQLite مشفرة داخل مجلد Qatra Pro Backups. بعد حذف التطبيق اختر حساب Google نفسه، ثم أدخل اسم المستخدم ونوعه فقط؛ لا توجد كلمة مرور منفصلة للنسخة.",
                14, false);
        intro.setPadding(0, dp(8), 0, dp(12));
        root.addView(intro);

        accountButton = button("اختيار حساب Google الموحد", Color.rgb(79, 70, 229));
        accountButton.setOnClickListener(v -> chooseGoogleAccount(null));
        root.addView(accountButton);
        updateAccountButton();

        LinearLayout credentials = card();
        root.addView(credentials);
        credentials.addView(label("اسم المستخدم"));
        usernameInput = input("username", false, false);
        usernameInput.setText(!sessionUsername.isEmpty() ? sessionUsername : manager.configuredUsername());
        credentials.addView(usernameInput);
        credentials.addView(label("نوع المستخدم"));
        roleSpinner = new Spinner(this);
        roleSpinner.setAdapter(new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item, ROLE_LABELS));
        roleSpinner.setSelection(roleIndex(BuildConfig.APP_ROLE));
        credentials.addView(roleSpinner);
        legacyRestoreButton = button("لدي نسخة قديمة محمية بكلمة مرور", Color.rgb(100, 116, 139));
        legacyRestoreButton.setOnClickListener(v -> toggleLegacyRestore());
        credentials.addView(legacyRestoreButton);
        legacyPasswordInput = input("كلمة مرور النسخة القديمة", true, false);
        legacyPasswordInput.setVisibility(View.GONE);
        credentials.addView(legacyPasswordInput);

        LinearLayout schedule = card();
        LinearLayout.LayoutParams scheduleParams = new LinearLayout.LayoutParams(-1, -2);
        scheduleParams.topMargin = dp(12);
        schedule.setLayoutParams(scheduleParams);
        root.addView(schedule);
        schedule.addView(label("تكرار النسخة التلقائية"));
        frequencySpinner = new Spinner(this);
        frequencySpinner.setAdapter(new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item,
                new String[]{"يدوي فقط", "يوميًا", "أسبوعيًا"}));
        schedule.addView(frequencySpinner);
        schedule.addView(label("الوقت المحلي التقريبي (ساعة : دقيقة)"));
        LinearLayout timeRow = new LinearLayout(this);
        timeRow.setOrientation(LinearLayout.HORIZONTAL);
        hourInput = input("02", false, true);
        minuteInput = input("00", false, true);
        hourInput.setText(String.format(Locale.US, "%02d", manager.scheduleHour()));
        minuteInput.setText(String.format(Locale.US, "%02d", manager.scheduleMinute()));
        timeRow.addView(hourInput, new LinearLayout.LayoutParams(0, dp(52), 1));
        TextView separator = text(" : ", 18, true);
        separator.setGravity(Gravity.CENTER);
        timeRow.addView(separator, new LinearLayout.LayoutParams(dp(38), dp(52)));
        timeRow.addView(minuteInput, new LinearLayout.LayoutParams(0, dp(52), 1));
        schedule.addView(timeRow);
        frequencySpinner.setSelection(manager.frequencyDays() == 7 ? 2
                : manager.frequencyDays() == 1 ? 1 : 0);

        connectButton = button("ربط Google Drive وحفظ نسخة الآن", Color.rgb(7, 89, 133));
        connectButton.setOnClickListener(v -> connectAndUpload());
        root.addView(connectButton);
        uploadButton = button("رفع نسخة مشفرة الآن", Color.rgb(15, 118, 110));
        uploadButton.setOnClickListener(v -> authorize(PendingAction.UPLOAD));
        root.addView(uploadButton);
        restoreButton = button("استعادة سريعة بدون كلمة مرور", Color.rgb(180, 83, 9));
        restoreButton.setOnClickListener(v -> confirmRestore());
        root.addView(restoreButton);
        disableButton = button("إيقاف النسخ التلقائي", Color.rgb(153, 27, 27));
        disableButton.setOnClickListener(v -> {
            manager.disableSchedule();
            renderStatus();
            toast("تم إيقاف الجدولة، ولم تُحذف النسخ المحفوظة من Drive");
        });
        root.addView(disableButton);

        progress = new ProgressBar(this);
        progress.setIndeterminate(true);
        progress.setVisibility(View.GONE);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(dp(44), dp(44));
        progressParams.gravity = Gravity.CENTER_HORIZONTAL;
        progressParams.topMargin = dp(12);
        root.addView(progress, progressParams);

        statusView = text("", 14, false);
        statusView.setBackgroundColor(Color.WHITE);
        statusView.setPadding(dp(13), dp(13), dp(13), dp(13));
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(-1, -2);
        statusParams.topMargin = dp(12);
        root.addView(statusView, statusParams);

        TextView security = text(
                "الأمان: مفتاح الاستعادة منفصل عن ملف البيانات ومحفوظ في مساحة Google Drive مخفية لا يصل إليها إلا قطرة برو بعد اختيار الحساب نفسه. إذا حُذفت بيانات قطرة برو من إعدادات Google Drive فلن يمكن استعادة النسخة. قد تتأخر الجدولة قليلًا بسبب توفير البطارية في Android.",
                12, false);
        security.setTextColor(Color.rgb(100, 55, 5));
        security.setPadding(0, dp(12), 0, dp(8));
        root.addView(security);
        Button close = button("العودة إلى التطبيق", Color.rgb(71, 85, 105));
        close.setOnClickListener(v -> finish());
        root.addView(close);
        setContentView(scroll);
    }

    private void connectAndUpload() {
        try {
            requireIdentityMatchesSession();
            requireRoleMatchesApp();
            parseHour();
            parseMinute();
            authorize(PendingAction.CONFIGURE_AND_UPLOAD);
        } catch (Exception error) {
            showError(error);
        }
    }

    private void confirmRestore() {
        try {
            requireIdentityMatchesSession();
            if (legacyRestoreMode) {
                QatraDriveBackupCrypto.validatePassword(legacyPasswordInput.getText().toString());
            }
            requireRoleMatchesApp();
        } catch (Exception error) {
            showError(error);
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("استعادة النسخة السحابية")
                .setMessage(legacyRestoreMode
                        ? "سيتم التحقق من النسخة القديمة باسم المستخدم وكلمة المرور والدور، ثم استبدال بيانات SQLite دفعة واحدة وتحويلها إلى الاستعادة السريعة. متابعة؟"
                        : "سيتم تنزيل أحدث نسخة مطابقة من حساب Google المحدد والتحقق من اسم المستخدم والدور، ثم استبدال بيانات SQLite الحالية دفعة واحدة. متابعة؟")
                .setNegativeButton("إلغاء", null)
                .setPositiveButton("تحقق واستعادة", (dialog, which) -> authorize(PendingAction.RESTORE))
                .show();
    }

    private void authorize(PendingAction action) {
        tokenRefreshAttempted = false;
        if (!googleAccount.hasSelectedAccount()) {
            chooseGoogleAccount(action);
            return;
        }
        requestAuthorization(action);
    }

    private void chooseGoogleAccount(PendingAction actionAfterSelection) {
        pendingAction = actionAfterSelection;
        try {
            startActivityForResult(googleAccount.accountPickerIntent(),
                    QatraGoogleDriveAccount.PICK_ACCOUNT_REQUEST);
        } catch (Exception error) {
            pendingAction = null;
            showError(new SecurityException(
                    "تعذر عرض حسابات Google. حدّث خدمات Google Play ثم أعد المحاولة."));
        }
    }

    private void requestAuthorization(PendingAction action) {
        if (action == PendingAction.UPLOAD && !manager.isConfigured()) {
            showError(new SecurityException("اربط حساب Google واحفظ نسخة أولى قبل الرفع اليدوي"));
            return;
        }
        if (action == PendingAction.UPLOAD && !manager.isPasswordlessConfigured()) {
            // Existing 2.5.7 installations are migrated transparently on their next manual upload.
            action = PendingAction.CONFIGURE_AND_UPLOAD;
        }
        pendingAction = action;
        setBusy(true);
        AuthorizationRequest request = AuthorizationRequest.builder()
                .setAccount(googleAccount.selectedAccount())
                .setRequestedScopes(Arrays.asList(
                        new Scope(QatraDriveBackupManager.DRIVE_SCOPE),
                        new Scope(QatraDriveBackupManager.DRIVE_APPDATA_SCOPE)))
                .build();
        Identity.getAuthorizationClient(this).authorize(request)
                .addOnSuccessListener(result -> {
                    if (result.hasResolution()) {
                        try {
                            startIntentSenderForResult(
                                    result.getPendingIntent().getIntentSender(),
                                    AUTHORIZATION_REQUEST, null, 0, 0, 0);
                        } catch (IntentSender.SendIntentException error) {
                            setBusy(false);
                            showError(error);
                        }
                    } else {
                        continueAction(result);
                    }
                })
                .addOnFailureListener(error -> {
                    setBusy(false);
                    if (error instanceof ApiException
                            && ((ApiException) error).getStatusCode() == CommonStatusCodes.CANCELED) {
                        handleAuthorizationDismissed();
                    } else {
                        showError(error);
                    }
                });
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == QatraGoogleDriveAccount.PICK_ACCOUNT_REQUEST) {
            PendingAction action = pendingAction;
            pendingAction = null;
            if (resultCode != RESULT_OK) {
                showError(new SecurityException(
                        "لم يتم اختيار حساب Google الموحد. لم تُرفع أو تُستعد أي بيانات."));
                return;
            }
            try {
                String previous = googleAccount.selectedEmail();
                String selected = googleAccount.accountFromResult(data);
                googleAccount.saveSelectedEmail(selected);
                if (!previous.equals(selected)) manager.onGoogleAccountChanged();
                updateAccountButton();
                renderStatus();
                if (action != null) requestAuthorization(action);
            } catch (Exception error) {
                showError(error);
            }
            return;
        }
        if (requestCode != AUTHORIZATION_REQUEST) return;
        if (resultCode != RESULT_OK || data == null) {
            setBusy(false);
            handleAuthorizationDismissed();
            return;
        }
        try {
            AuthorizationResult result = Identity.getAuthorizationClient(this)
                    .getAuthorizationResultFromIntent(data);
            continueAction(result);
        } catch (ApiException error) {
            setBusy(false);
            if (error.getStatusCode() == CommonStatusCodes.CANCELED) {
                handleAuthorizationDismissed();
            } else {
                showError(error);
            }
        }
    }

    private void continueAction(AuthorizationResult authorization) {
        String token = authorization.getAccessToken();
        if (token == null || token.isEmpty()) {
            setBusy(false);
            showError(new SecurityException("لم يمنح Google Drive رمز وصول صالحًا"));
            return;
        }
        if (!hasRequiredScopes(authorization)) {
            SecurityException missingScopes = new SecurityException(
                    "لم يمنح حساب Google صلاحيتي drive.file وdrive.appdata كاملتين. سيطلب التطبيق الصلاحيات مرة أخرى.");
            if (!tokenRefreshAttempted) {
                clearTokenAndRetry(token, pendingAction, missingScopes);
            } else {
                setBusy(false);
                showError(missingScopes);
            }
            return;
        }
        manager.recordAuthorizationSuccess();
        final PendingAction action = pendingAction;
        final String username = usernameInput.getText().toString();
        final String legacyPassword = legacyPasswordInput.getText().toString();
        final boolean restoreLegacy = legacyRestoreMode;
        final String selectedRole = selectedRole();
        final int frequencyDays = frequencyDaysFromSelection();
        final int hour;
        final int minute;
        try {
            hour = parseHour();
            minute = parseMinute();
        } catch (Exception error) {
            setBusy(false);
            showError(error);
            return;
        }
        new Thread(() -> {
            try {
                if (action == PendingAction.CONFIGURE_AND_UPLOAD) {
                    manager.configurePasswordless(
                            token, username, frequencyDays, hour, minute);
                    JSONObject result = manager.uploadNow(token, "initial");
                    runOnUiThread(() -> complete(
                            "تم الربط ورفع النسخة: " + result.optString("filename", ""), false, null));
                } else if (action == PendingAction.UPLOAD) {
                    JSONObject result = manager.uploadNow(token, "manual");
                    runOnUiThread(() -> complete(
                            "تم رفع النسخة: " + result.optString("filename", ""), false, null));
                } else if (action == PendingAction.RESTORE) {
                    QatraDriveBackupManager.RestoreResult restored = restoreLegacy
                            ? manager.restoreLatestLegacy(
                                    token, username, legacyPassword, selectedRole)
                            : manager.restoreLatest(token, username, selectedRole);
                    runOnUiThread(() -> complete(
                            "تمت استعادة النسخة بنجاح", true, restored));
                }
            } catch (Exception error) {
                manager.recordFailure(error);
                if (QatraDriveBackupManager.requiresFreshAuthorization(error)
                        && !tokenRefreshAttempted) {
                    runOnUiThread(() -> clearTokenAndRetry(token, action, error));
                    return;
                }
                runOnUiThread(() -> {
                    setBusy(false);
                    showError(error);
                    renderStatus();
                });
            }
        }, "qatra-drive-ui").start();
    }

    private static boolean hasRequiredScopes(AuthorizationResult authorization) {
        List<String> granted = authorization.getGrantedScopes();
        return granted != null
                && granted.contains(QatraDriveBackupManager.DRIVE_SCOPE)
                && granted.contains(QatraDriveBackupManager.DRIVE_APPDATA_SCOPE);
    }

    /** Clears only the invalid short-lived token, then repeats the same user action once. */
    private void clearTokenAndRetry(String token, PendingAction action, Exception originalError) {
        tokenRefreshAttempted = true;
        statusView.setText("يتم تحديث جلسة Google وإعادة التحقق من صلاحيات Drive…");
        statusView.setTextColor(Color.rgb(180, 83, 9));
        Identity.getAuthorizationClient(this)
                .clearToken(ClearTokenRequest.builder().setToken(token).build())
                .addOnSuccessListener(unused -> requestAuthorization(action))
                .addOnFailureListener(clearError -> {
                    setBusy(false);
                    showError(new SecurityException(safe(originalError)
                            + "\nتعذر تحديث رمز Google تلقائيًا. أغلق التطبيق وافتحه ثم أعد الربط."));
                });
    }

    private void complete(String message, boolean restored,
                          QatraDriveBackupManager.RestoreResult result) {
        setBusy(false);
        legacyPasswordInput.setText("");
        renderStatus();
        if (!restored) {
            toast(message);
            return;
        }
        String when = result == null || result.createdAt <= 0 ? "غير محدد"
                : DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
                .format(new Date(result.createdAt));
        new AlertDialog.Builder(this)
                .setTitle("اكتملت الاستعادة")
                .setMessage(message + "\nتاريخ النسخة: " + when
                        + "\nسيُعاد تحميل التطبيق الآن لقراءة البيانات المستعادة.")
                .setCancelable(false)
                .setPositiveButton("متابعة", (dialog, which) -> {
                    Intent out = new Intent();
                    out.putExtra(EXTRA_RESTORED, true);
                    if (result != null) out.putExtra(EXTRA_RESTORED_USERNAME, result.username);
                    setResult(RESULT_OK, out);
                    finish();
                })
                .show();
    }

    private void renderStatus() {
        try {
            JSONObject status = manager.status();
            boolean configured = status.optBoolean("configured", false);
            boolean passwordless = status.optBoolean("passwordless", false);
            boolean scheduled = status.optBoolean("scheduleEnabled", false);
            long lastSuccess = status.optLong("lastSuccessAt", 0L);
            long lastAuthorized = status.optLong("lastAuthorizedAt", 0L);
            boolean ready = configured && lastSuccess > 0L;
            StringBuilder value = new StringBuilder();
            value.append("حساب Google الموحد: ").append(googleAccount.hasSelectedAccount()
                    ? googleAccount.selectedEmail() : "غير محدد").append('\n');
            value.append("تفويض Google: ").append(lastAuthorized > 0L
                    ? "تم بنجاح" : "لم يكتمل").append('\n');
            value.append("مساحة النسخ في Drive: ").append(ready ? "جاهزة"
                    : configured ? "مهيأة محليًا — بانتظار أول رفع"
                    : "لم تكتمل التهيئة").append('\n');
            value.append("الدور: ").append(roleLabel(BuildConfig.APP_ROLE)).append('\n');
            if (configured) value.append("المستخدم: ").append(status.optString("username", "-")).append('\n');
            value.append("الاستعادة: ").append(passwordless && ready
                    ? "جاهزة بدون كلمة مرور" : passwordless
                    ? "مفتاحها جاهز — بانتظار أول رفع" : configured
                    ? "نسخة قديمة — سيتم تحويلها عند الرفع القادم" : "غير مهيأة").append('\n');
            value.append("النسخ التلقائي: ").append(scheduled ? "مفعّل" : "متوقف");
            if (scheduled) {
                value.append(status.optInt("frequencyDays", 1) == 7 ? " أسبوعيًا" : " يوميًا")
                        .append(" عند ")
                        .append(String.format(Locale.US, "%02d:%02d",
                                status.optInt("hour", 2), status.optInt("minute", 0)));
            }
            value.append("\nالاحتفاظ: أحدث ").append(QatraDriveBackupManager.RETENTION_COUNT).append(" نسخ");
            value.append("\nآخر رفع ناجح: ").append(lastSuccess > 0
                    ? DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
                    .format(new Date(lastSuccess)) : "لا يوجد");
            String lastFile = status.optString("lastFile", "");
            if (!lastFile.isEmpty()) value.append("\nآخر ملف: ").append(lastFile);
            String error = status.optString("lastError", "");
            if (!error.isEmpty()) value.append("\nآخر خطأ: ").append(error);
            statusView.setText(value.toString());
            statusView.setTextColor(error.isEmpty()
                    ? Color.rgb(15, 118, 110) : Color.rgb(153, 27, 27));
            uploadButton.setEnabled(configured);
            disableButton.setEnabled(scheduled);
        } catch (Exception error) {
            statusView.setText("تعذر قراءة حالة النسخ: " + safe(error));
            statusView.setTextColor(Color.rgb(153, 27, 27));
        }
    }

    private void requireIdentityMatchesSession() {
        String entered = QatraDriveBackupCrypto.normalizeUsername(usernameInput.getText().toString());
        if (!sessionUsername.isEmpty() && !sessionUsername.equals(entered)) {
            throw new SecurityException("اسم المستخدم يجب أن يطابق الحساب المفتوح حاليًا: " + sessionUsername);
        }
    }

    private void requireRoleMatchesApp() {
        if (!BuildConfig.APP_ROLE.equals(selectedRole())) {
            throw new SecurityException("نوع المستخدم يجب أن يطابق نسخة التطبيق: "
                    + roleLabel(BuildConfig.APP_ROLE));
        }
    }

    private void toggleLegacyRestore() {
        legacyRestoreMode = !legacyRestoreMode;
        legacyPasswordInput.setVisibility(legacyRestoreMode ? View.VISIBLE : View.GONE);
        legacyRestoreButton.setText(legacyRestoreMode
                ? "استخدام الاستعادة الجديدة بدون كلمة مرور"
                : "لدي نسخة قديمة محمية بكلمة مرور");
        restoreButton.setText(legacyRestoreMode
                ? "استعادة النسخة القديمة وتحويلها"
                : "استعادة سريعة بدون كلمة مرور");
        if (legacyRestoreMode) legacyPasswordInput.requestFocus();
        else legacyPasswordInput.setText("");
    }

    private void handleAuthorizationDismissed() {
        final PendingAction retryAction = pendingAction;
        pendingAction = null;
        statusView.setText(
                "لم تكتمل نافذة اختيار حساب Google. لم تُلغَ الصلاحية ولم تُحذف أي نسخة. اضغط زر الربط أو الاستعادة وحاول مرة أخرى.");
        statusView.setTextColor(Color.rgb(180, 83, 9));
        toast("لم تكتمل العملية؛ يمكنك إعادة المحاولة");
        if (retryAction == null || isFinishing()) return;
        new AlertDialog.Builder(this)
                .setTitle("لم يكتمل ربط Google Drive")
                .setMessage("إذا أغلقت نافذة Google بنفسك فاختر «لاحقًا». إذا ظهرت الرسالة دون أن تلغي العملية، فتحقق من إضافة معرف حزمة التطبيق وبصمة SHA-1 الصحيحة إلى Google Cloud، ثم أعد المحاولة.")
                .setNegativeButton("لاحقًا", null)
                .setPositiveButton("إعادة المحاولة", (dialog, which) -> authorize(retryAction))
                .show();
    }

    private String selectedRole() {
        int index = Math.max(0, Math.min(ROLE_CODES.length - 1, roleSpinner.getSelectedItemPosition()));
        return ROLE_CODES[index];
    }

    private int frequencyDaysFromSelection() {
        int selected = frequencySpinner.getSelectedItemPosition();
        return selected == 2 ? 7 : selected == 1 ? 1 : 0;
    }

    private int parseHour() {
        try {
            int value = Integer.parseInt(hourInput.getText().toString().trim());
            if (value < 0 || value > 23) throw new NumberFormatException();
            return value;
        } catch (Exception error) {
            throw new SecurityException("الساعة يجب أن تكون من 0 إلى 23");
        }
    }

    private int parseMinute() {
        try {
            int value = Integer.parseInt(minuteInput.getText().toString().trim());
            if (value < 0 || value > 59) throw new NumberFormatException();
            return value;
        } catch (Exception error) {
            throw new SecurityException("الدقائق يجب أن تكون من 0 إلى 59");
        }
    }

    private void setBusy(boolean busy) {
        progress.setVisibility(busy ? View.VISIBLE : View.GONE);
        accountButton.setEnabled(!busy);
        connectButton.setEnabled(!busy);
        uploadButton.setEnabled(!busy && manager.isConfigured());
        restoreButton.setEnabled(!busy);
        disableButton.setEnabled(!busy && manager.scheduleEnabled());
    }

    private void updateAccountButton() {
        if (accountButton == null) return;
        String email = googleAccount.selectedEmail();
        accountButton.setText(email.isEmpty()
                ? "اختيار حساب Google الموحد"
                : "الحساب الموحد: " + email + " — تغيير");
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(14), dp(14), dp(14));
        card.setBackgroundColor(Color.WHITE);
        return card;
    }

    private TextView label(String value) {
        TextView label = text(value, 13, true);
        label.setPadding(0, dp(10), 0, dp(4));
        return label;
    }

    private EditText input(String hint, boolean secret, boolean numeric) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setTextSize(15);
        input.setSingleLine(true);
        input.setPadding(dp(11), dp(9), dp(11), dp(9));
        if (numeric) {
            input.setInputType(InputType.TYPE_CLASS_NUMBER);
        } else if (secret) {
            input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        } else {
            input.setInputType(InputType.TYPE_CLASS_TEXT
                    | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                    | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
            input.setTextDirection(View.TEXT_DIRECTION_LTR);
        }
        return input;
    }

    private Button button(String label, int color) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14);
        button.setAllCaps(false);
        button.setBackgroundColor(color);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(50));
        params.topMargin = dp(10);
        button.setLayoutParams(params);
        return button;
    }

    private TextView text(String value, int size, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setGravity(Gravity.RIGHT);
        if (bold) view.setTypeface(view.getTypeface(), android.graphics.Typeface.BOLD);
        return view;
    }

    private void showError(Exception error) {
        String message = safe(error);
        statusView.setText("تعذر إكمال العملية\n" + message);
        statusView.setTextColor(Color.rgb(153, 27, 27));
    }

    private void toast(String message) {
        android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_LONG).show();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static int roleIndex(String role) {
        for (int i = 0; i < ROLE_CODES.length; i++) if (ROLE_CODES[i].equals(role)) return i;
        return 0;
    }

    private static String roleLabel(String role) {
        int index = roleIndex(role);
        return ROLE_LABELS[index];
    }

    private static String safe(Exception error) {
        if (error == null || error.getMessage() == null || error.getMessage().trim().isEmpty()) {
            return "حدث خطأ غير متوقع";
        }
        if (hasCause(error, UnknownHostException.class)) {
            return "لا يوجد اتصال صالح بالإنترنت أو تعذر الوصول إلى خوادم Google. تحقق من الشبكة والوقت والتاريخ في الهاتف ثم حاول مرة أخرى.";
        }
        if (hasCause(error, SocketTimeoutException.class)) {
            return "انتهت مهلة الاتصال بـ Google Drive. تحقق من استقرار الإنترنت ثم حاول مرة أخرى.";
        }
        return error.getMessage();
    }

    private static boolean hasCause(Throwable error, Class<?> type) {
        Throwable current = error;
        for (int i = 0; current != null && i < 8; i++, current = current.getCause()) {
            if (type.isInstance(current)) return true;
        }
        return false;
    }
}
