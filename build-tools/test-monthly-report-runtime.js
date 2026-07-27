'use strict';

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const reportMonth = {
  value: '2026-07',
  dataset: {},
  options: [{ value: '2026-07' }, { value: '2026-06' }],
  addEventListener(event, handler) { this[`on${event}`] = handler; },
  prepend(option) { this.options.unshift(option); }
};
const reportOutput = { innerHTML: '' };
const reportsRoot = {};

const state = {
  settings: { tariff: 100, currencyShort: 'ر.ي' },
  subscribers: [{ id: 'S1', name: 'مشترك تجريبي', meterNo: 'M-1', openingArrears: 200, openingCredit: 0 }],
  cycles: [{ id: 'C1', type: 'MONTHLY', cycleDate: '2026-06-30', mainPrev: 1000, mainCurrent: 1100 }],
  readings: [{ id: 'R1', cycleId: 'C1', subscriberId: 'S1', prev: 10, current: 40, consumption: 30 }],
  invoices: [],
  payments: [{ id: 'P1', subscriberId: 'S1', date: '2026-06-30', receiptNo: 'RC-1', amount: 1000, method: 'نقداً', collector: 'علي', confirmed: true, incomeType: 'WATER' }],
  expenses: [{ id: 'E1', date: '2026-06-30', amount: 100 }]
};

const elements = {
  '#reportMonth': reportMonth,
  '#reportOutput': reportOutput,
  '#reports': reportsRoot
};

const sandbox = {
  console,
  document: {
    querySelector(selector) { return elements[selector] || null; },
    createElement() { return { value: '', textContent: '' }; }
  },
  MutationObserver: class { observe() {} },
  setTimeout(fn) { fn(); return 1; },
  clearTimeout() {},
  App: {
    monthlySummaryReport() {},
    printCurrentReport() {},
    exportCurrentExcel() {},
    downloadCurrentCSV() {}
  },
  YWP: {
    state,
    esc(value) { return String(value ?? '').replace(/[&<>\"]/g, ''); },
    money(value) { return `${Number(value || 0).toLocaleString('en-US')} ر.ي`; },
    num(value) { return Number(value || 0).toLocaleString('en-US'); },
    subscriber(id) { return state.subscribers.find(row => row.id === id); },
    openingNet(subscriber) { return Number(subscriber?.openingArrears || 0) - Number(subscriber?.openingCredit || 0); },
    orgHeaderHtml() { return '<header>مياه الروضة</header>'; }
  }
};
sandbox.window = sandbox;
sandbox.window.addEventListener = (event, handler) => { if(event === 'load') handler(); };

vm.createContext(sandbox);
const source = fs.readFileSync('app/src/main/assets/qatra/assets/report_fix.js', 'utf8');
vm.runInContext(source, sandbox, { filename: 'report_fix.js' });

assert.strictEqual(typeof sandbox.App.monthlySummaryReport, 'function', 'لم يتم تثبيت إصلاح التقرير');
sandbox.App.monthlySummaryReport();

assert.strictEqual(reportMonth.value, '2026-06', 'يجب اختيار أحدث شهر يحتوي بيانات بدلاً من الشهر الفارغ');
assert.match(reportOutput.innerHTML, /استهلاك نهاية الشهر/);
assert.match(reportOutput.innerHTML, /30 م³/);
assert.match(reportOutput.innerHTML, /الإيرادات المحصلة فعلياً/);
assert.match(reportOutput.innerHTML, /الذمم المالية لدى المشتركين/);
assert.match(reportOutput.innerHTML, /قراءة محفوظة لم تُنشأ لها فواتير/);
assert.doesNotMatch(reportOutput.innerHTML, /إيرادات فواتير نهاية الشهر/);
assert.match(reportOutput.innerHTML, /report-shell/);
assert.match(reportOutput.innerHTML, /رجوع للتقارير/);
assert.match(reportOutput.innerHTML, /v13-summary-cards/);

state.invoices.push({ id: 'I-EXCLUDED', subscriberId: 'S1', cycleId: 'OTHER', date: '2026-06-29', amount: 9999 });
state.payments.push({ id: 'P-UNCONFIRMED', subscriberId: 'S1', date: '2026-06-30', receiptNo: 'RC-X', amount: 9000, confirmed: false });
sandbox.App.revenueReport();
assert.match(reportOutput.innerHTML, /كشف الإيرادات المحصلة/);
assert.match(reportOutput.innerHTML, /1,000 ر.ي/);
assert.match(reportOutput.innerHTML, /عدد السندات/);
assert.match(reportOutput.innerHTML, /المصدر/);
assert.doesNotMatch(reportOutput.innerHTML, /9,999 ر.ي|9,000 ر.ي/);

console.log('Monthly report regression test passed.');
