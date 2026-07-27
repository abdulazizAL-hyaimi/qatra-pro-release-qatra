'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const must = (condition, message) => {
  if (!condition) {
    console.error(`Portable backup regression test failed: ${message}`);
    process.exit(1);
  }
  console.log(`OK  ${message}`);
};

const crypto = read('app/src/main/java/com/qatra/pro/QatraCrypto.java');
const database = read('app/src/main/java/com/qatra/pro/QatraDatabase.java');
const namespacePolicy = read('app/src/main/java/com/qatra/pro/QatraNamespacePolicy.java');
const activity = read('app/src/main/java/com/qatra/pro/MainActivity.java');
const bridge = read('app/src/main/assets/qatra/assets/secure_bridge.js');
const portableEncrypt = crypto.slice(
  crypto.indexOf('encryptPortableBackup('),
  crypto.indexOf('public boolean isPortableBackup(')
);

must(crypto.includes('QATRA_PORTABLE_BACKUP_V3')
  && crypto.includes('LEGACY_PORTABLE_BACKUP_FORMAT'), 'automatic V3 format and V2 compatibility are versioned');
must(portableEncrypt.includes('AES/GCM/NoPadding') && portableEncrypt.includes('updateAAD'), 'portable backup uses authenticated AES-GCM');
must(portableEncrypt.includes('automaticRecoveryPassword')
  && portableEncrypt.includes('PBKDF2WithHmacSHA1'), 'portable backup uses app-managed recovery with an API 23-compatible KDF');
must(!portableEncrypt.includes('requireSyncKey') && !portableEncrypt.includes('getOrCreateSyncKey'), 'portable backup does not depend on the uninstall-scoped sync key');
must(portableEncrypt.includes('wrappedSyncKey') && crypto.includes('restoreRecoveredSyncKey'), 'portable backup restores the synchronization network without exposing its key to JavaScript');
must(crypto.includes('requiresLegacyRecoveryCode')
  && crypto.includes('رمز استعادة النسخة القديمة غير صحيح'), 'old V2 backups retain their legacy recovery-code path');
must(crypto.includes('Android removes Keystore aliases during uninstall'), 'pairing import repairs an unreadable post-uninstall key wrapper');

for (const namespace of ['admin.staff', 'admin.reader.config', 'admin.collector.config', 'admin.cashbox']) {
  must(namespacePolicy.includes(`"${namespace}"`), `admin portable backup includes ${namespace}`);
}
must(namespacePolicy.includes('ENTERPRISE_CORE')
  && namespacePolicy.includes('portable.put(ADMIN'), 'admin portable backup includes enterprise.core through the central policy');
for (const role of ['READER', 'COLLECTOR', 'CASHIER']) {
  const rolePortable = new RegExp(`portable\\.put\\(${role},\\s*immutableList\\([^)]*ENTERPRISE_CORE`, 'i');
  must(!rolePortable.test(namespacePolicy), `${role} portable backup excludes enterprise.core`);
}
must(database.includes('QatraNamespacePolicy.portableNamespacesForRole(role)'), 'SQLite backup scope is delegated to the central role policy');
must(database.includes('restorePortableBackup') && database.includes('db.beginTransaction()') && database.includes('BACKUP_RESTORED'), 'all backup namespaces restore transactionally to SQLite');
must(activity.includes('showPortableBackupExportDialog')
  && activity.includes('qatra-portable-backup-auto-import')
  && activity.includes('showLegacyPortableBackupImportDialog'), 'new backups restore automatically while old code-protected backups remain readable');
must(!activity.includes('اختر رمز استعادة من 8 محارف على الأقل'), 'new portable backup export must not ask for a recovery code');
must(activity.includes('inspectPortableBackup(\n                String base64Bytes, String requestId)'), 'JavaScript never supplies a recovery password to the native bridge');
must(bridge.includes('onBackupInspectResult') && bridge.includes('QatraBackup = Backup'), 'WebView receives only the decrypted inspection result');
must(bridge.includes('1e000065') && bridge.includes('استورد ملف الربط الأصلي'), 'legacy cipher failures are translated into recovery guidance');

for (const role of ['app.js', 'reader.js', 'collector.js', 'cashier.js']) {
  const source = read(`app/src/main/assets/qatra/assets/${role}`);
  must(source.includes('QatraBackup.export') && source.includes('QatraBackup.commit'), `${role} uses portable backup export and restore`);
}

console.log('\nPortable backup reinstall regression test passed.');
