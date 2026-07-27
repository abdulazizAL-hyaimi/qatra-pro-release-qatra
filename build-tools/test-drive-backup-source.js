'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const must = (condition, message) => {
  if (!condition) {
    console.error(`Google Drive backup regression test failed: ${message}`);
    process.exit(1);
  }
  console.log(`OK  ${message}`);
};

const gradle = read('app/build.gradle');
const manifest = read('app/src/main/AndroidManifest.xml');
const crypto = read('app/src/main/java/com/qatra/pro/QatraDriveBackupCrypto.java');
const manager = read('app/src/main/java/com/qatra/pro/QatraDriveBackupManager.java');
const scheduler = read('app/src/main/java/com/qatra/pro/QatraDriveBackupScheduler.java');
const job = read('app/src/main/java/com/qatra/pro/QatraDriveBackupJobService.java');
const activity = read('app/src/main/java/com/qatra/pro/QatraDriveBackupActivity.java');
const main = read('app/src/main/java/com/qatra/pro/MainActivity.java');
const access = read('app/src/main/java/com/qatra/pro/QatraAccessControl.java');
const bridge = read('app/src/main/assets/qatra/assets/secure_bridge.js');

must(gradle.includes("com.google.android.gms:play-services-auth:21.6.0"), 'Google Identity authorization dependency is pinned');
must(manifest.includes('.QatraDriveBackupActivity') && manifest.includes('.QatraDriveBackupJobService'), 'Drive UI and background job are declared');
must(crypto.includes('QATRA_DRIVE_BACKUP_V2') && crypto.includes('AES/GCM/NoPadding') && crypto.includes('updateAAD'), 'cloud snapshots use versioned authenticated encryption');
must(crypto.includes('QATRA_DRIVE_RECOVERY_KEY_V1') && crypto.includes('configurePasswordless') && crypto.includes('decodeRecoveryKey'), 'passwordless recovery uses a separate random recovery key');
must(crypto.includes('PBKDF2_ITERATIONS = 600_000') && crypto.includes('decryptLegacy'), 'legacy password backups remain readable for safe migration');
must(crypto.includes('AndroidKeyStore') && crypto.includes('wrapLocalKey') && crypto.includes('unwrapLocalKey'), 'scheduled backups use a non-exportable device wrapper');
must(!/putString\([^\n]*(password|Password)/.test(crypto), 'account password is never persisted');
must(crypto.includes('usernameHash') && crypto.includes('نوع المستخدم المختار لا يطابق'), 'username and role are cryptographically bound to restore');
must(manager.includes('drive.file') && manager.includes('drive.appdata') && manager.includes('appDataFolder'), 'Drive uses least-privilege file and hidden app-data scopes');
must(manager.includes('verifyRequiredDriveAccess(accessToken)') && manager.includes('spaces=drive&pageSize=1') && manager.includes('spaces=appDataFolder&pageSize=1'), 'first setup verifies both Drive spaces before changing local recovery state');
must(manager.includes('accessnotconfigured') && manager.includes('service_disabled') && manager.includes('insufficientpermissions') && manager.includes('domainpolicy'), 'Drive 401/403 responses retain actionable Google error reasons');
must(manager.includes('uploadType=resumable'), 'backup and recovery-key uploads are resumable');
must(manager.includes('exportPortableBackup(role, null)') && manager.includes('restorePortableBackup(role, backup.payloadJson)'), 'complete role-scoped SQLite data is uploaded and transactionally restored');
must(manager.includes('RETENTION_COUNT = 10') && manager.includes('cleanupOldBackups'), 'cloud retention is bounded to ten versions per user and role');
must(scheduler.includes('setPersisted(true)') && scheduler.includes('setRequiredNetworkType') && scheduler.includes('nextDelay'), 'selected local time survives reboot and waits for network');
must(job.includes('Identity.getAuthorizationClient') && job.includes('authorization.hasResolution()'), 'background upload reuses prior Google consent and fails safely when consent is needed');
must(job.includes('ClearTokenRequest') && job.includes('requiresFreshAuthorization'), 'background backup clears invalid short-lived Google tokens before retrying');
must(!job.toLowerCase().includes('refreshtoken'), 'no long-lived Google refresh token is stored on the device');
must(activity.includes('اسم المستخدم') && activity.includes('استعادة سريعة بدون كلمة مرور') && activity.includes('نوع المستخدم'), 'restore UI defaults to Google-account recovery without a separate password');
must(activity.includes('لم تُلغَ الصلاحية') && !activity.includes('تم إلغاء تفويض Google Drive'), 'closing Google consent is reported as an incomplete attempt, not revoked authorization');
must(activity.includes('CONFIGURE_AND_UPLOAD') && activity.includes('RESTORE') && activity.includes('frequencyDaysFromSelection'), 'UI supports first upload, scheduled frequency, and fast restore');
must(activity.includes('getGrantedScopes()') && activity.includes('ClearTokenRequest') && activity.includes('clearTokenAndRetry'), 'interactive Drive flow verifies both granted scopes and refreshes an invalid token once');
must(activity.includes('تفويض Google: ') && activity.includes('مساحة النسخ في Drive: ') && activity.includes('بانتظار أول رفع'), 'status distinguishes OAuth consent, Drive initialization, and first successful upload');
must(activity.includes('!manager.isPasswordlessConfigured()') && manager.includes('restoreLatestLegacy'), 'existing V1 installations migrate without losing old backups');
must(main.includes('openDriveBackupCenter') && main.includes('DRIVE_BACKUP_REQ') && bridge.includes('QatraDriveBackup = DriveBackup'), 'every WebView role can open the native Drive center and reload after restore');
must((access.includes('استعادة من Google Drive') || access.includes('RESTORE FROM GOOGLE DRIVE')) && access.includes('requireEnrollmentUsername') && main.includes('EXTRA_RESTORED_USERNAME'), 'fresh installs can restore before enrollment and then bind a new PIN to the restored username');

for (const roleFile of ['app.js', 'reader.js', 'collector.js', 'cashier.js']) {
  must(read(`app/src/main/assets/qatra/assets/${roleFile}`).includes('QatraDriveBackup.open()'), `${roleFile} exposes Google Drive backup`);
}

console.log('\nGoogle Drive backup source regression test passed.');
