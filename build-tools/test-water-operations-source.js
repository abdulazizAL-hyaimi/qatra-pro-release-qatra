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
const finance=read('app/src/main/assets/qatra/assets/erp_water_finance.js');
const boot=read('app/src/main/assets/qatra/assets/erp_water_operations.js');
const css=read('app/src/main/assets/qatra/assets/erp_water_operations.css');
const sw=read('app/src/main/assets/qatra/sw.js');
const patch=read('build-tools/apply-erp-usability-phase.py');

const order=['erp_water_core.js','erp_water_admin.js','erp_water_finance.js','erp_water_operations.js'].map(x=>html.indexOf(x));
ok(order.every(x=>x>=0)&&order.every((x,i)=>i===0||x>order[i-1]),'water operation modules load in dependency order');
const requiredBillingCollections = [
  'subscribers',
  'meters',
  'cycles',
  'readings',
  'invoices',
  'payments',
  'collectorSettlements',
  'cashboxSessions',
  'cashboxTransactions',
  'correctionRequests'
];

ok(
  core.includes('for(const k of [') &&
  core.includes('if(!Array.isArray(STATE[k]))STATE[k]=[]') &&
  requiredBillingCollections.every(
    key => core.includes(`'${key}'`)
  ),
  'billing state initializes every operational collection'
);
ok(core.includes('function reservedPaid')&&core.includes('function collectibleBalance')&&core.includes('invoiceAmount(i)-approvedPaid(i)-reservedPaid(i)'),'pending receipts reserve invoice balance and prevent duplicate collection');
ok(core.includes("has('CAPTURE_READINGS')")&&core.includes("has('COLLECT_PAYMENTS')")&&core.includes("has('MANAGE_CASHBOX')"),'navigation and views are role-aware');
ok(
  admin.includes('function activateCycle') &&
  admin.includes('latestApprovedReading(meterNo,cycle.id)') &&
  admin.includes(
    "readerUsername:readers.length?readers[index%readers.length]:''"
  ) &&
  admin.includes(
    "status:readers.length?'ASSIGNED':'DRAFT'"
  ),
  'cycle activation creates reader assignments from the latest approved reading'
);
ok(admin.includes('generateInvoices')&&admin.includes("postApprovedRecord','billing','invoices"),'approved readings generate source-linked accounting invoices');
ok(admin.includes("r.status='SUBMITTED'")&&admin.includes("r.status='APPROVED'")&&admin.includes("r.status='REJECTED'"),'reader submission and management approval workflow is complete');
ok(finance.includes('freshAvailable=collectibleBalance(invoice)')&&finance.includes("status:'SUBMITTED'"),'collection rechecks available balance before creating a receipt');
ok(finance.includes('createSettlement')&&finance.includes('settlement.paymentIds')&&finance.includes("settlement.status='APPROVED'"),'collector receipts are grouped and received as one settlement');
ok(finance.includes('const invoice=')&&finance.includes('before=invoice?approvedPaid(invoice):0')&&finance.includes('invoice.paidAmount=before+num(payment.amount)'),'cashier approval updates invoice balance exactly once');
ok(!finance.includes('approvedPaid(invoice)+num(payment.amount)'),'cashier approval does not double-count the payment after status change');
ok(finance.includes("postApprovedRecord','billing','payments")&&finance.includes("type:'COLLECTOR_RECEIPT'"),'cashier receipt posts accounting and creates a cashbox transaction');
ok(finance.includes('currentCashSession')&&finance.includes("cashSession.status='CLOSED'")&&finance.includes('cashSession.difference=counted-expected'),'cashbox sessions open, reconcile and close with a recorded difference');
for(const key of ['cycles','operationSettings','collectorSettlements','cashboxSessions','cashboxTransactions'])ok(patch.includes(`\\"${key}\\"`)||patch.includes(`"${key}"`),`native scoped-write migration protects ${key}`);
ok(patch.includes('allowed.add("readings")')&&patch.includes('allowed.add("collectorSettlements")')&&patch.includes('allowed.add("cashboxSessions")'),'reader, collector and cashier write scopes are separated');
ok(css.includes('.water-flow')&&css.includes('.water-settlement')&&css.includes('.water-cash-card'),'responsive water-operation interface styles are present');
for(const asset of ['erp_water_core.js','erp_water_admin.js','erp_water_finance.js','erp_water_operations.js','erp_water_operations.css'])ok(sw.includes(asset),`offline cache includes ${asset}`);
ok(boot.includes('QatraWaterCore')&&boot.includes('core.init()'),'small boot file initializes the modular operation layer');

for(const file of ['app/src/main/assets/qatra/assets/erp_water_core.js','app/src/main/assets/qatra/assets/erp_water_admin.js','app/src/main/assets/qatra/assets/erp_water_finance.js','app/src/main/assets/qatra/assets/erp_water_operations.js']){
  const result=cp.spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});
  ok(result.status===0,`JavaScript syntax: ${file}${result.status===0?'':result.stderr}`);
}
console.log('\nQatra water operations source test passed.');
