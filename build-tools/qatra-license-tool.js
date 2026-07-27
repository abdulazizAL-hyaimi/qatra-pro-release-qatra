#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LICENSE_SCHEMA = 'QATRA_LICENSE_V1';
const REQUEST_SCHEMA = 'QATRA_LICENSE_REQUEST_V1';
const ALL_ROLES = ['ADMIN', 'READER', 'COLLECTOR', 'CASHIER'];

function fail(message) { throw new Error(message); }
function clean(value) { return String(value ?? '').trim(); }
function base64urlEncode(value) { return Buffer.from(value).toString('base64url'); }
function base64urlDecode(value) { return Buffer.from(value, 'base64url').toString('utf8'); }

function parseRequest(value) {
  const raw = clean(value);
  if (!raw.startsWith('QLR1.')) fail('طلب التفعيل يجب أن يبدأ بـ QLR1.');
  let request;
  try { request = JSON.parse(base64urlDecode(raw.slice(5))); }
  catch (_) { fail('طلب التفعيل غير صالح أو تالف'); }
  if (request.schema !== REQUEST_SCHEMA) fail('إصدار طلب التفعيل غير مدعوم');
  if (!/^ORG-[A-Z0-9]{16,40}$/.test(clean(request.organizationId))) fail('هوية المنشأة غير صالحة');
  if (!/^QTR-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/.test(clean(request.deviceCode))) fail('رمز الجهاز غير صالح');
  const requestedRoles = [...new Set((request.requestedRoles || []).map(clean))].sort();
  if (!requestedRoles.length || requestedRoles.some(role => !ALL_ROLES.includes(role))) fail('صلاحيات التطبيقات المطلوبة غير صالحة');
  return {...request, requestedRoles};
}

function canonicalLicense(license) {
  const roles = [...new Set((license.allowedRoles || []).map(clean))].sort();
  return [
    LICENSE_SCHEMA,
    clean(license.licenseId),
    clean(license.organizationId),
    clean(license.customerName),
    clean(license.deviceCode).toUpperCase(),
    roles.join(','),
    String(Boolean(license.perpetual)),
    String(Number(license.issuedAt))
  ].join('\n');
}

function signLicense({requestCode, customerName, licenseId, privateKeyPem, passphrase, issuedAt = Date.now()}) {
  const request = parseRequest(requestCode);
  const customer = clean(customerName);
  if (customer.length < 2 || customer.length > 120) fail('اسم العميل يجب أن يكون بين 2 و120 محرفًا');
  const id = clean(licenseId).toUpperCase();
  if (!/^LIC-[A-Z0-9-]{8,64}$/.test(id)) fail('رقم الرخصة يجب أن يبدأ بـ LIC- ويحتوي أحرفًا وأرقامًا وشرطات');
  const license = {
    schema: LICENSE_SCHEMA,
    licenseId: id,
    organizationId: clean(request.organizationId),
    customerName: customer,
    deviceCode: clean(request.deviceCode).toUpperCase(),
    allowedRoles: request.requestedRoles,
    perpetual: true,
    issuedAt: Number(issuedAt)
  };
  const signature = crypto.sign('sha256', Buffer.from(canonicalLicense(license), 'utf8'), {
    key: privateKeyPem,
    passphrase: clean(passphrase)
  });
  license.signature = signature.toString('base64url');
  return license;
}

function verifyLicense({license, publicKeyPem}) {
  if (!license || license.schema !== LICENSE_SCHEMA) return false;
  return crypto.verify(
    'sha256',
    Buffer.from(canonicalLicense(license), 'utf8'),
    publicKeyPem,
    Buffer.from(clean(license.signature), 'base64url')
  );
}

function args(argv) {
  const output = {_: []};
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (!value.startsWith('--')) output._.push(value);
    else {
      const key = value.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) output[key] = true;
      else { output[key] = next; i++; }
    }
  }
  return output;
}

function requestValue(options) {
  if (options.request) return clean(options.request);
  if (options['request-file']) return clean(fs.readFileSync(path.resolve(options['request-file']), 'utf8'));
  fail('استخدم --request أو --request-file');
}

function pemPublicKeyFromBase64(value) {
  const lines = clean(value).match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}

function main(argv = process.argv.slice(2)) {
  const options = args(argv);
  const command = options._[0];
  if (command === 'sign') {
    const privateKeyPath = path.resolve(clean(options['private-key']));
    if (!clean(options['private-key'])) fail('استخدم --private-key لمسار المفتاح الخاص المشفّر');
    const passphrase = process.env.QATRA_LICENSE_KEY_PASSWORD;
    if (!passphrase) fail('عيّن QATRA_LICENSE_KEY_PASSWORD في بيئة آمنة قبل التوقيع');
    const licenseId = clean(options['license-id']) || `LIC-${new Date().toISOString().slice(0,10).replace(/-/g, '')}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const license = signLicense({
      requestCode: requestValue(options),
      customerName: options.customer,
      licenseId,
      privateKeyPem: fs.readFileSync(privateKeyPath, 'utf8'),
      passphrase
    });
    const outPath = path.resolve(clean(options.out) || `qatra-${license.licenseId.toLowerCase()}.qlicense`);
    fs.writeFileSync(outPath, `${JSON.stringify(license, null, 2)}\n`, {mode: 0o600});
    process.stdout.write(`تم إنشاء ملف التفعيل: ${outPath}\nرقم الرخصة: ${license.licenseId}\n`);
    return license;
  }
  if (command === 'verify') {
    if (!options.license) fail('استخدم --license لمسار ملف التفعيل');
    const license = JSON.parse(fs.readFileSync(path.resolve(options.license), 'utf8'));
    let publicKeyPem;
    if (options['public-key']) publicKeyPem = fs.readFileSync(path.resolve(options['public-key']), 'utf8');
    else if (options['public-key-base64']) publicKeyPem = pemPublicKeyFromBase64(options['public-key-base64']);
    else fail('استخدم --public-key أو --public-key-base64');
    if (!verifyLicense({license, publicKeyPem})) fail('توقيع ملف التفعيل غير صحيح');
    process.stdout.write(`صحيح: ${license.licenseId} — ${license.customerName}\n`);
    return true;
  }
  process.stdout.write(
    'Qatra Pro offline license tool\n\n' +
    'Sign:   QATRA_LICENSE_KEY_PASSWORD=... node build-tools/qatra-license-tool.js sign --private-key /secure/qatra-license-signing-private-encrypted.pem --request "QLR1..." --customer "اسم المنشأة" --out customer.qlicense\n' +
    'Verify: node build-tools/qatra-license-tool.js verify --license customer.qlicense --public-key /secure/qatra-license-signing-public.pem\n'
  );
  return null;
}

if (require.main === module) {
  try { main(); }
  catch (error) { process.stderr.write(`خطأ: ${error.message}\n`); process.exitCode = 1; }
}

module.exports = {parseRequest, canonicalLicense, signLicense, verifyLicense, main};
