package com.qatra.pro;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.fragment.app.FragmentActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/** Single-APK, multi-role shell for Qatra ERP. */
public final class UnifiedMainActivity extends FragmentActivity {
    private static final String ASSET_ROOT = "file:///android_asset/qatra/";
    private static final String START_PAGE = "erp.html";
    private static final long IDLE_TIMEOUT_MS = 5 * 60_000L;
    private static final int ERP_BACKUP_SAVE_REQ = 8810;
    private static final int ERP_BACKUP_RESTORE_REQ = 8811;
    private static final int ERP_SYNC_SAVE_REQ = 8820;
    private static final int ERP_SYNC_IMPORT_REQ = 8821;
    private static final int MAX_BACKUP_BYTES = 30_000_000;
    private static final String ERP_BACKUP_MIME = "application/vnd.qatra.erp+qbackup";
    private static final String ERP_SYNC_MIME = "application/vnd.qatra.erp-sync+json";

    private static final Map<String, String> READ_PERMISSION_BY_NAMESPACE = new LinkedHashMap<>();
    private static final Map<String, String> WRITE_PERMISSION_BY_NAMESPACE = new LinkedHashMap<>();
    static {
        READ_PERMISSION_BY_NAMESPACE.put("erp.core", QatraUnifiedUserStore.P_VIEW_DASHBOARD);
        READ_PERMISSION_BY_NAMESPACE.put("erp.billing", QatraUnifiedUserStore.P_VIEW_DASHBOARD);
        READ_PERMISSION_BY_NAMESPACE.put("erp.accounting", QatraUnifiedUserStore.P_VIEW_REPORTS);
        READ_PERMISSION_BY_NAMESPACE.put("erp.procurement", QatraUnifiedUserStore.P_VIEW_DASHBOARD);
        READ_PERMISSION_BY_NAMESPACE.put("erp.inventory", QatraUnifiedUserStore.P_VIEW_DASHBOARD);
        READ_PERMISSION_BY_NAMESPACE.put("erp.assets", QatraUnifiedUserStore.P_VIEW_DASHBOARD);
        READ_PERMISSION_BY_NAMESPACE.put("erp.hr", QatraUnifiedUserStore.P_VIEW_DASHBOARD);
        READ_PERMISSION_BY_NAMESPACE.put("erp.maintenance", QatraUnifiedUserStore.P_VIEW_DASHBOARD);
        READ_PERMISSION_BY_NAMESPACE.put("erp.documents", QatraUnifiedUserStore.P_VIEW_DASHBOARD);
        READ_PERMISSION_BY_NAMESPACE.put("erp.audit", QatraUnifiedUserStore.P_VIEW_AUDIT);
        READ_PERMISSION_BY_NAMESPACE.put("enterprise.core", QatraUnifiedUserStore.P_VIEW_DASHBOARD);

        WRITE_PERMISSION_BY_NAMESPACE.put("erp.core", QatraUnifiedUserStore.P_MANAGE_SETTINGS);
        WRITE_PERMISSION_BY_NAMESPACE.put("erp.billing", QatraUnifiedUserStore.P_MANAGE_BILLING);
        WRITE_PERMISSION_BY_NAMESPACE.put("erp.accounting", QatraUnifiedUserStore.P_MANAGE_ACCOUNTING);
        WRITE_PERMISSION_BY_NAMESPACE.put("erp.procurement", QatraUnifiedUserStore.P_MANAGE_PROCUREMENT);
        WRITE_PERMISSION_BY_NAMESPACE.put("erp.inventory", QatraUnifiedUserStore.P_MANAGE_INVENTORY);
        WRITE_PERMISSION_BY_NAMESPACE.put("erp.assets", QatraUnifiedUserStore.P_MANAGE_ASSETS);
        WRITE_PERMISSION_BY_NAMESPACE.put("erp.hr", QatraUnifiedUserStore.P_MANAGE_HR);
        WRITE_PERMISSION_BY_NAMESPACE.put("erp.maintenance", QatraUnifiedUserStore.P_MANAGE_MAINTENANCE);
        WRITE_PERMISSION_BY_NAMESPACE.put("erp.documents", QatraUnifiedUserStore.P_MANAGE_SETTINGS);
        WRITE_PERMISSION_BY_NAMESPACE.put("erp.audit", QatraUnifiedUserStore.P_VIEW_AUDIT);
        WRITE_PERMISSION_BY_NAMESPACE.put("enterprise.core", QatraUnifiedUserStore.P_MANAGE_SETTINGS);
    }

    private WebView webView;
    private QatraDatabase database;
    private QatraUnifiedUserStore users;
    private QatraErpMigration migration;
    private QatraErpPostingService postingService;
    private QatraCrypto crypto;
    private byte[] pendingBackupBytes;
    private String pendingBackupPackageId;
    private String pendingBackupActorId;
    private String pendingRestoreActorId;
    private byte[] pendingSyncBytes;
    private String pendingSyncPackageId;
    private String pendingSyncOperationId;
    private String pendingSyncPayloadHash;
    private String pendingSyncOperationType;
    private String pendingSyncPayloadJson;
    private String pendingSyncActorId;
    private String pendingSyncImportActorId;
    private String pendingSyncImportExpectedType;
    private QatraUnifiedUserStore.Session session;
    private AlertDialog activeDialog;
    private long backgroundAt;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        database = new QatraDatabase(getApplicationContext());
        users = new QatraUnifiedUserStore(getApplicationContext());
        migration = new QatraErpMigration(database);
        postingService = new QatraErpPostingService(database);
        crypto = new QatraCrypto(getApplicationContext());
        buildWebView();
        showGate();
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void buildWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (android.os.Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        webView.addJavascriptInterface(new UnifiedBridge(), "AndroidBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request == null || request.getUrl() == null ? "" : request.getUrl().toString();
                return blockExternal(url);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return blockExternal(url);
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (url != null && !url.startsWith(ASSET_ROOT)) {
                    view.stopLoading();
                    toast("تم منع فتح محتوى خارجي داخل التطبيق");
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.setVisibility(View.INVISIBLE);
        setContentView(webView);
    }

    private boolean blockExternal(String url) {
        if (url == null || url.startsWith(ASSET_ROOT) || url.startsWith("about:blank")) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url))); }
        catch (Exception error) { toast("تعذر فتح الرابط الخارجي"); }
        return true;
    }

    private void showGate() {
        if (isFinishing() || activeDialog != null) return;
        webView.setVisibility(View.INVISIBLE);
        if (!users.hasUsers()) showInitialAdmin(); else showLogin("");
    }

    private void showInitialAdmin() {
        EditText name = textInput("اسم مدير النظام");
        EditText username = textInput("اسم المستخدم بالإنجليزية");
        EditText password = passwordInput("كلمة المرور");
        EditText confirm = passwordInput("تأكيد كلمة المرور");
        LinearLayout form = form("تهيئة Qatra ERP",
                "أنشئ أول مدير للنظام. هذا الحساب يملك إدارة المستخدمين والأدوار والنسخ الاحتياطية.",
                name, username, password, confirm);
        Button save = primaryButton("إنشاء مدير النظام");
        save.setOnClickListener(v -> {
            try {
                if (!password.getText().toString().equals(confirm.getText().toString())) {
                    confirm.setError("كلمتا المرور غير متطابقتين");
                    return;
                }
                session = users.createInitialAdministrator(username.getText().toString(),
                        name.getText().toString(), password.getText().toString());
                password.setText("");
                confirm.setText("");
                dismissDialog();
                openApplication();
            } catch (Exception error) { password.setError(safeMessage(error)); }
        });
        form.addView(save, buttonParams());
        showDialog(form, false);
    }

    private void showLogin(String message) {
        EditText username = textInput("اسم المستخدم");
        EditText password = passwordInput("كلمة المرور");
        LinearLayout form = form("تسجيل الدخول", message.isEmpty()
                ? "أدخل حسابك. ستظهر فقط الوحدات والصلاحيات الممنوحة لك."
                : message, username, password);
        Button login = primaryButton("دخول");
        login.setOnClickListener(v -> {
            try {
                session = users.authenticate(username.getText().toString(), password.getText().toString());
                password.setText("");
                dismissDialog();
                if (session.mustChangePassword) showForcedPasswordChange(); else openApplication();
            } catch (Exception error) { password.setError(safeMessage(error)); }
        });
        form.addView(login, buttonParams());
        Button close = secondaryButton("إغلاق التطبيق");
        close.setOnClickListener(v -> finishAffinity());
        form.addView(close, buttonParams());
        showDialog(form, false);
    }

    private void showForcedPasswordChange() {
        EditText current = passwordInput("كلمة المرور المؤقتة");
        EditText next = passwordInput("كلمة المرور الجديدة");
        EditText confirm = passwordInput("تأكيد كلمة المرور الجديدة");
        LinearLayout form = form("تغيير كلمة المرور مطلوب",
                "أنشأت الإدارة كلمة مرور مؤقتة. يجب تغييرها قبل فتح النظام.", current, next, confirm);
        Button save = primaryButton("تغيير وفتح النظام");
        save.setOnClickListener(v -> {
            try {
                if (!next.getText().toString().equals(confirm.getText().toString())) {
                    confirm.setError("كلمتا المرور غير متطابقتين");
                    return;
                }
                session = users.changeOwnPassword(session, current.getText().toString(),
                        next.getText().toString());
                current.setText(""); next.setText(""); confirm.setText("");
                dismissDialog();
                openApplication();
            } catch (Exception error) { next.setError(safeMessage(error)); }
        });
        form.addView(save, buttonParams());
        showDialog(form, false);
    }

    private void openApplication() {
        backgroundAt = 0L;
        webView.setVisibility(View.VISIBLE);
        webView.onResume();
        webView.resumeTimers();
        webView.loadUrl(ASSET_ROOT + START_PAGE);
    }

    private void logout() {
        session = null;
        backgroundAt = 0L;
        webView.loadUrl("about:blank");
        webView.clearHistory();
        showGate();
    }

    @Override protected void onStop() {
        if (session != null) backgroundAt = System.currentTimeMillis();
        if (webView != null) { webView.onPause(); webView.pauseTimers(); }
        super.onStop();
    }

    @Override protected void onResume() {
        super.onResume();
        if (session != null && backgroundAt > 0L
                && System.currentTimeMillis() - backgroundAt >= IDLE_TIMEOUT_MS) {
            session = null;
            if (webView != null) { webView.loadUrl("about:blank"); webView.clearHistory(); }
        }
        if (session == null && users != null) showGate();
        else if (webView != null) { backgroundAt = 0L; webView.onResume(); webView.resumeTimers(); }
    }

    @Override public void onBackPressed() {
        if (activeDialog != null) { dismissDialog(); return; }
        if (session == null) { finishAffinity(); return; }
        new AlertDialog.Builder(this)
                .setTitle("Qatra ERP")
                .setMessage("هل تريد تسجيل الخروج؟")
                .setPositiveButton("تسجيل الخروج", (d, w) -> logout())
                .setNegativeButton("إلغاء", null)
                .show();
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == ERP_BACKUP_SAVE_REQ) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                writePendingBackup(data.getData());
            } else {
                clearPendingBackup();
                toast("تم إلغاء حفظ النسخة الاحتياطية");
            }
            return;
        }
        if (requestCode == ERP_BACKUP_RESTORE_REQ) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                inspectSelectedBackup(data.getData());
            } else {
                pendingRestoreActorId = null;
                toast("تم إلغاء اختيار نسخة الاستعادة");
            }
            return;
        }
        if (requestCode == ERP_SYNC_SAVE_REQ) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                writePendingDeviceSync(data.getData());
            } else {
                clearPendingDeviceSync();
                toast("تم إلغاء حفظ حزمة المزامنة");
            }
            return;
        }
        if (requestCode == ERP_SYNC_IMPORT_REQ) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                inspectSelectedDeviceSync(data.getData());
            } else {
                pendingSyncImportActorId = null;
                pendingSyncImportExpectedType = null;
                toast("تم إلغاء اختيار حزمة المزامنة");
            }
        }
    }

    private void launchBackupSave(byte[] bytes, String packageId, String actorUserId) {
        if (!sameActiveRecoveryActor(actorUserId)) {
            if (bytes != null) Arrays.fill(bytes, (byte) 0);
            return;
        }
        try {
            clearPendingBackup();
            pendingBackupBytes = Arrays.copyOf(bytes, bytes.length);
            pendingBackupPackageId = packageId;
            pendingBackupActorId = actorUserId;
            String stamp = new SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(new Date());
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(ERP_BACKUP_MIME);
            intent.putExtra(Intent.EXTRA_TITLE, "qatra-erp-backup-" + stamp + ".qerpbak");
            startActivityForResult(Intent.createChooser(intent,
                    "حفظ نسخة Qatra ERP المشفرة"), ERP_BACKUP_SAVE_REQ);
        } catch (Exception error) {
            clearPendingBackup();
            toast("تعذر فتح نافذة حفظ النسخة: " + safeMessage(error));
        } finally {
            if (bytes != null) Arrays.fill(bytes, (byte) 0);
        }
    }

    private void writePendingBackup(Uri uri) {
        final byte[] bytes = pendingBackupBytes == null ? null
                : Arrays.copyOf(pendingBackupBytes, pendingBackupBytes.length);
        final String packageId = pendingBackupPackageId;
        final String actorUserId = pendingBackupActorId;
        clearPendingBackup();
        if (bytes == null || !sameActiveRecoveryActor(actorUserId)) {
            if (bytes != null) Arrays.fill(bytes, (byte) 0);
            toast("انتهت صلاحية عملية حفظ النسخة");
            return;
        }
        new Thread(() -> {
            try (OutputStream out = getContentResolver().openOutputStream(uri, "w")) {
                if (out == null) throw new IllegalStateException("تعذر فتح ملف النسخة للكتابة");
                out.write(bytes);
                out.flush();
                database.recordPortableBackupExport("UNIFIED", packageId);
                runOnUiThread(() -> toast("تم حفظ نسخة Qatra ERP المشفرة بنجاح"));
            } catch (Exception error) {
                runOnUiThread(() -> toast("تعذر حفظ النسخة: " + safeMessage(error)));
            } finally {
                Arrays.fill(bytes, (byte) 0);
            }
        }, "qatra-erp-backup-write").start();
    }

    private void launchRestorePicker(String actorUserId) {
        if (!sameActiveRecoveryActor(actorUserId)) return;
        try {
            pendingRestoreActorId = actorUserId;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES,
                    new String[]{ERP_BACKUP_MIME, "application/octet-stream"});
            startActivityForResult(Intent.createChooser(intent,
                    "اختر نسخة Qatra ERP المشفرة"), ERP_BACKUP_RESTORE_REQ);
        } catch (Exception error) {
            pendingRestoreActorId = null;
            toast("تعذر فتح نافذة الاستعادة: " + safeMessage(error));
        }
    }

    private void inspectSelectedBackup(Uri uri) {
        final String actorUserId = pendingRestoreActorId;
        pendingRestoreActorId = null;
        if (!sameActiveRecoveryActor(actorUserId)) {
            toast("انتهت صلاحية عملية الاستعادة");
            return;
        }
        new Thread(() -> {
            byte[] bytes = null;
            try {
                bytes = readLimitedBytes(uri);
                if (!crypto.isPortableBackup(bytes)) {
                    throw new SecurityException("الملف ليس نسخة احتياطية مشفرة لقطرة برو");
                }
                QatraCrypto.EncryptedPackage pack =
                        crypto.decryptPortableBackup(bytes, "UNIFIED");
                runOnUiThread(() -> showRestoreConfirmation(pack, actorUserId));
            } catch (Exception error) {
                runOnUiThread(() -> toast("تعذر فحص النسخة: " + safeMessage(error)));
            } finally {
                if (bytes != null) Arrays.fill(bytes, (byte) 0);
            }
        }, "qatra-erp-backup-inspect").start();
    }

    private void showRestoreConfirmation(
            QatraCrypto.EncryptedPackage pack, String actorUserId) {
        if (!sameActiveRecoveryActor(actorUserId) || isFinishing()) {
            clearPackage(pack);
            return;
        }
        try {
            JSONObject payload = new JSONObject(pack.payloadJson);
            JSONObject meta = payload.optJSONObject("meta");
            int count = meta == null ? 0 : meta.optInt("namespaceCount", 0);
            long exportedAt = meta == null ? 0L : meta.optLong("exportedAt", 0L);
            String when = exportedAt <= 0L ? "غير معروف"
                    : new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US)
                            .format(new Date(exportedAt));
            new AlertDialog.Builder(this)
                    .setTitle("تأكيد استعادة Qatra ERP")
                    .setMessage("تاريخ النسخة: " + when + "\nنطاقات البيانات: " + count
                            + "\n\nسيُنشئ النظام لقطة رجوع محلية قبل الاستعادة. "
                            + "الحسابات وكلمات المرور لا تتغير.")
                    .setPositiveButton("استعادة النسخة", (dialog, which) ->
                            applySelectedBackup(pack, actorUserId))
                    .setNegativeButton("إلغاء", (dialog, which) -> clearPackage(pack))
                    .setOnCancelListener(dialog -> clearPackage(pack))
                    .show();
        } catch (Exception error) {
            clearPackage(pack);
            toast("تعذر قراءة وصف النسخة: " + safeMessage(error));
        }
    }

    private void applySelectedBackup(
            QatraCrypto.EncryptedPackage pack, String actorUserId) {
        if (!sameActiveRecoveryActor(actorUserId)) {
            clearPackage(pack);
            toast("انتهت صلاحية عملية الاستعادة");
            return;
        }
        new Thread(() -> {
            boolean restored = false;
            try {
                boolean hadSyncKey = crypto.isProvisioned();
                if (hadSyncKey) crypto.restoreRecoveredSyncKey(pack.recoveredSyncKey);
                database.restorePortableBackup("UNIFIED", pack.payloadJson);
                restored = true;
                if (!hadSyncKey) crypto.restoreRecoveredSyncKey(pack.recoveredSyncKey);
                runOnUiThread(() -> {
                    if (webView != null) webView.reload();
                    toast("تمت الاستعادة بنجاح. لقطة الرجوع متاحة من مركز التعافي.");
                });
            } catch (Exception error) {
                if (restored) {
                    try { database.rollbackLastPortableRestore("UNIFIED", actorUserId); }
                    catch (Exception ignored) { }
                }
                runOnUiThread(() -> toast("تعذر استعادة النسخة: " + safeMessage(error)));
            } finally {
                clearPackage(pack);
            }
        }, "qatra-erp-backup-restore").start();
    }

    private void launchDeviceSyncSave(
            QatraCrypto.EncryptedPackage pack, String actorUserId) {
        if (!sameActiveSyncExportActor(actorUserId)) {
            clearPackage(pack);
            return;
        }
        try {
            clearPendingDeviceSync();
            pendingSyncBytes = Arrays.copyOf(pack.bytes, pack.bytes.length);
            pendingSyncPackageId = pack.packageId;
            pendingSyncOperationId = pack.operationId;
            pendingSyncPayloadHash = pack.payloadHash;
            pendingSyncOperationType = pack.operationType;
            pendingSyncPayloadJson = pack.payloadJson;
            pendingSyncActorId = actorUserId;
            boolean receipt = "DEVICE_RECEIPT".equals(pack.operationType);
            String stamp = new SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(new Date());
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(ERP_SYNC_MIME);
            intent.putExtra(Intent.EXTRA_TITLE,
                    (receipt ? "qatra-erp-receipt-" : "qatra-erp-sync-")
                            + stamp + ".qerpsync");
            startActivityForResult(Intent.createChooser(intent, receipt
                    ? "حفظ إيصال مزامنة Qatra ERP المشفر"
                    : "حفظ حزمة مزامنة Qatra ERP المشفرة"), ERP_SYNC_SAVE_REQ);
        } catch (Exception error) {
            clearPendingDeviceSync();
            toast("تعذر فتح نافذة حفظ ملف المزامنة: " + safeMessage(error));
        } finally {
            clearPackage(pack);
        }
    }

    private void writePendingDeviceSync(Uri uri) {
        final byte[] bytes = pendingSyncBytes == null ? null
                : Arrays.copyOf(pendingSyncBytes, pendingSyncBytes.length);
        final String packageId = pendingSyncPackageId;
        final String operationId = pendingSyncOperationId;
        final String payloadHash = pendingSyncPayloadHash;
        final String operationType = pendingSyncOperationType;
        final String payloadJson = pendingSyncPayloadJson;
        final String actorUserId = pendingSyncActorId;
        clearPendingDeviceSync();
        if (bytes == null || payloadJson == null
                || (!"DEVICE_CHANGESET".equals(operationType)
                && !"DEVICE_RECEIPT".equals(operationType))
                || !sameActiveSyncExportActor(actorUserId)) {
            if (bytes != null) Arrays.fill(bytes, (byte) 0);
            toast("انتهت صلاحية عملية تصدير المزامنة");
            return;
        }
        new Thread(() -> {
            try (OutputStream out = getContentResolver().openOutputStream(uri, "w")) {
                if (out == null) throw new IllegalStateException("تعذر فتح ملف المزامنة للكتابة");
                out.write(bytes);
                out.flush();
                if ("DEVICE_RECEIPT".equals(operationType)) {
                    database.recordDeviceReceiptExport(
                            packageId, operationId, payloadHash, payloadJson, actorUserId);
                } else {
                    database.recordDeviceChangesetExport(
                            packageId, operationId, payloadHash, payloadJson, actorUserId);
                }
                runOnUiThread(() -> toast("DEVICE_RECEIPT".equals(operationType)
                        ? "تم حفظ إيصال الإدارة المشفر. أعده إلى الجهاز المصدر لتثبيت النتائج."
                        : "تم حفظ الحزمة المشفرة. تبقى حركات المصدر حتى استيراد إيصال الإدارة."));
            } catch (Exception error) {
                runOnUiThread(() -> toast("تعذر حفظ ملف المزامنة: " + safeMessage(error)));
            } finally {
                Arrays.fill(bytes, (byte) 0);
            }
        }, "qatra-erp-sync-write").start();
    }

    private void launchDeviceSyncImport(String actorUserId, String expectedType) {
        if (!sameActiveSyncImportActor(actorUserId, expectedType)) return;
        try {
            pendingSyncImportActorId = actorUserId;
            pendingSyncImportExpectedType = expectedType;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES,
                    new String[]{ERP_SYNC_MIME, "application/octet-stream", "application/json"});
            startActivityForResult(Intent.createChooser(intent,
                    "DEVICE_RECEIPT".equals(expectedType)
                            ? "اختر إيصال الإدارة المشفر"
                            : "اختر حزمة مزامنة Qatra ERP المشفرة"), ERP_SYNC_IMPORT_REQ);
        } catch (Exception error) {
            pendingSyncImportActorId = null;
            pendingSyncImportExpectedType = null;
            toast("تعذر فتح نافذة استيراد المزامنة: " + safeMessage(error));
        }
    }

    private void inspectSelectedDeviceSync(Uri uri) {
        final String actorUserId = pendingSyncImportActorId;
        final String expectedType = pendingSyncImportExpectedType;
        pendingSyncImportActorId = null;
        pendingSyncImportExpectedType = null;
        if (!sameActiveSyncImportActor(actorUserId, expectedType)) {
            toast("انتهت صلاحية عملية استيراد المزامنة");
            return;
        }
        new Thread(() -> {
            byte[] bytes = null;
            try {
                bytes = readLimitedBytes(uri);
                QatraCrypto.EncryptedPackage pack = crypto.decryptSync(bytes, "UNIFIED");
                if (!expectedType.equals(pack.operationType)) {
                    clearPackage(pack);
                    throw new SecurityException("نوع ملف المزامنة لا يطابق العملية المطلوبة");
                }
                runOnUiThread(() -> {
                    if ("DEVICE_RECEIPT".equals(expectedType)) {
                        showDeviceReceiptImportConfirmation(pack, actorUserId);
                    } else {
                        showDeviceSyncImportConfirmation(pack, actorUserId);
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> toast("تعذر فحص ملف المزامنة: " + safeMessage(error)));
            } finally {
                if (bytes != null) Arrays.fill(bytes, (byte) 0);
            }
        }, "qatra-erp-sync-inspect").start();
    }

    private void showDeviceSyncImportConfirmation(
            QatraCrypto.EncryptedPackage pack, String actorUserId) {
        if (!sameActiveRecoveryActor(actorUserId) || isFinishing()) {
            clearPackage(pack);
            return;
        }
        try {
            JSONObject payload = new JSONObject(pack.payloadJson);
            JSONObject meta = payload.optJSONObject("meta");
            int count = meta == null ? 0 : meta.optInt("changeCount", 0);
            String sourceDevice = meta == null ? "—" : meta.optString("sourceDeviceId", "—");
            JSONArray roles = meta == null ? null : meta.optJSONArray("sourceRoles");
            new AlertDialog.Builder(this)
                    .setTitle("إضافة الحزمة إلى المراجعة")
                    .setMessage("عدد الحركات: " + count
                            + "\nالجهاز المصدر: " + sourceDevice
                            + "\nالأدوار المعلنة: " + (roles == null ? "—" : roles.toString())
                            + "\n\nلن تتغير البيانات التشغيلية الآن. تُفحص الحركات وتنتظر اعتماد الإدارة، والتعارضات تحتاج قرارًا مستقلًا.")
                    .setPositiveButton("فحص وإضافة", (dialog, which) ->
                            stageSelectedDeviceSync(pack, actorUserId))
                    .setNegativeButton("إلغاء", (dialog, which) -> clearPackage(pack))
                    .setOnCancelListener(dialog -> clearPackage(pack))
                    .show();
        } catch (Exception error) {
            clearPackage(pack);
            toast("تعذر قراءة وصف حزمة المزامنة: " + safeMessage(error));
        }
    }

    private void stageSelectedDeviceSync(
            QatraCrypto.EncryptedPackage pack, String actorUserId) {
        if (!sameActiveRecoveryActor(actorUserId)) {
            clearPackage(pack);
            toast("انتهت صلاحية مراجعة المزامنة");
            return;
        }
        new Thread(() -> {
            try {
                JSONObject result = database.stageDeviceSyncPackage(
                        pack.packageId, pack.operationId, pack.payloadHash, pack.payloadJson,
                        localDeviceId(), actorUserId);
                runOnUiThread(() -> {
                    if (webView != null) webView.reload();
                    toast(result.optString("message", "تمت إضافة الحزمة للمراجعة"));
                });
            } catch (Exception error) {
                runOnUiThread(() -> toast("تعذر إضافة حزمة المزامنة: " + safeMessage(error)));
            } finally {
                clearPackage(pack);
            }
        }, "qatra-erp-sync-stage").start();
    }

    private void showDeviceReceiptImportConfirmation(
            QatraCrypto.EncryptedPackage pack, String actorUserId) {
        if (!sameActiveSyncExportActor(actorUserId) || isFinishing()) {
            clearPackage(pack);
            return;
        }
        try {
            JSONObject payload = new JSONObject(pack.payloadJson);
            JSONObject meta = payload.optJSONObject("meta");
            int count = meta == null ? 0 : meta.optInt("decisionCount", 0);
            String sourceDevice = meta == null ? "—" : meta.optString("sourceDeviceId", "—");
            String originalPackage = meta == null
                    ? "—" : meta.optString("originalPackageId", "—");
            new AlertDialog.Builder(this)
                    .setTitle("تثبيت نتيجة مراجعة الإدارة")
                    .setMessage("عدد النتائج: " + count
                            + "\nجهاز الإدارة: " + sourceDevice
                            + "\nالحزمة الأصلية: " + originalPackage
                            + "\n\nلن يستبدل الإيصال بيانات تشغيلية. سيؤكد الحركات المقبولة ويحفظ الرفض أو الإبقاء على المحلي في السجل، فلا تُعاد الحركات المحسومة في التصدير.")
                    .setPositiveButton("فحص وتثبيت", (dialog, which) ->
                            applySelectedDeviceReceipt(pack, actorUserId))
                    .setNegativeButton("إلغاء", (dialog, which) -> clearPackage(pack))
                    .setOnCancelListener(dialog -> clearPackage(pack))
                    .show();
        } catch (Exception error) {
            clearPackage(pack);
            toast("تعذر قراءة وصف إيصال المزامنة: " + safeMessage(error));
        }
    }

    private void applySelectedDeviceReceipt(
            QatraCrypto.EncryptedPackage pack, String actorUserId) {
        if (!sameActiveSyncExportActor(actorUserId)) {
            clearPackage(pack);
            toast("انتهت صلاحية تثبيت إيصال المزامنة");
            return;
        }
        new Thread(() -> {
            try {
                JSONObject result = database.applyDeviceReceipt(
                        pack.packageId, pack.operationId, pack.payloadHash, pack.payloadJson,
                        localDeviceId(), actorUserId);
                runOnUiThread(() -> {
                    if (webView != null) webView.reload();
                    toast(result.optString("message", "تم تثبيت إيصال الإدارة"));
                });
            } catch (Exception error) {
                runOnUiThread(() -> toast("تعذر تثبيت إيصال المزامنة: " + safeMessage(error)));
            } finally {
                clearPackage(pack);
            }
        }, "qatra-erp-receipt-apply").start();
    }

    private String localDeviceId() {
        android.content.SharedPreferences prefs =
                getSharedPreferences("qatra_erp_device_identity", MODE_PRIVATE);
        String id = prefs.getString("device_id", "");
        if (id != null && id.matches("DEV-[0-9a-fA-F-]{36}")) return id;
        id = "DEV-" + java.util.UUID.randomUUID();
        if (!prefs.edit().putString("device_id", id).commit()) {
            throw new IllegalStateException("تعذر حفظ معرّف جهاز المزامنة");
        }
        return id;
    }

    private boolean sameActiveSyncExportActor(String actorUserId) {
        return actorUserId != null && session != null
                && actorUserId.equals(session.userId)
                && (session.has(QatraUnifiedUserStore.P_EXPORT_DATA)
                || session.has(QatraUnifiedUserStore.P_CAPTURE_READINGS)
                || session.has(QatraUnifiedUserStore.P_COLLECT_PAYMENTS)
                || session.has(QatraUnifiedUserStore.P_MANAGE_CASHBOX)
                || session.has(QatraUnifiedUserStore.P_MANAGE_SETTINGS));
    }

    private boolean sameActiveSyncImportActor(String actorUserId, String expectedType) {
        if ("DEVICE_CHANGESET".equals(expectedType)) {
            return sameActiveRecoveryActor(actorUserId);
        }
        return "DEVICE_RECEIPT".equals(expectedType)
                && sameActiveSyncExportActor(actorUserId);
    }

    private void clearPendingDeviceSync() {
        if (pendingSyncBytes != null) Arrays.fill(pendingSyncBytes, (byte) 0);
        pendingSyncBytes = null;
        pendingSyncPackageId = null;
        pendingSyncOperationId = null;
        pendingSyncPayloadHash = null;
        pendingSyncOperationType = null;
        pendingSyncPayloadJson = null;
        pendingSyncActorId = null;
    }

    private byte[] readLimitedBytes(Uri uri) throws Exception {
        try (InputStream in = getContentResolver().openInputStream(uri);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) throw new IllegalStateException("تعذر فتح ملف النسخة");
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = in.read(buffer)) != -1) {
                total += read;
                if (total > MAX_BACKUP_BYTES) {
                    throw new SecurityException("حجم الملف يتجاوز الحد المسموح");
                }
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }

    private boolean sameActiveRecoveryActor(String actorUserId) {
        return actorUserId != null && session != null
                && actorUserId.equals(session.userId)
                && session.has(QatraUnifiedUserStore.P_MANAGE_SETTINGS);
    }

    private void clearPendingBackup() {
        if (pendingBackupBytes != null) Arrays.fill(pendingBackupBytes, (byte) 0);
        pendingBackupBytes = null;
        pendingBackupPackageId = null;
        pendingBackupActorId = null;
    }

    private static void clearPackage(QatraCrypto.EncryptedPackage pack) {
        if (pack == null) return;
        if (pack.bytes != null) Arrays.fill(pack.bytes, (byte) 0);
        if (pack.recoveredSyncKey != null) Arrays.fill(pack.recoveredSyncKey, (byte) 0);
    }

    @Override protected void onDestroy() {
        clearPendingBackup();
        clearPendingDeviceSync();
        pendingRestoreActorId = null;
        pendingSyncImportActorId = null;
        pendingSyncImportExpectedType = null;
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidBridge");
            webView.destroy();
        }
        if (database != null) database.close();
        if (users != null) users.close();
        super.onDestroy();
    }

    private void requireSession() {
        if (session == null) throw new SecurityException("انتهت الجلسة. سجل الدخول مرة أخرى");
    }

    private void requirePermission(String permission) {
        requireSession();
        if (permission != null && !permission.isEmpty() && !session.has(permission)) {
            throw new SecurityException("لا تملك الصلاحية المطلوبة: " + permission);
        }
    }

    private void requireAnyPermission(String... permissions) {
        requireSession();
        for (String permission : permissions) {
            if (permission != null && session.has(permission)) return;
        }
        throw new SecurityException("لا تملك أيًا من الصلاحيات المطلوبة");
    }

    private JSONObject enforceBillingWriteScope(String namespace, JSONObject incoming) throws Exception {
        if (!"erp.billing".equals(namespace) || session.has(QatraUnifiedUserStore.P_MANAGE_BILLING)) {
            return incoming;
        }
        java.util.Set<String> allowed = new java.util.LinkedHashSet<>();
        if (session.has(QatraUnifiedUserStore.P_CAPTURE_READINGS)) allowed.add("readings");
        if (session.has(QatraUnifiedUserStore.P_COLLECT_PAYMENTS)) {
            allowed.add("payments");
            allowed.add("collectorSettlements");
        }
        if (session.has(QatraUnifiedUserStore.P_MANAGE_CASHBOX)) {
            allowed.add("payments");
            allowed.add("collectorSettlements");
            allowed.add("cashboxSessions");
            allowed.add("cashboxTransactions");
        }
        if (allowed.isEmpty()) throw new SecurityException("لا تملك صلاحية تعديل بيانات الفوترة");

        String currentText = database.getState(namespace);
        JSONObject current = currentText == null || currentText.trim().isEmpty()
                ? new JSONObject() : new JSONObject(currentText);
        String[] protectedKeys = {"subscribers", "meters", "cycles", "operationSettings",
                "readings", "invoices", "payments", "collectorSettlements",
                "cashboxSessions", "cashboxTransactions", "correctionRequests"};
        for (String key : protectedKeys) {
            if (allowed.contains(key)) continue;
            Object before = current.opt(key);
            Object after = incoming.opt(key);
            String beforeJson = before == null ? "" : String.valueOf(before);
            String afterJson = after == null ? "" : String.valueOf(after);
            if (!beforeJson.equals(afterJson)) {
                throw new SecurityException("لا تملك صلاحية تعديل قسم " + key);
            }
            if (current.has(key)) incoming.put(key, current.get(key)); else incoming.remove(key);
        }
        return incoming;
    }

    private void requireNamespace(String namespace, boolean write) {
        String clean = namespace == null ? "" : namespace.trim();
        String permission = (write ? WRITE_PERMISSION_BY_NAMESPACE : READ_PERMISSION_BY_NAMESPACE).get(clean);
        if (permission == null) throw new SecurityException("نطاق بيانات ERP غير معتمد");
        requirePermission(permission);
    }

    public final class UnifiedBridge {
        @JavascriptInterface public String getAppInfo() {
            try {
                requireSession();
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("role", "UNIFIED");
                out.put("version", BuildConfig.VERSION_NAME);
                out.put("database", "SQLite");
                out.put("session", session.toJson());
                out.put("roleCatalog", QatraUnifiedUserStore.roleCatalogJson());
                return out.toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String getState(String namespace) {
            try {
                requireNamespace(namespace, false);
                String payload = database.getState(namespace);
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("found", payload != null);
                if (payload != null) out.put("payload", new JSONObject(payload));
                return out.toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String saveState(String namespace, String payloadJson) {
            try {
                requireNamespace(namespace, true);
                JSONObject payload = new JSONObject(payloadJson == null ? "{}" : payloadJson);
                payload = enforceBillingWriteScope(namespace == null ? "" : namespace.trim(), payload);
                payload.put("lastModifiedBy", session.userId);
                payload.put("lastModifiedAt", System.currentTimeMillis());
                database.saveState(namespace, payload.toString());
                return okJson("تم الحفظ في SQLite");
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String listUsers(boolean includeArchived) {
            try {
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("users", users.listUsers(session, includeArchived));
                out.put("roles", QatraUnifiedUserStore.roleCatalogJson());
                return out.toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String createUser(String inputJson) {
            try {
                JSONObject user = users.createUser(session, new JSONObject(inputJson));
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("user", user);
                out.put("message", "تم إنشاء المستخدم بكلمة مرور مؤقتة");
                return out.toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String updateUser(String inputJson) {
            try {
                JSONObject user = users.updateUser(session, new JSONObject(inputJson));
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("user", user);
                return out.toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String setUserActive(String userId, boolean active) {
            try {
                users.setActive(session, userId, active);
                return okJson(active ? "تم تفعيل المستخدم" : "تم إيقاف المستخدم");
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String resetUserPassword(String userId, String temporaryPassword) {
            try {
                users.resetPassword(session, userId, temporaryPassword);
                return okJson("تم تعيين كلمة مرور مؤقتة وسيُطلب تغييرها عند أول دخول");
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String deleteUser(String userId) {
            try {
                String result = users.deleteOrArchive(session, userId);
                return okJson("deleted".equals(result)
                        ? "تم حذف الحساب غير المستخدم" : "تمت أرشفة الحساب للحفاظ على السجل");
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String changeOwnPassword(String currentPassword, String newPassword) {
            try {
                session = users.changeOwnPassword(session, currentPassword, newPassword);
                return okJson("تم تغيير كلمة المرور");
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String getIdentityAudit(int limit) {
            try {
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("rows", users.audit(session, limit));
                return out.toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String previewLegacyMigration() {
            try {
                requirePermission(QatraUnifiedUserStore.P_MANAGE_SETTINGS);
                return migration.preview().toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String commitLegacyMigration() {
            try {
                requirePermission(QatraUnifiedUserStore.P_MANAGE_SETTINGS);
                return migration.commit(session.userId).toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String restoreLegacyMigrationSnapshot() {
            try {
                requirePermission(QatraUnifiedUserStore.P_MANAGE_SETTINGS);
                return migration.restoreLastSnapshot(session.userId).toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String postApprovedRecord(
                String module, String entity, String recordJson) {
            try {
                String normalized = module == null ? "" : module.trim().toUpperCase(Locale.ROOT);
                if ("BILLING".equals(normalized)) {
                    if ("payments".equals(entity)) {
                        requireAnyPermission(QatraUnifiedUserStore.P_MANAGE_BILLING,
                                QatraUnifiedUserStore.P_COLLECT_PAYMENTS,
                                QatraUnifiedUserStore.P_MANAGE_CASHBOX);
                    } else requirePermission(QatraUnifiedUserStore.P_MANAGE_BILLING);
                }
                else if ("PROCUREMENT".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_PROCUREMENT);
                else if ("INVENTORY".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_INVENTORY);
                else if ("ASSETS".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_MANAGE_ASSETS);
                else if ("HR".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_PAYROLL);
                else if ("MAINTENANCE".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_MAINTENANCE);
                else if ("ACCOUNTING".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_ACCOUNTING);
                else throw new SecurityException("الوحدة غير معتمدة للترحيل المحاسبي");
                return postingService.post(normalized, entity,
                        new JSONObject(recordJson == null ? "{}" : recordJson), session).toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String approveErpRecord(
                String module, String entity, String recordJson, String moduleStateJson) {
            try {
                String normalized = module == null ? "" : module.trim().toUpperCase(Locale.ROOT);
                if ("BILLING".equals(normalized)) {
                    if ("payments".equals(entity)) {
                        requireAnyPermission(QatraUnifiedUserStore.P_MANAGE_BILLING,
                                QatraUnifiedUserStore.P_COLLECT_PAYMENTS,
                                QatraUnifiedUserStore.P_MANAGE_CASHBOX);
                    } else requirePermission(QatraUnifiedUserStore.P_MANAGE_BILLING);
                }
                else if ("PROCUREMENT".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_PROCUREMENT);
                else if ("INVENTORY".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_INVENTORY);
                else if ("ASSETS".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_MANAGE_ASSETS);
                else if ("HR".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_PAYROLL);
                else if ("MAINTENANCE".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_MAINTENANCE);
                else if ("ACCOUNTING".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_ACCOUNTING);
                else throw new SecurityException("الوحدة غير معتمدة للاعتماد المترابط");
                return postingService.approveAndPost(normalized, entity,
                        new JSONObject(recordJson == null ? "{}" : recordJson),
                        new JSONObject(moduleStateJson == null ? "{}" : moduleStateJson),
                        session).toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String validateAccountingBalance() {
            try {
                requirePermission(QatraUnifiedUserStore.P_VIEW_REPORTS);
                return postingService.validateBalance().toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String decideBillingCorrection(
                String requestId, String decision, String reviewNotes) {
            try {
                requirePermission(QatraUnifiedUserStore.P_APPROVE_ACCOUNTING);
                return postingService.decideBillingCorrection(requestId, decision,
                        reviewNotes, session).toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String getDeviceSyncStatus() {
            try {
                requireAnyPermission(QatraUnifiedUserStore.P_EXPORT_DATA,
                        QatraUnifiedUserStore.P_CAPTURE_READINGS,
                        QatraUnifiedUserStore.P_COLLECT_PAYMENTS,
                        QatraUnifiedUserStore.P_MANAGE_CASHBOX,
                        QatraUnifiedUserStore.P_MANAGE_SETTINGS,
                        QatraUnifiedUserStore.P_VIEW_AUDIT);
                JSONObject out = database.deviceSyncStatus();
                out.put("deviceId", localDeviceId());
                out.put("keyProvisioned", crypto.isProvisioned());
                return out.toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String startDeviceSyncExport() {
            try {
                requireAnyPermission(QatraUnifiedUserStore.P_EXPORT_DATA,
                        QatraUnifiedUserStore.P_CAPTURE_READINGS,
                        QatraUnifiedUserStore.P_COLLECT_PAYMENTS,
                        QatraUnifiedUserStore.P_MANAGE_CASHBOX,
                        QatraUnifiedUserStore.P_MANAGE_SETTINGS);
                if (!crypto.isProvisioned()) {
                    throw new SecurityException(
                            "أنشئ نسخة ERP احتياطية مشفرة أولًا لتأسيس مفتاح المؤسسة، ثم استعدها على الجهاز الآخر");
                }
                final String actorUserId = session.userId;
                final java.util.Set<String> actorRoles =
                        new java.util.LinkedHashSet<>(session.roles);
                new Thread(() -> {
                    try {
                        JSONObject payload = database.prepareDeviceSyncPayload(
                                localDeviceId(), actorUserId, actorRoles, 500);
                        JSONArray changes = payload.optJSONArray("changes");
                        if (changes == null || changes.length() == 0) {
                            throw new IllegalStateException(
                                    "لا توجد حركات معلقة مسموحة لأدوار المستخدم الحالي");
                        }
                        QatraCrypto.EncryptedPackage pack = crypto.encryptSync(
                                "UNIFIED", "UNIFIED", "DEVICE_CHANGESET", payload.toString());
                        runOnUiThread(() -> launchDeviceSyncSave(pack, actorUserId));
                    } catch (Exception error) {
                        runOnUiThread(() -> toast(
                                "تعذر تجهيز حزمة المزامنة: " + safeMessage(error)));
                    }
                }, "qatra-erp-sync-prepare").start();
                return okJson("جارٍ تجهيز حزمة المزامنة المشفرة");
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String startDeviceSyncImport() {
            try {
                requirePermission(QatraUnifiedUserStore.P_MANAGE_SETTINGS);
                final String actorUserId = session.userId;
                runOnUiThread(() -> launchDeviceSyncImport(
                        actorUserId, "DEVICE_CHANGESET"));
                return okJson("اختر حزمة المزامنة المشفرة");
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String startDeviceSyncReceiptExport(
                String originalPackageId) {
            try {
                requirePermission(QatraUnifiedUserStore.P_MANAGE_SETTINGS);
                if (!crypto.isProvisioned()) {
                    throw new SecurityException("مفتاح المؤسسة غير مؤسس على هذا الجهاز");
                }
                final String actorUserId = session.userId;
                new Thread(() -> {
                    try {
                        JSONObject payload = database.prepareDeviceReceiptPayload(
                                originalPackageId, localDeviceId(), actorUserId);
                        QatraCrypto.EncryptedPackage pack = crypto.encryptSync(
                                "UNIFIED", "UNIFIED", "DEVICE_RECEIPT", payload.toString());
                        runOnUiThread(() -> launchDeviceSyncSave(pack, actorUserId));
                    } catch (Exception error) {
                        runOnUiThread(() -> toast(
                                "تعذر تجهيز إيصال المزامنة: " + safeMessage(error)));
                    }
                }, "qatra-erp-receipt-prepare").start();
                return okJson("جارٍ تجهيز إيصال الإدارة المشفر");
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String startDeviceSyncReceiptImport() {
            try {
                requireAnyPermission(QatraUnifiedUserStore.P_EXPORT_DATA,
                        QatraUnifiedUserStore.P_CAPTURE_READINGS,
                        QatraUnifiedUserStore.P_COLLECT_PAYMENTS,
                        QatraUnifiedUserStore.P_MANAGE_CASHBOX,
                        QatraUnifiedUserStore.P_MANAGE_SETTINGS);
                final String actorUserId = session.userId;
                runOnUiThread(() -> launchDeviceSyncImport(
                        actorUserId, "DEVICE_RECEIPT"));
                return okJson("اختر إيصال الإدارة المشفر");
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String reviewDeviceSyncPackage(
                String packageId, String decision, String notes) {
            try {
                requirePermission(QatraUnifiedUserStore.P_MANAGE_SETTINGS);
                return database.reviewDeviceSyncPackage(
                        packageId, decision, notes, session.userId).toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String resolveDeviceSyncConflict(
                String changeId, String decision, String notes) {
            try {
                requirePermission(QatraUnifiedUserStore.P_MANAGE_SETTINGS);
                return database.resolveDeviceSyncConflict(
                        changeId, decision, notes, session.userId).toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String getRecoveryStatus() {
            try {
                requireAnyPermission(QatraUnifiedUserStore.P_MANAGE_SETTINGS,
                        QatraUnifiedUserStore.P_VIEW_AUDIT);
                JSONObject out = database.recoveryStatus("UNIFIED");
                out.put("ok", true);
                return out.toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String startEncryptedBackup() {
            try {
                requirePermission(QatraUnifiedUserStore.P_MANAGE_SETTINGS);
                final String actorUserId = session.userId;
                new Thread(() -> {
                    byte[] syncKey = null;
                    try {
                        JSONObject payload = database.exportPortableBackup("UNIFIED", null);
                        syncKey = crypto.syncKeyForPortableBackup();
                        QatraCrypto.EncryptedPackage pack = crypto.encryptPortableBackup(
                                "UNIFIED", "FULL_BACKUP", payload.toString(), syncKey);
                        runOnUiThread(() -> launchBackupSave(
                                pack.bytes, pack.packageId, actorUserId));
                    } catch (Exception error) {
                        runOnUiThread(() -> toast(
                                "تعذر تجهيز النسخة: " + safeMessage(error)));
                    } finally {
                        if (syncKey != null) Arrays.fill(syncKey, (byte) 0);
                    }
                }, "qatra-erp-backup-prepare").start();
                return okJson("جارٍ تجهيز النسخة المشفرة");
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String startEncryptedRestore() {
            try {
                requirePermission(QatraUnifiedUserStore.P_MANAGE_SETTINGS);
                final String actorUserId = session.userId;
                runOnUiThread(() -> launchRestorePicker(actorUserId));
                return okJson("اختر ملف النسخة المراد استعادتها");
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String rollbackLastRestore() {
            try {
                requirePermission(QatraUnifiedUserStore.P_MANAGE_SETTINGS);
                JSONObject out = database.rollbackLastPortableRestore(
                        "UNIFIED", session.userId);
                runOnUiThread(() -> {
                    if (webView != null) webView.reload();
                    toast(out.optString("message", "تم التراجع عن الاستعادة"));
                });
                return out.toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String logout() {
            runOnUiThread(UnifiedMainActivity.this::logout);
            return okJson("تم تسجيل الخروج");
        }
    }

    private LinearLayout form(String title, String message, EditText... fields) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(22), dp(18), dp(22), dp(18));
        TextView heading = new TextView(this);
        heading.setText(title);
        heading.setTextSize(22f);
        heading.setTextColor(Color.rgb(16, 42, 67));
        heading.setPadding(0, 0, 0, dp(8));
        root.addView(heading);
        TextView info = new TextView(this);
        info.setText(message);
        info.setTextSize(14f);
        info.setTextColor(Color.DKGRAY);
        info.setPadding(0, 0, 0, dp(10));
        root.addView(info);
        for (EditText field : fields) root.addView(field, fieldParams());
        return root;
    }

    private EditText textInput(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setSingleLine(true);
        input.setTextDirection(View.TEXT_DIRECTION_LOCALE);
        input.setInputType(InputType.TYPE_CLASS_TEXT);
        return input;
    }

    private EditText passwordInput(String hint) {
        EditText input = textInput(hint);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        return input;
    }

    private Button primaryButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextColor(Color.WHITE);
        button.setBackgroundColor(Color.rgb(30, 115, 190));
        return button;
    }

    private Button secondaryButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        return button;
    }

    private LinearLayout.LayoutParams fieldParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(54));
        params.setMargins(0, dp(5), 0, dp(5));
        return params;
    }

    private LinearLayout.LayoutParams buttonParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(52));
        params.setMargins(0, dp(8), 0, 0);
        return params;
    }

    private void showDialog(LinearLayout view, boolean cancelable) {
        activeDialog = new AlertDialog.Builder(this).setView(view).setCancelable(cancelable).create();
        activeDialog.setOnDismissListener(d -> activeDialog = null);
        activeDialog.show();
    }

    private void dismissDialog() {
        if (activeDialog != null) {
            AlertDialog dialog = activeDialog;
            activeDialog = null;
            dialog.dismiss();
        }
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + .5f);
    }

    private void toast(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show());
    }

    private static String okJson(String message) {
        try {
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("message", message == null ? "" : message);
            return out.toString();
        } catch (Exception ignored) { return "{\"ok\":true}"; }
    }

    private static String errorJson(Exception error) {
        try {
            JSONObject out = new JSONObject();
            out.put("ok", false);
            out.put("error", safeMessage(error));
            return out.toString();
        } catch (Exception ignored) { return "{\"ok\":false,\"error\":\"error\"}"; }
    }

    private static String safeMessage(Throwable error) {
        String message = error == null ? "" : error.getMessage();
        return message == null || message.trim().isEmpty() ? "حدث خطأ غير متوقع" : message;
    }
}
