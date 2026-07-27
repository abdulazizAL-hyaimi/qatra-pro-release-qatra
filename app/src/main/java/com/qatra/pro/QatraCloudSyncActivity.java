package com.qatra.pro;

import android.app.Activity;
import android.content.Intent;
import android.content.IntentSender;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import com.google.android.gms.auth.GoogleAuthException;
import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.UserRecoverableAuthException;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Scope;

import org.json.JSONObject;

import java.io.IOException;
import java.text.DateFormat;
import java.util.Collections;
import java.util.Date;
import java.util.List;

/** Direct Google Drive synchronization center shared by all four Qatra role apps. */
public final class QatraCloudSyncActivity extends Activity {
    private static final int AUTHORIZATION_REQUEST = 8102;
    private static final int LEGACY_AUTHORIZATION_REQUEST = 8103;
    private static final String LEGACY_SCOPE_PREFIX = "oauth2:";

    private enum PendingAction { CONNECT, SYNC, DOWNLOAD, UPLOAD }

    private TextView statusView;
    private ProgressBar progress;
    private Button accountButton;
    private Button chooseButton;
    private Button syncButton;
    private Button downloadButton;
    private Button uploadButton;
    private QatraDriveApiSyncTransport transport;
    private QatraGoogleDriveAccount googleAccount;
    private PendingAction pendingAction;
    private boolean tokenRefreshAttempted;
    private boolean legacyRecoveryAttempted;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        transport = new QatraDriveApiSyncTransport(getApplicationContext());
        googleAccount = new QatraGoogleDriveAccount(getApplicationContext());
        setTitle("مزامنة قطرة برو");
        buildUi();
        refreshStatus();
    }

    private void buildUi() {
        int pad = dp(18);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);
        root.setBackgroundColor(Color.rgb(241, 247, 250));
        scroll.addView(root, new ScrollView.LayoutParams(-1, -2));

        TextView eyebrow = text("QATRA PRO · " + roleArabic(BuildConfig.APP_ROLE), 11, true);
        eyebrow.setTextColor(Color.rgb(15, 118, 110));
        root.addView(eyebrow);

        TextView title = text("مركز المزامنة عبر Google Drive", 24, true);
        title.setTextColor(Color.rgb(7, 52, 78));
        root.addView(title);

        TextView intro = text(
                "يرتبط قطرة برو بحساب Google مباشرة وينشئ مجلد QatraPro-Sync تلقائيًا. لا يحتاج ظهور Google Drive داخل مدير الملفات، ويستخدم مسار تفويض متوافقًا مع Android 9 و10 على أجهزة Samsung القديمة.",
                14, false);
        intro.setTextColor(Color.rgb(71, 85, 105));
        intro.setPadding(0, dp(8), 0, dp(14));
        root.addView(intro);

        LinearLayout card = card();
        root.addView(card);

        accountButton = button("👤 اختيار حساب Google الموحد", Color.rgb(79, 70, 229));
        accountButton.setOnClickListener(v -> chooseGoogleAccount(null));
        card.addView(accountButton);

        chooseButton = button("🔗 ربط Google Drive — مرة واحدة", Color.rgb(7, 89, 133));
        chooseButton.setOnClickListener(v -> authorize(PendingAction.CONNECT));
        card.addView(chooseButton);

        syncButton = button("🔄 مزامنة الآن", Color.rgb(15, 118, 110));
        syncButton.setOnClickListener(v -> authorize(PendingAction.SYNC));
        card.addView(syncButton);

        TextView advanced = text("خيارات منفصلة عند الحاجة", 12, true);
        advanced.setTextColor(Color.rgb(71, 85, 105));
        advanced.setPadding(0, dp(12), 0, 0);
        card.addView(advanced);

        downloadButton = button("⬇ تحميل فقط", Color.rgb(2, 132, 199));
        downloadButton.setOnClickListener(v -> authorize(PendingAction.DOWNLOAD));
        card.addView(downloadButton);

        uploadButton = button("⬆ رفع فقط", Color.rgb(71, 85, 105));
        uploadButton.setOnClickListener(v -> authorize(PendingAction.UPLOAD));
        card.addView(uploadButton);

        TextView rule = text(
                "في تطبيقات الكاشف والمحصل والصندوق تُجهَّز العمليات الجديدة تلقائيًا عند فتح هذا المركز. وفي الإدارة تُرفع ملفات التكليف والإعدادات التي تم اعتماد تصديرها من صفحات إدارة المستخدمين.",
                12, false);
        rule.setTextColor(Color.rgb(87, 83, 78));
        rule.setPadding(dp(10), dp(12), dp(10), 0);
        card.addView(rule);

        progress = new ProgressBar(this);
        progress.setIndeterminate(true);
        progress.setVisibility(View.GONE);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(dp(42), dp(42));
        progressParams.gravity = Gravity.CENTER_HORIZONTAL;
        progressParams.topMargin = dp(12);
        root.addView(progress, progressParams);

        statusView = text("جاري قراءة حالة المزامنة…", 14, false);
        statusView.setTextColor(Color.rgb(15, 23, 42));
        statusView.setBackgroundColor(Color.WHITE);
        statusView.setPadding(dp(14), dp(14), dp(14), dp(14));
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(-1, -2);
        statusParams.topMargin = dp(14);
        root.addView(statusView, statusParams);

        TextView safety = text(
                "الحماية: كل ملف مشفر بمفتاح شبكة قطرة برو ومحدد للجهة المستلمة. لا يُرفع ملف غير مشفر، وتُرفض الحزم المعدلة أو المخصصة لتطبيق آخر.",
                12, false);
        safety.setTextColor(Color.rgb(71, 85, 105));
        safety.setPadding(dp(8), dp(14), dp(8), dp(6));
        root.addView(safety);

        Button close = button("العودة إلى التطبيق ومراجعة الوارد", Color.rgb(71, 85, 105));
        close.setOnClickListener(v -> finish());
        root.addView(close);
        setContentView(scroll);
        updateAccountButton();
    }

    private void authorize(PendingAction action) {
        tokenRefreshAttempted = false;
        legacyRecoveryAttempted = false;
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

    /** Android 9/10 use the proven GoogleAuthUtil recovery flow; newer versions use Identity. */
    private void requestAuthorization(PendingAction action) {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q) {
            requestLegacyAuthorization(action);
        } else {
            requestModernAuthorization(action);
        }
    }

    private void requestModernAuthorization(PendingAction action) {
        pendingAction = action;
        setBusy(true);
        AuthorizationRequest request = AuthorizationRequest.builder()
                .setAccount(googleAccount.selectedAccount())
                .setRequestedScopes(Collections.singletonList(
                        new Scope(QatraDriveApiSyncTransport.DRIVE_SCOPE)))
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
                            pendingAction = null;
                            showError(error);
                        }
                    } else {
                        continueModernAction(result);
                    }
                })
                .addOnFailureListener(error -> {
                    setBusy(false);
                    pendingAction = null;
                    if (error instanceof ApiException
                            && ((ApiException) error).getStatusCode() == CommonStatusCodes.CANCELED) {
                        showError(new SecurityException("تم إلغاء تفويض Google Drive"));
                    } else {
                        showError(error);
                    }
                });
    }

    private void requestLegacyAuthorization(PendingAction action) {
        pendingAction = action;
        setBusy(true);
        statusView.setText("يتم طلب صلاحية Google Drive بالطريقة المتوافقة مع Android 9 و10…");
        statusView.setTextColor(Color.rgb(7, 89, 133));
        new Thread(() -> {
            try {
                String token = GoogleAuthUtil.getToken(
                        getApplicationContext(),
                        googleAccount.selectedAccount(),
                        LEGACY_SCOPE_PREFIX + QatraDriveApiSyncTransport.DRIVE_SCOPE);
                if (token == null || token.trim().isEmpty()) {
                    throw new SecurityException("لم يمنح Google Drive رمز وصول صالحًا");
                }
                runOnUiThread(() -> executeActionWithToken(token, action, true));
            } catch (UserRecoverableAuthException recoverable) {
                runOnUiThread(() -> openLegacyRecovery(recoverable));
            } catch (GoogleAuthException | IOException error) {
                runOnUiThread(() -> {
                    setBusy(false);
                    pendingAction = null;
                    showError(new SecurityException(
                            "تعذر تفويض Google Drive على هذا الجهاز: " + safe(error)));
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    setBusy(false);
                    pendingAction = null;
                    showError(error);
                });
            }
        }, "qatra-drive-legacy-auth").start();
    }

    private void openLegacyRecovery(UserRecoverableAuthException recoverable) {
        if (legacyRecoveryAttempted) {
            setBusy(false);
            pendingAction = null;
            showError(new SecurityException(
                    "لم يكتمل تفويض Google Drive بعد موافقة الحساب. حدّث خدمات Google Play وGoogle Drive ثم أعد المحاولة."));
            return;
        }
        legacyRecoveryAttempted = true;
        try {
            startActivityForResult(recoverable.getIntent(), LEGACY_AUTHORIZATION_REQUEST);
        } catch (Exception error) {
            setBusy(false);
            pendingAction = null;
            showError(new SecurityException(
                    "تعذر فتح شاشة موافقة Google Drive: " + safe(error)));
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == QatraGoogleDriveAccount.PICK_ACCOUNT_REQUEST) {
            PendingAction action = pendingAction;
            pendingAction = null;
            if (resultCode != RESULT_OK) {
                showError(new SecurityException(
                        "لم يتم اختيار حساب Google الموحد. لم تُرفع أو تُنزّل أي بيانات."));
                return;
            }
            try {
                String previous = googleAccount.selectedEmail();
                String selected = googleAccount.accountFromResult(data);
                googleAccount.saveSelectedEmail(selected);
                if (!previous.equals(selected)) {
                    transport.clearConfiguration();
                    new QatraDriveBackupManager(getApplicationContext()).onGoogleAccountChanged();
                }
                updateAccountButton();
                refreshStatus();
                if (action != null) requestAuthorization(action);
            } catch (Exception error) {
                showError(error);
            }
            return;
        }

        if (requestCode == LEGACY_AUTHORIZATION_REQUEST) {
            PendingAction action = pendingAction;
            if (resultCode != RESULT_OK || action == null) {
                setBusy(false);
                pendingAction = null;
                showError(new SecurityException(
                        "لم يكتمل تفويض Google Drive. وافق على صلاحية الوصول ثم أعد الربط."));
                return;
            }
            requestLegacyAuthorization(action);
            return;
        }

        if (requestCode != AUTHORIZATION_REQUEST) return;
        if (resultCode != RESULT_OK || data == null) {
            setBusy(false);
            pendingAction = null;
            showError(new SecurityException("لم يكتمل تفويض Google Drive"));
            return;
        }
        try {
            AuthorizationResult result = Identity.getAuthorizationClient(this)
                    .getAuthorizationResultFromIntent(data);
            continueModernAction(result);
        } catch (ApiException error) {
            setBusy(false);
            pendingAction = null;
            showError(error.getStatusCode() == CommonStatusCodes.CANCELED
                    ? new SecurityException("تم إلغاء تفويض Google Drive") : error);
        }
    }

    private void continueModernAction(AuthorizationResult authorization) {
        String token = authorization.getAccessToken();
        if (token == null || token.isEmpty()) {
            setBusy(false);
            pendingAction = null;
            showError(new SecurityException("لم يمنح Google Drive رمز وصول صالحًا"));
            return;
        }
        if (!hasDriveScope(authorization)) {
            SecurityException missing = new SecurityException(
                    "لم يمنح حساب Google صلاحية drive.file. سيطلب التطبيق التفويض مرة أخرى.");
            if (!tokenRefreshAttempted) {
                clearModernTokenAndRetry(token, pendingAction, missing);
            } else {
                setBusy(false);
                pendingAction = null;
                showError(missing);
            }
            return;
        }
        executeActionWithToken(token, pendingAction, false);
    }

    private void executeActionWithToken(String token, PendingAction action, boolean legacyToken) {
        if (action == null) {
            setBusy(false);
            return;
        }
        new Thread(() -> {
            try {
                JSONObject result;
                if (action == PendingAction.CONNECT) {
                    result = transport.configure(token);
                } else if (action == PendingAction.DOWNLOAD) {
                    result = transport.downloadUpdates(token);
                } else if (action == PendingAction.UPLOAD) {
                    result = transport.uploadPending(token);
                } else {
                    JSONObject downloaded = transport.downloadUpdates(token);
                    JSONObject uploaded = transport.uploadPending(token);
                    result = transport.status();
                    result.put("downloaded", downloaded.optInt("downloaded", 0));
                    result.put("duplicates", downloaded.optInt("duplicates", 0));
                    result.put("rejected", downloaded.optInt("rejected", 0));
                    result.put("uploaded", uploaded.optInt("uploaded", 0));
                    result.put("alreadyThere", uploaded.optInt("alreadyThere", 0));
                    result.put("message",
                            "اكتملت المزامنة: تم تنزيل التحديثات الجديدة ثم رفع العمليات المعلّقة");
                }
                runOnUiThread(() -> {
                    pendingAction = null;
                    setBusy(false);
                    renderStatus(result, result.optString("message", "اكتملت العملية"));
                });
            } catch (Exception error) {
                if (QatraDriveApiSyncTransport.requiresFreshAuthorization(error)
                        && !tokenRefreshAttempted) {
                    if (legacyToken) {
                        runOnUiThread(() -> clearLegacyTokenAndRetry(token, action, error));
                    } else {
                        runOnUiThread(() -> clearModernTokenAndRetry(token, action, error));
                    }
                    return;
                }
                runOnUiThread(() -> {
                    pendingAction = null;
                    setBusy(false);
                    showError(error);
                    refreshStatus();
                });
            }
        }, "qatra-drive-api-sync").start();
    }

    private static boolean hasDriveScope(AuthorizationResult authorization) {
        List<String> granted = authorization.getGrantedScopes();
        return granted != null && granted.contains(QatraDriveApiSyncTransport.DRIVE_SCOPE);
    }

    private void clearModernTokenAndRetry(
            String token, PendingAction action, Exception originalError) {
        tokenRefreshAttempted = true;
        statusView.setText("يتم تحديث جلسة Google وإعادة طلب صلاحية Drive…");
        statusView.setTextColor(Color.rgb(180, 83, 9));
        Identity.getAuthorizationClient(this)
                .clearToken(ClearTokenRequest.builder().setToken(token).build())
                .addOnSuccessListener(unused -> requestModernAuthorization(action))
                .addOnFailureListener(clearError -> {
                    setBusy(false);
                    pendingAction = null;
                    showError(new SecurityException(safe(originalError)
                            + "\nتعذر تحديث جلسة Google تلقائيًا. أغلق التطبيق وافتحه ثم أعد الربط."));
                });
    }

    private void clearLegacyTokenAndRetry(
            String token, PendingAction action, Exception originalError) {
        tokenRefreshAttempted = true;
        legacyRecoveryAttempted = false;
        statusView.setText("يتم تحديث جلسة Google القديمة وإعادة التفويض…");
        statusView.setTextColor(Color.rgb(180, 83, 9));
        new Thread(() -> {
            try {
                GoogleAuthUtil.clearToken(getApplicationContext(), token);
                runOnUiThread(() -> requestLegacyAuthorization(action));
            } catch (Exception clearError) {
                runOnUiThread(() -> {
                    setBusy(false);
                    pendingAction = null;
                    showError(new SecurityException(safe(originalError)
                            + "\nتعذر تحديث جلسة Google على Android 9/10: " + safe(clearError)));
                });
            }
        }, "qatra-drive-legacy-clear").start();
    }

    private void refreshStatus() {
        new Thread(() -> {
            try {
                JSONObject status = transport.status();
                runOnUiThread(() -> renderStatus(status, null));
            } catch (Exception error) {
                runOnUiThread(() -> showError(error));
            }
        }, "qatra-drive-sync-status").start();
    }

    private void renderStatus(JSONObject status, String message) {
        boolean configured = status.optBoolean("configured", false);
        boolean keyReady = status.optBoolean("keyReady", false);
        syncButton.setEnabled(configured && keyReady);
        downloadButton.setEnabled(configured && keyReady);
        uploadButton.setEnabled(configured && keyReady);
        long lastUpload = status.optLong("lastUploadAt", 0L);
        long lastDownload = status.optLong("lastDownloadAt", 0L);
        StringBuilder value = new StringBuilder();
        if (message != null && !message.isEmpty()) value.append(message).append("\n\n");
        value.append("حساب Google الموحد: ").append(googleAccount.hasSelectedAccount()
                ? googleAccount.selectedEmail() : "غير محدد").append('\n');
        value.append("طريقة الاتصال: Google Drive API مباشر").append('\n');
        value.append("طريقة التفويض: ").append(Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q
                ? "متوافقة مع Android 9/10" : "Google Identity الحديثة").append('\n');
        value.append("المجلد السحابي: ").append(configured
                ? "QatraPro-Sync جاهز" : "غير مربوط").append('\n');
        value.append("مفتاح التشفير: ").append(keyReady
                ? "جاهز" : "يلزم ملف ربط من الإدارة").append('\n');
        value.append("التطبيق: ").append(roleArabic(status.optString("role", BuildConfig.APP_ROLE))).append('\n');
        value.append("بانتظار الرفع: ").append(status.optInt("pendingUpload", 0)).append('\n');
        value.append("بانتظار المراجعة والدمج: ").append(status.optInt("pendingReview", 0)).append('\n');
        value.append("آخر رفع: ").append(formatTime(lastUpload)).append('\n');
        value.append("آخر تحميل: ").append(formatTime(lastDownload));
        if (status.has("uploaded")) {
            value.append("\n\nنتيجة الرفع: ").append(status.optInt("uploaded", 0))
                    .append(" جديد، ").append(status.optInt("alreadyThere", 0))
                    .append(" موجود مسبقًا");
        }
        if (status.has("downloaded")) {
            value.append("\n\nنتيجة التحميل: ").append(status.optInt("downloaded", 0))
                    .append(" جديد، ").append(status.optInt("duplicates", 0))
                    .append(" مكرر، ").append(status.optInt("rejected", 0)).append(" مرفوض");
        }
        String error = status.optString("lastError", "");
        if (!error.isEmpty()) value.append("\nآخر خطأ: ").append(error);
        statusView.setText(value.toString());
        statusView.setTextColor(configured && keyReady
                ? Color.rgb(15, 118, 110) : Color.rgb(120, 53, 15));
    }

    private void setBusy(boolean busy) {
        progress.setVisibility(busy ? View.VISIBLE : View.GONE);
        accountButton.setEnabled(!busy);
        chooseButton.setEnabled(!busy);
        syncButton.setEnabled(!busy && transport.isConfigured());
        downloadButton.setEnabled(!busy && transport.isConfigured());
        uploadButton.setEnabled(!busy && transport.isConfigured());
    }

    private void updateAccountButton() {
        if (accountButton == null) return;
        String email = googleAccount.selectedEmail();
        accountButton.setText(email.isEmpty()
                ? "👤 اختيار حساب Google الموحد"
                : "👤 الحساب الموحد: " + email + " — تغيير");
    }

    private void showError(Throwable error) {
        String message = safe(error);
        statusView.setText("تعذرت العملية\n\n" + message);
        statusView.setTextColor(Color.rgb(153, 27, 27));
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(14), dp(14), dp(14));
        card.setBackgroundColor(Color.WHITE);
        return card;
    }

    private Button button(String label, int color) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14);
        button.setAllCaps(false);
        button.setBackgroundColor(color);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(52));
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

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private static String roleArabic(String role) {
        if ("ADMIN".equals(role)) return "الإدارة";
        if ("READER".equals(role)) return "الكاشف";
        if ("COLLECTOR".equals(role)) return "المحصل";
        if ("CASHIER".equals(role)) return "الصندوق";
        return role == null ? "-" : role;
    }

    private static String formatTime(long value) {
        return value <= 0 ? "لم يتم" : DateFormat.getDateTimeInstance(
                DateFormat.MEDIUM, DateFormat.SHORT).format(new Date(value));
    }

    private static String safe(Throwable error) {
        if (error == null) return "خطأ غير معروف";
        String message = error.getMessage();
        return message == null || message.trim().isEmpty()
                ? error.getClass().getSimpleName() : message;
    }
}
