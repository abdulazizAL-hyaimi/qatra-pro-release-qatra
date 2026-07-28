'use strict';
const fs=require('fs');
const path=require('path');
const cp=require('child_process');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function ok(v,m){if(!v)throw new Error(m);console.log('OK  '+m)}

const html=read('app/src/main/assets/qatra/erp.html');
const core=read('app/src/main/assets/qatra/assets/erp_water_core.js');
const admin=read('app/src/main/assets/qatra/assets/erp_water_admin.js');
const controls=read('app/src/main/assets/qatra/assets/erp_water_controls.js');
const sw=read('app/src/main/assets/qatra/sw.js');

const order=['erp_water_core.js','erp_water_admin.js','erp_water_controls.js','erp_water_operations.js'].map(x=>html.indexOf(x));
ok(order.every(x=>x>=0)&&order.every((x,i)=>i===0||x>order[i-1]),'control module loads after admin and before operation bootstrap');
ok(core.includes('function addHistory')&&core.includes('record.history.length>100'),'record history is bounded and stored with the protected entity');
ok(core.includes('function assertCycleOpen')&&core.includes("['CLOSED','ARCHIVED']"),'closed and archived cycles reject later changes');
ok(admin.includes('function cycleReadiness')&&admin.includes('missingInvoices')&&admin.includes('draftInvoices')&&admin.includes('postingFailures'),'cycle closure checks readings, invoices and accounting posting results');
ok(admin.includes('closureSnapshot')&&admin.includes("addHistory(cycle,'CYCLE_CLOSED'"),'safe closure stores an immutable operational snapshot and event');
ok(admin.includes("addHistory(r,'READING_SUBMITTED'")&&admin.includes("'READING_APPROVED':'READING_REJECTED'"),'reading submission and review decisions are recorded');
const invoiceCreatedHistory =
  admin.includes("addHistory(invoice,'INVOICE_CREATED'") ||
  admin.includes("addHistory(inv,'INVOICE_CREATED'");

const invoicePostingFailureHistory =
  admin.includes("addHistory(invoice,'INVOICE_POSTING_FAILED'") ||
  admin.includes("addHistory(inv,'INVOICE_POSTING_FAILED'");

ok(
  invoiceCreatedHistory &&
  invoicePostingFailureHistory &&
  admin.includes('postingError'),
  'invoice creation and posting failures are recorded'
);
ok(controls.includes('function integrityFindings')&&controls.includes('تتجاوز قيمتها')&&controls.includes('لا يطابق سنداته'),'control center detects overcollection and settlement mismatches');
ok(controls.includes("register('controls','الرقابة والإقفال',canManage"),'control center is restricted to billing management');
ok(sw.includes('erp_water_controls.js')&&sw.includes('qatra-pro-cache-v2919'),'offline cache includes the new control center');

for(const file of ['app/src/main/assets/qatra/assets/erp_water_core.js','app/src/main/assets/qatra/assets/erp_water_admin.js','app/src/main/assets/qatra/assets/erp_water_controls.js']){
 const result=cp.spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});
 ok(result.status===0,`JavaScript syntax: ${file}${result.status===0?'':result.stderr}`);
}
console.log('\nQatra water controls source test passed.');
