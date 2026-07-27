#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, value):
    (ROOT / path).write_text(value, encoding='utf-8')


def unified_redirect_block():
    return '''        if ("UNIFIED".equals(APP_ROLE)) {
            Intent unified = new Intent(this, UnifiedMainActivity.class);
            Intent source = getIntent();
            if (source != null) {
                unified.setAction(source.getAction());
                unified.setData(source.getData());
                unified.setType(source.getType());
                unified.setClipData(source.getClipData());
                if (source.getExtras() != null) unified.putExtras(source.getExtras());
                unified.addFlags(source.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
            }
            startActivity(unified);
            finish();
            return;
        }
'''


def migration_methods_block():
    return '''        @JavascriptInterface public String previewLegacyMigration() {
            try {
                requirePermission(QatraUnifiedUserStore.P_MANAGE_SETTINGS);
                return migration.preview().toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String commitLegacyMigration() {
            try {
                requirePermission(QatraUnifiedUserStore.P_MANAGE_SETTINGS);
                return migration.commit(session.userId).toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String restoreLegacyMigrationSnapshot() {
            try {
                requirePermission(QatraUnifiedUserStore.P_MANAGE_SETTINGS);
                return migration.restoreLastSnapshot(session.userId).toString();
            } catch (Exception error) { return errorJson(error); }
        }

'''


def posting_methods_block():
    return '''        @JavascriptInterface public String postApprovedRecord(
                String module, String entity, String recordJson) {
            try {
                String normalized = module == null ? "" : module.trim().toUpperCase(Locale.ROOT);
                if ("BILLING".equals(normalized)) {
                    if ("payments".equals(entity)) {
                        requireAnyPermission(QatraUnifiedUserStore.P_MANAGE_BILLING,
                                QatraUnifiedUserStore.P_COLLECT_PAYMENTS,
                                QatraUnifiedUserStore.P_MANAGE_CASHBOX);
                    } else requirePermission(QatraUnifiedUserStore.P_MANAGE_BILLING);
                }
                else if ("PROCUREMENT".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_PROCUREMENT);
                else if ("INVENTORY".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_INVENTORY);
                else if ("ASSETS".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_MANAGE_ASSETS);
                else if ("HR".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_PAYROLL);
                else if ("MAINTENANCE".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_MAINTENANCE);
                else if ("ACCOUNTING".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_ACCOUNTING);
                else throw new SecurityException("الوحدة غير معتمدة للترحيل المحاسبي");
                return postingService.post(normalized, entity,
                        new JSONObject(recordJson == null ? "{}" : recordJson), session).toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String approveErpRecord(
                String module, String entity, String recordJson, String moduleStateJson) {
            try {
                String normalized = module == null ? "" : module.trim().toUpperCase(Locale.ROOT);
                if ("BILLING".equals(normalized)) {
                    if ("payments".equals(entity)) {
                        requireAnyPermission(QatraUnifiedUserStore.P_MANAGE_BILLING,
                                QatraUnifiedUserStore.P_COLLECT_PAYMENTS,
                                QatraUnifiedUserStore.P_MANAGE_CASHBOX);
                    } else requirePermission(QatraUnifiedUserStore.P_MANAGE_BILLING);
                }
                else if ("PROCUREMENT".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_PROCUREMENT);
                else if ("INVENTORY".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_INVENTORY);
                else if ("ASSETS".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_MANAGE_ASSETS);
                else if ("HR".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_PAYROLL);
                else if ("MAINTENANCE".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_MAINTENANCE);
                else if ("ACCOUNTING".equals(normalized)) requirePermission(QatraUnifiedUserStore.P_APPROVE_ACCOUNTING);
                else throw new SecurityException("الوحدة غير معتمدة للاعتماد المترابط");
                return postingService.approveAndPost(normalized, entity,
                        new JSONObject(recordJson == null ? "{}" : recordJson),
                        new JSONObject(moduleStateJson == null ? "{}" : moduleStateJson),
                        session).toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String decideBillingCorrection(
                String requestId, String decision, String reviewNotes) {
            try {
                requirePermission(QatraUnifiedUserStore.P_APPROVE_ACCOUNTING);
                return postingService.decideBillingCorrection(requestId, decision,
                        reviewNotes, session).toString();
            } catch (Exception error) { return errorJson(error); }
        }

        @JavascriptInterface public String validateAccountingBalance() {
            try {
                requirePermission(QatraUnifiedUserStore.P_VIEW_REPORTS);
                return postingService.validateBalance().toString();
            } catch (Exception error) { return errorJson(error); }
        }

'''


def patch_main_activity():
    path = 'app/src/main/java/com/qatra/pro/MainActivity.java'
    value = read(path)
    block = unified_redirect_block()
    # Canonicalize the generated redirect to exactly one block.
    value = value.replace(block, '')
    marker = '''    protected void onCreate(Bundle b) {
        super.onCreate(b);
'''
    if marker not in value:
        raise RuntimeError('MainActivity onCreate marker is missing')
    value = value.replace(marker, marker + block, 1)
    write(path, value)


def patch_namespace_policy():
    value = read('app/src/main/java/com/qatra/pro/QatraNamespacePolicy.java')
    required = (
        'public static final String UNIFIED = "UNIFIED";',
        'public static final String ERP_MIGRATION = "erp.migration";',
        'allowed.put(UNIFIED',
        'portable.put(UNIFIED',
    )
    if not all(token in value for token in required):
        raise RuntimeError('Unified namespace policy must be maintained explicitly')


def patch_user_store():
    path = 'app/src/main/java/com/qatra/pro/QatraUnifiedUserStore.java'
    value = read(path)
    old = '''        Set<String> roles = rolesFor(db, id);
        out.put("roles", new JSONArray(roles));
        if (includePermissions) out.put("permissions", new JSONArray(permissionsFor(db, id, roles)));
        return out;
'''
    new = '''        Set<String> roles = rolesFor(db, id);
        out.put("roles", new JSONArray(roles));
        out.put("permissionOverrides", permissionOverridesJson(db, id));
        if (includePermissions) out.put("permissions", new JSONArray(permissionsFor(db, id, roles)));
        return out;
'''
    if new not in value:
        if old not in value:
            raise RuntimeError('user JSON permission marker is missing')
        value = value.replace(old, new, 1)
    if 'private static JSONArray permissionOverridesJson' not in value:
        marker = '''    private void updatePassword(String userId, String password, boolean forceChange) throws Exception {
'''
        method = '''    private static JSONArray permissionOverridesJson(SQLiteDatabase db, String id) throws Exception {
        JSONArray rows = new JSONArray();
        try (Cursor c = db.rawQuery(
                "SELECT permission_code,granted FROM erp_user_permissions WHERE user_id=? ORDER BY permission_code",
                new String[]{id})) {
            while (c.moveToNext()) {
                JSONObject row = new JSONObject();
                row.put("permission", c.getString(0));
                row.put("granted", c.getInt(1) == 1);
                rows.put(row);
            }
        }
        return rows;
    }

'''
        if marker not in value:
            raise RuntimeError('user store password marker is missing')
        value = value.replace(marker, method + marker, 1)
    write(path, value)


def remove_bridge_method(value, name, signature_tail=''):
    if name == 'postApprovedRecord':
        pattern = (r'\n        @JavascriptInterface public String postApprovedRecord\(\s*'
                   r'String module, String entity, String recordJson\) \{.*?\n        \}\n')
    elif name == 'approveErpRecord':
        pattern = (r'\n        @JavascriptInterface public String approveErpRecord\(\s*'
                   r'String module, String entity, String recordJson, String moduleStateJson\) '
                   r'\{.*?\n        \}\n')
    elif name == 'decideBillingCorrection':
        pattern = (r'\n        @JavascriptInterface public String decideBillingCorrection\(\s*'
                   r'String requestId, String decision, String reviewNotes\) \{.*?\n        \}\n')
    else:
        pattern = (r'\n        @JavascriptInterface public String ' + re.escape(name)
                   + r'\(' + signature_tail + r'\) \{.*?\n        \}\n')
    return re.sub(pattern, '\n', value, flags=re.S)


def patch_unified_activity():
    path = 'app/src/main/java/com/qatra/pro/UnifiedMainActivity.java'
    value = read(path)

    # Canonicalize generated service fields.
    value = re.sub(r'^    private QatraErpMigration migration;\n', '', value, flags=re.M)
    value = re.sub(r'^    private QatraErpPostingService postingService;\n', '', value, flags=re.M)
    field_marker = '    private QatraUnifiedUserStore users;\n'
    if field_marker not in value:
        raise RuntimeError('Unified activity user-store field is missing')
    value = value.replace(field_marker, field_marker
            + '    private QatraErpMigration migration;\n'
            + '    private QatraErpPostingService postingService;\n', 1)

    # Canonicalize generated service initialization.
    value = re.sub(r'^        migration = new QatraErpMigration\(database\);\n', '', value, flags=re.M)
    value = re.sub(r'^        postingService = new QatraErpPostingService\(database\);\n', '', value, flags=re.M)
    init_marker = '        users = new QatraUnifiedUserStore(getApplicationContext());\n'
    if init_marker not in value:
        raise RuntimeError('Unified activity user-store initialization is missing')
    value = value.replace(init_marker, init_marker
            + '        migration = new QatraErpMigration(database);\n'
            + '        postingService = new QatraErpPostingService(database);\n', 1)

    # Remove every generated bridge copy, then insert one canonical set before logout.
    for name in ('previewLegacyMigration', 'commitLegacyMigration',
                 'restoreLegacyMigrationSnapshot', 'validateAccountingBalance'):
        value = remove_bridge_method(value, name)
    value = remove_bridge_method(value, 'postApprovedRecord')
    value = remove_bridge_method(value, 'approveErpRecord')
    value = remove_bridge_method(value, 'decideBillingCorrection')

    logout_marker = '''        @JavascriptInterface public String logout() {
'''
    if logout_marker not in value:
        raise RuntimeError('Unified bridge logout marker is missing')
    value = value.replace(logout_marker,
            migration_methods_block() + posting_methods_block() + logout_marker, 1)
    write(path, value)


def permission_labels_js():
    return """const PERMISSION_LABELS={MANAGE_USERS:'إدارة المستخدمين',MANAGE_SECURITY:'إعادة كلمات المرور والأمان',VIEW_DASHBOARD:'عرض لوحة التحكم',MANAGE_BILLING:'إدارة المشتركين والفوترة',CAPTURE_READINGS:'إدخال القراءات',COLLECT_PAYMENTS:'تحصيل المدفوعات',MANAGE_CASHBOX:'إدارة الصندوق',MANAGE_ACCOUNTING:'إدارة المحاسبة',APPROVE_ACCOUNTING:'اعتماد القيود',MANAGE_PROCUREMENT:'إدارة المشتريات',APPROVE_PROCUREMENT:'اعتماد المشتريات',MANAGE_INVENTORY:'إدارة المخزون',APPROVE_INVENTORY:'اعتماد حركات المخزون',MANAGE_ASSETS:'إدارة الأصول',MANAGE_HR:'إدارة الموارد البشرية',APPROVE_PAYROLL:'اعتماد الرواتب',MANAGE_MAINTENANCE:'إدارة الصيانة',APPROVE_MAINTENANCE:'اعتماد الصيانة',VIEW_REPORTS:'عرض التقارير',EXPORT_DATA:'تصدير البيانات',VIEW_AUDIT:'عرض سجل التدقيق',MANAGE_SETTINGS:'إدارة إعدادات المؤسسة'};\n"""


def patch_erp_runtime():
    path = 'app/src/main/assets/qatra/assets/erp.js'
    value = read(path)
    if 'const PERMISSION_LABELS=' not in value:
        marker = "const ROLE_LABELS={SYSTEM_ADMIN:'مدير النظام',ADMIN:'الإدارة',ACCOUNTANT:'المحاسبة',READER:'الكاشف',COLLECTOR:'المحصل',CASHIER:'الصندوق',PROCUREMENT:'المشتريات',INVENTORY:'المخزون',HR:'الموارد البشرية',MAINTENANCE:'الصيانة',AUDITOR:'المراجعة'};\n"
        if marker not in value:
            raise RuntimeError('role label marker is missing')
        value = value.replace(marker, marker + permission_labels_js(), 1)

    old_approve = "if(action==='approve'){requireApproval(module);r.status='APPROVED';r.approvedAt=now();r.approvedBy=SESSION.userId}"
    new_approve = "if(action==='approve'){requireApproval(module);const posting=call('postApprovedRecord',module,entity,JSON.stringify({...r,status:'APPROVED'}));if(!posting.ok)throw new Error(posting.error||'تعذر إنشاء القيد المحاسبي');r.status='APPROVED';r.approvedAt=now();r.approvedBy=SESSION.userId;if(posting.posted)notice(posting.message||'تم إنشاء القيد المحاسبي','success')}"
    if "call('approveErpRecord'" not in value and new_approve not in value:
        if old_approve not in value:
            raise RuntimeError('ERP approval marker is missing')
        value = value.replace(old_approve, new_approve, 1)

    if 'function permissionOverrideEditor(' not in value:
        replacement = r'''function permissionOverrideEditor(user,roles){const current=new Map((user?.permissionOverrides||[]).map(x=>[x.permission,x.granted?'allow':'deny'])),permissions=[...new Set((roles||[]).flatMap(r=>r.permissions||[]))].sort();return`<div class="erp-permission-grid">${permissions.map(p=>`<div class="erp-field"><label>${esc(PERMISSION_LABELS[p]||p)}</label><select name="uPermission" data-permission="${esc(p)}"><option value="inherit" ${!current.has(p)?'selected':''}>حسب الدور</option><option value="allow" ${current.get(p)==='allow'?'selected':''}>سماح إضافي</option><option value="deny" ${current.get(p)==='deny'?'selected':''}>منع لهذا المستخدم</option></select></div>`).join('')}</div>`}
function readPermissionOverrides(){return[...document.querySelectorAll('select[name="uPermission"]')].filter(x=>x.value!=='inherit').map(x=>({permission:x.dataset.permission,granted:x.value==='allow'}))}
function showUserForm(user,roles){const selected=new Set(user?.roles||[]);openModal(user?'تعديل المستخدم':'إضافة مستخدم',`<div class="erp-form-grid"><div class="erp-field"><label>الاسم الكامل</label><input id="uName" value="${esc(user?.fullName||'')}"></div><div class="erp-field"><label>اسم المستخدم</label><input id="uUsername" dir="ltr" ${user?'disabled':''} value="${esc(user?.username||'')}"></div>${user?'':'<div class="erp-field full"><label>كلمة مرور مؤقتة</label><input id="uPassword" type="password" placeholder="8 محارف على الأقل وتتضمن حرفًا ورقمًا"></div>'}</div><h3>الأدوار</h3><div class="erp-permission-grid">${roles.map(r=>`<label class="erp-check"><input type="checkbox" name="uRole" value="${esc(r.code)}" ${selected.has(r.code)?'checked':''}> ${esc(r.label||ROLE_LABELS[r.code]||r.code)}</label>`).join('')}</div><h3>استثناءات الصلاحيات</h3><p>اتركها «حسب الدور» عادةً. السماح أو المنع هنا يتغلب على صلاحيات الدور لهذا المستخدم فقط.</p>${permissionOverrideEditor(user,roles)}<div class="erp-toolbar" style="margin-top:16px"><button class="erp-button success" id="saveUser">حفظ</button><button class="erp-button secondary" data-action="close-modal">إلغاء</button></div>`);$('#saveUser').onclick=()=>{const payload={id:user?.id,fullName:$('#uName').value,username:$('#uUsername').value,temporaryPassword:$('#uPassword')?.value||'',roles:[...document.querySelectorAll('input[name="uRole"]:checked')].map(x=>x.value),permissionOverrides:readPermissionOverrides()};const res=user?call('updateUser',JSON.stringify(payload)):call('createUser',JSON.stringify(payload));if(!res.ok){notice(res.error,'error');return}closeModal();renderUsers();notice(res.message||'تم حفظ المستخدم','success')}}
'''
        value, count = re.subn(r'function showUserForm\(user,roles\)\{.*?\}\nfunction userAction',
                               replacement + 'function userAction', value, count=1, flags=re.S)
        if count != 1:
            raise RuntimeError('user form function replacement failed')
    write(path, value)


def patch_service_worker():
    path = 'app/src/main/assets/qatra/sw.js'
    value = read(path)
    if "'erp.html'" not in value:
        value = value.replace("const ASSETS = [", "const ASSETS = ['erp.html','assets/erp.css','assets/erp.js','assets/erp_migration.js',", 1)
    elif "'assets/erp_migration.js'" not in value:
        value = value.replace("'assets/erp.js'", "'assets/erp.js','assets/erp_migration.js'", 1)
    write(path, value)


def main():
    patch_main_activity()
    patch_namespace_policy()
    patch_user_store()
    patch_unified_activity()
    patch_erp_runtime()
    patch_service_worker()
    print('Unified Qatra ERP integration canonicalized successfully.')


if __name__ == '__main__':
    main()
