'use strict';

const fs = require('fs');
const assert = require('assert');

const read = path => fs.readFileSync(path, 'utf8');
const manifest = read('app/src/main/AndroidManifest.xml');
const cashierManifest = read('app/src/cashier/AndroidManifest.xml');
const main = read('app/src/main/java/com/qatra/pro/MainActivity.java');
const crypto = read('app/src/main/java/com/qatra/pro/QatraCrypto.java');
const cashier = read('app/src/main/assets/qatra/assets/cashier.js');

for (const mime of [
  'application/vnd.qatra.admin+qsync',
  'application/vnd.qatra.reader+qsync',
  'application/vnd.qatra.collector+qsync',
  'application/vnd.qatra.cashier+qsync',
  'application/vnd.qatra.pairing+binary'
]) assert.ok(manifest.includes(mime), `missing universal MIME ${mime}`);

for (const extension of ['qadmin','qreader','qcollector','qcashier','qsync','qbackup','qconfirm','qpair','qlicense']) {
  assert.ok(manifest.includes(`.*\\.${extension}`), `missing Android open filter for .${extension}`);
}

for (const mime of [
  'application/octet-stream',
  'application/json',
  'text/json',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
  'application/binary',
  'application/x-binary',
  'application/x-download',
  'application/x-qatra-pro',
  'application/x-qbackup',
  'application/x-qsync'
]) {
  const count = manifest.split(`android:mimeType="${mime}"`).length - 1;
  assert.ok(count >= 2, `fallback MIME ${mime} must support both VIEW and SEND`);
}
assert.ok(manifest.includes('android:mimeType="*/*"'),
  'extension-aware VIEW routing must accept provider-specific MIME values');
assert.ok((manifest.match(/android\.intent\.category\.BROWSABLE/g) || []).length >= 3,
  'external document VIEW filters must be browsable');
assert.ok((manifest.match(/android\.intent\.category\.OPENABLE/g) || []).length >= 3,
  'file-manager VIEW filters must accept OPENABLE intents');
assert.ok((manifest.match(/android:priority="100"/g) || []).length === 2,
  'low-priority */* VIEW and SEND fallbacks must cover opaque file-manager MIME values');

for (const packageName of [
  'com.meyah.rawdah.system',
  'com.meyah.rawdah.reader',
  'com.meyah.rawdah.collector',
  'com.meyah.rawdah.cashier'
]) assert.ok(manifest.includes(`<package android:name="${packageName}"`),
  `Android package visibility missing for ${packageName}`);

assert.match(crypto, /public static String peekTargetRole\(byte\[] bytes\)/,
  'package target role must be readable without importing the payload');
assert.match(main, /QatraCrypto\.peekTargetRole\(bytes\)/,
  'incoming files must be routed from their package header');
assert.match(main, /QatraCrypto\.isRecognizedPackage\(bytes\)/,
  'generic file-manager intents must be rejected unless the Qatra envelope is recognized');
assert.match(main, /Intent\.ACTION_SEND_MULTIPLE/,
  'file-manager share intents may deliver their URI through ClipData');
for (const mapping of [
  'if("ADMIN".equals(role)) base = "com.meyah.rawdah.system"',
  'else if("READER".equals(role)) base = "com.meyah.rawdah.reader"',
  'else if("COLLECTOR".equals(role)) base = "com.meyah.rawdah.collector"',
  'else if("CASHIER".equals(role)) base = "com.meyah.rawdah.cashier"'
]) assert.ok(main.includes(mapping), `missing package router mapping ${mapping}`);
assert.ok(main.includes('getPackageName().endsWith(".debug") ? ".debug" : ""'),
  'router must address both debug and release package IDs');
assert.match(main, /setClipData\(ClipData\.newUri/,
  'forwarded content URI must preserve Android read permission');
assert.match(main, /FileProvider\.getUriForFile\(/,
  'routing must stage an app-owned URI instead of forwarding a fragile external grant');
assert.match(main, /new File\(getCacheDir\(\), "qatra-file-router"\)/,
  'routing cache must be scoped to the source app');

assert.match(main, /"CASHIER"\.equals\(APP_ROLE\) && isSpreadsheetExport/,
  'cashier native save boundary must reject spreadsheets');
assert.match(main, /@JavascriptInterface public void exportXlsx[\s\S]{0,260}"CASHIER"\.equals\(APP_ROLE\)/,
  'cashier native Excel bridge must be denied');
for (const method of ['printThermalReceipt','printThermalInvoice','printThermalTest']) {
  const start = main.indexOf(`public void ${method}`);
  assert.ok(start >= 0, `missing native method ${method}`);
  assert.ok(main.slice(start, start + 420).includes('"CASHIER".equals(APP_ROLE)'),
    `${method} must deny the cashier flavor`);
}
assert.match(cashierManifest, /android\.permission\.BLUETOOTH_CONNECT[\s\S]*tools:node="remove"/,
  'cashier APK must not request Bluetooth printer access');
assert.doesNotMatch(cashier, /onclick="Cashier\.(?:printThermalById|exportDailyXlsx)/,
  'cashier UI must not expose thermal or Excel controls');
assert.match(cashier, /printHtml',`سند \$\{x\.receiptNo\|\|x\.id\}`,html,'A5L'/,
  'cashier receipt must print on A5 landscape');
assert.match(main, /safeTitle\.trim\(\)\.startsWith\("سند"\)\) requested = "A5L"/,
  'native print layer must enforce A5 for cashier receipts');

console.log('Universal Qatra file routing, cashier permissions and A5 print policy source test passed.');
