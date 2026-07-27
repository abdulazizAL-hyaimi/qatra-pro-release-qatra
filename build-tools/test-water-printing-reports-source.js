'use strict';
const fs=require('fs');
const path=require('path');
const cp=require('child_process');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function ok(value,message){if(!value)throw new Error(message);console.log('OK  '+message)}

const html=read('app/src/main/assets/qatra/erp.html');
const docs=read('app/src/main/assets/qatra/assets/erp_water_documents.js');
const center=read('app/src/main/assets/qatra/assets/erp_water_document_center.js');
const reports=read('app/src/main/assets/qatra/assets/erp_water_reports.js');
const css=read('app/src/main/assets/qatra/assets/erp_water_print.css');
const service=read('app/src/main/java/com/qatra/pro/QatraErpDocumentService.java');
const manifest=read('app/src/unified/AndroidManifest.xml');
const patch=read('build-tools/apply-water-printing-reports.py');
const sw=read('app/src/main/assets/qatra/sw.js');

ok(html.indexOf('erp_water_core.js')<html.indexOf('erp_water_documents.js')&&html.indexOf('erp_water_documents.js')<html.indexOf('erp_water_operations.js'),'document and report modules load after the water core and before boot');
ok(html.includes('erp_water_document_center.js')&&html.includes('erp_water_reports.js')&&html.includes('erp_water_print.css'),'ERP shell loads document center, reports and print styles');
ok(docs.includes('@page{size:A5 landscape')&&docs.includes('width:18mm')&&docs.includes('width:17mm'),'A5 documents keep an 18mm preview and 17mm print QR');
ok(docs.includes("printA5('invoice'")||docs.includes('function printA5(type,id)'),'invoice, receipt and settlement A5 printing is implemented');
ok(docs.includes("type==='settlement'")&&docs.includes('سند التوريد يطبع A5 فقط'),'collector settlement remains A5-only');
ok(docs.includes("r.has('COLLECTOR')")&&!docs.includes("r.has('CASHIER')||"),'thermal printing is exposed to collector/admin roles and not cashier-only accounts');
ok(docs.includes('createDocumentVerification')&&docs.includes('verifyDocumentQr')&&docs.includes('qatra://verify'),'document QR generation and verification UI are connected');
ok(center.includes("register('documents'")&&center.includes('s.invoices.map')&&center.includes('s.payments.map')&&center.includes('s.collectorSettlements.map')&&center.includes('data-doc-a5="${x.type}"'),'document center dynamically reprints historical invoices, receipts and settlements');
ok(center.includes('function canOpenCenter()')&&center.includes("if(canCash())return type==='payment'||type==='settlement'")&&center.includes("if(canCollect())return type==='invoice'"),'document center hides financial records from readers and scopes collector/cashier visibility');
ok(!/phone|address/.test(service.slice(service.indexOf('private JSONObject publicPayload'),service.indexOf('private JSONObject findCurrentRecord'))),'signed QR payload excludes phone and address');
ok(service.includes('AndroidKeyStore')&&service.includes('HmacSHA256')&&service.includes('MessageDigest.isEqual'),'QR verification uses Keystore HMAC and constant-time signature comparison');
ok(service.includes('MAX_VERIFICATION_URI_CHARS')&&service.includes('MAX_VERIFICATION_PAYLOAD_BYTES'),'QR verification rejects oversized links and decoded payloads');
ok(service.includes('detailsHash')&&service.includes('paymentIds')&&service.includes('collectorUserId')&&service.includes('readingId'),'QR fingerprint binds invoice, payment and settlement operational details');
ok(service.includes('findCurrentRecord')&&service.includes('matchesCurrent'),'verification compares signed fields with current SQLite data');
ok(service.includes('PrintManager')&&service.includes('ISO_A5.asLandscape()')&&service.includes('createPrintDocumentAdapter'),'A5 output uses Android Print Framework');
ok(service.includes('BluetoothSocket')&&service.includes('BLUETOOTH_CONNECT')&&service.includes('writeRaster'),'thermal output uses permission-gated Bluetooth ESC/POS raster printing');
ok(service.includes('createInsecureRfcommSocketToServiceRecord')&&service.includes('createRfcommSocketToServiceRecord'),'paired thermal printers have secure and compatible RFCOMM connection paths');
ok(service.includes('renderThermalBitmap')&&service.includes('qrBitmap'),'thermal receipt is rasterized with Arabic text and QR');
ok(manifest.includes('android:scheme="qatra"')&&manifest.includes('android:host="verify"')&&manifest.includes('android:exported="true"'),'unified flavor accepts Qatra verification deep links');
ok(patch.includes('requireThermalPrintAccess')&&patch.includes('ROLE_CASHIER')===false&&patch.includes('ROLE_COLLECTOR'),'native bridge preserves the no-thermal cashier policy');
ok(patch.includes('createDocumentVerification')&&patch.includes('printErpHtml')&&patch.includes('printThermalDocument')&&patch.includes('getPendingVerification'),'generated bridge exposes verification, A5 and thermal operations');
ok(reports.includes('readerReport')&&reports.includes('collectorReport')&&reports.includes('cashboxReport')&&reports.includes('cyclesReport'),'all requested operational performance reports exist');
ok(reports.includes('نسبة الإنجاز')&&reports.includes('قيد التوريد')&&reports.includes('صافي الفروقات')&&reports.includes('الرصيد القائم'),'reports expose reader, collector, cashbox and cycle KPIs');
ok(css.includes('.verification-result')&&css.includes('.performance-table')&&css.includes('.report-controls'),'verification and report layouts are responsive');
for(const asset of ['erp_water_documents.js','erp_water_document_center.js','erp_water_reports.js','erp_water_print.css'])ok(sw.includes(`'assets/${asset}'`),`offline cache contains ${asset}`);

for(const file of ['app/src/main/assets/qatra/assets/erp_water_documents.js','app/src/main/assets/qatra/assets/erp_water_document_center.js','app/src/main/assets/qatra/assets/erp_water_reports.js']){
  const result=cp.spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});
  ok(result.status===0,`JavaScript syntax: ${file}${result.status===0?'':result.stderr}`);
}
console.log('\nQatra ERP water printing and reports source test passed.');
