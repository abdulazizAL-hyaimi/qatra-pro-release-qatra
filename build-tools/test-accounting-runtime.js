const fs=require('fs');
const path=require('path');
const vm=require('vm');
const assert=require('assert');

const state={
  meta:{createdAt:'2026-01-01T00:00:00.000Z'},
  settings:{currencyShort:'ر.ي',cashOpeningBalance:0},
  subscribers:[
    {id:'S1',code:'001',name:'المشترك الأول',phone:'700000001',openingArrears:100,openingCredit:0},
    {id:'S2',code:'002',name:'المشترك الثاني',phone:'700000002',openingArrears:0,openingCredit:0}
  ],
  invoices:[
    {id:'I1',no:'INV-1',subscriberId:'S1',date:'2026-01-10',amount:200},
    {id:'I2',no:'INV-2',subscriberId:'S1',date:'2026-02-10',amount:100},
    {id:'I3',no:'INV-3',subscriberId:'S2',date:'2026-01-15',amount:100},
    {id:'I4',no:'INV-ZERO',subscriberId:'S2',date:'2026-02-15',amount:0}
  ],
  payments:[
    {id:'P1',receiptNo:'R-1',subscriberId:'S1',date:'2026-01-11',amount:250,method:'نقداً',incomeType:'WATER'},
    {id:'P2',receiptNo:'R-2',subscriberId:'S1',date:'2026-02-11',amount:200,method:'تحويل بنكي',incomeType:'WATER'},
    {id:'P3',receiptNo:'R-3',subscriberId:'S2',date:'2026-01-16',amount:100,method:'نقداً',source:'collector-app',incomeType:'WATER'},
    {id:'P4',receiptNo:'R-4',subscriberId:'S2',date:'2026-01-17',amount:30,method:'تحويل',incomeType:'CONNECTION_FEE'}
  ],
  expenses:[
    {id:'E1',date:'2026-01-20',category:'كهرباء',description:'فاتورة كهرباء',amount:60,paymentAccount:'cash'},
    {id:'EXP-CASH-TX5',date:'2026-01-22',category:'أخرى',description:'مصروف صندوق',amount:20,paymentAccount:'cash',source:'cashier'}
  ],
  cashboxTransactions:[
    {id:'TX1',date:'2026-01-18',type:'collector_deposit',amount:100,party:'المحصل'},
    {id:'TX2',date:'2026-01-21',type:'bank_deposit',amount:40},
    {id:'TX5',date:'2026-01-22',type:'expense',category:'أخرى',amount:20}
  ]
};
let saveCount=0,uidCount=0;
const document={querySelector:()=>null,addEventListener:()=>{}};
const window={document,YWP:{state,toNumber:v=>Number(v)||0,today:()=> '2026-02-28',uid:p=>`${p}-TEST-${++uidCount}`,money:v=>String(v),esc:v=>String(v),save:()=>{saveCount++}}};
const context={window,document,globalThis:window,console,setTimeout:()=>0,clearTimeout:()=>{},Date,Math,JSON,Number,String,Array,Map,Set,Object,RegExp,Error};
vm.createContext(context);
const source=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/qatra/assets/accounting.js'),'utf8');
vm.runInContext(source,context,{filename:'accounting.js'});
const A=window.QatraAccounting;

assert(A,'accounting API must be exposed');
const journals=A.buildJournals(state);
assert(journals.length>0,'automatic journals must be generated');
journals.forEach(j=>assert(A.validateJournal(j,state).ok,`journal ${j.id} must balance`));
assert.strictEqual(journals.filter(j=>j.id==='CBX-TX5').length,0,'cashier expense transaction must not duplicate imported expense');
assert.strictEqual(journals.find(j=>j.id==='PAY-P3').lines[0].partyName,'المحصل','collector custody must retain the collector as its subledger party');

const check=A.validateLedger(state);
assert.strictEqual(check.ok,true,'ledger must pass validation');
assert.strictEqual(check.difference,0,'ledger debits and credits must match');

const activity=Object.fromEntries(A.accountActivity(state,{to:'2026-02-28'}).map(x=>[x.code,x]));
assert.strictEqual(activity['1200'].balance,0,'subscriber receivables must be fully settled');
assert.strictEqual(activity['2100'].balance,-50,'overpayment must become a subscriber advance liability');
assert.strictEqual(activity['1120'].balance,0,'collector custody must clear after deposit');
assert.strictEqual(activity['1100'].balance,230,'cash must include collections, deposit, expenses and bank transfer');
assert.strictEqual(activity['1110'].balance,270,'bank must include transfers and cash deposit');
assert.strictEqual(activity['4100'].balance,-400,'water invoices must post to water revenue');
assert.strictEqual(activity['4200'].balance,-30,'connection fee must post separately');
assert.strictEqual(activity['5200'].balance,60,'electricity expense must use its mapped expense account');
assert.strictEqual(activity['5900'].balance,20,'cashier expense must post exactly once');

const tb=A.trialBalance(state,{to:'2026-02-28'});
assert.strictEqual(tb.difference,0,'trial balance must balance');
assert.strictEqual(tb.totals.debitBalance,tb.totals.creditBalance,'trial balance sides must match');
const februaryTb=A.trialBalance(state,{from:'2026-02-01',to:'2026-02-28'});
assert.strictEqual(februaryTb.rows.find(x=>x.code==='1100').balance,230,'period trial balance must carry the opening balance from prior months');
assert.strictEqual(februaryTb.difference,0,'period trial balance with opening balances must remain balanced');
const pl=A.incomeStatement(state,{to:'2026-02-28'});
assert.strictEqual(pl.revenue,430,'income statement revenue must exclude opening balances and advances');
assert.strictEqual(pl.expense,80,'income statement must include mapped expenses once');
assert.strictEqual(pl.netIncome,350,'net income must be revenue less expenses');
const bs=A.balanceSheet(state,'2026-02-28');
assert.strictEqual(bs.difference,0,'balance sheet equation must balance');
assert.strictEqual(bs.totalAssets,500,'asset balance must be correct');

const age=A.aging(state,'2026-02-28');
const s1=age.find(x=>x.subscriberId==='S1');
assert(s1,'subscriber with advance must be present in aging report');
assert.strictEqual(s1.total,0,'settled subscriber must have no receivable aging');
assert.strictEqual(s1.advance,50,'aging must show subscriber advance separately');

A.addAccount({code:'5710',name:'اتصالات وإنترنت',type:'EXPENSE',group:'المصروفات الإدارية'},state);
assert.strictEqual(A.account('5710',state).name,'اتصالات وإنترنت','custom account must be added to the chart');
assert.throws(()=>A.addAccount({code:'5710',name:'مكرر',type:'EXPENSE'},state),/مسبقاً/,'duplicate account code must be rejected');

assert.throws(()=>A.postManual({date:'2026-02-20',description:'غير متوازن',lines:[{account:'1100',debit:10,credit:0},{account:'2200',debit:0,credit:9}]},state),/غير متوازن/,'unbalanced journal must be rejected');
const manual=A.postManual({date:'2026-02-20',description:'شراء أصل آجل',lines:[{account:'1400',debit:100,credit:0},{account:'2200',debit:0,credit:100}]},state);
assert(manual.id.startsWith('JV-'),'balanced manual journal must post');
A.closePeriod('2026-02','إقفال اختبار',state);
assert.strictEqual(A.isClosed('2026-02-28',state),true,'closed month must be detected');
assert.throws(()=>A.postManual({date:'2026-02-21',description:'داخل فترة مقفلة',lines:[{account:'1100',debit:1,credit:0},{account:'3100',debit:0,credit:1}]},state),/مقفلة/,'closed month must reject new journals');
A.reopenPeriod('2026-02','تصحيح معتمد',state);
assert.strictEqual(A.isClosed('2026-02-28',state),false,'reopened month must accept controlled corrections');
const reversal=A.reverseManual(manual.id,'2026-02-22','إلغاء شراء تجريبي',state);
assert.strictEqual(reversal.reversalOf,manual.id,'manual correction must use a linked reversing journal');
assert(saveCount>=4,'accounting controls must persist through the shared SQLite-backed state');

console.log(`Accounting runtime test passed: ${journals.length} automatic journals, balanced statements, aging, close and reversal verified.`);
