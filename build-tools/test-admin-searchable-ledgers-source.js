'use strict';

const fs=require('fs');
const assert=require('assert');
const read=path=>fs.readFileSync(path,'utf8');

const app=read('app/src/main/assets/qatra/assets/app.js');
const messages=read('app/src/main/assets/qatra/assets/bulk_messages.js');
const design=read('app/src/main/assets/qatra/assets/design-v25.css');
const messageCss=read('app/src/main/assets/qatra/assets/bulk_messages.css');
const brand=read('app/src/main/assets/qatra/assets/qatra-brand.css');

for(const id of ['invoiceFilterFrom','invoiceFilterTo','invoiceFilterQuery','invoiceFilterStatus']){
  assert.ok(app.includes(id),`invoice ledger is missing ${id}`);
}
assert.match(app,/function filteredInvoices\(\)[\s\S]{0,900}s\.phone[\s\S]{0,200}s\.address/,
  'invoice search must cover phone and address alongside subscriber identity');
assert.ok(app.indexOf('invoice-money-grid')<app.indexOf('invoice-card-actions'),
  'invoice actions must render after invoice and account information');
assert.match(app,/function printUnpaidInvoices\(\)\{ const invs=filteredInvoices\(\)/,
  'invoice batch printing must honor the visible filter result');
assert.match(app,/const rows = filteredInvoices\(\)\.map/,
  'invoice export must honor the visible filter result');

for(const id of ['paySubscriberSearch','paymentAccountPreview','paymentFilterFrom','paymentFilterTo','paymentFilterQuery']){
  assert.ok(app.includes(id),`collection entry is missing ${id}`);
}
assert.match(app,/function filteredPayments\(\)[\s\S]{0,900}s\.phone[\s\S]{0,200}s\.address/,
  'receipt search must cover subscriber phone and address');
assert.match(app,/function refreshPaymentAccount\(\)/,
  'collection entry must show the selected subscriber account before saving');

for(const id of ['bulkInvoiceFrom','bulkInvoiceTo','messageHistoryFrom','messageHistoryTo','messageHistoryQuery','messageHistoryStatus','messageHistoryChannel']){
  assert.ok(messages.includes(id),`message center is missing ${id}`);
}
assert.match(messages,/function filteredHistory\(\)[\s\S]{0,1100}sub\.address/,
  'message history must search subscriber address and identity');
assert.match(messages,/latestInvoice\(s\)\?\.date/,
  'recipient selection must support a latest-invoice date range');

for(const cls of ['invoice-filter-panel','invoice-ledger-card','invoice-card-actions','payment-entry-grid','payment-account-card','report-org-seal']){
  assert.ok(design.includes(`.${cls}`),`shared responsive design is missing .${cls}`);
}
assert.ok(messageCss.includes('.message-history-filters')&&messageCss.includes('.message-history-search'),
  'message filters must have responsive presentation rules');
for(const role of ['role-admin','role-reader','role-collector','role-cashier']){
  assert.ok(brand.includes(`.${role}`),`unified palette is missing ${role}`);
}
assert.ok(app.includes('report-org-identity')&&app.includes('report-org-details')&&app.includes('report-org-seal'),
  'report organization header must expose identity, contact details and official seal');

console.log('Admin searchable invoices, messages, receipts, report masthead and role palette source test passed.');
