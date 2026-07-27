'use strict';

const fs = require('fs');
const assert = require('assert');

const read = path => fs.readFileSync(path, 'utf8');
const pages = ['mobile','enterprise','reader','collector','cashier','manager_users','manager_reader','manager_collectors','manager_cashbox'];
const design = read('app/src/main/assets/qatra/assets/design-v25.css');
const uxCss = read('app/src/main/assets/qatra/assets/ux-v26.css');
const uxJs = read('app/src/main/assets/qatra/assets/ux-v26.js');
const accountingCss = read('app/src/main/assets/qatra/assets/accounting.css');
const accountingJs = read('app/src/main/assets/qatra/assets/accounting.js');
const enterpriseCss = read('app/src/main/assets/qatra/assets/enterprise.css');
const enterpriseJs = read('app/src/main/assets/qatra/assets/enterprise.js');
const mobileHtml = read('app/src/main/assets/qatra/mobile.html');
const sw = read('app/src/main/assets/qatra/sw.js');

pages.forEach(name => {
  const html = read(`app/src/main/assets/qatra/${name}.html`);
  assert.match(html, /name="viewport"[^>]+width=device-width/, `${name}.html must use the device viewport`);
  assert.match(html, /assets\/design-v25\.css/, `${name}.html must load the shared responsive design`);
  assert.match(html, /assets\/ux-v26\.css/, `${name}.html must load the usability design layer`);
  assert.match(html, /assets\/ux-v26\.js/, `${name}.html must load the usability runtime layer`);
});

assert.match(design, /Qatra 2\.5\.5 universal phone fit/);
assert.match(design, /@media screen and \(max-width:600px\)/);
assert.match(design, /@media screen and \(max-width:380px\)/);
assert.match(design, /@media screen and \(max-width:330px\)/);
assert.match(design, /orientation:landscape/);
assert.match(design, /overflow-x:hidden/);
assert.match(design, /100dvh/);
assert.match(design, /env\(safe-area-inset/);
assert.match(design, /\.grid\.two,.grid\.three\{grid-template-columns:minmax\(0,1fr\)!important\}/);
assert.match(design, /\.reader-sheet,.collector-modal-sheet,.cashier-modal-sheet/);
assert.match(design, /\.table-wrap:not\(\.accounting-table-wrap\)\{overflow-x:auto!important/);

for (const token of ['qatra-context-bar','qatra-primary-action','qatra-sticky-actions','qatra-live-consumption','qatra-mobile-cards','qatra-field-error']) assert.ok(uxCss.includes(token), `UX CSS must include ${token}`);
assert.match(uxCss, /body\.role-reader[\s\S]{0,160}--ux-role/);
assert.match(uxCss, /body\.role-collector[\s\S]{0,160}--ux-role/);
assert.match(uxCss, /body\.role-cashier[\s\S]{0,160}--ux-role/);
assert.match(uxCss, /@media\(max-width:720px\)[\s\S]{0,4000}table\.qatra-mobile-cards/);

for (const token of ['ensureContextBar','decorateTable','validateInput','liveConsumptionForModal','liveConsumptionForAdmin','addProgressSummary']) assert.ok(uxJs.includes(token), `UX runtime must include ${token}`);
assert.match(uxJs, /cell\.dataset\.label=labels\[index\]/);
assert.match(uxJs, /current-previous/);
assert.doesNotMatch(uxJs, /localStorage|replaceAll/);

assert.match(accountingJs, /function decorateAccountingTables/);
assert.match(accountingJs, /cell\.dataset\.label=labels\[index\]/);
assert.match(accountingJs, /class="accounting-responsive-table"/);
assert.match(accountingJs, /decorateAccountingTables\(content\)/);
assert.match(accountingCss, /Phone-first accounting layout/);
assert.match(accountingCss, /\.accounting-responsive-table tbody td::before\{content:attr\(data-label\)/);
assert.match(accountingCss, /\.accounting-responsive-table thead\{position:absolute/);
assert.match(accountingCss, /@media screen and \(max-width:330px\)/);

assert.match(mobileHtml, /id="enterprise" class="tab enterprise-body"/, 'enterprise portal must be embedded inside the ADMIN page');
assert.match(mobileHtml, /App\.switchTab\('enterprise'\)/, 'ADMIN menu must open enterprise portal without native page navigation');
assert.match(mobileHtml, /id="enterpriseRoot"/, 'embedded enterprise portal must expose its render root');
assert.match(mobileHtml, /assets\/enterprise\.css/, 'ADMIN page must load enterprise design');
assert.match(mobileHtml, /assets\/enterprise\.js/, 'ADMIN page must load enterprise runtime');
assert.doesNotMatch(mobileHtml, /href="enterprise\.html"/, 'enterprise portal must not use a native-blocked local-page link');
for (const token of ['purchaseRequests','purchaseOrders','inventoryItems','stockMovements','assets','employees','payrollRuns','workOrders','approvals','audit']) assert.ok(enterpriseJs.includes(token), `enterprise state must include ${token}`);
for (const token of ['saveSupplier','savePurchaseRequest','savePurchaseOrder','saveInventoryItem','saveStockMovement','saveAsset','saveEmployee','createPayroll','saveWorkOrder','decideApproval']) assert.ok(enterpriseJs.includes(token), `enterprise runtime must include ${token}`);
assert.match(enterpriseJs, /QatraStore\.load\(NS,fresh\)/, 'enterprise data must load through SQLite bridge');
assert.match(enterpriseJs, /QatraStore\.save\(NS,state\)/, 'enterprise data must save through SQLite bridge');
assert.doesNotMatch(enterpriseJs, /localStorage|sessionStorage/, 'enterprise modules must not bypass SQLite');
assert.match(enterpriseCss, /enterprise-module-grid/);
assert.match(enterpriseCss, /@media\(max-width:800px\)/);
assert.match(sw, /enterprise\.html/);
assert.match(sw, /assets\/enterprise\.js/);
assert.match(sw, /assets\/enterprise\.css/);

console.log('Responsive layout, Qatra UX 2.6 and embedded ADMIN enterprise access regression test passed.');
