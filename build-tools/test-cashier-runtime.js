const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.resolve(__dirname, '../app/src/main/assets/qatra/assets/cashier.js');
const source = fs.readFileSync(sourcePath, 'utf8') + '\n;globalThis.__Cashier = Cashier;';

function assert(value, message) {
  if (!value) throw new Error(message);
}

function createHarness(initialState) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      id, value: '', checked: false, hidden: true, innerHTML: '', textContent: '',
      style: {}, dataset: {}, classList: {toggle() {}}, focus() {}
    });
    return nodes.get(id);
  };
  ['cashierModalTitle','cashierModalBody','cashierModal','home','transactions','direct','sync']
    .forEach(node);

  let savedState = null;
  let paperPayload = null;
  const alerts = [];
  const document = {
    body: {style: {}, appendChild() {}},
    querySelector(selector) { return selector.startsWith('#') ? node(selector.slice(1)) : null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    createElement() { return {style:{}, click(){}, remove(){}}; }
  };
  const AndroidBridge = {
    printThermalReceipt() { throw new Error('cashier must not call thermal printing'); },
    printHtml(title, html, pageSize) { paperPayload = {title, html, pageSize}; },
    exportXlsx() {}
  };
  const context = {
    console, document, AndroidBridge,
    window: {AndroidBridge, scrollTo(){}, open(){return null;}},
    QatraStore: {
      load() { return JSON.parse(JSON.stringify(initialState)); },
      save(namespace, state) { assert(namespace === 'cashier', 'cashier namespace expected'); savedState = JSON.parse(JSON.stringify(state)); },
      appInfo() { return {ok:true, role:'CASHIER', username:'cashier1'}; }
    },
    QatraSync: {},
    alert(message) { alerts.push(String(message)); },
    confirm() { return true; },
    setTimeout(callback) { if (typeof callback === 'function') callback(); return 1; },
    clearTimeout() {},
    Intl, Date, Math, JSON, String, Number, Array, Object, Map, Set, RegExp,
    encodeURIComponent, decodeURIComponent, Blob: function(){}, URL: {createObjectURL(){return 'blob:test';},revokeObjectURL(){} }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, {filename: sourcePath});
  return {Cashier: context.__Cashier, node, alerts, getSaved:()=>savedState, getPaper:()=>paperPayload};
}

const initial = {
  setup: {meta:{id:'SETUP-1'},settings:{projectName:'اختبار الصندوق',cashierId:'USR-1',cashierName:'أمين الصندوق',cashierUsername:'cashier1',cashierCode:'CX',permissions:['VIEW_CASHBOX','DIRECT_COLLECTION','RECORD_CASH_MOVEMENTS','PRINT_RECEIPTS','EXPORT_CASHBOX']}, subscribers:[{id:'S1',name:'مشترك تجريبي',meterNo:'101',due:500,connectionFeePaid:false}]},
  transactions: [], directPayments: [], exports: [], audit: [],
  preferences: {cashierName:'أمين الصندوق',thermalWidth:'58',autoPrint:false}
};
const h = createHarness(initial);
h.Cashier.openDirectPayment(encodeURIComponent('S1'));
h.node('directAmount').value = '200';
h.node('directIncomeType').value = 'WATER';
h.node('directMethod').value = 'cash';
h.node('directReference').value = 'REF-1';
h.node('directNote').value = 'اختبار';
h.Cashier.saveDirectPaymentForSubscriber(encodeURIComponent('S1'));
const saved = h.getSaved();
assert(saved && saved.directPayments.length === 1, 'direct payment must be saved once');
assert(saved.directPayments[0].method === 'cash', 'direct payment method must be persisted');
h.Cashier.printPaperById(encodeURIComponent(saved.directPayments[0].id), 'direct');
assert(h.getPaper() && h.getPaper().pageSize === 'A5L', 'cashier receipt must request A5 landscape paper');
assert(h.getPaper().html.includes('qatra-print-brand'), 'cashier A5 receipt must include the Qatra footer brand');
assert(h.Cashier.printThermalById === undefined, 'cashier API must not expose thermal printing');
assert(h.Cashier.exportDailyXlsx === undefined, 'cashier API must not expose Excel export');

const legacy = createHarness({setup:null});
legacy.Cashier.openSettings();
assert(legacy.node('cashierModalBody').innerHTML.includes('طباعة سندات الصندوق ورقية على مقاس A5 فقط'), 'legacy state must normalize into the restricted cashier print policy');

const mismatchState = JSON.parse(JSON.stringify(initial));
mismatchState.setup.settings.cashierUsername = 'other.cashier';
const mismatch = createHarness(mismatchState);
mismatch.Cashier.switchTab('home');
assert(mismatch.node('home').innerHTML.includes('تم حجب بيانات الصندوق'), 'cashier data must be hidden from a different native username');

console.log('Cashier runtime smoke test passed.');
