#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, value):
    (ROOT / path).write_text(value, encoding='utf-8')


def patch_runtime():
    path = 'app/src/main/assets/qatra/assets/erp.js'
    value = read(path)
    value = value.replace(
        "function visibleModule(m){return has(m[4])||m[0]==='dashboard'}",
        "function visibleModule(m){return (Array.isArray(m[4])?m[4].some(has):has(m[4]))||m[0]==='dashboard'}"
    )
    value = value.replace(
        "['billing','المشتركون والفوترة','العدادات والقراءات والفواتير والتحصيل','◫','MANAGE_BILLING'],",
        "['billing','المشتركون والفوترة','العدادات والقراءات والفواتير والتحصيل','◫',['MANAGE_BILLING','CAPTURE_READINGS','COLLECT_PAYMENTS','MANAGE_CASHBOX']],"
    )
    helper = "function entityVisible(module,key){if(module!=='billing'||has('MANAGE_BILLING'))return true;if(key==='readings')return has('CAPTURE_READINGS');if(key==='payments')return has('COLLECT_PAYMENTS')||has('MANAGE_CASHBOX');return false}\n"
    if 'function entityVisible(module,key)' not in value:
        value = value.replace('function renderModuleHome(module){\n', helper + 'function renderModuleHome(module){\n', 1)
    value = value.replace(
        'Object.entries(def.items).map(([key,e])=>',
        'Object.entries(def.items).filter(([key])=>entityVisible(module,key)).map(([key,e])=>'
    )
    write(path, value)


def helper_block():
    return '''    private void requireAnyPermission(String... permissions) {
        requireSession();
        for (String permission : permissions) {
            if (permission != null && session.has(permission)) return;
        }
        throw new SecurityException("لا تملك أيًا من الصلاحيات المطلوبة");
    }

    private JSONObject enforceBillingWriteScope(String namespace, JSONObject incoming) throws Exception {
        if (!"erp.billing".equals(namespace) || session.has(QatraUnifiedUserStore.P_MANAGE_BILLING)) {
            return incoming;
        }
        java.util.Set<String> allowed = new java.util.LinkedHashSet<>();
        if (session.has(QatraUnifiedUserStore.P_CAPTURE_READINGS)) {
            allowed.add("readings");
        }
        if (session.has(QatraUnifiedUserStore.P_COLLECT_PAYMENTS)) {
            allowed.add("payments");
            allowed.add("collectorSettlements");
        }
        if (session.has(QatraUnifiedUserStore.P_MANAGE_CASHBOX)) {
            allowed.add("payments");
            allowed.add("collectorSettlements");
            allowed.add("cashboxSessions");
            allowed.add("cashboxTransactions");
        }
        if (allowed.isEmpty()) throw new SecurityException("لا تملك صلاحية تعديل بيانات الفوترة");

        String currentText = database.getState(namespace);
        JSONObject current = currentText == null || currentText.trim().isEmpty()
                ? new JSONObject() : new JSONObject(currentText);
        String[] protectedKeys = {"subscribers", "meters", "cycles", "operationSettings",
                "readings", "invoices", "payments", "collectorSettlements",
                "cashboxSessions", "cashboxTransactions", "correctionRequests"};
        for (String key : protectedKeys) {
            if (allowed.contains(key)) continue;
            Object before = current.opt(key);
            Object after = incoming.opt(key);
            String beforeJson = before == null ? "" : String.valueOf(before);
            String afterJson = after == null ? "" : String.valueOf(after);
            if (!beforeJson.equals(afterJson)) {
                throw new SecurityException("لا تملك صلاحية تعديل قسم " + key);
            }
            if (current.has(key)) incoming.put(key, current.get(key)); else incoming.remove(key);
        }
        return incoming;
    }

'''


def patch_native():
    path = 'app/src/main/java/com/qatra/pro/UnifiedMainActivity.java'
    value = read(path)
    start = value.find('    private void requireAnyPermission(String... permissions) {')
    end = value.find('    private void requireNamespace(String namespace, boolean write) {')
    if start >= 0 and end > start:
        value = value[:start] + helper_block() + value[end:]
    elif end >= 0:
        value = value[:end] + helper_block() + value[end:]
    else:
        raise RuntimeError('requireNamespace marker is missing')

    namespace_pattern = re.compile(
        r'    private void requireNamespace\(String namespace, boolean write\) \{.*?\n    \}\n',
        re.S
    )
    namespace_body = '''    private void requireNamespace(String namespace, boolean write) {
        String clean = namespace == null ? "" : namespace.trim();
        if (write && "erp.billing".equals(clean)) {
            requireAnyPermission(QatraUnifiedUserStore.P_MANAGE_BILLING,
                    QatraUnifiedUserStore.P_CAPTURE_READINGS,
                    QatraUnifiedUserStore.P_COLLECT_PAYMENTS,
                    QatraUnifiedUserStore.P_MANAGE_CASHBOX);
            return;
        }
        String permission = (write ? WRITE_PERMISSION_BY_NAMESPACE : READ_PERMISSION_BY_NAMESPACE).get(clean);
        if (permission == null) throw new SecurityException("نطاق بيانات ERP غير معتمد");
        requirePermission(permission);
    }
'''
    value, count = namespace_pattern.subn(namespace_body, value, count=1)
    if count != 1:
        raise RuntimeError('requireNamespace body is missing')

    old_save = '                JSONObject payload = new JSONObject(payloadJson == null ? "{}" : payloadJson);\n                payload.put("lastModifiedBy", session.userId);\n'
    new_save = '                JSONObject payload = new JSONObject(payloadJson == null ? "{}" : payloadJson);\n                payload = enforceBillingWriteScope(namespace == null ? "" : namespace.trim(), payload);\n                payload.put("lastModifiedBy", session.userId);\n'
    if old_save in value:
        value = value.replace(old_save, new_save, 1)

    old_billing = '                if ("BILLING".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_MANAGE_BILLING);\n'
    new_billing = '''                if ("BILLING".equals(normalized)) {
                    if ("payments".equals(entity)) {
                        requireAnyPermission(QatraUnifiedUserStore.P_MANAGE_BILLING,
                                QatraUnifiedUserStore.P_COLLECT_PAYMENTS,
                                QatraUnifiedUserStore.P_MANAGE_CASHBOX);
                    } else requirePermission(QatraUnifiedUserStore.P_MANAGE_BILLING);
                }
'''
    if old_billing in value:
        value = value.replace(old_billing, new_billing, 1)
    write(path, value)


def patch_service_worker():
    path = 'app/src/main/assets/qatra/sw.js'
    value = read(path)
    assets = [
        "'assets/erp_dynamic.js'", "'assets/erp_dynamic.css'",
        "'assets/erp_water_operations.js'", "'assets/erp_water_operations.css'"
    ]
    for asset in assets:
        if asset not in value:
            value = value.replace("'assets/erp_migration.js'", "'assets/erp_migration.js'," + asset, 1)
    write(path, value)


def main():
    patch_runtime()
    patch_native()
    patch_service_worker()
    print('Qatra ERP usability, water operations and scoped role writes applied.')


if __name__ == '__main__':
    main()
