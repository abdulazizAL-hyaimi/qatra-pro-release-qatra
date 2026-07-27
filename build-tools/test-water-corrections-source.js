#!/usr/bin/env node
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const expect=(condition,message)=>{if(!condition)throw new Error(message)};

const db=read('app/src/main/java/com/qatra/pro/QatraDatabase.java');
const posting=read('app/src/main/java/com/qatra/pro/QatraErpPostingService.java');
const activity=read('app/src/main/java/com/qatra/pro/UnifiedMainActivity.java');
const core=read('app/src/main/assets/qatra/assets/erp_water_core.js');
const admin=read('app/src/main/assets/qatra/assets/erp_water_admin.js');
const corrections=read('app/src/main/assets/qatra/assets/erp_water_corrections.js');
const controls=read('app/src/main/assets/qatra/assets/erp_water_controls.js');
const html=read('app/src/main/assets/qatra/erp.html');
const sw=read('app/src/main/assets/qatra/sw.js');
const generator=read('build-tools/apply-erp-usability-phase.py');
const shellGenerator=read('build-tools/apply-unified-erp-shell.py');
const workflow=read('.github/workflows/build-unified-erp.yml');

expect(db.includes('public synchronized void saveStates(Map<String, String> states)'),'atomic multi-namespace save is missing');
expect(db.includes('db.beginTransaction()')&&db.includes('STATE_SAVED_ATOMIC'),'atomic correction audit is missing');
expect(db.includes('"correctionRequests"'),'correction request SQLite indexing is missing');

expect(posting.includes('decideBillingCorrection('),'native correction decision service is missing');
expect(posting.includes('لا يجوز لمقدم طلب التصحيح اعتماد طلبه أو رفضه'),'maker-checker separation is missing');
expect(posting.includes('reverseJournal(accounting, "BILLING", "invoices"'),'invoice reversal is missing');
expect(posting.includes('reverseJournal(accounting, "BILLING", "payments"'),'payment reversal is missing');
expect(posting.includes('firstNumber(sourceLine, "credit")')&&posting.includes('firstNumber(sourceLine, "debit")'),'reversal lines do not swap debit and credit');
expect(posting.includes('"AUTO_JOURNAL_REVERSED"'),'accounting reversal audit is missing');
expect(posting.includes('database.saveStates(states)'),'accounting and billing are not saved atomically');
expect(posting.includes('"PAYMENT_REVERSAL"')&&posting.includes('-firstNumber(payment, "amount")'),'cashbox reversal adjustment is missing');
expect(!/\.remove\([^)]*invoice|\.remove\([^)]*payment/.test(posting),'financial source documents must not be deleted');

expect(activity.includes('requirePermission(QatraUnifiedUserStore.P_APPROVE_ACCOUNTING);'),'accounting approval permission is missing');
expect(activity.includes('postingService.decideBillingCorrection'),'correction bridge is missing');
expect(activity.includes('"correctionRequests"'),'correction requests are not protected by native write scoping');
expect(generator.includes('"correctionRequests"'),'generated native scope does not preserve correction protection');
expect(shellGenerator.includes('decideBillingCorrection'),'generated unified bridge does not preserve correction approval');

expect(core.includes("'correctionRequests'"),'correction state initialization is missing');
expect(core.includes("['CANCELLED','REVERSED'].includes"),'reversed invoices are still counted as collectible');
expect(corrections.includes("register('corrections','التصحيحات والإلغاءات'"),'correction screen is not registered');
expect(corrections.includes("canManage()||canReview()"),'correction screen role split is missing');
expect(corrections.includes("call('decideBillingCorrection'"),'review actions do not use the native decision boundary');
expect(corrections.includes("يوجد طلب تصحيح معلق لهذا المستند"),'duplicate pending request guard is missing');
expect(corrections.includes("يلزم مراجع آخر"),'independent reviewer guidance is missing');
expect(admin.includes("['CANCELLED','REVERSED']"),'rebilling after a governed reversal is blocked');
expect(controls.includes("['طلب التصحيح',s.correctionRequests||[]]"),'correction events are absent from the control center');

const correctionScript=html.indexOf('erp_water_corrections.js');
const documentScript=html.indexOf('erp_water_documents.js');
expect(correctionScript>0&&correctionScript<documentScript,'correction module load order is invalid');
expect(sw.includes('qatra-pro-cache-v2920')&&sw.includes('erp_water_corrections.js'),'offline cache is not updated for corrections');
expect(workflow.includes('test-water-corrections-source.js'),'correction source gate is missing from workflow');

console.log('Water correction and reversal source checks passed.');
