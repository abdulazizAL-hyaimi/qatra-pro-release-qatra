#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, value):
    (ROOT / path).write_text(value, encoding='utf-8')


def patch_activity():
    path = 'app/src/main/java/com/qatra/pro/UnifiedMainActivity.java'
    value = read(path)

    field_marker = '    private QatraErpPostingService postingService;\n'
    fields = ('    private QatraErpDocumentService documentService;\n'
              '    private String pendingVerificationUri = "";\n')
    if fields not in value:
        if field_marker not in value:
            raise RuntimeError('posting service field marker is missing')
        value = value.replace(field_marker, field_marker + fields, 1)

    init_marker = '        postingService = new QatraErpPostingService(database);\n'
    init = ('        documentService = new QatraErpDocumentService(this, database);\n'
            '        captureVerificationIntent(getIntent());\n')
    if init not in value:
        if init_marker not in value:
            raise RuntimeError('posting service initialization marker is missing')
        value = value.replace(init_marker, init_marker + init, 1)

    intent_methods = '''    private void captureVerificationIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        android.net.Uri uri = intent.getData();
        if ("qatra".equalsIgnoreCase(uri.getScheme())
                && "verify".equalsIgnoreCase(uri.getHost())) {
            pendingVerificationUri = uri.toString();
        }
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureVerificationIntent(intent);
        if (session != null && webView != null && !pendingVerificationUri.isEmpty()) {
            webView.evaluateJavascript("window.QatraWaterDocuments&&window.QatraWaterDocuments.consumePendingVerification()", null);
        }
    }

    private void requireDocumentAccess() {
        requireAnyPermission(QatraUnifiedUserStore.P_MANAGE_BILLING,
                QatraUnifiedUserStore.P_CAPTURE_READINGS,
                QatraUnifiedUserStore.P_COLLECT_PAYMENTS,
                QatraUnifiedUserStore.P_MANAGE_CASHBOX,
                QatraUnifiedUserStore.P_VIEW_REPORTS);
    }

    private void requireThermalPrintAccess() {
        requireSession();
        boolean roleAllowed = session.roles.contains(QatraUnifiedUserStore.ROLE_SYSTEM_ADMIN)
                || session.roles.contains(QatraUnifiedUserStore.ROLE_ADMIN)
                || session.roles.contains(QatraUnifiedUserStore.ROLE_COLLECTOR);
        boolean permissionAllowed = session.has(QatraUnifiedUserStore.P_MANAGE_BILLING)
                || session.has(QatraUnifiedUserStore.P_COLLECT_PAYMENTS);
        if (!roleAllowed || !permissionAllowed) {
            throw new SecurityException("الطباعة الحرارية متاحة للإدارة والمحصل فقط؛ مستندات الصندوق تطبع A5");
        }
    }

'''
    if 'private void captureVerificationIntent(Intent intent)' not in value:
        marker = '    @Override protected void onStop() {\n'
        if marker not in value:
            raise RuntimeError('onStop marker is missing')
        value = value.replace(marker, intent_methods + marker, 1)

    bridge_methods = '''        @JavascriptInterface public String createDocumentVerification(
                String type, String recordJson) {
            try {
                requireDocumentAccess();
                return documentService.createVerification(type,
                        new JSONObject(recordJson == null ? "{}" : recordJson)).toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String verifyDocumentQr(String verificationUri) {
            try {
                requireDocumentAccess();
                return documentService.verify(verificationUri).toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String getPendingVerification() {
            try {
                requireDocumentAccess();
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("found", !pendingVerificationUri.isEmpty());
                out.put("uri", pendingVerificationUri);
                pendingVerificationUri = "";
                return out.toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String printErpHtml(String title, String html, String page) {
            try {
                requireDocumentAccess();
                return documentService.printHtml(title, html, page).toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String listThermalPrinters() {
            try {
                requireThermalPrintAccess();
                return documentService.listPairedPrinters().toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String printThermalDocument(String address, int widthMm,
                String documentJson, String verificationUri) {
            try {
                requireThermalPrintAccess();
                return documentService.printThermal(address, widthMm,
                        new JSONObject(documentJson == null ? "{}" : documentJson),
                        verificationUri).toString();
            } catch (Exception error) { return errorJson(error); }
        }

'''
    if '@JavascriptInterface public String createDocumentVerification(' not in value:
        marker = '        @JavascriptInterface public String logout() {\n'
        if marker not in value:
            raise RuntimeError('bridge logout marker is missing')
        value = value.replace(marker, bridge_methods + marker, 1)

    write(path, value)


def patch_document_service():
    path = 'app/src/main/java/com/qatra/pro/QatraErpDocumentService.java'
    value = read(path)
    value = value.replace('                adapter.cancelDiscovery();\n', '')
    value = value.replace(
        '        int height = 160 + count * lineHeight + qrSpace + 100;\n',
        '        int height = 220 + count * lineHeight * 2 + qrSpace + 140;\n')
    write(path, value)


def patch_service_worker():
    path = 'app/src/main/assets/qatra/sw.js'
    value = read(path)
    assets = [
        "'assets/erp_water_documents.js'",
        "'assets/erp_water_document_center.js'",
        "'assets/erp_water_reports.js'",
        "'assets/erp_water_print.css'",
    ]
    for asset in assets:
        if asset not in value:
            value = value.replace("'assets/erp_water_operations.js'",
                                  "'assets/erp_water_operations.js'," + asset, 1)
    write(path, value)


def main():
    patch_activity()
    patch_document_service()
    patch_service_worker()
    print('Qatra ERP document printing, thermal output and verification bridge applied.')


if __name__ == '__main__':
    main()
