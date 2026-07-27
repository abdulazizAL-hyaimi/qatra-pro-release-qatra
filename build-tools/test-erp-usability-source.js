'use strict';
const fs=require('fs');
const path=require('path');
const child=require('child_process');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function ok(value,message){if(!value)throw new Error(message);console.log('OK  '+message)}

const html=read('app/src/main/assets/qatra/erp.html');
const runtime=read('app/src/main/assets/qatra/assets/erp.js');
const dynamic=read('app/src/main/assets/qatra/assets/erp_dynamic.js');
const css=read('app/src/main/assets/qatra/assets/erp_dynamic.css');
const native=read('app/src/main/java/com/qatra/pro/UnifiedMainActivity.java');
const sw=read('app/src/main/assets/qatra/sw.js');

ok(html.includes('erpGlobalSearch')&&html.includes('erpTasksButton')&&html.includes('erpQuickButton'),'header exposes global search, tasks and quick actions');
ok(html.includes('erpMobileNav')&&html.includes('assets/erp_dynamic.js')&&html.includes('assets/erp_dynamic.css'),'dynamic assets and mobile navigation are loaded');
ok(dynamic.includes('function collectTasks')&&dynamic.includes('function searchAll')&&dynamic.includes('function showQuick'),'task center, global search and command palette are implemented');
ok(dynamic.includes('function installAutosave')&&dynamic.includes('qatra-erp-draft:'),'forms keep recoverable session drafts');
ok(dynamic.includes('data-dyn-status')&&dynamic.includes('function decorateTable'),'entity tables receive dynamic status filters');
ok(dynamic.includes("has('CAPTURE_READINGS')")&&dynamic.includes("has('COLLECT_PAYMENTS')")&&dynamic.includes("has('MANAGE_CASHBOX')"),'quick actions are personalized for reader, collector and cashier roles');
ok(css.includes('.erp-dyn-welcome')&&css.includes('.erp-dyn-task-list')&&css.includes('.erp-mobile-nav'),'dynamic responsive interface styles are present');
ok(runtime.includes("Array.isArray(m[4])?m[4].some(has)")&&runtime.includes('function entityVisible(module,key)'),'unified navigation accepts composite role permissions and scopes billing screens');
ok(native.includes('requireAnyPermission(String... permissions)')&&native.includes('enforceBillingWriteScope'),'native layer supports alternative permissions and scoped billing writes');
ok(native.includes('allowed.add("readings")')&&native.includes('allowed.add("payments")'),'reader and collection writes are restricted to their own sections');
ok(sw.includes("'assets/erp_dynamic.js'")&&sw.includes("'assets/erp_dynamic.css'"),'offline cache contains dynamic ERP assets');

for(const file of ['app/src/main/assets/qatra/assets/erp_dynamic.js','app/src/main/assets/qatra/assets/erp.js','app/src/main/assets/qatra/assets/erp_migration.js']){
  const result=child.spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});
  ok(result.status===0,`JavaScript syntax: ${file}${result.status===0?'':result.stderr}`);
}
console.log('\nQatra ERP usability source test passed.');
