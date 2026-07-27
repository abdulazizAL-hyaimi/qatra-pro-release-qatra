#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'app/src/main/java/com/qatra/pro/QatraErpDocumentService.java'
value = PATH.read_text(encoding='utf-8')

if 'import android.annotation.SuppressLint;' not in value:
    value = value.replace('package com.qatra.pro;\n\n',
                          'package com.qatra.pro;\n\nimport android.annotation.SuppressLint;\n', 1)
if '@SuppressLint("MissingPermission")\n    public JSONObject listPairedPrinters' not in value:
    value = value.replace('    public JSONObject listPairedPrinters() throws Exception {',
                          '    @SuppressLint("MissingPermission")\n    public JSONObject listPairedPrinters() throws Exception {', 1)
if '@SuppressLint("MissingPermission")\n    public JSONObject printThermal' not in value:
    value = value.replace('    public JSONObject printThermal(String address, int widthMm, JSONObject document,',
                          '    @SuppressLint("MissingPermission")\n    public JSONObject printThermal(String address, int widthMm, JSONObject document,', 1)
if 'MAX_VERIFICATION_URI_CHARS' not in value:
    value = value.replace(
        '    private static final int MAX_THERMAL_JSON_BYTES = 80_000;\n',
        '    private static final int MAX_THERMAL_JSON_BYTES = 80_000;\n'
        '    private static final int MAX_VERIFICATION_URI_CHARS = 12_000;\n'
        '    private static final int MAX_VERIFICATION_PAYLOAD_BYTES = 4_096;\n',
        1)
verify_marker = '''        if (verificationUri == null || verificationUri.trim().isEmpty()) {
            throw new IllegalArgumentException("رمز التحقق مطلوب");
        }
'''
verify_hardened = '''        if (verificationUri == null || verificationUri.trim().isEmpty()) {
            throw new IllegalArgumentException("رمز التحقق مطلوب");
        }
        if (verificationUri.length() > MAX_VERIFICATION_URI_CHARS) {
            throw new SecurityException("رابط التحقق أكبر من الحد المسموح");
        }
'''
if verify_marker in value and verify_hardened not in value:
    value = value.replace(verify_marker, verify_hardened, 1)
payload_marker = '''        byte[] payloadBytes = Base64.decode(encoded, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        byte[] expected = hmac(payloadBytes);
'''
payload_hardened = '''        byte[] payloadBytes = Base64.decode(encoded, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        if (payloadBytes.length == 0 || payloadBytes.length > MAX_VERIFICATION_PAYLOAD_BYTES) {
            throw new SecurityException("حمولة رمز التحقق غير صالحة");
        }
        byte[] expected = hmac(payloadBytes);
'''
if payload_marker in value and payload_hardened not in value:
    value = value.replace(payload_marker, payload_hardened, 1)

detail_marker = '''        out.put("subscriberId", first(source, "subscriberId", "accountNo"));
        out.put("cycleId", first(source, "cycleId", "cycleNo"));
        out.put("issuer", installationIssuer());
'''
detail_hardened = '''        out.put("subscriberId", first(source, "subscriberId", "accountNo"));
        out.put("cycleId", first(source, "cycleId", "cycleNo"));
        out.put("detailsHash", detailsHash(type, source));
        out.put("issuer", installationIssuer());
'''
if detail_marker in value and detail_hardened not in value:
    value = value.replace(detail_marker, detail_hardened, 1)

if 'private static String detailsHash(String type, JSONObject source)' not in value:
    marker = '    private static String fingerprint(JSONObject payload) throws Exception {\n'
    method = '''    private static String detailsHash(String type, JSONObject source) throws Exception {
        String details;
        if ("invoice".equals(type)) {
            details = first(source, "meterNo") + "|" + first(source, "readingId") + "|"
                    + money(firstNumber(source, "previous")) + "|"
                    + money(firstNumber(source, "current")) + "|"
                    + money(firstNumber(source, "consumption")) + "|"
                    + money(firstNumber(source, "unitPrice")) + "|"
                    + money(firstNumber(source, "fixedFee"));
        } else if ("payment".equals(type)) {
            details = first(source, "invoiceId", "invoiceNo") + "|"
                    + first(source, "method") + "|"
                    + first(source, "collectorUserId", "collectorUsername");
        } else {
            JSONArray paymentIds = source.optJSONArray("paymentIds");
            details = first(source, "collectorUserId", "collectorUsername") + "|"
                    + first(source, "paymentCount") + "|"
                    + (paymentIds == null ? "" : paymentIds.toString());
        }
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        return toHex(digest.digest(details.getBytes(StandardCharsets.UTF_8)));
    }

'''
    if marker not in value:
        raise RuntimeError('fingerprint marker is missing')
    value = value.replace(marker, method + marker, 1)

fingerprint_old = '''                + payload.optString("date") + "|" + payload.optString("subscriberId") + "|"
                + payload.optString("cycleId");
'''
fingerprint_new = '''                + payload.optString("date") + "|" + payload.optString("subscriberId") + "|"
                + payload.optString("cycleId") + "|" + payload.optString("detailsHash");
'''
if fingerprint_old in value:
    value = value.replace(fingerprint_old, fingerprint_new, 1)
value = value.replace('                adapter.cancelDiscovery();\n', '')
value = value.replace('        int height = 160 + count * lineHeight + qrSpace + 100;\n',
                      '        int height = 220 + count * lineHeight * 2 + qrSpace + 140;\n')
value = value.replace('        return Bitmap.createBitmap(bitmap, 0, 0, width, Math.min(bitmap.getHeight(), y + 55));\n',
                      '        return bitmap;\n')
secure_connect = '''                socket = device.createRfcommSocketToServiceRecord(SPP_UUID);\n                socket.connect();\n'''
fallback_connect = '''                socket = device.createRfcommSocketToServiceRecord(SPP_UUID);\n                try {\n                    socket.connect();\n                } catch (Exception secureError) {\n                    try { socket.close(); } catch (Exception ignored) { }\n                    socket = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);\n                    socket.connect();\n                }\n'''
if secure_connect in value:
    value = value.replace(secure_connect, fallback_connect, 1)
PATH.write_text(value, encoding='utf-8')
print('Qatra ERP document service hardened for signed document details, QR limits and Bluetooth printing.')
