'use strict';

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const state = {
  meta: {},
  settings: {
    projectName: 'مياه الاختبار',
    currencyShort: 'ر.ي',
    generalSmsTemplate: 'SMS::{name}::{subscriberCode}',
    generalWhatsappTemplate: 'WA::{name}::{meterNo}',
    invoiceSmsTemplate: 'INV-SMS::{invoiceNo}',
    invoiceWhatsappTemplate: 'INV-WA::{invoiceNo}',
    bulkDefaultChannel: 'sms',
    bulkDefaultMode: 'personalized',
    bulkDefaultTemplateKind: 'general'
  },
  subscribers: [{id:'S1',code:'001',name:'أحمد',meterNo:'M-7',phone:'777000111',area:'تعز',status:'active'}],
  invoices: [{id:'I1',no:'INV-77',subscriberId:'S1',date:'2026-07-22'}],
  messageLog: []
};

const elements = {
  '#bulkChannel': {value:'sms'},
  '#bulkTemplateKind': {value:'general'},
  '#bulkSendMode': {value:'personalized'}
};
let uid=0,saveCount=0;
const document = {querySelector(selector){return elements[selector]||null;},body:{dataset:{}}};
const sandbox = {
  console,document,sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
  setTimeout(){return 1;},clearTimeout(){},alert(){},confirm(){return true;},
  YWP:{
    state,uid(prefix){return `${prefix}-${++uid}`;},save(){saveCount++;},
    esc(value){return String(value??'');},money(value){return String(value);},balance(){return 25;},
    normalizePhone(phone){return String(phone||'').replace(/\D/g,'');},
    smsText(invoice,channel){return `${channel==='whatsapp'?'INV-WA':'INV-SMS'}::${invoice.no}`;},
    openSms(){},openWhatsApp(){},exportCSV(){}
  }
};
sandbox.window=sandbox;sandbox.window.addEventListener=()=>{};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('app/src/main/assets/qatra/assets/bulk_messages.js','utf8'),sandbox,{filename:'bulk_messages.js'});

const messages=sandbox.QatraBulkMessages;
assert(messages,'يجب تحميل مركز الرسائل الموحد');
assert.strictEqual(messages.__test.templateFor('sms','general'),'SMS::{name}::{subscriberCode}','SMS must use its saved general template');
assert.strictEqual(messages.__test.templateFor('whatsapp','general'),'WA::{name}::{meterNo}','WhatsApp must use its saved general template');
assert.strictEqual(messages.__test.personalizedText(state.subscribers[0],'sms','general'),'SMS::أحمد::001','general template fields must be personalized');
assert.strictEqual(messages.__test.personalizedText(state.subscribers[0],'whatsapp','invoice'),'INV-WA::INV-77','invoice mode must use the saved WhatsApp invoice template path');

const bulkSource=fs.readFileSync('app/src/main/assets/qatra/assets/bulk_messages.js','utf8');
assert.doesNotMatch(bulkSource,/id="bulkMessageTemplate"|<textarea/i,'the messaging center must not expose an editable message body');
for(const token of ['bulkChannel','bulkTemplateKind','bulkSendMode','bulkInvoiceFrom','messageHistoryFrom','messageHistoryQuery','كشف الرسائل المرسلة والفاشلة','failureReason'])assert.ok(bulkSource.includes(token),`messaging behavior must include ${token}`);

const appSource=fs.readFileSync('app/src/main/assets/qatra/assets/app.js','utf8');
assert.ok(appSource.indexOf('invoice-money-grid')<appSource.indexOf('invoice-card-actions'),'invoice actions must follow subscriber, invoice and account information');
assert.match(appSource,/report-org-identity[\s\S]{0,900}report-org-seal/,'printed reports must use the professional organization masthead');
assert.match(appSource,/\.print-page-a4>\.qatra-print-brand\{position:fixed/,'A4 marketing identity must be fixed in the physical footer');
assert.match(appSource,/\.print-page-a5 \.a5 \.qatra-print-brand\{position:absolute/,'each A5 document must place marketing identity at its own footer');
assert.doesNotMatch(appSource,/if\(!state\.settings\.messageTemplatesV13\)\{\s*state\.settings\.invoiceSmsTemplate\s*=/,'migration must not overwrite a saved invoice template');

const cashierSource=fs.readFileSync('app/src/main/assets/qatra/assets/cashier.js','utf8');
assert.match(cashierSource,/\.receipt>\.qatra-print-brand\{position:absolute/,'cashier A5 receipt brand must be anchored to the paper footer');
assert.match(cashierSource,/printHtml',`سند \$\{x\.receiptNo\|\|x\.id\}`,html,'A5L'/,'cashier paper receipt must request A5 landscape');
assert.doesNotMatch(cashierSource,/onclick="Cashier\.(?:printThermalById|exportDailyXlsx)/,'cashier UI must not expose thermal or Excel actions');
const collectorSource=fs.readFileSync('app/src/main/assets/qatra/assets/collector.js','utf8');
assert.match(collectorSource,/\.qatra-print-brand\{position:absolute;right:3mm;left:3mm;bottom:2mm/,'collector A5 receipt brand must be anchored to the paper footer');
const managerCollectorSource=fs.readFileSync('app/src/main/assets/qatra/assets/manager_collectors.js','utf8');
assert.match(managerCollectorSource,/\.qatra-print-brand\{position:fixed;right:8mm;left:8mm;bottom:2mm/,'manager collector reports must keep the brand in the A4 footer');

const reportSandbox={
  console,document:{querySelector(){return null;},body:{}},App:{},YWP:{},
  MutationObserver:class{observe(){}},setTimeout(){return 1;},clearTimeout(){}
};
reportSandbox.window=reportSandbox;reportSandbox.window.addEventListener=()=>{};
vm.createContext(reportSandbox);
vm.runInContext(fs.readFileSync('app/src/main/assets/qatra/assets/report_ui.js','utf8'),reportSandbox,{filename:'report_ui.js'});
let removed=0;
const current={querySelectorAll(){return [{remove(){}},{remove(){removed++;}},{remove(){removed++;}}];}};
assert.strictEqual(reportSandbox.QatraReportUI.__test.dedupeOrgHeaders(current),1,'one report organization header must remain');
assert.strictEqual(removed,2,'duplicate report logos must be removed at runtime');

const reportCustomization=fs.readFileSync('app/src/main/assets/qatra/assets/report_customization.js','utf8');
const reportCustomizationCss=fs.readFileSync('app/src/main/assets/qatra/assets/report_customization.css','utf8');
const reportLogoCleanup=fs.readFileSync('app/src/main/assets/qatra/assets/report_logo_cleanup.js','utf8');
const readingImportHandoff=fs.readFileSync('app/src/main/assets/qatra/assets/reading_import_handoff.js','utf8');
const readerCycleHandoff=fs.readFileSync('app/src/main/assets/qatra/assets/reader_cycle_handoff.js','utf8');
const mobileHtml=fs.readFileSync('app/src/main/assets/qatra/mobile.html','utf8');
for(const token of ['reportHeaderRightLine1','reportHeaderCenterLine1','reportHeaderLeftLine1','reportHeaderLogoPosition','reportHeaderAccentColor','reportBrandWatermarkOpacity','مصمم ترويسة الكشوفات والتقارير'])assert.ok(reportCustomization.includes(token),`report header designer must persist ${token}`);
assert.ok(reportCustomization.includes("reportHeaderLogoPosition:'hidden'")&&reportCustomization.includes('reportLogosRemovedV2913'),'existing and new reports must default to a text-only masthead without the two large logos');
assert.ok(reportCustomization.includes("querySelectorAll('.org-header,.report-org-header,.v13-doc-header')"),'customization must remove the legacy v13 logo block');
assert.ok(reportCustomization.includes('position:fixed!important;left:4mm!important;bottom:3mm!important'),'printed Qatra watermark must repeat at the lower-left of physical report pages');
assert.ok(reportCustomization.includes('report-brand-sentinel')&&reportCustomization.includes('enhancePrintBody'),'custom reports must suppress the old centered footer brand');
assert.ok(reportCustomizationCss.includes('.qatra-report-watermark')&&reportCustomizationCss.includes('left:10px')&&reportCustomizationCss.includes('bottom:7px'),'report preview must show the brand watermark at the lower-left');
assert.ok(reportLogoCleanup.includes('.v13-doc-header')&&reportLogoCleanup.includes('removeLegacyIdentity'),'report sanitizer must remove both legacy organization headers and the old centered v13 logo/title block');
assert.ok(mobileHtml.includes('assets/report_customization.css')&&mobileHtml.includes('assets/report_customization.js')&&mobileHtml.includes('assets/report_logo_cleanup.js'),'administration must load report customization and identity cleanup assets');

for(const token of ['سجل تدقيق','رقم العداد','القراءة الحالية','validateReadingFile','spreadsheetSignature'])assert.ok(readingImportHandoff.includes(token),`reading import preflight must include ${token}`);
assert.ok(readingImportHandoff.indexOf('validateReadingFile(await spreadsheetSignature(file))')<readingImportHandoff.indexOf("if(wasClosed)cycle.status='open'"),'invalid Excel files must be rejected before a closed cycle is temporarily opened');
for(const token of ['createAndDistribute','ManagerReader.autoSplit','إنشاء الدورة التالية وتوزيعها تلقائيًا','sourceCycleId'])assert.ok(readerCycleHandoff.includes(token),`reader cycle handoff must include ${token}`);

const readerAssignment=fs.readFileSync('app/src/main/assets/qatra/assets/manager_reader_latest_reading.js','utf8');
for(const token of ['assignmentsByCycle','savedAtByCycle','توزيع تلقائي لغير المقروءين وحفظه','updateAssignment','cleanupCompleted'])assert.ok(readerAssignment.includes(token),`reader distribution must include ${token}`);
assert.match(readerAssignment,/pending\.forEach\(subscriber=>[\s\S]{0,700}counts\[reader\.id\]\+\+/,'automatic distribution must balance only pending unread subscribers');

assert(saveCount===0,'template resolution must not mutate persisted settings');
console.log('Message templates, one-logo report cleanup, Excel reading preflight and next-cycle reader handoff tests passed.');
