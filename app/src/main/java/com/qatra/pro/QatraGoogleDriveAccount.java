package com.qatra.pro;

import android.accounts.Account;
import android.accounts.AccountManager;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;

import com.google.android.gms.common.AccountPicker;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Stores the explicitly selected Google account and opens Drive's DocumentsProvider at it. */
final class QatraGoogleDriveAccount {
    static final int PICK_ACCOUNT_REQUEST = 7399;
    static final String GOOGLE_ACCOUNT_TYPE = "com.google";
    static final String DRIVE_PACKAGE = "com.google.android.apps.docs";
    private static final String DRIVE_DOCUMENTS_AUTHORITY =
            "com.google.android.apps.docs.storage";
    private static final String PREFS = "qatra_google_account_v1";
    private static final String PREF_EMAIL = "selected_email";

    private final Context context;
    private final SharedPreferences prefs;

    QatraGoogleDriveAccount(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    String selectedEmail() {
        return normalizeEmail(prefs.getString(PREF_EMAIL, ""));
    }

    boolean hasSelectedAccount() {
        return !selectedEmail().isEmpty();
    }

    Account selectedAccount() {
        String email = selectedEmail();
        return email.isEmpty() ? null : new Account(email, GOOGLE_ACCOUNT_TYPE);
    }

    void saveSelectedEmail(String value) {
        String email = normalizeEmail(value);
        if (email.isEmpty()) throw new SecurityException("اختر حساب Google صالحًا");
        if (!prefs.edit().putString(PREF_EMAIL, email).commit()) {
            throw new IllegalStateException("تعذر حفظ حساب Google المحدد");
        }
    }

    Intent accountPickerIntent() {
        Account selected = selectedAccount();
        // The legacy AccountPicker contract is more reliable on Android 9/10 devices such as
        // Samsung Note 9, while the options builder is retained for newer Android versions.
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q) {
            return AccountPicker.newChooseAccountIntent(
                    selected,
                    null,
                    new String[]{GOOGLE_ACCOUNT_TYPE},
                    true,
                    "اختر حساب Google الموحد لقطرة برو",
                    null,
                    null,
                    null);
        }
        AccountPicker.AccountChooserOptions.Builder builder =
                new AccountPicker.AccountChooserOptions.Builder()
                        .setAllowableAccountsTypes(
                                Collections.singletonList(GOOGLE_ACCOUNT_TYPE))
                        .setAlwaysShowAccountPicker(true)
                        .setTitleOverrideText("اختر حساب Google الموحد لقطرة برو");
        if (selected != null) builder.setSelectedAccount(selected);
        return AccountPicker.newChooseAccountIntent(builder.build());
    }

    String accountFromResult(Intent data) {
        if (data == null) return "";
        return normalizeEmail(data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME));
    }

    boolean isDriveProviderAvailable() {
        if (!isDriveAppInstalled()) return false;
        ContentResolver resolver = context.getContentResolver();
        for (String authority : driveAuthorities()) {
            try {
                ProviderInfo provider = context.getPackageManager()
                        .resolveContentProvider(authority, 0);
                if (provider != null && provider.enabled) return true;
            } catch (Exception ignored) { }
            try (Cursor cursor = resolver.query(
                    DocumentsContract.buildRootsUri(authority),
                    new String[]{DocumentsContract.Root.COLUMN_ROOT_ID},
                    null, null, null)) {
                if (cursor != null) return true;
            } catch (Exception ignored) { }
        }
        // Some Samsung Android 9/10 builds hide Drive's provider metadata from package queries,
        // although the system Storage Access Framework can still display and grant the Drive tree.
        return context.getPackageManager().resolveActivity(
                new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE),
                PackageManager.MATCH_DEFAULT_ONLY) != null;
    }

    boolean isDriveAppInstalled() {
        try {
            return context.getPackageManager()
                    .getApplicationInfo(DRIVE_PACKAGE, 0).enabled;
        } catch (Exception ignored) {
            return false;
        }
    }

    boolean canOpenSelectedAccountRoot() {
        return hasSelectedAccount() && selectedDriveRoot() != null;
    }

    String driveAvailabilityMessage() {
        if (!isDriveAppInstalled()) {
            return "تطبيق Google Drive غير مثبت";
        }
        if (!isDriveProviderAvailable()) {
            return "Google Drive مثبت؛ سيفتح قطرة برو منتقي الملفات للنظام لاختيار Drive يدويًا";
        }
        if (!canOpenSelectedAccountRoot()) {
            return Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q
                    ? "Google Drive جاهز. في Android 9/10 اختر Drive والحساب نفسه من القائمة الجانبية"
                    : "Google Drive جاهز، لكن تعذر تثبيت البداية على الحساب المحدد. اختر الحساب نفسه من قائمة Drive";
        }
        return "Google Drive جاهز على الحساب المحدد";
    }

    boolean isGoogleDriveUri(Uri uri) {
        String authority = uri == null ? "" : uri.getAuthority();
        if (authority == null || authority.trim().isEmpty()) return false;
        if (DRIVE_DOCUMENTS_AUTHORITY.equals(authority)) return true;
        for (String allowed : driveAuthorities()) {
            if (authority.equals(allowed)) return true;
        }
        return false;
    }

    Intent driveFolderPickerIntent() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        intent.putExtra(Intent.EXTRA_LOCAL_ONLY, false);
        // Samsung's Android 9/10 document picker can fail to open when EXTRA_INITIAL_URI points
        // directly at a Drive root. Open the normal provider list there; on newer Android versions
        // keep the convenient account-root jump.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Uri initial = selectedDriveRoot();
            if (initial != null) {
                intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initial);
            }
        }
        return intent;
    }

    Intent openDriveOrStoreIntent() {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(DRIVE_PACKAGE);
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            return launch;
        }
        Intent store = new Intent(Intent.ACTION_VIEW,
                Uri.parse("market://details?id=" + DRIVE_PACKAGE));
        store.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return store;
    }

    private Uri selectedDriveRoot() {
        String wanted = selectedEmail().toLowerCase(Locale.ROOT);
        if (wanted.isEmpty()) return null;
        ContentResolver resolver = context.getContentResolver();
        List<Uri> candidates = new ArrayList<>();
        for (String authority : driveAuthorities()) {
            Uri roots = DocumentsContract.buildRootsUri(authority);
            String[] projection = {
                    DocumentsContract.Root.COLUMN_ROOT_ID,
                    DocumentsContract.Root.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Root.COLUMN_TITLE,
                    DocumentsContract.Root.COLUMN_SUMMARY
            };
            try (Cursor cursor = resolver.query(roots, projection, null, null, null)) {
                if (cursor == null) continue;
                int rootIndex = cursor.getColumnIndex(DocumentsContract.Root.COLUMN_ROOT_ID);
                int documentIndex = cursor.getColumnIndex(
                        DocumentsContract.Root.COLUMN_DOCUMENT_ID);
                int titleIndex = cursor.getColumnIndex(DocumentsContract.Root.COLUMN_TITLE);
                int summaryIndex = cursor.getColumnIndex(DocumentsContract.Root.COLUMN_SUMMARY);
                while (cursor.moveToNext()) {
                    String rootId = value(cursor, rootIndex);
                    String documentId = value(cursor, documentIndex);
                    String title = value(cursor, titleIndex);
                    String summary = value(cursor, summaryIndex);
                    Uri uri = !documentId.isEmpty()
                            ? DocumentsContract.buildDocumentUri(authority, documentId)
                            : !rootId.isEmpty()
                            ? DocumentsContract.buildRootUri(authority, rootId) : null;
                    if (uri == null) continue;
                    candidates.add(uri);
                    String searchable = (rootId + " " + documentId + " " + title + " "
                            + summary).toLowerCase(Locale.ROOT);
                    if (searchable.contains(wanted)) return uri;
                }
            } catch (Exception ignored) { }
        }
        return candidates.size() == 1 ? candidates.get(0) : null;
    }

    private List<String> driveAuthorities() {
        Set<String> out = new LinkedHashSet<>();
        PackageManager packageManager = context.getPackageManager();

        // The authority below is stable across the legacy Drive builds found on Note 9 devices.
        // Keep it as a fallback even when package metadata is incomplete or stored in a split APK.
        if (isDriveAppInstalled()) out.add(DRIVE_DOCUMENTS_AUTHORITY);

        try {
            Intent providerIntent = new Intent(DocumentsContract.PROVIDER_INTERFACE);
            List<ResolveInfo> providers = packageManager.queryIntentContentProviders(
                    providerIntent, PackageManager.GET_META_DATA);
            if (providers != null) {
                for (ResolveInfo resolved : providers) {
                    ProviderInfo provider = resolved == null ? null : resolved.providerInfo;
                    if (provider == null) continue;
                    String packageName = provider.packageName == null ? "" : provider.packageName;
                    String raw = provider.authority == null ? "" : provider.authority;
                    if (!DRIVE_PACKAGE.equals(packageName)
                            && !raw.toLowerCase(Locale.ROOT).contains("google.android.apps.docs")) {
                        continue;
                    }
                    addAuthorities(out, raw);
                }
            }
        } catch (Exception ignored) { }

        try {
            PackageInfo info = packageManager.getPackageInfo(
                    DRIVE_PACKAGE, PackageManager.GET_PROVIDERS);
            ProviderInfo[] providers = info.providers;
            if (providers != null) {
                for (ProviderInfo provider : providers) {
                    addAuthorities(out, provider == null ? "" : provider.authority);
                }
            }
        } catch (Exception ignored) { }

        return new ArrayList<>(out);
    }

    private static void addAuthorities(Set<String> out, String raw) {
        if (raw == null) return;
        for (String authority : raw.split(";")) {
            String clean = authority.trim();
            String lower = clean.toLowerCase(Locale.ROOT);
            if (!clean.isEmpty()
                    && (lower.contains("google.android.apps.docs.storage")
                    || lower.endsWith(".storage"))) {
                out.add(clean);
            }
        }
    }

    private static String value(Cursor cursor, int index) {
        return index < 0 || cursor.isNull(index) ? "" : cursor.getString(index);
    }

    private static String normalizeEmail(String value) {
        String email = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        if (email.length() > 254 || !email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) {
            return "";
        }
        return email;
    }
}
