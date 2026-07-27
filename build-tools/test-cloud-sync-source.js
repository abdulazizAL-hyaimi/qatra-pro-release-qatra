'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const must = (condition, message) => {
  if (!condition) {
    console.error(`Direct Drive sync source test failed: ${message}`);
    process.exit(1);
  }
};

const manifest = read('app/src/main/AndroidManifest.xml');
const activity = read('app/src/main/java/com/qatra/pro/QatraCloudSyncActivity.java');
const account = read('app/src/main/java/com/qatra/pro/QatraGoogleDriveAccount.java');
const apiTransport = read('app/src/main/java/com/qatra/pro/QatraDriveApiSyncTransport.java');
const legacyTransport = read('app/src/main/java/com/qatra/pro/QatraDriveSyncTransport.java');
const store = read('app/src/main/java/com/qatra/pro/QatraDriveSyncStore.java');
const backup = read('app/src/main/java/com/qatra/pro/QatraDriveBackupActivity.java');
const backupJob = read('app/src/main/java/com/qatra/pro/QatraDriveBackupJobService.java');
const backupManager = read('app/src/main/java/com/qatra/pro/QatraDriveBackupManager.java');
const main = read('app/src/main/java/com/qatra/pro/MainActivity.java');
const bridge = read('app/src/main/assets/qatra/assets/secure_bridge.js');

must(manifest.includes('.QatraCloudSyncActivity') && manifest.includes('android:exported="false"'),
  'the synchronization activity must remain internal-only');
must(account.includes('AccountPicker.newChooseAccountIntent')
    && account.includes('Build.VERSION_CODES.Q'),
  'the unified Google account picker and Android 9/10 account path are missing');
must(activity.includes('AuthorizationRequest.builder()')
    && activity.includes('QatraDriveApiSyncTransport.DRIVE_SCOPE')
    && activity.includes('Identity.getAuthorizationClient'),
  'the synchronization center does not retain modern direct Drive authorization');
must(activity.includes('GoogleAuthUtil.getToken')
    && activity.includes('UserRecoverableAuthException')
    && activity.includes('LEGACY_AUTHORIZATION_REQUEST')
    && activity.includes('Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q'),
  'the Android 9/10 GoogleAuthUtil authorization fallback is missing');
must(activity.includes('GoogleAuthUtil.clearToken')
    && activity.includes('clearLegacyTokenAndRetry'),
  'expired legacy Google tokens are not refreshed safely');
must(activity.includes('لا يحتاج ظهور Google Drive داخل مدير الملفات')
    && !activity.includes('ACTION_OPEN_DOCUMENT_TREE')
    && !activity.includes('isDriveProviderAvailable'),
  'the center still depends on Samsung DocumentsUI or Drive DocumentsProvider');
must(activity.includes('PendingAction.CONNECT')
    && activity.includes('PendingAction.SYNC')
    && activity.includes('تحميل فقط')
    && activity.includes('رفع فقط'),
  'connect, one-tap sync, and separate transfer actions are missing');
must(activity.includes('transport.clearConfiguration()')
    && activity.includes('.onGoogleAccountChanged()'),
  'changing the selected Google account must invalidate both sync and backup bindings');

must(apiTransport.includes('https://www.googleapis.com/drive/v3/files')
    && apiTransport.includes('https://www.googleapis.com/upload/drive/v3/files'),
  'direct Drive REST listing and upload endpoints are missing');
must(apiTransport.includes('QatraPro-Sync')
    && apiTransport.includes('QATRA_SYNC_ROOT_V1')
    && apiTransport.includes('ensureRootFolder'),
  'the deterministic shared Drive root folder is missing');
must(apiTransport.includes('"to-" + clean.toLowerCase')
    && apiTransport.includes('ensureDirectory'),
  'role-targeted Drive directory routing is missing');
must(apiTransport.includes('crypto.decryptSync(bytes, role)')
    && apiTransport.includes('database.isProcessed')
    && apiTransport.includes('store.enqueueIncoming'),
  'downloaded packages are not authenticated, deduplicated, and queued for review');
must(apiTransport.includes('resumableUpload')
    && apiTransport.includes('store.markUploaded')
    && apiTransport.includes('application/vnd.qatra.sync+binary'),
  'encrypted outbox packages are not uploaded directly and acknowledged durably');
must(apiTransport.includes('RequiresAuthorizationException')
    && apiTransport.includes('requiresFreshAuthorization'),
  'expired Google tokens are not retried safely');
must(apiTransport.includes('new QatraDriveSyncTransport(context).clearConfiguration()')
    && legacyTransport.includes('releasePersistableUriPermission'),
  'legacy SAF grants are not retired safely during migration to direct API transport');

must(store.includes('drive-sync-v1') && store.includes('outbox') && store.includes('inbox'),
  'durable local upload/download queues are missing');
must(main.includes('queueEncryptedPackage') && main.includes('enqueueSavedPackageForDrive'),
  'manual admin exports and role auto-exports do not feed the Drive outbox');
must(main.includes('loadNextDriveIncoming') && main.includes('incomingDrivePackageId'),
  'downloaded Drive packages are not routed through the reviewed import flow');
must(bridge.includes('QatraDriveSync = DriveSync')
    && bridge.includes("queue(filename, targetRole, operationType, payload)"),
  'the WebView roles cannot queue changes or open the Drive center');

must(backup.includes('.setAccount(googleAccount.selectedAccount())')
    && backupJob.includes('.setAccount(googleAccount.selectedAccount())'),
  'manual and scheduled Drive backups are not pinned to the selected account');
must(backupManager.includes('PREF_GOOGLE_ACCOUNT')
    && backupManager.includes('bindSelectedGoogleAccount()'),
  'backup configuration is not bound to the selected Google account');

for (const page of ['mobile.html', 'reader.html', 'collector.html', 'cashier.html']) {
  const html = read(`app/src/main/assets/qatra/${page}`);
  must(html.includes('QatraDriveSync') || html.includes('openDriveSync'),
    `${page} does not expose shared Drive sync`);
}
for (const roleFile of ['reader.js', 'collector.js', 'cashier.js']) {
  const source = read(`app/src/main/assets/qatra/assets/${roleFile}`);
  must(source.includes('openDriveSync') && source.includes('QatraSync.queue'),
    `${roleFile} does not prepare new role operations before opening sync`);
}

console.log('Direct Google Drive API synchronization source test passed.');
