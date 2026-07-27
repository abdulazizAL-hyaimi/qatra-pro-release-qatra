package com.qatra.pro;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Intent;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.*;
import android.widget.*;

import androidx.fragment.app.FragmentActivity;
import androidx.core.content.FileProvider;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;

import org.json.JSONObject;
import org.json.JSONArray;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

public class MainActivity extends FragmentActivity {
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraPhotoUri;
    private WebView printWebView;
    private static final int FILE_CHOOSER_REQ = 7001;
    private static final int BT_REQ = 7002;
    private static final int SAVE_FILE_REQ = 7003;
    private static final int DRIVE_BACKUP_REQ = 7004;
    private static final int LICENSE_FILE_REQ = 7005;
    private static final int EMERGENCY_RESTORE_FILE_REQ = 7006;
    private static final String EXPORT_ROOT = "QatraPro";
    private final String assetRoot = "file:///android_asset/qatra/";
    private static final String START_PAGE = BuildConfig.START_PAGE;
    private static final String APP_ROLE = BuildConfig.APP_ROLE;
    private String currentPage = START_PAGE;
    private String pendingSaveContent = null;
    private String pendingSaveMime = null;
    private String pendingSaveFilename = null;
    private String pendingSaveToken = null;
    private byte[] pendingSaveBytes = null;
    private long lastBackPressedAt = 0L;
    private QatraDatabase database;
    private QatraCrypto crypto;
    private QatraDriveSyncStore driveSyncStore;
    private QatraAccessControl accessControl;
    private QatraLicenseManager licenseManager;
    private AlertDialog licenseDialog;
    private boolean accessUnlocked = false;
    private boolean licenseBlocked = false;
    private boolean returnToLicenseGateAfterSave = false;
    private String sessionUsername = "";
    private boolean initialPageLoaded = false;
    private long backgroundAt = 0L;
    private static final long ACCESS_IDLE_TIMEOUT_MS = 120_000L;
    private final Map<String, QatraCrypto.EncryptedPackage> pendingImports = new HashMap<>();
    private final Map<String, QatraCrypto.EncryptedPackage> pendingPortableBackups =
            Collections.synchronizedMap(new HashMap<>());
    private final Map<String, QatraCrypto.EncryptedPackage> pendingDriveSavePackages =
            Collections.synchronizedMap(new HashMap<>());
    private volatile byte[] incomingFileBytes = null;
    private volatile String incomingFileName = "";
    private volatile String incomingFileMime = "";
    private volatile String incomingDrivePackageId = "";
    private static final int MAX_INCOMING_FILE_BYTES = 32 * 1024 * 1024;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if ("UNIFIED".equals(APP_ROLE)) {
            Intent unified = new Intent(this, UnifiedMainActivity.class);
            Intent source = getIntent();
            if (source != null) {
                unified.setAction(source.getAction());
                unified.setData(source.getData());
                unified.setType(source.getType());
                unified.setClipData(source.getClipData());
                if (source.getExtras() != null) unified.putExtras(source.getExtras());
                unified.addFlags(source.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
            }
            startActivity(unified);
            finish();
            return;
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        database = new QatraDatabase(getApplicationContext());
        crypto = new QatraCrypto(getApplicationContext());
        driveSyncStore = new QatraDriveSyncStore(getApplicationContext());
        licenseManager = new QatraLicenseManager(getApplicationContext(), APP_ROLE);
        accessControl = new QatraAccessControl(this, APP_ROLE,
                () -> openDriveBackupCenter(""));
        ensureExportWorkspace();
        buildUi();
        captureIncomingFileIntent(getIntent());
        webView.setVisibility(View.INVISIBLE);
        showAccessGate();
    }

    private void showAccessGate() {
        if (accessUnlocked || accessControl == null) return;
        if (webView != null) webView.setVisibility(View.INVISIBLE);
        accessControl.showGate(username -> {
            accessUnlocked = true;
            sessionUsername = username == null ? "" : username;
            backgroundAt = 0L;
            completeUnlockedAccess();
        });
    }

    private void completeUnlockedAccess() {
        QatraLicenseManager.Snapshot license = licenseManager.ensureInitialized();
        if (!license.operationalAllowed()) {
            blockForLicense(license);
            return;
        }
        licenseBlocked = false;
        if (licenseDialog != null) {
            licenseDialog.dismiss();
            licenseDialog = null;
        }
        webView.onResume();
        webView.resumeTimers();
        webView.setVisibility(View.VISIBLE);
        // Cashier policy permits A5 document printing only. It must not request Bluetooth
        // access because thermal printing is intentionally unavailable in that flavor.
        if(!"CASHIER".equals(APP_ROLE)) requestBluetoothIfNeeded();
        if (!initialPageLoaded) {
            initialPageLoaded = true;
            loadRole(START_PAGE);
        } else {
            notifyIncomingFileAvailable();
        }
        loadNextDriveIncoming();
    }

    private void blockForLicense(QatraLicenseManager.Snapshot license) {
        licenseBlocked = true;
        if (webView != null) {
            webView.setVisibility(View.INVISIBLE);
            webView.onPause();
            webView.pauseTimers();
        }
        showLicenseCenter(true);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureIncomingFileIntent(intent);
        if (!accessUnlocked) showAccessGate();
    }

    private void lockApplication() {
        accessUnlocked = false;
        sessionUsername = "";
        if (accessControl != null) accessControl.clearSession();
        if (licenseDialog != null) {
            licenseDialog.dismiss();
            licenseDialog = null;
        }
        backgroundAt = 0L;
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
        showAccessGate();
    }

    @Override protected void onStop() {
        if (accessUnlocked) backgroundAt = System.currentTimeMillis();
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
        super.onStop();
    }

    @Override protected void onResume() {
        super.onResume();
        if (accessUnlocked && backgroundAt > 0L
                && System.currentTimeMillis() - backgroundAt >= ACCESS_IDLE_TIMEOUT_MS) {
            accessUnlocked = false;
            sessionUsername = "";
            if (accessControl != null) accessControl.clearSession();
            if (licenseDialog != null) {
                licenseDialog.dismiss();
                licenseDialog = null;
            }
        }
        if (!accessUnlocked && accessControl != null) showAccessGate();
        else {
            backgroundAt = 0L;
            QatraLicenseManager.Snapshot license = licenseManager == null ? null : licenseManager.current();
            if (license != null && !license.operationalAllowed()) {
                blockForLicense(license);
            } else if (webView != null) {
                licenseBlocked = false;
                webView.onResume();
                webView.resumeTimers();
                loadNextDriveIncoming();
            }
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(false);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        if (Build.VERSION.SDK_INT >= 16) {
            s.setAllowFileAccessFromFileURLs(true);
            s.setAllowUniversalAccessFromFileURLs(false);
        }
        if (Build.VERSION.SDK_INT >= 21) s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(true);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        webView.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request){
                return handleExternalUrl(request != null && request.getUrl() != null ? request.getUrl().toString() : null);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url){
                return handleExternalUrl(url);
            }
            @Override public void onPageFinished(WebView view, String url){
                super.onPageFinished(view, url);
                if(url != null && url.startsWith(assetRoot)){
                    String page = url.substring(assetRoot.length());
                    int q = page.indexOf('?'); if(q >= 0) page = page.substring(0, q);
                    int h = page.indexOf('#'); if(h >= 0) page = page.substring(0, h);
                    if(!page.trim().isEmpty()) currentPage = page;
                }
                notifyIncomingFileAvailable();
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (url != null && !url.startsWith(assetRoot)) {
                    view.stopLoading();
                    toast("تم منع فتح محتوى خارجي داخل التطبيق");
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params){
                if(filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                String[] accepts = params == null ? null : params.getAcceptTypes();
                boolean wantsImage = false;
                if(accepts != null) for(String accept : accepts) {
                    if(accept != null && accept.toLowerCase(Locale.US).startsWith("image/")) wantsImage = true;
                }
                if(wantsImage) {
                    Intent picker = new Intent(Intent.ACTION_GET_CONTENT);
                    picker.addCategory(Intent.CATEGORY_OPENABLE);
                    picker.setType("image/*");
                    Intent camera = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE);
                    try {
                        File photo = new File(getCacheDir(), "qatra-camera-" + System.currentTimeMillis() + ".jpg");
                        cameraPhotoUri = FileProvider.getUriForFile(
                                MainActivity.this, getPackageName() + ".files", photo);
                        camera.putExtra(android.provider.MediaStore.EXTRA_OUTPUT, cameraPhotoUri);
                        camera.setClipData(ClipData.newRawUri("qatra-photo", cameraPhotoUri));
                        camera.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                        Intent chooser = Intent.createChooser(picker, "التقاط صورة أو اختيارها");
                        chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
                        startActivityForResult(chooser, FILE_CHOOSER_REQ);
                    } catch(Exception error) {
                        cameraPhotoUri = null;
                        startActivityForResult(Intent.createChooser(picker, "اختر صورة"), FILE_CHOOSER_REQ);
                    }
                    return true;
                }
                cameraPhotoUri = null;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/octet-stream", "application/vnd.qatra.admin+qsync", "application/vnd.qatra.reader+qsync", "application/vnd.qatra.collector+qsync", "application/vnd.qatra.cashier+qsync", "application/json", "text/csv", "text/plain", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/xml"});
                startActivityForResult(Intent.createChooser(intent, "اختر ملف مياه الروضة"), FILE_CHOOSER_REQ);
                return true;
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
    }

    private void loadRole(String page) {
        currentPage = page;
        webView.stopLoading();
        webView.clearHistory();
        webView.loadUrl(assetRoot + page);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQ && filePathCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK) {
                if(data != null && data.getData() != null) result = new Uri[]{data.getData()};
                else if(cameraPhotoUri != null) result = new Uri[]{cameraPhotoUri};
            }
            filePathCallback.onReceiveValue(result);
            filePathCallback = null;
            cameraPhotoUri = null;
            return;
        }
        if(requestCode == SAVE_FILE_REQ){
            boolean saved = false;
            String saveError = "تم إلغاء حفظ الملف";
            String completedSaveToken = pendingSaveToken;
            String completedFilename = pendingSaveFilename;
            if(resultCode == RESULT_OK && data != null && data.getData() != null && (pendingSaveContent != null || pendingSaveBytes != null)){
                try(OutputStream out = getContentResolver().openOutputStream(data.getData())){
                    if(out == null) throw new IOException("تعذر فتح الملف");
                    if(pendingSaveBytes != null) out.write(pendingSaveBytes);
                    else out.write((pendingSaveContent == null ? "" : pendingSaveContent).getBytes(StandardCharsets.UTF_8));
                    out.flush();
                    saved = true;
                    saveError = "";
                    toast("تم حفظ الملف: " + (pendingSaveFilename == null ? "" : pendingSaveFilename));
                }catch(Exception e){ saveError = "فشل حفظ الملف: " + e.getMessage(); toast(saveError); }
            }
            if(saved) enqueueSavedPackageForDrive(completedSaveToken, completedFilename);
            else pendingDriveSavePackages.remove(completedSaveToken);
            notifyFileSaveResult(completedSaveToken, saved, saveError,
                    completedFilename, saved ? "المجلد الذي اخترته" : "");
            pendingSaveContent = null;
            pendingSaveBytes = null;
            pendingSaveMime = null;
            pendingSaveFilename = null;
            pendingSaveToken = null;
            if(returnToLicenseGateAfterSave) {
                returnToLicenseGateAfterSave = false;
                getWindow().getDecorView().post(() -> blockForLicense(licenseManager.current()));
            }
            return;
        }
        if(requestCode == LICENSE_FILE_REQ) {
            if(resultCode == RESULT_OK && data != null && data.getData() != null) {
                activateLicenseFromUri(data.getData());
            } else if(licenseBlocked) {
                showLicenseCenter(true);
            }
            return;
        }
        if(requestCode == EMERGENCY_RESTORE_FILE_REQ) {
            if(resultCode == RESULT_OK && data != null && data.getData() != null) {
                prepareEmergencyPortableRestore(data.getData());
            } else if(licenseBlocked) {
                showLicenseCenter(true);
            }
            return;
        }
        if(requestCode == DRIVE_BACKUP_REQ) {
            if(resultCode == RESULT_OK && data != null
                    && data.getBooleanExtra(QatraDriveBackupActivity.EXTRA_RESTORED, false)) {
                pendingImports.clear();
                pendingPortableBackups.clear();
                String restoredUsername = data.getStringExtra(
                        QatraDriveBackupActivity.EXTRA_RESTORED_USERNAME);
                if(accessControl != null) accessControl.requireEnrollmentUsername(restoredUsername);
                if(webView != null) webView.reload();
                toast("تم تحميل بيانات النسخة المستعادة من Google Drive");
            }
            if(licenseBlocked) getWindow().getDecorView().post(() -> {
                if(accessUnlocked) showLicenseCenter(true);
                else showAccessGate();
            });
        }
    }

    @Override public void onBackPressed(){
        if(!accessUnlocked){ finishAffinity(); return; }
        if(webView == null){ super.onBackPressed(); return; }

        // Give every WebView screen the first chance to close a modal/report or
        // move to its own previous tab. The old flow skipped this on START_PAGE,
        // which made Back try to exit while an admin sub-screen was still open.
        webView.evaluateJavascript(
                "(function(){try{return (window.App && typeof App.handleAndroidBack==='function' && App.handleAndroidBack()) ? 'true' : 'false';}catch(e){return 'false';}})()",
                value -> {
                    boolean handled = "\"true\"".equals(value) || "true".equals(value);
                    if(handled) return;
                    if(!START_PAGE.equals(currentPage)){
                        if(webView.canGoBack()) webView.goBack();
                        else loadRole(START_PAGE);
                        return;
                    }
                    confirmExit();
                }
        );
    }

    @Override protected void onDestroy() {
        if(webView != null) {
            webView.removeJavascriptInterface("AndroidBridge");
            webView.destroy();
        }
        if(database != null) database.close();
        super.onDestroy();
    }

    private void confirmExit(){
        long now = System.currentTimeMillis();
        if(now - lastBackPressedAt < 2200L){
            finish();
        }else{
            lastBackPressedAt = now;
            toast("اضغط رجوع مرة أخرى للخروج من التطبيق");
        }
    }

    private int dp(int v){ return (int)(v * getResources().getDisplayMetrics().density + .5f); }

    private void toast(String msg){ runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show()); }

    private boolean handleExternalUrl(String url){
        if(url == null) return false;
        if(url.startsWith(assetRoot)){
            String page = url.substring(assetRoot.length()).split("[?#]", 2)[0];
            if(isAllowedLocalPage(page)) return false;
            toast("هذه الصفحة غير متاحة لصلاحية " + APP_ROLE);
            return true;
        }
        String lower = url.toLowerCase(Locale.ROOT);
        if(lower.startsWith("sms:") || lower.startsWith("smsto:") || lower.startsWith("tel:") || lower.startsWith("mailto:")){
            try{ startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
            catch(Exception e){ toast("لا يوجد تطبيق مناسب لفتح الرابط"); }
            return true;
        }
        if(lower.startsWith("whatsapp:") || lower.startsWith("https://wa.me/") || lower.startsWith("https://api.whatsapp.com/")){
            try{ startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
            catch(Exception e){ toast("تعذر فتح واتساب"); }
            return true;
        }
        if(lower.startsWith("https://") || lower.startsWith("http://")){
            try{ startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
            catch(Exception e){ toast("تعذر فتح الرابط الخارجي"); }
            return true;
        }
        return !lower.startsWith("about:blank");
    }

    private boolean isAllowedLocalPage(String page){
        if(page == null || page.trim().isEmpty()) return false;
        if("ADMIN".equals(APP_ROLE)){
            return "mobile.html".equals(page) || "manager_users.html".equals(page) || "manager_collectors.html".equals(page)
                    || "manager_cashbox.html".equals(page) || "manager_reader.html".equals(page);
        }
        if("READER".equals(APP_ROLE)) return "reader.html".equals(page);
        if("COLLECTOR".equals(APP_ROLE)) return "collector.html".equals(page);
        return "CASHIER".equals(APP_ROLE) && "cashier.html".equals(page);
    }

    private void openSmsApp(String phone, String text){
        try{
            Intent intent = new Intent(Intent.ACTION_SENDTO);
            intent.setData(Uri.parse("smsto:" + (phone == null ? "" : phone)));
            intent.putExtra("sms_body", text == null ? "" : text);
            startActivity(intent);
        }catch(Exception e){ toast("تعذر فتح تطبيق الرسائل النصية"); }
    }

    private void openWhatsAppApp(String phone, String text){
        String p = phone == null ? "" : phone.replaceAll("[^0-9]", "");
        String url = "https://wa.me/" + p + "?text=" + Uri.encode(text == null ? "" : text);
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        try{
            intent.setPackage("com.whatsapp");
            startActivity(intent);
        }catch(Exception first){
            try{
                intent.setPackage("com.whatsapp.w4b");
                startActivity(intent);
            }catch(Exception second){
                try{
                    intent.setPackage(null);
                    startActivity(intent);
                }catch(Exception third){ toast("تعذر فتح واتساب. تأكد من تثبيته"); }
            }
        }
    }

    private void captureIncomingFileIntent(Intent intent) {
        if(intent == null) return;
        Uri uri = null;
        String action = intent.getAction();
        if(Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if(Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            try { uri = intent.getParcelableExtra(Intent.EXTRA_STREAM); }
            catch(Exception ignored) { }
            if(uri == null && intent.getClipData() != null
                    && intent.getClipData().getItemCount() > 0) {
                uri = intent.getClipData().getItemAt(0).getUri();
            }
        }
        if(uri == null && intent.getClipData() != null
                && intent.getClipData().getItemCount() > 0) {
            uri = intent.getClipData().getItemAt(0).getUri();
        }
        if(uri == null) return;
        final Uri source = uri;
        final Intent sourceIntent = intent;
        final String declaredMime = intent.getType();
        try {
            boolean canPersistRead = (intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0;
            if("content".equalsIgnoreCase(source.getScheme()) && canPersistRead) {
                getContentResolver().takePersistableUriPermission(
                        source, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
        } catch(Exception ignored) { }
        new Thread(() -> {
            try {
                byte[] bytes = readIncomingBytes(source);
                if(bytes.length == 0) throw new IOException("الملف فارغ");
                String resolvedName = resolveIncomingFilename(source, sourceIntent, declaredMime);
                boolean licenseFile = resolvedName.toLowerCase(Locale.ROOT).endsWith(".qlicense")
                        || "application/vnd.qatra.license+json".equalsIgnoreCase(declaredMime);
                if(licenseFile) {
                    QatraLicenseManager.Snapshot licensed = licenseManager.activate(
                            new String(bytes, StandardCharsets.UTF_8));
                    incomingFileBytes = null;
                    incomingFileName = "";
                    incomingFileMime = "";
                    runOnUiThread(() -> {
                        toast("تم اعتماد التفعيل الدائم للعميل " + licensed.customerName);
                        if(accessUnlocked) completeUnlockedAccess();
                        else showAccessGate();
                    });
                    return;
                }
                String targetRole = QatraCrypto.peekTargetRole(bytes);
                if(targetRole.isEmpty()) targetRole = roleFromIncomingFilename(resolvedName);
                if(!QatraCrypto.isRecognizedPackage(bytes)) {
                    throw new SecurityException("الملف ليس من ملفات قطرة برو المعتمدة");
                }
                if(!targetRole.isEmpty() && !APP_ROLE.equals(targetRole)) {
                    final String routedRole = targetRole;
                    runOnUiThread(() -> forwardIncomingFileToRole(
                            bytes, resolvedName, routedRole));
                    return;
                }
                incomingFileBytes = bytes;
                incomingDrivePackageId = "";
                incomingFileName = resolvedName;
                String resolved = declaredMime;
                if(resolved == null || resolved.trim().isEmpty()) {
                    resolved = getContentResolver().getType(source);
                }
                incomingFileMime = (resolved == null || resolved.trim().isEmpty())
                        ? "application/octet-stream" : resolved;
                runOnUiThread(() -> {
                    toast("تم فتح " + incomingFileName + " في " + roleArabicName(APP_ROLE));
                    notifyIncomingFileAvailable();
                });
            } catch(Exception error) {
                incomingFileBytes = null;
                incomingFileName = "";
                incomingFileMime = "";
                runOnUiThread(() -> toast("تعذر فتح ملف قطرة برو: " + error.getMessage()));
            }
        }, "qatra-incoming-file").start();
    }

    private void forwardIncomingFileToRole(byte[] bytes, String filename, String targetRole) {
        incomingFileBytes = null;
        incomingFileName = "";
        incomingFileMime = "";
        incomingDrivePackageId = "";
        String packageName = packageForRole(targetRole);
        if(packageName.isEmpty()) {
            toast("تعذر تحديد تطبيق قطرة برو المناسب لهذا الملف");
            return;
        }
        try {
            getPackageManager().getPackageInfo(packageName, 0);
        } catch(PackageManager.NameNotFoundException missingRoleApp) {
            toast("الملف مخصص لـ " + roleArabicName(targetRole)
                    + "، وهذه النسخة غير مثبتة على الجهاز");
            return;
        }
        try {
            File routeDirectory = new File(getCacheDir(), "qatra-file-router");
            if (!routeDirectory.isDirectory() && !routeDirectory.mkdirs()) {
                throw new IOException("تعذر تجهيز الملف المؤقت للتوجيه");
            }
            cleanupRoutedFiles(routeDirectory);
            String safeName = sanitize(filename == null ? "qatra-incoming.qsync" : filename);
            File routedFile = new File(routeDirectory,
                    UUID.randomUUID().toString() + "-" + safeName);
            try (FileOutputStream output = new FileOutputStream(routedFile)) {
                output.write(bytes == null ? new byte[0] : bytes);
                output.flush();
            }
            Uri routedUri = FileProvider.getUriForFile(
                    this, getPackageName() + ".files", routedFile);
            Intent forward = new Intent(Intent.ACTION_VIEW);
            forward.setDataAndType(routedUri, syncMimeForRole(targetRole));
            forward.setPackage(packageName);
            forward.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_ACTIVITY_NEW_TASK);
            forward.setClipData(ClipData.newUri(
                    getContentResolver(), safeName, routedUri));
            startActivity(forward);
            toast("تم توجيه الملف بأمان إلى " + roleArabicName(targetRole));
        } catch(Exception error) {
            toast("تعذر فتح الملف في " + roleArabicName(targetRole) + ": " + error.getMessage());
        }
    }

    private void cleanupRoutedFiles(File directory) {
        File[] files = directory == null ? null : directory.listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - 24L * 60L * 60L * 1000L;
        for (File file : files) {
            if (file != null && file.isFile() && file.lastModified() < cutoff) file.delete();
        }
    }

    private String roleFromIncomingFilename(String filename) {
        String value = filename == null ? "" : filename.toLowerCase(Locale.ROOT);
        if(value.endsWith(".qadmin")) return "ADMIN";
        if(value.endsWith(".qreader")) return "READER";
        if(value.endsWith(".qcollector")) return "COLLECTOR";
        if(value.endsWith(".qcashier")) return "CASHIER";
        return "";
    }

    private String packageForRole(String role) {
        String base = "";
        if("ADMIN".equals(role)) base = "com.meyah.rawdah.system";
        else if("READER".equals(role)) base = "com.meyah.rawdah.reader";
        else if("COLLECTOR".equals(role)) base = "com.meyah.rawdah.collector";
        else if("CASHIER".equals(role)) base = "com.meyah.rawdah.cashier";
        if(base.isEmpty()) return "";
        return base + (getPackageName().endsWith(".debug") ? ".debug" : "");
    }

    private byte[] readIncomingBytes(Uri uri) throws IOException {
        try(InputStream input = getContentResolver().openInputStream(uri);
            ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if(input == null) throw new IOException("تعذر قراءة الملف");
            byte[] buffer = new byte[8192];
            int total = 0;
            int count;
            while((count = input.read(buffer)) != -1) {
                total += count;
                if(total > MAX_INCOMING_FILE_BYTES) throw new IOException("حجم الملف أكبر من 24 ميجابايت");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private String resolveIncomingFilename(Uri uri, Intent intent, String declaredMime) {
        String name = "";
        if(uri != null && "content".equalsIgnoreCase(uri.getScheme())) {
            try(android.database.Cursor cursor = getContentResolver().query(
                    uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if(cursor != null && cursor.moveToFirst()) {
                    int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if(index >= 0 && cursor.getString(index) != null) name = cursor.getString(index);
                }
            } catch(Exception ignored) { }
        }
        if(name.trim().isEmpty() && intent != null) {
            String title = intent.getStringExtra(Intent.EXTRA_TITLE);
            if(title != null) name = title;
            if(name.trim().isEmpty() && intent.getClipData() != null
                    && intent.getClipData().getDescription() != null
                    && intent.getClipData().getDescription().getLabel() != null) {
                name = intent.getClipData().getDescription().getLabel().toString();
            }
        }
        if(name.trim().isEmpty() && uri != null && uri.getLastPathSegment() != null) {
            name = Uri.decode(uri.getLastPathSegment());
        }
        if(name.trim().isEmpty() || !name.contains(".")) {
            if("application/vnd.qatra.license+json".equalsIgnoreCase(declaredMime)) {
                name = "qatra-license.qlicense";
            } else if("application/vnd.qatra.pairing+binary".equalsIgnoreCase(declaredMime)) {
                name = "qatra-pairing.qpair";
            } else {
                name = "qatra-incoming.qsync";
            }
        }
        return sanitize(name);
    }

    private void notifyIncomingFileAvailable() {
        if(!accessUnlocked || incomingFileBytes == null || webView == null) return;
        webView.evaluateJavascript(
                "window.QatraNative&&window.QatraNative.onIncomingFileAvailable&&window.QatraNative.onIncomingFileAvailable();",
                null);
    }

    private void loadNextDriveIncoming() {
        if(driveSyncStore == null || incomingFileBytes != null || !accessUnlocked) return;
        new Thread(() -> {
            try {
                QatraDriveSyncStore.Item item = driveSyncStore.nextIncoming();
                if(item == null || item.bytes.length == 0 || incomingFileBytes != null) return;
                incomingFileBytes = item.bytes;
                incomingFileName = item.filename;
                incomingFileMime = syncMimeForRole(APP_ROLE);
                incomingDrivePackageId = item.packageId;
                runOnUiThread(() -> {
                    toast("وصل تحديث مشفر من المجلد المشترك");
                    notifyIncomingFileAvailable();
                });
            } catch(Exception error) {
                runOnUiThread(() -> toast("تعذر فتح تحديث Drive: " + error.getMessage()));
            }
        }, "qatra-drive-inbox").start();
    }

    private String syncMimeForRole(String role) {
        if("ADMIN".equals(role)) return "application/vnd.qatra.admin+qsync";
        if("READER".equals(role)) return "application/vnd.qatra.reader+qsync";
        if("COLLECTOR".equals(role)) return "application/vnd.qatra.collector+qsync";
        if("CASHIER".equals(role)) return "application/vnd.qatra.cashier+qsync";
        return "application/octet-stream";
    }

    private String syncExtensionForRole(String role) {
        if("ADMIN".equals(role)) return ".qadmin";
        if("READER".equals(role)) return ".qreader";
        if("COLLECTOR".equals(role)) return ".qcollector";
        if("CASHIER".equals(role)) return ".qcashier";
        return ".qsync";
    }

    private String roleSyncFilename(String filename, String targetRole) {
        String clean = sanitize(filename == null ? "qatra-sync" : filename);
        int dot = clean.lastIndexOf('.');
        if(dot > 0) clean = clean.substring(0, dot);
        return clean + syncExtensionForRole(targetRole);
    }

    private String roleArabicName(String role) {
        if("ADMIN".equals(role)) return "نسخة الإدارة";
        if("READER".equals(role)) return "نسخة الكاشف";
        if("COLLECTOR".equals(role)) return "نسخة المحصل";
        return "نسخة الصندوق";
    }

    private void requestBluetoothIfNeeded(){
        if(Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED){
            requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, BT_REQ);
        }
    }

    private void showLicenseCenter(boolean blocking) {
        if(isFinishing() || licenseManager == null) return;
        QatraLicenseManager.Snapshot snapshot = licenseManager.current();
        if(blocking && snapshot.operationalAllowed()) {
            completeUnlockedAccess();
            return;
        }
        if(licenseDialog != null && licenseDialog.isShowing()) return;

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(20), dp(8), dp(20), dp(6));

        TextView status = new TextView(this);
        status.setTextSize(16f);
        status.setTextColor(snapshot.operationalAllowed()
                ? Color.rgb(6, 120, 55) : Color.rgb(153, 27, 27));
        status.setText(licenseStatusText(snapshot));
        status.setPadding(0, 0, 0, dp(12));
        content.addView(status);

        TextView identifiers = new TextView(this);
        identifiers.setTextIsSelectable(true);
        identifiers.setText("هوية المنشأة:\n" + emptyDash(snapshot.organizationId)
                + "\n\nرمز الجهاز:\n" + emptyDash(snapshot.deviceCode));
        identifiers.setTextSize(13f);
        identifiers.setTextColor(Color.rgb(51, 65, 85));
        identifiers.setPadding(dp(12), dp(10), dp(12), dp(10));
        identifiers.setBackgroundColor(Color.rgb(241, 245, 249));
        content.addView(identifiers);

        String requestCode = "";
        try { requestCode = licenseManager.activationRequest(); }
        catch(Exception ignored) { }
        final String copyValue = requestCode;
        Button copyRequest = licenseButton("نسخ طلب التفعيل للجهاز", Color.rgb(3, 105, 161));
        copyRequest.setEnabled(!copyValue.isEmpty());
        copyRequest.setOnClickListener(v -> {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if(clipboard != null) {
                clipboard.setPrimaryClip(ClipData.newPlainText("Qatra license request", copyValue));
                toast("تم نسخ طلب التفعيل. أرسله إلى مسؤول تراخيص قطرة برو");
            }
        });
        content.addView(copyRequest);

        EditText activation = new EditText(this);
        activation.setHint("الصق منحة التجربة أو رمز التفعيل الدائم هنا");
        activation.setMinLines(3);
        activation.setMaxLines(6);
        activation.setGravity(Gravity.TOP | Gravity.START);
        activation.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        activation.setPadding(dp(12), dp(10), dp(12), dp(10));
        content.addView(activation, new LinearLayout.LayoutParams(-1, -2));

        Button activate = licenseButton("اعتماد التجربة أو التفعيل", Color.rgb(5, 150, 105));
        activate.setOnClickListener(v -> {
            try {
                QatraLicenseManager.Snapshot licensed = licenseManager.activate(
                        activation.getText().toString());
                activation.setText("");
                toast(licensed.status == QatraLicenseManager.Status.LICENSED
                        ? "تم تفعيل قطرة برو دائمًا"
                        : "تم اعتماد منحة التجربة لمدة 30 يومًا");
                if(licenseDialog != null) licenseDialog.dismiss();
                licenseDialog = null;
                completeUnlockedAccess();
            } catch(Exception error) {
                activation.setError(error.getMessage() == null ? "رمز التفعيل غير صالح" : error.getMessage());
                activation.requestFocus();
            }
        });
        content.addView(activate);

        Button chooseFile = licenseButton("فتح ملف تفعيل .qlicense", Color.rgb(14, 116, 144));
        chooseFile.setOnClickListener(v -> chooseLicenseFile());
        content.addView(chooseFile);

        Button drive = licenseButton("Google Drive: نسخ احتياطي واستعادة", Color.rgb(180, 83, 9));
        drive.setOnClickListener(v -> {
            if(licenseDialog != null) licenseDialog.dismiss();
            licenseDialog = null;
            openDriveBackupCenter(sessionUsername);
        });
        content.addView(drive);

        Button portable = licenseButton("إنشاء نسخة احتياطية مشفرة", Color.rgb(71, 85, 105));
        portable.setOnClickListener(v -> showEmergencyPortableBackup());
        content.addView(portable);

        Button restorePortable = licenseButton("استعادة نسخة احتياطية مشفرة", Color.rgb(71, 85, 105));
        restorePortable.setOnClickListener(v -> chooseEmergencyPortableRestore());
        content.addView(restorePortable);

        Button diagnostics = licenseButton("فحص سلامة قاعدة البيانات", Color.rgb(71, 85, 105));
        diagnostics.setOnClickListener(v -> {
            try {
                JSONObject result = database.diagnostics();
                new AlertDialog.Builder(this)
                        .setTitle("سلامة بيانات قطرة برو")
                        .setMessage("SQLite: " + result.optString("integrity", "-")
                                + "\nالحالات: " + result.optLong("states")
                                + "\nالسجلات: " + result.optLong("records")
                                + "\nملفات المزامنة: " + result.optLong("syncPackages"))
                        .setPositiveButton("حسنًا", null).show();
            } catch(Exception error) { toast("تعذر فحص قاعدة البيانات: " + error.getMessage()); }
        });
        content.addView(diagnostics);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(content);
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(snapshot.status == QatraLicenseManager.Status.LICENSED
                        ? "ترخيص قطرة برو" : "التجربة والاشتراك")
                .setView(scroll)
                .setCancelable(!blocking)
                .setNegativeButton(blocking ? "إغلاق التطبيق" : "إغلاق", (d, w) -> {
                    if(blocking) finishAffinity();
                })
                .create();
        licenseDialog = dialog;
        dialog.setOnDismissListener(ignored -> {
            if(licenseDialog == dialog) licenseDialog = null;
        });
        dialog.show();
    }

    private Button licenseButton(String text, int color) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14f);
        button.setAllCaps(false);
        button.setBackgroundColor(color);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(50));
        params.setMargins(0, dp(9), 0, 0);
        button.setLayoutParams(params);
        return button;
    }

    private String licenseStatusText(QatraLicenseManager.Snapshot snapshot) {
        if(snapshot.status == QatraLicenseManager.Status.LICENSED) {
            return "الرخصة: تفعيل دائم\nالعميل: " + emptyDash(snapshot.customerName)
                    + "\nرقم الرخصة: " + emptyDash(snapshot.licenseId);
        }
        if(snapshot.status == QatraLicenseManager.Status.TRIAL_ACTIVE) {
            return "نسخة تجريبية — متبقي " + snapshot.remainingDays() + " يومًا\n"
                    + "تنتهي في: " + formatLicenseDate(snapshot.trialExpiresAt);
        }
        if(snapshot.status == QatraLicenseManager.Status.TRIAL_REQUIRED) {
            return "يلزم إصدار منحة تجربة موقعة لهذا الجهاز\n"
                    + "إعادة تثبيت التطبيق لا تبدأ تجربة جديدة.";
        }
        return snapshot.message + "\nلن تُحذف البيانات. فعّل الرخصة أو أنشئ نسخة احتياطية.";
    }

    private String formatLicenseDate(long value) {
        if(value <= 0L) return "-";
        return new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(new Date(value));
    }

    private static String emptyDash(String value) {
        return value == null || value.trim().isEmpty() ? "-" : value;
    }

    private void chooseLicenseFile() {
        if(licenseDialog != null) licenseDialog.dismiss();
        licenseDialog = null;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES,
                new String[]{"application/vnd.qatra.license+json", "application/json", "text/plain", "application/octet-stream"});
        startActivityForResult(Intent.createChooser(intent, "اختر ملف تفعيل قطرة برو"), LICENSE_FILE_REQ);
    }

    private void activateLicenseFromUri(Uri uri) {
        new Thread(() -> {
            try {
                byte[] bytes = readIncomingBytes(uri);
                String token = new String(bytes, StandardCharsets.UTF_8);
                QatraLicenseManager.Snapshot licensed = licenseManager.activate(token);
                runOnUiThread(() -> {
                    toast(licensed.status == QatraLicenseManager.Status.LICENSED
                            ? "تم التفعيل الدائم بنجاح"
                            : "تم اعتماد منحة التجربة بنجاح");
                    if(accessUnlocked) completeUnlockedAccess();
                    else showAccessGate();
                });
            } catch(Exception error) {
                runOnUiThread(() -> {
                    toast("تعذر اعتماد ملف التفعيل: " + error.getMessage());
                    showLicenseCenter(licenseBlocked);
                });
            }
        }, "qatra-license-file").start();
    }

    private void showEmergencyPortableBackup() {
        if(licenseDialog != null) licenseDialog.dismiss();
        licenseDialog = null;
        try {
            JSONObject payload = database.exportPortableBackup(APP_ROLE, null);
            String operation = "ADMIN".equals(APP_ROLE) ? "FULL_BACKUP" : "ROLE_BACKUP";
            String filename = "qatra-emergency-backup-"
                    + APP_ROLE.toLowerCase(Locale.ROOT) + "-"
                    + new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date())
                    + syncExtensionForRole(APP_ROLE);
            returnToLicenseGateAfterSave = true;
            showPortableBackupExportDialog(filename, operation, payload.toString());
        } catch(Exception error) {
            toast("تعذر تجهيز النسخة الاحتياطية: " + error.getMessage());
            if(licenseBlocked) showLicenseCenter(true);
        }
    }

    private void chooseEmergencyPortableRestore() {
        if(licenseDialog != null) licenseDialog.dismiss();
        licenseDialog = null;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES,
                new String[]{"application/octet-stream", syncMimeForRole(APP_ROLE)});
        startActivityForResult(Intent.createChooser(intent,
                "اختر النسخة الاحتياطية المشفرة"), EMERGENCY_RESTORE_FILE_REQ);
    }

    private void prepareEmergencyPortableRestore(Uri uri) {
        new Thread(() -> {
            try {
                byte[] bytes = readIncomingBytes(uri);
                if(!crypto.isPortableBackup(bytes)) {
                    throw new SecurityException("الملف ليس نسخة احتياطية محمولة لقطرة برو");
                }
                runOnUiThread(() -> showEmergencyPortableRestoreDialog(bytes));
            } catch(Exception error) {
                runOnUiThread(() -> {
                    toast("تعذر فتح النسخة الاحتياطية: " + error.getMessage());
                    if(licenseBlocked) showLicenseCenter(true);
                });
            }
        }, "qatra-emergency-backup-read").start();
    }

    private void showEmergencyPortableRestoreDialog(byte[] bytes) {
        if(crypto.requiresLegacyRecoveryCode(bytes)) {
            showLegacyEmergencyPortableRestoreDialog(bytes);
            return;
        }
        new Thread(() -> {
            byte[] recoveredKey = null;
            try {
                QatraCrypto.EncryptedPackage pack =
                        crypto.decryptPortableBackup(bytes, APP_ROLE);
                recoveredKey = pack.recoveredSyncKey;
                if(!APP_ROLE.equals(pack.targetRole)) {
                    throw new SecurityException("النسخة الاحتياطية مخصصة لتطبيق آخر");
                }
                crypto.restoreRecoveredSyncKey(recoveredKey);
                database.restorePortableBackup(APP_ROLE, pack.payloadJson);
                runOnUiThread(() -> {
                    if(webView != null && initialPageLoaded) webView.reload();
                    toast("تمت استعادة بيانات SQLite بنجاح دون رمز. الرخصة وبيانات الدخول لم تتغير.");
                    if(licenseBlocked) showLicenseCenter(true);
                });
            } catch(Exception error) {
                runOnUiThread(() -> {
                    toast("تعذر استعادة النسخة: " + backupErrorMessage(error));
                    if(licenseBlocked) showLicenseCenter(true);
                });
            } finally {
                if(recoveredKey != null) Arrays.fill(recoveredKey, (byte) 0);
            }
        }, "qatra-emergency-backup-auto-restore").start();
    }

    private void showLegacyEmergencyPortableRestoreDialog(byte[] bytes) {
        if(isFinishing()) return;
        LinearLayout fields = backupPasswordFields(false);
        EditText password = (EditText) fields.getChildAt(1);
        final boolean[] completed = {false};
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("استعادة نسخة قطرة برو")
                .setMessage("هذه نسخة قديمة فقط. أدخل رمز الاستعادة السابق؛ النسخ الجديدة تُستعاد تلقائيًا.")
                .setView(fields)
                .setPositiveButton("تحقق واستعادة", null)
                .setNegativeButton("إلغاء", null)
                .create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String recoveryPassword = password.getText().toString();
            if(recoveryPassword.length() < 8 || recoveryPassword.length() > 64) {
                password.setError("أدخل رمز الاستعادة من 8 إلى 64 محرفًا");
                return;
            }
            password.setText("");
            password.setEnabled(false);
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(false);
            new Thread(() -> {
                byte[] recoveredKey = null;
                try {
                    QatraCrypto.EncryptedPackage pack = crypto.decryptPortableBackup(
                            bytes, APP_ROLE, recoveryPassword);
                    recoveredKey = pack.recoveredSyncKey;
                    if(!APP_ROLE.equals(pack.targetRole)) {
                        throw new SecurityException("النسخة الاحتياطية مخصصة لتطبيق آخر");
                    }
                    crypto.restoreRecoveredSyncKey(recoveredKey);
                    database.restorePortableBackup(APP_ROLE, pack.payloadJson);
                    completed[0] = true;
                    runOnUiThread(() -> {
                        dialog.dismiss();
                        if(webView != null && initialPageLoaded) webView.reload();
                        toast("تمت استعادة بيانات SQLite بنجاح. الرخصة وبيانات الدخول لم تتغير.");
                        if(licenseBlocked) showLicenseCenter(true);
                    });
                } catch(Exception error) {
                    runOnUiThread(() -> {
                        password.setEnabled(true);
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                        dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(true);
                        password.setError(backupErrorMessage(error));
                        password.requestFocus();
                    });
                } finally {
                    if(recoveredKey != null) Arrays.fill(recoveredKey, (byte) 0);
                }
            }, "qatra-emergency-backup-restore").start();
        }));
        dialog.setOnDismissListener(ignored -> {
            if(!completed[0] && licenseBlocked) {
                getWindow().getDecorView().post(() -> showLicenseCenter(true));
            }
        });
        dialog.show();
    }

    private void requireOperationalLicense() {
        QatraLicenseManager.Snapshot snapshot = licenseManager.current();
        if(snapshot.operationalAllowed()) return;
        runOnUiThread(() -> blockForLicense(snapshot));
        throw new SecurityException(snapshot.message.isEmpty()
                ? "انتهت صلاحية التشغيل. افتح إدارة الترخيص." : snapshot.message);
    }

    private void openDriveBackupCenter(String username) {
        Intent intent = new Intent(this, QatraDriveBackupActivity.class);
        intent.putExtra(QatraDriveBackupActivity.EXTRA_SESSION_USERNAME,
                username == null ? "" : username);
        startActivityForResult(intent, DRIVE_BACKUP_REQ);
    }

    public class AndroidBridge {
        @JavascriptInterface public String getAppInfo() {
            try {
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("role", APP_ROLE);
                out.put("username", sessionUsername);
                out.put("version", BuildConfig.VERSION_NAME);
                out.put("database", "SQLite");
                out.put("exportLocation", exportDisplayPath());
                out.put("syncKeyProvisioned", crypto.isProvisioned());
                out.put("license", licenseManager.current().toJson());
                return out.toString();
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String createQrCode(String text) {
            try {
                requireOperationalLicense();
                String value = text == null ? "" : text.trim();
                if(value.isEmpty() || value.length() > 700) throw new IllegalArgumentException("بيانات QR غير صالحة");
                Bitmap bitmap = createQrBitmap(value, 320);
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
                JSONObject result = new JSONObject();
                result.put("ok", true);
                result.put("dataUrl", "data:image/png;base64," + android.util.Base64.encodeToString(
                        output.toByteArray(), android.util.Base64.NO_WRAP));
                return result.toString();
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String getState(String namespace) {
            try {
                requireNamespace(namespace);
                String payload = database.getState(namespace);
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("found", payload != null);
                if(payload != null) out.put("payload", new JSONObject(payload));
                return out.toString();
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String getIncomingFile() {
            try {
                JSONObject out = new JSONObject();
                byte[] bytes = incomingFileBytes;
                out.put("ok", true);
                out.put("available", bytes != null && bytes.length > 0);
                if(bytes != null && bytes.length > 0) {
                    out.put("filename", incomingFileName);
                    out.put("mime", incomingFileMime);
                    out.put("size", bytes.length);
                    out.put("base64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP));
                }
                return out.toString();
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String clearIncomingFile() {
            String completedDrivePackage = incomingDrivePackageId;
            incomingFileBytes = null;
            incomingFileName = "";
            incomingFileMime = "";
            incomingDrivePackageId = "";
            if(driveSyncStore != null && completedDrivePackage != null
                    && !completedDrivePackage.isEmpty()) {
                driveSyncStore.consumeIncoming(completedDrivePackage);
                runOnUiThread(() -> getWindow().getDecorView().postDelayed(
                        () -> loadNextDriveIncoming(), 180L));
            }
            return okJson("تم إغلاق الملف الوارد");
        }
        @JavascriptInterface public String openDriveSyncCenter() {
            runOnUiThread(() -> startActivity(new Intent(
                    MainActivity.this, QatraCloudSyncActivity.class)));
            return okJson("تم فتح مركز المزامنة");
        }
        @JavascriptInterface public String saveState(String namespace, String payloadJson) {
            try {
                requireOperationalLicense();
                requireNamespace(namespace);
                database.saveState(namespace, payloadJson);
                return okJson("تم حفظ البيانات في SQLite");
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String migrateLegacyState(String namespace, String legacyKey, String payloadJson) {
            try {
                requireOperationalLicense();
                requireNamespace(namespace);
                requireLegacyKey(namespace, legacyKey);
                boolean migrated = database.migrateLegacyState(namespace, legacyKey, payloadJson);
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("migrated", migrated);
                return out.toString();
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String createPairingFile(String filename, String pin) {
            try {
                requireOperationalLicense();
                if(!"ADMIN".equals(APP_ROLE)) throw new SecurityException("إنشاء مفتاح الربط متاح للإدارة فقط");
                byte[] bytes = crypto.createPairingPackage(pin, APP_ROLE);
                runOnUiThread(() -> savePackageBytes(
                        filename, bytes, "application/vnd.qatra.pairing+binary"));
                return okJson("تم إنشاء ملف ربط مشفر");
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String importPairingFile(String base64Bytes, String pin) {
            try {
                crypto.importPairingPackage(android.util.Base64.decode(base64Bytes, android.util.Base64.DEFAULT), pin);
                return okJson("تم ربط مفتاح المزامنة وحفظه عبر Android Keystore");
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String getEncryptedPackageType(String base64Bytes) {
            try {
                byte[] bytes = android.util.Base64.decode(base64Bytes, android.util.Base64.DEFAULT);
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("portableBackup", crypto.isPortableBackup(bytes));
                return out.toString();
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String exportPortableBackup(
                String filename, String operationType, String primaryOverrideJson) {
            try {
                String operation = cleanOperation(operationType);
                requirePortableBackupOperation(operation);
                JSONObject payload = database.exportPortableBackup(APP_ROLE, primaryOverrideJson);
                String safeFilename = roleSyncFilename(filename, APP_ROLE);
                runOnUiThread(() -> showPortableBackupExportDialog(
                        safeFilename, operation, payload.toString()));
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("pending", true);
                out.put("message", "يجري تشفير النسخة تلقائيًا دون رمز استعادة");
                return out.toString();
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String inspectPortableBackup(
                String base64Bytes, String requestId) {
            try {
                if(requestId == null || !requestId.matches("BKP_REQ_[A-Za-z0-9_-]{8,64}")) {
                    throw new SecurityException("معرّف طلب الاستعادة غير صالح");
                }
                byte[] bytes = android.util.Base64.decode(base64Bytes, android.util.Base64.DEFAULT);
                if(!crypto.isPortableBackup(bytes)) {
                    throw new SecurityException("الملف ليس نسخة احتياطية محمولة");
                }
                runOnUiThread(() -> showPortableBackupImportDialog(bytes, requestId));
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("pending", true);
                return out.toString();
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String commitPortableBackup(String namespace, String packageId) {
            try {
                requireNamespace(namespace);
                if(!primaryNamespaceForCurrentRole().equals(namespace)) {
                    throw new SecurityException("نطاق استعادة النسخة لا يطابق صلاحية التطبيق");
                }
                QatraCrypto.EncryptedPackage pack = pendingPortableBackups.get(packageId);
                if(pack == null) throw new SecurityException("أعد فتح النسخة الاحتياطية وانتظر اكتمال فحصها");
                if(!APP_ROLE.equals(pack.targetRole)) {
                    throw new SecurityException("النسخة الاحتياطية مخصصة لتطبيق آخر");
                }
                crypto.restoreRecoveredSyncKey(pack.recoveredSyncKey);
                database.restorePortableBackup(APP_ROLE, pack.payloadJson);
                pendingPortableBackups.remove(packageId);
                if(pack.recoveredSyncKey != null) Arrays.fill(pack.recoveredSyncKey, (byte) 0);
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("message", "تمت استعادة النسخة الاحتياطية في SQLite بنجاح");
                return out.toString();
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String exportEncryptedPackage(
                String filename, String targetRole, String operationType, String payloadJson) {
            try {
                requireOperationalLicense();
                String cleanTargetRole = cleanRole(targetRole);
                String cleanOperationType = cleanOperation(operationType);
                String protectedPayload = licenseManager.attachProvisioning(
                        cleanOperationType, payloadJson);
                QatraCrypto.EncryptedPackage pack = crypto.encryptSync(
                        APP_ROLE, cleanTargetRole, cleanOperationType, protectedPayload);
                database.recordOutgoing(pack.packageId, pack.operationId, pack.senderRole,
                        pack.targetRole, pack.operationType, pack.payloadHash);
                pendingDriveSavePackages.put(pack.packageId, pack);
                runOnUiThread(() -> savePackageBytes(
                        roleSyncFilename(filename, pack.targetRole), pack.bytes,
                        syncMimeForRole(pack.targetRole), pack.packageId));
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("packageId", pack.packageId);
                out.put("operationId", pack.operationId);
                out.put("payloadHash", pack.payloadHash);
                return out.toString();
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String queueEncryptedPackage(
                String filename, String targetRole, String operationType, String payloadJson) {
            try {
                requireOperationalLicense();
                String cleanTargetRole = cleanRole(targetRole);
                String cleanOperationType = cleanOperation(operationType);
                String protectedPayload = licenseManager.attachProvisioning(
                        cleanOperationType, payloadJson);
                QatraCrypto.EncryptedPackage pack = crypto.encryptSync(
                        APP_ROLE, cleanTargetRole, cleanOperationType, protectedPayload);
                database.recordOutgoing(pack.packageId, pack.operationId, pack.senderRole,
                        pack.targetRole, pack.operationType, pack.payloadHash);
                boolean queued = driveSyncStore.enqueueOutgoing(
                        pack, roleSyncFilename(filename, pack.targetRole));
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("queued", queued);
                out.put("packageId", pack.packageId);
                out.put("operationId", pack.operationId);
                out.put("payloadHash", pack.payloadHash);
                out.put("message", queued
                        ? "تم تجهيز التحديث المشفر للرفع"
                        : "التحديث موجود مسبقًا في طابور الرفع");
                return out.toString();
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String inspectEncryptedPackage(String base64Bytes) {
            try {
                byte[] bytes = android.util.Base64.decode(base64Bytes, android.util.Base64.DEFAULT);
                QatraCrypto.EncryptedPackage pack = crypto.decryptSync(bytes, APP_ROLE);
                boolean duplicate = database.isProcessed(pack.packageId, pack.operationId);
                JSONObject out = pack.toInspectionJson(duplicate);
                if(duplicate) {
                    out.remove("payload");
                    out.put("message", "تم استيراد هذه العملية سابقًا، ولم تُطبق مرة أخرى");
                } else {
                    database.recordIncomingPending(pack.packageId, pack.operationId, pack.senderRole,
                            pack.targetRole, pack.operationType, pack.payloadHash);
                    pendingImports.put(pack.packageId, pack);
                }
                return out.toString();
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String commitImportedState(
                String namespace, String packageId, String mergedStateJson) {
            try {
                requireOperationalLicense();
                requireNamespace(namespace);
                QatraCrypto.EncryptedPackage pack = pendingImports.get(packageId);
                if(pack == null) {
                    if(database.isProcessed(packageId, "")) {
                        JSONObject duplicate = new JSONObject();
                        duplicate.put("ok", true);
                        duplicate.put("duplicate", true);
                        return duplicate.toString();
                    }
                    throw new SecurityException("يجب فحص ملف المزامنة قبل تثبيته");
                }
                QatraLicenseManager.Provisioning provisioning = licenseManager.validateProvisioning(
                        pack.senderRole, pack.operationType, pack.payloadJson);
                String confirmationId = database.commitImportedState(namespace, pack.packageId,
                        pack.operationId, pack.senderRole, pack.targetRole, pack.operationType,
                        pack.payloadHash, mergedStateJson);
                if(confirmationId == null) {
                    pendingImports.remove(packageId);
                    JSONObject duplicate = new JSONObject();
                    duplicate.put("ok", true);
                    duplicate.put("duplicate", true);
                    return duplicate.toString();
                }
                licenseManager.adoptProvisioning(provisioning);

                JSONObject confirmationPayload = new JSONObject();
                confirmationPayload.put("type", "QATRA_SYNC_CONFIRMATION");
                confirmationPayload.put("confirmationId", confirmationId);
                confirmationPayload.put("packageId", pack.packageId);
                confirmationPayload.put("operationId", pack.operationId);
                confirmationPayload.put("payloadHash", pack.payloadHash);
                confirmationPayload.put("processedByRole", APP_ROLE);
                confirmationPayload.put("processedAt", System.currentTimeMillis());
                QatraCrypto.EncryptedPackage confirmation = crypto.encryptSync(
                        APP_ROLE, pack.senderRole, "CONFIRMATION", confirmationPayload.toString());
                database.recordOutgoing(confirmation.packageId, confirmation.operationId,
                        confirmation.senderRole, confirmation.targetRole,
                        confirmation.operationType, confirmation.payloadHash);
                driveSyncStore.enqueueOutgoing(confirmation,
                        "qatra-confirmation-" + pack.packageId + ".qsync");
                pendingImports.remove(packageId);
                runOnUiThread(() -> savePackageBytes(
                        "qatra-confirmation-" + pack.packageId + ".qconfirm",
                        confirmation.bytes, syncMimeForRole(confirmation.targetRole)));

                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("duplicate", false);
                out.put("confirmationId", confirmationId);
                out.put("message", "تم تثبيت الاستيراد وإنشاء ملف التأكيد");
                QatraLicenseManager.Snapshot postImportLicense = licenseManager.current();
                if(!postImportLicense.operationalAllowed()) {
                    runOnUiThread(() -> getWindow().getDecorView().postDelayed(
                            () -> blockForLicense(postImportLicense), 250L));
                }
                return out.toString();
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String acceptConfirmation(String packageId) {
            try {
                requireOperationalLicense();
                QatraCrypto.EncryptedPackage pack = pendingImports.get(packageId);
                if(pack == null) {
                    if(database.isProcessed(packageId, "")) {
                        JSONObject duplicate = new JSONObject();
                        duplicate.put("ok", true);
                        duplicate.put("duplicate", true);
                        return duplicate.toString();
                    }
                    throw new SecurityException("يجب فحص ملف التأكيد أولاً");
                }
                if(!"CONFIRMATION".equals(pack.operationType)) {
                    throw new SecurityException("الملف ليس ملف تأكيد");
                }
                JSONObject payload = new JSONObject(pack.payloadJson);
                if(!"QATRA_SYNC_CONFIRMATION".equals(payload.optString("type"))) {
                    throw new SecurityException("محتوى ملف التأكيد غير صالح");
                }
                boolean committed = database.commitConfirmationReceipt(
                        pack.packageId, pack.operationId, pack.senderRole, pack.targetRole,
                        pack.payloadHash, payload.getString("packageId"),
                        payload.getString("operationId"), payload.getString("payloadHash"));
                pendingImports.remove(packageId);
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("duplicate", !committed);
                out.put("acknowledgedPackageId", payload.getString("packageId"));
                out.put("message", committed ? "تم اعتماد ملف التأكيد" : "تم اعتماد التأكيد سابقًا");
                return out.toString();
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String diagnostics() {
            try {
                JSONObject out = database.diagnostics();
                out.put("ok", true);
                out.put("role", APP_ROLE);
                out.put("syncKeyProvisioned", crypto.isProvisioned());
                return out.toString();
            } catch(Exception e) { return errorJson(e); }
        }
        @JavascriptInterface public String openAccessSettings() {
            runOnUiThread(() -> accessControl.showAccessSettings());
            return okJson("تم فتح إعدادات الدخول والبصمة");
        }
        @JavascriptInterface public String openLicenseCenter() {
            runOnUiThread(() -> {
                Intent intent = new Intent(MainActivity.this, LicenseActivity.class);
                startActivity(intent);
            });
            return okJson("تم فتح إدارة الاشتراك والترخيص");
        }
        @JavascriptInterface public String openDriveBackupCenter() {
            runOnUiThread(() -> MainActivity.this.openDriveBackupCenter(sessionUsername));
            return okJson("تم فتح مركز Google Drive");
        }
        @JavascriptInterface public String lockApplication() {
            runOnUiThread(() -> MainActivity.this.lockApplication());
            return okJson("تم قفل التطبيق");
        }
        @JavascriptInterface public void saveFile(String filename, String content, String mime) {
            try {
                requireOperationalLicense();
                if("CASHIER".equals(APP_ROLE) && isSpreadsheetExport(filename, mime)) {
                    toast("تصدير Excel وCSV غير متاح في نسخة الصندوق");
                    return;
                }
                runOnUiThread(() -> saveAndShare(filename, content, mime));
            } catch(Exception ignored) { }
        }
        @JavascriptInterface public void exportXlsx(String filename, String title, String rowsJson) {
            try { requireOperationalLicense(); }
            catch(Exception ignored) { return; }
            if("CASHIER".equals(APP_ROLE)) {
                toast("تصدير Excel غير متاح في نسخة الصندوق");
                return;
            }
            new Thread(() -> {
                try {
                    byte[] data = buildXlsx(title, rowsJson);
                    runOnUiThread(() -> saveBinaryAndShare(filename, data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
                } catch(Exception e) { toast("فشل إنشاء ملف Excel: " + e.getMessage()); }
            }).start();
        }
        @JavascriptInterface public void printHtml(String title, String html, String pageSize) {
            try {
                requireOperationalLicense();
                runOnUiThread(() -> printHtmlDocument(title, html, pageSize));
            } catch(Exception ignored) { }
        }
        @JavascriptInterface public void openSms(String phone, String text) {
            try {
                requireOperationalLicense();
                runOnUiThread(() -> openSmsApp(phone, text));
            } catch(Exception ignored) { }
        }
        @JavascriptInterface public void openWhatsApp(String phone, String text) {
            try {
                requireOperationalLicense();
                runOnUiThread(() -> openWhatsAppApp(phone, text));
            } catch(Exception ignored) { }
        }
        @JavascriptInterface public void printThermalReceipt(String json) {
            try { requireOperationalLicense(); }
            catch(Exception ignored) { return; }
            if("CASHIER".equals(APP_ROLE)) {
                toast("الطباعة الحرارية غير متاحة في نسخة الصندوق؛ استخدم سند A5");
                return;
            }
            new Thread(() -> {
                try { printReceiptJson(json); }
                catch(Exception e){ toast("تعذرت الطباعة الحرارية: " + e.getMessage()); }
            }).start();
        }
        @JavascriptInterface public void printThermalInvoice(String json) {
            try { requireOperationalLicense(); }
            catch(Exception ignored) { return; }
            if("CASHIER".equals(APP_ROLE)) {
                toast("الطباعة الحرارية غير متاحة في نسخة الصندوق؛ استخدم سند A5");
                return;
            }
            new Thread(() -> {
                try { printInvoiceJson(json); }
                catch(Exception e){ toast("تعذرت طباعة الفاتورة الحرارية: " + e.getMessage()); }
            }).start();
        }
        @JavascriptInterface public void printThermalTest() {
            try { requireOperationalLicense(); }
            catch(Exception ignored) { return; }
            if("CASHIER".equals(APP_ROLE)) {
                toast("اختبار الطابعة الحرارية غير متاح في نسخة الصندوق");
                return;
            }
            String fake = "{\"receiptNo\":\"TEST-001\",\"date\":\"" + new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()) + "\",\"subscriberCode\":\"000\",\"subscriberName\":\"اختبار الطابعة\",\"phone\":\"\",\"area\":\"\",\"amount\":\"1000\",\"method\":\"نقداً\",\"collectorName\":\"Qatra Pro\"}";
            printThermalReceipt(fake);
        }
    }

    private void showPortableBackupExportDialog(
            String filename, String operationType, String payloadJson) {
        if(isFinishing()) return;
        new Thread(() -> {
            byte[] syncKeyForRecovery = null;
            try {
                syncKeyForRecovery = crypto.syncKeyForPortableBackup();
                QatraCrypto.EncryptedPackage pack = crypto.encryptPortableBackup(
                        APP_ROLE, operationType, payloadJson, syncKeyForRecovery);
                runOnUiThread(() -> {
                    savePackageBytes(filename, pack.bytes,
                            syncMimeForRole(APP_ROLE), pack.packageId);
                    toast("تم تشفير النسخة وحفظها؛ لا تحتاج إلى رمز استعادة");
                });
            } catch(Exception error) {
                runOnUiThread(() -> {
                    toast("تعذر إنشاء النسخة الاحتياطية: " + backupErrorMessage(error));
                    if(returnToLicenseGateAfterSave) {
                        returnToLicenseGateAfterSave = false;
                        blockForLicense(licenseManager.current());
                    }
                });
            } finally {
                if(syncKeyForRecovery != null) Arrays.fill(syncKeyForRecovery, (byte) 0);
            }
        }, "qatra-portable-backup-export").start();
    }

    private void showPortableBackupImportDialog(byte[] bytes, String requestId) {
        if(crypto.requiresLegacyRecoveryCode(bytes)) {
            showLegacyPortableBackupImportDialog(bytes, requestId);
            return;
        }
        new Thread(() -> {
            try {
                QatraCrypto.EncryptedPackage pack =
                        crypto.decryptPortableBackup(bytes, APP_ROLE);
                pendingPortableBackups.put(pack.packageId, pack);
                JSONObject result = pack.toInspectionJson(false);
                result.put("portableBackup", true);
                runOnUiThread(() -> notifyPortableBackupInspection(requestId, result));
            } catch(Exception error) {
                JSONObject result = portableBackupError(backupErrorMessage(error), false);
                runOnUiThread(() -> notifyPortableBackupInspection(requestId, result));
            }
        }, "qatra-portable-backup-auto-import").start();
    }

    private void showLegacyPortableBackupImportDialog(byte[] bytes, String requestId) {
        if(isFinishing()) {
            notifyPortableBackupInspection(requestId, portableBackupError("تعذر فتح نافذة الاستعادة", false));
            return;
        }
        LinearLayout fields = backupPasswordFields(false);
        EditText password = (EditText) fields.getChildAt(1);
        final boolean[] completed = {false};
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("استعادة نسخة قطرة برو")
                .setMessage("هذه نسخة قديمة فقط. أدخل رمز الاستعادة الذي استُخدم عند تصديرها؛ النسخ الجديدة لا تحتاج رمزًا.")
                .setView(fields)
                .setPositiveButton("فك النسخة ومراجعتها", null)
                .setNegativeButton("إلغاء", (d, which) -> {
                    if(!completed[0]) {
                        completed[0] = true;
                        notifyPortableBackupInspection(requestId,
                                portableBackupError("تم إلغاء استعادة النسخة الاحتياطية", true));
                    }
                })
                .create();
        dialog.setOnCancelListener(ignored -> {
            if(!completed[0]) {
                completed[0] = true;
                notifyPortableBackupInspection(requestId,
                        portableBackupError("تم إلغاء استعادة النسخة الاحتياطية", true));
            }
        });
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            String recoveryPassword = password.getText().toString();
            if(recoveryPassword.length() < 8 || recoveryPassword.length() > 64) {
                password.setError("أدخل رمز الاستعادة من 8 إلى 64 محرفًا");
                return;
            }
            password.setText("");
            password.setEnabled(false);
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(false);
            new Thread(() -> {
                try {
                    QatraCrypto.EncryptedPackage pack = crypto.decryptPortableBackup(
                            bytes, APP_ROLE, recoveryPassword);
                    pendingPortableBackups.put(pack.packageId, pack);
                    JSONObject result = pack.toInspectionJson(false);
                    result.put("portableBackup", true);
                    completed[0] = true;
                    runOnUiThread(() -> {
                        dialog.dismiss();
                        notifyPortableBackupInspection(requestId, result);
                    });
                } catch(Exception error) {
                    runOnUiThread(() -> {
                        password.setEnabled(true);
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                        dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(true);
                        password.setError(backupErrorMessage(error));
                        password.requestFocus();
                    });
                }
            }, "qatra-portable-backup-import").start();
        }));
        dialog.show();
    }

    private LinearLayout backupPasswordFields(boolean withConfirmation) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(22), dp(8), dp(22), 0);
        TextView firstLabel = new TextView(this);
        firstLabel.setText("رمز استعادة النسخة القديمة");
        EditText first = new EditText(this);
        first.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        first.setSingleLine(true);
        first.setHint("الرمز المستخدم في الإصدار القديم");
        box.addView(firstLabel);
        box.addView(first);
        return box;
    }

    private void notifyPortableBackupInspection(String requestId, JSONObject result) {
        if(webView == null || requestId == null) return;
        runOnUiThread(() -> {
            String script = "window.QatraNative&&window.QatraNative.onBackupInspectResult(" +
                    JSONObject.quote(requestId) + "," + JSONObject.quote(result.toString()) + ");";
            webView.evaluateJavascript(script, null);
        });
    }

    private static JSONObject portableBackupError(String message, boolean cancelled) {
        JSONObject out = new JSONObject();
        try {
            out.put("ok", false);
            out.put("cancelled", cancelled);
            out.put("error", message == null ? "تعذر استعادة النسخة الاحتياطية" : message);
        } catch(Exception ignored) { }
        return out;
    }

    private static String backupErrorMessage(Exception error) {
        return error == null || error.getMessage() == null
                ? "تعذر معالجة النسخة الاحتياطية" : error.getMessage();
    }

    private void requirePortableBackupOperation(String operationType) {
        boolean allowed = "ADMIN".equals(APP_ROLE)
                ? "FULL_BACKUP".equals(operationType)
                : "ROLE_BACKUP".equals(operationType);
        if(!allowed) throw new SecurityException("نوع النسخة الاحتياطية لا يطابق صلاحية التطبيق");
    }

    private String primaryNamespaceForCurrentRole() {
        return QatraNamespacePolicy.primaryNamespaceForRole(APP_ROLE);
    }

    private void requireNamespace(String namespace) {
        QatraNamespacePolicy.requireNamespace(APP_ROLE, namespace);
    }

    private void requireLegacyKey(String namespace, String legacyKey) {
        Map<String, Set<String>> allowed = new HashMap<>();
        allowed.put("admin", new HashSet<>(Collections.singletonList("qatra_pro_v6_editable_cycles_from_gray_excel")));
        allowed.put("admin.backups", new HashSet<>(Collections.singletonList("qatra_pro_local_backups_v1")));
        allowed.put("admin.collector.config", new HashSet<>(Collections.singletonList("qatra_pro_collector_single_v71")));
        allowed.put("reader", new HashSet<>(Arrays.asList("qatra_reader_v1", "qatra_pro_v6_editable_cycles_from_gray_excel")));
        allowed.put("collector", new HashSet<>(Collections.singletonList("meyah_alrawdah_collector_v1")));
        allowed.put("cashier", new HashSet<>(Collections.singletonList("meyah_alrawdah_cashier_v1")));
        Set<String> namespaceKeys = allowed.get(namespace);
        if(namespaceKeys == null || !namespaceKeys.contains(legacyKey)) {
            throw new SecurityException("مفتاح الترحيل القديم غير معتمد");
        }
    }

    private static String cleanRole(String value) {
        return value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
    }

    private static String cleanOperation(String value) {
        return value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
    }

    private static boolean isSpreadsheetExport(String filename, String mime) {
        String name = filename == null ? "" : filename.trim().toLowerCase(Locale.ROOT);
        String type = mime == null ? "" : mime.trim().toLowerCase(Locale.ROOT);
        return name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")
                || type.contains("spreadsheet") || type.contains("ms-excel")
                || type.startsWith("text/csv");
    }

    private static String okJson(String message) {
        try {
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("message", message == null ? "" : message);
            return out.toString();
        } catch(Exception ignored) { return "{\"ok\":true}"; }
    }

    private static String errorJson(Exception error) {
        try {
            JSONObject out = new JSONObject();
            out.put("ok", false);
            out.put("error", error == null || error.getMessage() == null
                    ? "حدث خطأ غير متوقع" : error.getMessage());
            return out.toString();
        } catch(Exception ignored) { return "{\"ok\":false,\"error\":\"error\"}"; }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void printHtmlDocument(String title, String html, String pageSize) {
        try {
            printWebView = new WebView(this);
            WebSettings ws = printWebView.getSettings();
            ws.setJavaScriptEnabled(false);
            ws.setDefaultTextEncodingName("UTF-8");
            printWebView.setWebViewClient(new WebViewClient() {
                private boolean started = false;
                @Override public void onPageFinished(WebView view, String url) {
                    if(started) return;
                    started = true;
                    PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                    String safeTitle = (title == null || title.trim().isEmpty()) ? "Qatra Pro" : title;
                    PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(safeTitle);
                    String requested = pageSize == null ? "A4" : pageSize.toUpperCase(Locale.ROOT);
                    if("CASHIER".equals(APP_ROLE)
                            && safeTitle.trim().startsWith("سند")) requested = "A5L";
                    PrintAttributes.MediaSize media = requested.contains("A5")
                            ? PrintAttributes.MediaSize.ISO_A5
                            : PrintAttributes.MediaSize.ISO_A4;
                    if(requested.contains("L") || requested.contains("LANDSCAPE")) media = media.asLandscape();
                    else media = media.asPortrait();
                    PrintAttributes attrs = new PrintAttributes.Builder()
                            .setMediaSize(media)
                            .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME)
                            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                            .build();
                    pm.print(safeTitle, adapter, attrs);
                    toast("اختر الطابعة أو اختر حفظ كملف PDF");
                }
            });
            printWebView.loadDataWithBaseURL(assetRoot, html, "text/html", "UTF-8", null);
        } catch(Exception e) {
            toast("تعذرت الطباعة: " + e.getMessage());
        }
    }

    private void saveAndShare(String filename, String content, String mime) {
        exportBytes(filename == null ? "qatra-export.txt" : filename,
                (content == null ? "" : content).getBytes(StandardCharsets.UTF_8),
                (mime == null || mime.trim().isEmpty()) ? "text/plain" : mime, null);
    }

    private void saveBinaryAndShare(String filename, byte[] content, String mime) {
        String safe = sanitize(filename == null ? "qatra-report.xlsx" : filename);
        if(!safe.toLowerCase(Locale.ROOT).endsWith(".xlsx")) safe += ".xlsx";
        exportBytes(safe, content == null ? new byte[0] : content,
                (mime == null || mime.trim().isEmpty()) ? "application/octet-stream" : mime, null);
    }

    private void savePackageBytes(String filename, byte[] content, String mime) {
        savePackageBytes(filename, content, mime, null);
    }

    private void savePackageBytes(String filename, byte[] content, String mime, String saveToken) {
        exportBytes(filename == null ? "qatra-secure-package.qsync" : filename,
                content == null ? new byte[0] : content,
                (mime == null || mime.trim().isEmpty()) ? "application/octet-stream" : mime,
                saveToken);
    }

    private void exportBytes(String filename, byte[] content, String mime, String saveToken) {
        final String safeFilename = sanitize(filename);
        final byte[] bytes = content == null ? new byte[0] : content;
        final String safeMime = (mime == null || mime.trim().isEmpty())
                ? "application/octet-stream" : mime;
        if(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            new Thread(() -> saveToDownloads(safeFilename, bytes, safeMime, saveToken)).start();
            return;
        }
        launchLegacySave(safeFilename, bytes, safeMime, saveToken);
    }

    private void launchLegacySave(String filename, byte[] content, String mime, String saveToken) {
        try {
            pendingSaveFilename = filename;
            pendingSaveBytes = content;
            pendingSaveContent = null;
            pendingSaveToken = saveToken;
            pendingSaveMime = mime;
            Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            save.addCategory(Intent.CATEGORY_OPENABLE);
            save.setType(pendingSaveMime);
            save.putExtra(Intent.EXTRA_TITLE, pendingSaveFilename);
            startActivityForResult(save, SAVE_FILE_REQ);
        } catch(Exception e) {
            pendingSaveToken = null;
            pendingDriveSavePackages.remove(saveToken);
            notifyFileSaveResult(saveToken, false, "فشل فتح نافذة الحفظ: " + e.getMessage(), filename, "");
            toast("فشل فتح نافذة الحفظ: " + e.getMessage());
        }
    }

    @android.annotation.TargetApi(Build.VERSION_CODES.Q)
    private void saveToDownloads(String filename, byte[] content, String mime, String saveToken) {
        Uri uri = null;
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
            values.put(MediaStore.Downloads.MIME_TYPE, mime);
            values.put(MediaStore.Downloads.RELATIVE_PATH, exportRelativePath());
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if(uri == null) throw new IOException("تعذر إنشاء الملف داخل التنزيلات");
            try(OutputStream out = getContentResolver().openOutputStream(uri, "w")) {
                if(out == null) throw new IOException("تعذر فتح ملف التصدير");
                out.write(content);
                out.flush();
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            getContentResolver().update(uri, values, null, null);
            final Uri savedUri = uri;
            final String location = exportDisplayPath();
            runOnUiThread(() -> {
                enqueueSavedPackageForDrive(saveToken, filename);
                notifyFileSaveResult(saveToken, true, "", filename, location);
                toast("تم حفظ " + filename + " في " + location);
                shareSavedFile(savedUri, mime, filename);
            });
        } catch(Exception error) {
            if(uri != null) {
                try { getContentResolver().delete(uri, null, null); } catch(Exception ignored) { }
            }
            final String message = "فشل حفظ الملف تلقائيًا: " + error.getMessage();
            runOnUiThread(() -> {
                pendingDriveSavePackages.remove(saveToken);
                notifyFileSaveResult(saveToken, false, message, filename, "");
                toast(message);
            });
        }
    }

    private void shareSavedFile(Uri uri, String mime, String filename) {
        try {
            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType(mime);
            share.putExtra(Intent.EXTRA_STREAM, uri);
            share.putExtra(Intent.EXTRA_SUBJECT, filename);
            share.setClipData(ClipData.newRawUri(filename, uri));
            share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(share, "مشاركة ملف قطرة برو"));
        } catch(Exception e) {
            toast("تم الحفظ، لكن تعذر فتح المشاركة: " + e.getMessage());
        }
    }

    private String exportRoleFolder() {
        if("ADMIN".equals(APP_ROLE)) return "Admin";
        if("READER".equals(APP_ROLE)) return "Reader";
        if("COLLECTOR".equals(APP_ROLE)) return "Collector";
        return "Cashier";
    }

    private String exportRelativePath() {
        return Environment.DIRECTORY_DOWNLOADS + "/" + EXPORT_ROOT + "/" + exportRoleFolder();
    }

    private String exportDisplayPath() {
        return "Downloads/" + EXPORT_ROOT + "/" + exportRoleFolder();
    }

    private void ensureExportWorkspace() {
        new Thread(() -> {
            try {
                if(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    String markerKey = "export_workspace_" + exportRoleFolder();
                    if(getSharedPreferences("qatra_export", MODE_PRIVATE).getBoolean(markerKey, false)) return;
                    String text = "مجلد تصدير قطرة برو - " + exportRoleFolder()
                            + "\nتُحفظ هنا ملفات Excel وملفات المزامنة المشفرة تلقائيًا.\n";
                    createWorkspaceMarker("QatraPro-README.txt", text.getBytes(StandardCharsets.UTF_8));
                    getSharedPreferences("qatra_export", MODE_PRIVATE).edit().putBoolean(markerKey, true).apply();
                } else {
                    File root = new File(getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS),
                            EXPORT_ROOT + File.separator + exportRoleFolder());
                    if(!root.exists() && !root.mkdirs()) return;
                    File marker = new File(root, "QatraPro-README.txt");
                    if(!marker.exists()) try(FileOutputStream out = new FileOutputStream(marker)) {
                        out.write("مجلد ملفات قطرة برو الاحتياطي للأجهزة القديمة.\n".getBytes(StandardCharsets.UTF_8));
                    }
                }
            } catch(Exception ignored) { }
        }).start();
    }

    @android.annotation.TargetApi(Build.VERSION_CODES.Q)
    private void createWorkspaceMarker(String filename, byte[] content) throws Exception {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
        values.put(MediaStore.Downloads.MIME_TYPE, "text/plain");
        values.put(MediaStore.Downloads.RELATIVE_PATH, exportRelativePath());
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if(uri == null) throw new IOException("تعذر إنشاء مجلد التصدير");
        try(OutputStream out = getContentResolver().openOutputStream(uri, "w")) {
            if(out == null) throw new IOException("تعذر إنشاء ملف تعريف المجلد");
            out.write(content);
        } catch(Exception error) {
            getContentResolver().delete(uri, null, null);
            throw error;
        }
        values.clear();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        getContentResolver().update(uri, values, null, null);
    }

    private void notifyFileSaveResult(String token, boolean saved, String error,
                                      String filename, String location) {
        if (token == null || token.trim().isEmpty() || webView == null) return;
        try {
            JSONObject event = new JSONObject();
            event.put("token", token);
            event.put("saved", saved);
            event.put("error", error == null ? "" : error);
            event.put("filename", filename == null ? "" : filename);
            event.put("location", location == null ? "" : location);
            String script = "window.QatraNative&&window.QatraNative.onFileSaveResult(" +
                    JSONObject.quote(event.toString()) + ");";
            webView.evaluateJavascript(script, null);
        } catch(Exception ignored) { }
    }

    private void enqueueSavedPackageForDrive(String token, String filename) {
        if(token == null || token.trim().isEmpty() || driveSyncStore == null) return;
        QatraCrypto.EncryptedPackage pack = pendingDriveSavePackages.remove(token);
        if(pack == null) return;
        try {
            driveSyncStore.enqueueOutgoing(pack, filename);
        } catch(Exception error) {
            toast("تم حفظ الملف، لكن تعذر إضافته إلى طابور Drive: " + error.getMessage());
        }
    }

    private byte[] buildXlsx(String title, String rowsJson) throws Exception {
        JSONArray rows = new JSONArray(rowsJson == null ? "[]" : rowsJson);
        int maxCols = 1;
        for(int i=0;i<rows.length();i++){
            JSONArray row = rows.optJSONArray(i);
            if(row != null) maxCols = Math.max(maxCols, row.length());
        }
        String sheetName = sanitizeSheetName(title == null ? "تقرير" : title);
        StringBuilder sheet = new StringBuilder();
        sheet.append("<?xml version='1.0' encoding='UTF-8' standalone='yes'?>")
             .append("<worksheet xmlns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'>")
             .append("<sheetViews><sheetView workbookViewId='0' rightToLeft='1'><pane ySplit='1' topLeftCell='A2' activePane='bottomLeft' state='frozen'/></sheetView></sheetViews>")
             .append("<cols>");
        for(int c=1;c<=maxCols;c++) sheet.append("<col min='").append(c).append("' max='").append(c).append("' width='20' customWidth='1'/>");
        sheet.append("</cols><sheetData>");
        for(int r=0;r<rows.length();r++){
            JSONArray row = rows.optJSONArray(r);
            if(row == null) continue;
            int excelRow = r + 1;
            sheet.append("<row r='").append(excelRow).append("'>");
            for(int c=0;c<row.length();c++){
                Object value = row.opt(c);
                String ref = columnName(c + 1) + excelRow;
                int style = r == 0 ? 1 : 0;
                if(value instanceof Number){
                    sheet.append("<c r='").append(ref).append("' s='").append(style).append("' t='n'><v>").append(value.toString()).append("</v></c>");
                } else {
                    String text = value == null || value == JSONObject.NULL ? "" : String.valueOf(value);
                    sheet.append("<c r='").append(ref).append("' s='").append(style).append("' t='inlineStr'><is><t xml:space='preserve'>").append(xmlEscape(text)).append("</t></is></c>");
                }
            }
            sheet.append("</row>");
        }
        String endRef = columnName(maxCols) + Math.max(1, rows.length());
        sheet.append("</sheetData><autoFilter ref='A1:").append(endRef).append("'/><pageMargins left='0.25' right='0.25' top='0.4' bottom='0.4' header='0.2' footer='0.2'/>")
             .append("<pageSetup orientation='landscape' paperSize='9' fitToWidth='1' fitToHeight='0'/></worksheet>");

        String contentTypes = "<?xml version='1.0' encoding='UTF-8'?>"+
                "<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'>"+
                "<Default Extension='rels' ContentType='application/vnd.openxmlformats-package.relationships+xml'/>"+
                "<Default Extension='xml' ContentType='application/xml'/>"+
                "<Override PartName='/xl/workbook.xml' ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'/>"+
                "<Override PartName='/xl/worksheets/sheet1.xml' ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'/>"+
                "<Override PartName='/xl/styles.xml' ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'/>"+
                "<Override PartName='/docProps/core.xml' ContentType='application/vnd.openxmlformats-package.core-properties+xml'/>"+
                "<Override PartName='/docProps/app.xml' ContentType='application/vnd.openxmlformats-officedocument.extended-properties+xml'/></Types>";
        String rootRels = "<?xml version='1.0' encoding='UTF-8'?><Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>"+
                "<Relationship Id='rId1' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument' Target='xl/workbook.xml'/>"+
                "<Relationship Id='rId2' Type='http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties' Target='docProps/core.xml'/>"+
                "<Relationship Id='rId3' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties' Target='docProps/app.xml'/></Relationships>";
        String workbook = "<?xml version='1.0' encoding='UTF-8'?><workbook xmlns='http://schemas.openxmlformats.org/spreadsheetml/2006/main' xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'><bookViews><workbookView/></bookViews><sheets><sheet name='"+xmlEscape(sheetName)+"' sheetId='1' r:id='rId1'/></sheets></workbook>";
        String workbookRels = "<?xml version='1.0' encoding='UTF-8'?><Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Relationship Id='rId1' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet' Target='worksheets/sheet1.xml'/><Relationship Id='rId2' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles' Target='styles.xml'/></Relationships>";
        String styles = "<?xml version='1.0' encoding='UTF-8'?><styleSheet xmlns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'><fonts count='2'><font><sz val='11'/><name val='Arial'/></font><font><b/><sz val='11'/><color rgb='FFFFFFFF'/><name val='Arial'/></font></fonts><fills count='3'><fill><patternFill patternType='none'/></fill><fill><patternFill patternType='gray125'/></fill><fill><patternFill patternType='solid'><fgColor rgb='FF075985'/><bgColor indexed='64'/></patternFill></fill></fills><borders count='2'><border/><border><left style='thin'/><right style='thin'/><top style='thin'/><bottom style='thin'/></border></borders><cellStyleXfs count='1'><xf numFmtId='0' fontId='0' fillId='0' borderId='0'/></cellStyleXfs><cellXfs count='2'><xf numFmtId='0' fontId='0' fillId='0' borderId='1' xfId='0' applyAlignment='1'><alignment horizontal='right' vertical='center' wrapText='1'/></xf><xf numFmtId='0' fontId='1' fillId='2' borderId='1' xfId='0' applyAlignment='1'><alignment horizontal='center' vertical='center' wrapText='1'/></xf></cellXfs><cellStyles count='1'><cellStyle name='Normal' xfId='0' builtinId='0'/></cellStyles></styleSheet>";
        String now = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).format(new Date());
        String core = "<?xml version='1.0' encoding='UTF-8'?><cp:coreProperties xmlns:cp='http://schemas.openxmlformats.org/package/2006/metadata/core-properties' xmlns:dc='http://purl.org/dc/elements/1.1/' xmlns:dcterms='http://purl.org/dc/terms/' xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance'><dc:title>"+xmlEscape(title)+"</dc:title><dc:creator>مشروع مياه الروضة</dc:creator><dcterms:created xsi:type='dcterms:W3CDTF'>"+now+"</dcterms:created></cp:coreProperties>";
        String app = "<?xml version='1.0' encoding='UTF-8'?><Properties xmlns='http://schemas.openxmlformats.org/officeDocument/2006/extended-properties' xmlns:vt='http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes'><Application>مشروع مياه الروضة</Application></Properties>";

        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try(ZipOutputStream zip = new ZipOutputStream(bos)){
            putZip(zip,"[Content_Types].xml",contentTypes);
            putZip(zip,"_rels/.rels",rootRels);
            putZip(zip,"xl/workbook.xml",workbook);
            putZip(zip,"xl/_rels/workbook.xml.rels",workbookRels);
            putZip(zip,"xl/styles.xml",styles);
            putZip(zip,"xl/worksheets/sheet1.xml",sheet.toString());
            putZip(zip,"docProps/core.xml",core);
            putZip(zip,"docProps/app.xml",app);
        }
        return bos.toByteArray();
    }

    private void putZip(ZipOutputStream zip, String name, String content) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(content.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }
    private String xmlEscape(String s){
        return (s == null ? "" : s).replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&apos;");
    }
    private String sanitizeSheetName(String s){
        String v = s == null ? "تقرير" : s;
        char[] bad = new char[]{'\\','/','?','*','[',']',':'};
        for(char ch: bad) v = v.replace(ch, ' ');
        v = v.trim();
        if(v.isEmpty()) v = "تقرير";
        return v.length()>31 ? v.substring(0,31) : v;
    }
    private String columnName(int index){
        StringBuilder sb=new StringBuilder(); int n=index;
        while(n>0){ n--; sb.insert(0,(char)('A'+(n%26))); n/=26; }
        return sb.toString();
    }

    private String sanitize(String n){ return n.replaceAll("[^a-zA-Z0-9_\\-.ء-ي]", "_"); }

    private BluetoothDevice findPrinter() throws Exception {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if(adapter == null) throw new Exception("الجهاز لا يدعم البلوتوث");
        if(!adapter.isEnabled()) throw new Exception("فعّل البلوتوث أولاً");
        if(Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) throw new Exception("اسمح بصلاحية البلوتوث");
        Set<BluetoothDevice> devices = adapter.getBondedDevices();
        if(devices == null || devices.isEmpty()) throw new Exception("لا توجد طابعة مقترنة. اربط الطابعة من إعدادات البلوتوث أولاً");
        BluetoothDevice fallback = null;
        for(BluetoothDevice d: devices){
            String name = d.getName() == null ? "" : d.getName().toLowerCase(Locale.ROOT);
            if(fallback == null) fallback = d;
            if(name.contains("printer") || name.contains("pos") || name.contains("mtp") || name.contains("58") || name.contains("thermal")) return d;
        }
        return fallback;
    }

    private void printReceiptJson(String json) throws Exception {
        JSONObject p = new JSONObject(json);
        sendThermalBitmap(buildReceiptBitmap(p), "تم إرسال سند القبض للطابعة");
    }

    private void printInvoiceJson(String json) throws Exception {
        JSONObject p = new JSONObject(json);
        sendThermalBitmap(buildInvoiceBitmap(p), "تم إرسال الفاتورة الحرارية للطابعة");
    }

    private void sendThermalBitmap(Bitmap bmp, String successMessage) throws Exception {
        byte[] data = bitmapToEscPosRaster(bmp);
        BluetoothDevice device = findPrinter();
        if(device == null) throw new Exception("لم يتم العثور على طابعة بلوتوث مقترنة");
        UUID uuid = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
        if(Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) throw new Exception("صلاحية البلوتوث غير مفعلة");
        try(BluetoothSocket socket = device.createRfcommSocketToServiceRecord(uuid)) {
            socket.connect();
            OutputStream out = socket.getOutputStream();
            out.write(new byte[]{0x1B,0x40});
            out.write(data);
            out.write(new byte[]{0x0A,0x0A,0x0A,0x1D,0x56,0x42,0x00});
            out.flush();
        }
        toast(successMessage);
    }

    private Bitmap createThermalCanvas(JSONObject p, int[] widthOut, boolean[] narrowOut) {
        boolean narrow = !"80".equals(p.optString("thermalWidth", "58"));
        int width = narrow ? 384 : 576;
        widthOut[0] = width;
        narrowOut[0] = narrow;
        Bitmap bmp = Bitmap.createBitmap(width, narrow ? 1600 : 1900, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        c.drawColor(Color.WHITE);
        return bmp;
    }

    private Bitmap decodeThermalLogo(JSONObject payload) {
        String selected = payload == null ? "" : payload.optString("projectLogo", "").trim();
        try {
            if (selected.startsWith("data:image/") && selected.contains(",") && selected.length() <= 4_000_000) {
                String encoded = selected.substring(selected.indexOf(',') + 1).replaceAll("\\s", "");
                byte[] bytes = android.util.Base64.decode(encoded, android.util.Base64.DEFAULT);
                Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (decoded != null) return decoded;
            }
            if (selected.startsWith("assets/") && !selected.contains("..")) {
                try (InputStream in = getAssets().open("qatra/" + selected)) {
                    Bitmap decoded = BitmapFactory.decodeStream(in);
                    if (decoded != null) return decoded;
                }
            }
        } catch (Exception ignored) { }
        try (InputStream in = getAssets().open("qatra/assets/icon-512.png")) {
            return BitmapFactory.decodeStream(in);
        } catch (Exception ignored) {
            return null;
        }
    }

    private int drawThermalLogo(Canvas c, Paint paint, int width, int y, boolean narrow, JSONObject payload) {
        Bitmap logo = decodeThermalLogo(payload);
        if (logo == null) return y;
        int targetW = narrow ? 150 : 205;
        int targetH = Math.max(72, Math.round(targetW * (logo.getHeight() / (float) logo.getWidth())));
        targetH = Math.min(targetH, narrow ? 150 : 205);
        Rect src = new Rect(0, 0, logo.getWidth(), logo.getHeight());
        Rect dst = new Rect((width - targetW) / 2, y, (width + targetW) / 2, y + targetH);
        c.drawBitmap(logo, src, dst, paint);
        return y + targetH + (narrow ? 6 : 10);
    }

    private int drawThermalMarketingMark(Canvas canvas, Paint paint, int width, int y, boolean narrow, JSONObject payload) {
        y = drawThermalLine(canvas, y + 2, width);
        paint.setTextSize(narrow ? 15 : 18);
        return drawThermalCenter(canvas, paint,
                payload.optString("marketingBrand", "QATRA PRO — نظام قطرة برو"),
                width, y, true, narrow ? 22 : 26);
    }

    private Bitmap createQrBitmap(String text, int size) throws Exception {
        Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
        hints.put(EncodeHintType.CHARACTER_SET, StandardCharsets.UTF_8.name());
        hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M);
        hints.put(EncodeHintType.MARGIN, 2);
        BitMatrix matrix = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, hints);
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        for(int y = 0; y < size; y++) for(int x = 0; x < size; x++)
            bitmap.setPixel(x, y, matrix.get(x, y) ? Color.BLACK : Color.WHITE);
        return bitmap;
    }

    private int drawThermalQr(Canvas canvas, Paint paint, int width, int y, String text, boolean narrow) {
        if(text == null || text.trim().isEmpty()) return y;
        try {
            int size = narrow ? 190 : 230;
            Bitmap qr = createQrBitmap(text.trim(), size);
            canvas.drawBitmap(qr, (width - size) / 2f, y, paint);
            paint.setTextSize(narrow ? 15 : 19);
            return drawThermalCenter(canvas, paint, "امسح لعرض بيانات السداد بالعربية", width,
                    y + size + (narrow ? 18 : 22), false, narrow ? 24 : 29);
        } catch(Exception ignored) { return y; }
    }

    private Bitmap buildReceiptBitmap(JSONObject p) throws Exception {
        int[] widthOut={0}; boolean[] narrowOut={false};
        Bitmap bmp=createThermalCanvas(p,widthOut,narrowOut); int width=widthOut[0]; boolean narrow=narrowOut[0];
        Canvas c=new Canvas(bmp); Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG); paint.setColor(Color.BLACK);
        int y=narrow?10:14; y=drawThermalLogo(c,paint,width,y,narrow,p);
        paint.setTextSize(narrow?23:29); y=drawThermalCenter(c,paint,p.optString("projectName","قطرة برو"),width,y,true,narrow?30:37);
        paint.setTextSize(narrow?22:27); y=drawThermalCenter(c,paint,p.optString("receiptTitle","سند قبض"),width,y,true,narrow?28:34);
        y=drawThermalLine(c,y+3,width);
        y=drawThermalRow(c,paint,width,y,"رقم السند",p.optString("receiptNo"),narrow,true);
        y=drawThermalRow(c,paint,width,y,"التاريخ",p.optString("date"),narrow,false);
        String partyName=p.has("partyName")?p.optString("partyName"):p.optString("subscriberName");
        y=drawThermalRow(c,paint,width,y,p.optString("partyLabel","اسم المشترك"),partyName,narrow,true);
        if(!p.optString("meterNo").trim().isEmpty()){
            y=drawThermalRow(c,paint,width,y,"رقم العداد",p.optString("meterNo"),narrow,true);
        }
        y=drawThermalLine(c,y+2,width);
        y=drawThermalAmountBox(c,paint,width,y,p.optString("amount","0")+" ريال",narrow,p.optString("amountLabel","المبلغ المسدد"));
        if(p.optBoolean("showBalances",true)){
            String before=p.optString("balanceBeforeAmount","0")+" ريال"+p.optString("balanceBeforeSuffix","");
            y=drawThermalRow(c,paint,width,y,"الرصيد قبل السداد",before,narrow,false);
            y=drawThermalRow(c,paint,width,y,p.optString("balanceLabel","الرصيد المتبقي عليكم"),p.optString("balanceAmount","0")+" ريال",narrow,true);
        }
        y=drawThermalRow(c,paint,width,y,"طريقة الدفع",p.optString("method"),narrow,false);
        if(!p.optString("statement").trim().isEmpty()){
            y=drawThermalRow(c,paint,width,y,"البيان",p.optString("statement"),narrow,false);
        }
        y=drawThermalLine(c,y+2,width);
        y=drawThermalQr(c,paint,width,y,p.optString("qrText"),narrow);
        paint.setTextSize(narrow?17:21);
        y=drawThermalWrappedCenter(c,paint,p.optString("footer","هذا السند صادر من المشروع."),width,y+4,narrow?24:29,narrow?34:46);
        String operatorName=p.has("operatorName")?p.optString("operatorName"):p.optString("collectorName","المحصل");
        y=drawThermalCenter(c,paint,p.optString("operatorLabel","المحصل")+": "+operatorName,width,y+4,false,narrow?24:29);
        y=drawThermalMarketingMark(c,paint,width,y,narrow,p);
        return Bitmap.createBitmap(bmp,0,0,width,Math.min(bmp.getHeight(),y+(narrow?24:36)));
    }

    private Bitmap buildInvoiceBitmap(JSONObject p) throws Exception {
        int[] widthOut={0}; boolean[] narrowOut={false};
        Bitmap bmp=createThermalCanvas(p,widthOut,narrowOut); int width=widthOut[0]; boolean narrow=narrowOut[0];
        Canvas c=new Canvas(bmp); Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG); paint.setColor(Color.BLACK);
        int y=narrow?10:14; y=drawThermalLogo(c,paint,width,y,narrow,p);
        paint.setTextSize(narrow?23:29); y=drawThermalCenter(c,paint,p.optString("projectName","قطرة برو"),width,y,true,narrow?30:37);
        paint.setTextSize(narrow?22:28); y=drawThermalCenter(c,paint,p.optString("invoiceTitle","فاتورة استهلاك مياه"),width,y,true,narrow?30:36);
        y=drawThermalLine(c,y+3,width);
        y=drawThermalRow(c,paint,width,y,"رقم الفاتورة",p.optString("invoiceNo"),narrow,true);
        y=drawThermalRow(c,paint,width,y,"التاريخ",p.optString("date"),narrow,false);
        y=drawThermalRow(c,paint,width,y,"الدورة",p.optString("cycleName"),narrow,false);
        y=drawThermalRow(c,paint,width,y,"اسم المشترك",p.optString("subscriberName"),narrow,true);
        y=drawThermalRow(c,paint,width,y,"رقم العداد",p.optString("meterNo"),narrow,true);
        y=drawThermalLine(c,y+2,width);
        y=drawThermalRow(c,paint,width,y,"القراءة السابقة",p.optString("prevReading"),narrow,false);
        y=drawThermalRow(c,paint,width,y,"القراءة الحالية",p.optString("currentReading"),narrow,false);
        y=drawThermalRow(c,paint,width,y,"الاستهلاك",p.optString("consumption")+" م3",narrow,true);
        y=drawThermalRow(c,paint,width,y,"سعر الوحدة",p.optString("tariff")+" ريال",narrow,false);
        y=drawThermalRow(c,paint,width,y,"قيمة الاستهلاك",p.optString("amount")+" ريال",narrow,true);
        y=drawThermalRow(c,paint,width,y,"المتأخرات",p.optString("arrears")+" ريال",narrow,false);
        y=drawThermalRow(c,paint,width,y,"الرصيد المقدم",p.optString("credit")+" ريال",narrow,false);
        y=drawThermalLine(c,y+2,width);
        y=drawThermalAmountBox(c,paint,width,y,p.optString("balanceAmount","0")+" ريال",narrow,p.optString("balanceLabel","الرصيد المتبقي عليكم"));
        y=drawThermalQr(c,paint,width,y+3,p.optString("qrText"),narrow);
        String footer=p.optString("footer","");
        if(!footer.trim().isEmpty()){
            paint.setTextSize(narrow?16:20);
            y=drawThermalWrappedCenter(c,paint,footer,width,y+4,narrow?23:28,narrow?34:46);
        }
        y=drawThermalMarketingMark(c,paint,width,y,narrow,p);
        return Bitmap.createBitmap(bmp,0,0,width,Math.min(bmp.getHeight(),y+(narrow?24:36)));
    }

    private int drawThermalCenter(Canvas c, Paint p, String text, int w, int y, boolean bold, int step){
        p.setTextAlign(Paint.Align.CENTER); p.setTypeface(Typeface.create(Typeface.SANS_SERIF,bold?Typeface.BOLD:Typeface.NORMAL));
        c.drawText(text==null?"":text,w/2f,y,p); p.setTextAlign(Paint.Align.RIGHT); p.setTypeface(Typeface.create(Typeface.SANS_SERIF,Typeface.NORMAL));
        return y+step;
    }

    private int drawThermalWrappedCenter(Canvas c, Paint p, String text, int w, int y, int step, int maxChars){
        String value=text==null?"":text.trim(); if(value.isEmpty())return y;
        List<String> lines=new ArrayList<>(); StringBuilder current=new StringBuilder();
        for(String word:value.split("\\s+")){
            if(current.length()>0 && current.length()+1+word.length()>maxChars){lines.add(current.toString());current.setLength(0);}
            if(current.length()>0)current.append(' '); current.append(word);
        }
        if(current.length()>0)lines.add(current.toString());
        for(String line:lines)y=drawThermalCenter(c,p,line,w,y,false,step);
        return y;
    }

    private int drawThermalLine(Canvas c, int y, int w){
        Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);p.setColor(Color.BLACK);p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(2f);p.setPathEffect(new DashPathEffect(new float[]{8f,6f},0));
        c.drawLine(8,y,w-8,y,p);return y+18;
    }

    private int drawThermalRow(Canvas c, Paint p, int w, int y, String key, String value, boolean narrow, boolean boldValue){
        int pad=narrow?10:14; int keyWidth=narrow?145:205; int maxChars=narrow?22:34;
        p.setTextSize(narrow?19:24);p.setTypeface(Typeface.create(Typeface.SANS_SERIF,Typeface.BOLD));p.setTextAlign(Paint.Align.RIGHT);c.drawText((key==null?"":key)+":",w-pad,y,p);
        p.setTypeface(Typeface.create(Typeface.SANS_SERIF,boldValue?Typeface.BOLD:Typeface.NORMAL));p.setTextAlign(Paint.Align.RIGHT);
        String v=value==null?"":value; List<String> lines=new ArrayList<>();
        while(v.length()>maxChars){int cut=v.lastIndexOf(' ',maxChars);if(cut<8)cut=maxChars;lines.add(v.substring(0,cut).trim());v=v.substring(cut).trim();}
        lines.add(v); int yy=y; for(String line:lines){c.drawText(line,w-keyWidth,yy,p);yy+=narrow?25:31;}
        return Math.max(y+(narrow?28:34),yy);
    }

    private int drawThermalAmountBox(Canvas c, Paint p, int w, int y, String amount, boolean narrow, String label){
        int h=narrow?92:112;Paint box=new Paint(Paint.ANTI_ALIAS_FLAG);box.setColor(Color.BLACK);box.setStyle(Paint.Style.STROKE);box.setStrokeWidth(3f);c.drawRect(8,y,w-8,y+h,box);
        p.setTextAlign(Paint.Align.CENTER);p.setTypeface(Typeface.create(Typeface.SANS_SERIF,Typeface.NORMAL));p.setTextSize(narrow?17:21);c.drawText(label==null?"":label,w/2f,y+(narrow?28:34),p);
        p.setTypeface(Typeface.create(Typeface.SANS_SERIF,Typeface.BOLD));p.setTextSize(narrow?28:36);c.drawText(amount==null?"":amount,w/2f,y+(narrow?67:82),p);p.setTextAlign(Paint.Align.RIGHT);
        return y+h+(narrow?14:18);
    }

    private byte[] bitmapToEscPosRaster(Bitmap bmp) throws IOException {
        int width = bmp.getWidth();
        int height = bmp.getHeight();
        int bytesPerRow = (width + 7) / 8;
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(new byte[]{0x1D, 0x76, 0x30, 0x00, (byte)(bytesPerRow & 0xff), (byte)((bytesPerRow >> 8) & 0xff), (byte)(height & 0xff), (byte)((height >> 8) & 0xff)});
        for(int y=0; y<height; y++){
            for(int xByte=0; xByte<bytesPerRow; xByte++){
                int b = 0;
                for(int bit=0; bit<8; bit++){
                    int x = xByte*8 + bit;
                    if(x < width){
                        int color = bmp.getPixel(x,y);
                        int r = Color.red(color), g = Color.green(color), bl = Color.blue(color);
                        int lum = (r+g+bl)/3;
                        if(lum < 160) b |= (0x80 >> bit);
                    }
                }
                out.write(b);
            }
        }
        return out.toByteArray();
    }
}
