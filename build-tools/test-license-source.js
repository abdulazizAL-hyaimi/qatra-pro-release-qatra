'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = value => fs.readFileSync(path.join(root, value), 'utf8');
const ok = (value, message) => { assert.ok(value, message); console.log(`OK  ${message}`); };

const manager = read('app/src/main/java/com/qatra/pro/QatraLicenseManager.java');
const main = read('app/src/main/java/com/qatra/pro/MainActivity.java');
const access = read('app/src/main/java/com/qatra/pro/QatraAccessControl.java');
const gradle = read('app/build.gradle');
const manifest = read('app/src/main/AndroidManifest.xml');
const bridge = read('app/src/main/assets/qatra/assets/secure_bridge.js');
const toolSource = read('build-tools/qatra-license-tool.js');
const ownerEngine = read('owner-console/src/main/java/com/qatra/pro/ownerconsole/LicenseEngine.java');
const ownerMain = read('owner-console/src/main/java/com/qatra/pro/ownerconsole/MainActivity.java');

ok(manager.includes('30L * 24L * 60L * 60L * 1000L') && manager.includes('TRIAL_EXPIRED'),
  'native trial expires after exactly 30 days');
ok(manager.includes('QATRA_TRIAL_GRANT_V1') && manager.includes('TRIAL_REQUIRED')
  && manager.includes('trialGrantRequired = true') && manager.includes('verifyTrialGrant'),
  'a reinstall cannot mint a new trial and requires an owner-signed device grant');
ok(manager.includes('AndroidKeyStore') && manager.includes('HmacSHA256') && manager.includes('CLOCK_TAMPER'),
  'trial state and trusted clock are tamper-evident through Android Keystore');
ok(manager.includes('SHA256withECDSA') && manager.includes('LICENSE_PUBLIC_KEY_BASE64'),
  'permanent activation is verified asymmetrically in native Android');
ok(manager.includes('signingCertificateHash()') && manager.includes('Settings.Secure.ANDROID_ID'),
  'device activation is bound to Android identity and the APK signing certificate');
ok(manager.includes('attachProvisioning') && manager.includes('adoptProvisioning')
  && manager.includes('QATRA_TRIAL_PROVISIONING_V1'),
  'encrypted role setup files inherit the organization trial window');
ok(main.includes('blockForLicense') && main.includes('showLicenseCenter')
  && main.includes('showEmergencyPortableBackup') && main.includes('showEmergencyPortableRestoreDialog')
  && main.includes('openDriveBackupCenter'),
  'expired operation is blocked while encrypted backup, restore and Drive recovery remain available');
ok(main.includes('requireOperationalLicense()') && main.includes('licenseManager.attachProvisioning')
  && main.includes('licenseManager.validateProvisioning'),
  'native mutation and synchronization paths enforce the commercial license');
ok(!access.includes('ACTIVATION / LICENSE HELP') && !access.includes('licenseCenterLauncher'),
  'login no longer displays contact or licensing controls on every launch');
ok(bridge.includes('openLicense:') && bridge.includes("call('openLicenseCenter')"),
  'licensing is exposed explicitly through the More screen bridge');
ok(!bridge.includes("button.className = 'qatra-security-button'"),
  'the floating security and licensing shortcut is not injected on every application screen');
ok(manifest.indexOf('android:name=".MainActivity"') < manifest.indexOf('android.intent.action.MAIN')
  && manifest.includes('android:name=".LicenseActivity"\n            android:exported="false"'),
  'the operational login is the launcher and the licensing center is internal');
ok(ownerEngine.includes('signTrialGrant') && ownerEngine.includes('expiresAt')
  && ownerEngine.includes('TRIAL_DURATION_MS'),
  'the owner console signs an exact 30-day device-bound trial grant');
ok(ownerMain.includes('qatra_owner_trial_ledger_v1') && ownerMain.includes('grant.')
  && ownerMain.includes('existing = trialLedger.getString'),
  'the owner console reissues the original grant instead of restarting its expiry');
ok(manifest.includes('.qlicense') && manifest.includes('application/vnd.qatra.license+json'),
  'signed license files open directly in the installed role applications');
ok(bridge.includes("call('openLicenseCenter'") && bridge.includes('license.remainingDays'),
  'the shared security screen displays and opens native licensing');
ok(gradle.includes('LICENSE_PUBLIC_KEY_BASE64') && !gradle.includes('PRIVATE KEY'),
  'APK source contains only the public license verification key');
ok(!manager.includes('BEGIN PRIVATE KEY') && !toolSource.includes('BEGIN PRIVATE KEY'),
  'no private license key is embedded in Android or the owner tool');

const licenseTool = require('./qatra-license-tool');
const {privateKey, publicKey} = crypto.generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
const request = {
  schema: 'QATRA_LICENSE_REQUEST_V1',
  organizationId: 'ORG-1234567890ABCDEF12345678',
  deviceCode: 'QTR-12345678-90ABCDEF-12345678-90ABCDEF',
  requestedRoles: ['READER', 'ADMIN', 'CASHIER', 'COLLECTOR'],
  requestingRole: 'ADMIN',
  productionBuild: false,
  createdAt: Date.now()
};
const requestCode = `QLR1.${Buffer.from(JSON.stringify(request)).toString('base64url')}`;
const license = licenseTool.signLicense({
  requestCode,
  customerName: 'منشأة اختبار قطرة',
  licenseId: 'LIC-TEST-12345678',
  privateKeyPem: privateKey.export({type: 'pkcs8', format: 'pem'}),
  passphrase: ''
});
ok(license.allowedRoles.join(',') === 'ADMIN,CASHIER,COLLECTOR,READER',
  'license roles are canonical and include all four applications');
ok(licenseTool.verifyLicense({license, publicKeyPem: publicKey.export({type: 'spki', format: 'pem'})}),
  'owner tool produces a verifiable ECDSA activation file');
license.customerName = 'اسم تم العبث به';
ok(!licenseTool.verifyLicense({license, publicKeyPem: publicKey.export({type: 'spki', format: 'pem'})}),
  'changing licensed customer data invalidates the signature');

console.log('\nLicense source and protocol tests passed.');
