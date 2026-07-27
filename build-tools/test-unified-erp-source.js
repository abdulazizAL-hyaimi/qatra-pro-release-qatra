'use strict';
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function ok(v,m){if(!v)throw new Error(m);console.log('OK  '+m)}

const gradle=read('app/build.gradle');
const manifest=read('app/src/main/AndroidManifest.xml');
const main=read('app/src/main/java/com/qatra/pro/MainActivity.java');
const unified=read('app/src/main/java/com/qatra/pro/UnifiedMainActivity.java');
const users=read('app/src/main/java/com/qatra/pro/QatraUnifiedUserStore.java');
const migration=read('app/src/main/java/com/qatra/pro/QatraErpMigration.java');
const posting=read('app/src/main/java/com/qatra/pro/QatraErpPostingService.java');
const policy=read('app/src/main/java/com/qatra/pro/QatraNamespacePolicy.java');
const html=read('app/src/main/assets/qatra/erp.html');
const css=read('app/src/main/assets/qatra/assets/erp.css');
const js=read('app/src/main/assets/qatra/assets/erp.js');
const migrationJs=read('app/src/main/assets/qatra/assets/erp_migration.js');
const sw=read('app/src/main/assets/qatra/sw.js');

ok(gradle.includes('unified {')&&gradle.includes("applicationId 'com.meyah.rawdah.erp'")&&gradle.includes('assembleUnifiedDebug')===false,'unified flavor is declared independently from build tasks');
ok(manifest.includes('.UnifiedMainActivity')&&manifest.includes('com.meyah.rawdah.erp')&&manifest.includes('.qerp'),'manifest registers unified activity, package visibility and ERP files');
ok(main.includes('"UNIFIED".equals(APP_ROLE)')&&main.includes('UnifiedMainActivity.class'),'launcher redirects only the unified flavor to the ERP activity');
ok((main.match(/if \("UNIFIED"\.equals\(APP_ROLE\)\)/g)||[]).length===1,'unified launcher redirect is not duplicated');
ok(policy.includes('public static final String UNIFIED')&&policy.includes('ERP_PRIMARY')&&policy.includes('ERP_MIGRATION')&&policy.includes('erp.accounting')&&policy.includes('erp.procurement'),'namespace policy recognizes unified ERP and migration data');
ok(users.includes('PBKDF2WithHmacSHA256')&&users.includes('PBKDF2WithHmacSHA1')&&!users.includes('password TEXT'),'passwords use salted PBKDF2 verifiers and are never stored as text');
ok(users.includes('must_change_password')&&users.includes('resetPassword')&&users.includes('changeOwnPassword'),'temporary password, forced change, reset and self-service change are implemented');
ok(users.includes('erp_user_roles')&&users.includes('erp_user_permissions')&&users.includes('DEFAULT_ROLE_PERMISSIONS'),'multi-role RBAC and permission overrides are persisted');
ok(users.includes('permissionOverridesJson')&&users.includes('permissionOverrides'),'effective user records expose explicit permission exceptions');
ok(users.includes('USER_ARCHIVED')&&users.includes('USER_DELETED_UNUSED'),'used users are archived while unused accounts may be deleted');
ok(unified.includes('requireNamespace(namespace, true)')&&unified.includes('WRITE_PERMISSION_BY_NAMESPACE'),'native bridge enforces write permissions by module namespace');
ok(unified.includes('listUsers')&&unified.includes('resetUserPassword')&&unified.includes('deleteUser'),'unified bridge exposes governed user administration');
ok(unified.includes('previewLegacyMigration')&&unified.includes('commitLegacyMigration')&&unified.includes('restoreLegacyMigrationSnapshot'),'unified native bridge governs preview, commit and source restore');
ok(unified.includes('postingService = new QatraErpPostingService(database)')&&unified.includes('postApprovedRecord')&&unified.includes('validateAccountingBalance'),'unified native activity initializes and exposes authorized accounting posting');
for(const method of ['previewLegacyMigration','commitLegacyMigration','restoreLegacyMigrationSnapshot','postApprovedRecord','validateAccountingBalance']){
  ok((unified.match(new RegExp(`public String ${method}\\(`,'g'))||[]).length===1,`${method} bridge method is declared exactly once`);
}
ok((unified.match(/private QatraErpMigration migration;/g)||[]).length===1,'migration service field is declared exactly once');
ok((unified.match(/private QatraErpPostingService postingService;/g)||[]).length===1,'posting service field is declared exactly once');
ok(!/\n{3,}/.test(unified)&&!/\n{3,}/.test(main),'generated Android integration has stable whitespace');
ok(migration.includes('IN_PROGRESS')&&migration.includes('lastCommittedSourceHash')&&migration.includes('sourceIdentity'),'legacy migration is staged, idempotent and source-traceable');
ok(migration.includes('snapshot')&&migration.includes('restoreLastSnapshot'),'legacy source snapshot is saved before migration and can be restored');
ok(migration.includes('erp.billing')&&migration.includes('erp.procurement')&&migration.includes('erp.inventory')&&migration.includes('erp.hr'),'legacy data maps into the principal ERP modules');
ok(posting.includes('postingIndex')&&posting.includes('sourceKey')&&posting.includes('duplicate'),'automatic journals are source-linked and idempotent');
ok(posting.includes('ذمم المشتركين')&&posting.includes('ذمم الموردين')&&posting.includes('رواتب مستحقة')&&posting.includes('مجمع الإهلاك'),'posting rules cover billing, suppliers, payroll and depreciation');
ok(posting.includes('lines.put(line')&&posting.includes('validateBalance'),'automatic journals are double-entry and expose balance validation');
ok(html.includes('Qatra ERP')&&html.includes('erpNav')&&html.includes('erpModal')&&html.includes('erp_migration.js'),'unified ERP shell and migration UI are present');
for(const module of ['billing','accounting','procurement','inventory','assets','hr','maintenance','documents'])ok(js.includes(`${module}:`)||js.includes(`['${module}'`),`${module} module is registered`);
ok(js.includes("if(r.status!=='DRAFT')throw new Error('الحذف مسموح للمسودة فقط')")&&js.includes("r.status='APPROVED'"),'workflow blocks deletion after submission and supports approval');
ok(js.includes("call('postApprovedRecord'")&&js.includes('تعذر إنشاء القيد المحاسبي'),'approval workflow requires successful automatic posting');
ok(js.includes('permissionOverrideEditor')&&js.includes('readPermissionOverrides')&&js.includes('حسب الدور')&&js.includes('منع لهذا المستخدم'),'user editor supports inherit, grant and deny permission exceptions');
ok((js.match(/function permissionOverrideEditor\(/g)||[]).length===1,'permission override editor is not duplicated');
ok(js.includes('MANAGE_USERS')&&js.includes('changeOwnPassword')&&js.includes('resetUserPassword'),'user and password controls are visible in the ERP UI');
ok(migrationJs.includes('previewLegacyMigration')&&migrationJs.includes('commitLegacyMigration')&&migrationJs.includes('restoreLegacyMigrationSnapshot'),'migration UI exposes review, commit and restore actions');
ok(css.includes('.erp-sidebar')&&css.includes('@media(max-width:760px)'),'ERP design supports desktop and mobile layouts');
ok(sw.includes("'erp.html'")&&sw.includes("'assets/erp.js'")&&sw.includes("'assets/erp.css'")&&sw.includes("'assets/erp_migration.js'"),'offline asset list includes the unified ERP shell and migration UI');
for(const file of ['app/src/main/assets/qatra/assets/erp.js','app/src/main/assets/qatra/assets/erp_migration.js']){
  const cp=require('child_process').spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});
  ok(cp.status===0,`JavaScript syntax: ${file}${cp.status===0?'':cp.stderr}`);
}
console.log('\nUnified Qatra ERP source test passed.');
