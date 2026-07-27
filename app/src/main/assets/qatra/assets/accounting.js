/* Qatra Pro accounting core: double-entry ledger, financial statements and period control. */
(function(global){
  'use strict';
  const $=s=>global.document?.querySelector(s);
  const Y=()=>global.YWP;
  const S=()=>global.YWP?.state;
  const round=v=>Math.round((Number(v)||0)*100)/100;
  const n=v=>{const x=Number(String(v??'').replace(/,/g,''));return Number.isFinite(x)?x:0};
  const esc=v=>Y()?.esc?Y().esc(v):String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money=v=>Y()?.money?Y().money(round(v)):round(v).toLocaleString('en-US');
  const today=()=>Y()?.today?Y().today():new Date().toISOString().slice(0,10);
  const month=d=>String(d||today()).slice(0,7);
  const now=()=>new Date().toISOString();
  const uid=p=>Y()?.uid?Y().uid(p):`${p}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const currentUser=()=>{try{return global.QatraStore?.appInfo()?.username||'ADMIN'}catch(e){return'ADMIN'}};
  const audit=(action,details)=>{try{global.QatraProduction?.audit(action,details||{})}catch(e){}};

  const DEFAULT_CHART=[
    {code:'1100',name:'الصندوق والنقدية',type:'ASSET',group:'الأصول المتداولة'},
    {code:'1110',name:'الحسابات البنكية',type:'ASSET',group:'الأصول المتداولة'},
    {code:'1120',name:'عهد وتحصيلات لدى المحصلين',type:'ASSET',group:'الأصول المتداولة'},
    {code:'1130',name:'نقدية قيد التسليم للإدارة',type:'ASSET',group:'الأصول المتداولة'},
    {code:'1200',name:'ذمم المشتركين',type:'ASSET',group:'الأصول المتداولة'},
    {code:'1300',name:'المخزون وقطع الغيار',type:'ASSET',group:'الأصول المتداولة'},
    {code:'1400',name:'الأصول الثابتة',type:'ASSET',group:'الأصول غير المتداولة'},
    {code:'2100',name:'دفعات مقدمة من المشتركين',type:'LIABILITY',group:'الالتزامات المتداولة'},
    {code:'2200',name:'ذمم الموردين',type:'LIABILITY',group:'الالتزامات المتداولة'},
    {code:'3100',name:'حقوق الملكية والأرصدة الافتتاحية',type:'EQUITY',group:'حقوق الملكية'},
    {code:'3200',name:'الأرباح المحتجزة',type:'EQUITY',group:'حقوق الملكية'},
    {code:'4100',name:'إيرادات استهلاك المياه',type:'REVENUE',group:'الإيرادات التشغيلية'},
    {code:'4200',name:'إيرادات إدخال الخدمة',type:'REVENUE',group:'الإيرادات التشغيلية'},
    {code:'4900',name:'إيرادات أخرى',type:'REVENUE',group:'إيرادات أخرى'},
    {code:'5100',name:'مصروف الديزل والوقود',type:'EXPENSE',group:'تكلفة التشغيل'},
    {code:'5200',name:'مصروف الكهرباء',type:'EXPENSE',group:'تكلفة التشغيل'},
    {code:'5300',name:'صيانة المضخات',type:'EXPENSE',group:'تكلفة التشغيل'},
    {code:'5310',name:'صيانة الشبكة',type:'EXPENSE',group:'تكلفة التشغيل'},
    {code:'5400',name:'الرواتب والأجور',type:'EXPENSE',group:'المصروفات التشغيلية'},
    {code:'5500',name:'مواسير وقطع غيار مستهلكة',type:'EXPENSE',group:'تكلفة التشغيل'},
    {code:'5600',name:'مواصلات ونقل',type:'EXPENSE',group:'المصروفات التشغيلية'},
    {code:'5700',name:'مصروفات إدارية',type:'EXPENSE',group:'المصروفات التشغيلية'},
    {code:'5900',name:'مصروفات أخرى',type:'EXPENSE',group:'المصروفات التشغيلية'}
  ];
  const EXPENSE_MAP={'ديزل / وقود':'5100','كهرباء':'5200','صيانة مضخات':'5300','صيانة شبكة':'5310','رواتب':'5400','مواسير وقطع غيار':'5500','مواصلات':'5600','مصروفات إدارية':'5700','أخرى':'5900'};
  const TYPES={ASSET:'أصل',LIABILITY:'التزام',EQUITY:'حقوق ملكية',REVENUE:'إيراد',EXPENSE:'مصروف'};
  let currentView='summary';

  function ensureState(state=S()){
    if(!state)return null;
    state.accounting ||= {};
    const a=state.accounting;
    a.version='1.0.0';
    a.chart=Array.isArray(a.chart)&&a.chart.length?a.chart:JSON.parse(JSON.stringify(DEFAULT_CHART));
    a.manualJournals=Array.isArray(a.manualJournals)?a.manualJournals:[];
    a.closedPeriods=Array.isArray(a.closedPeriods)?a.closedPeriods:[];
    a.reconciliations=Array.isArray(a.reconciliations)?a.reconciliations:[];
    a.settings={fiscalYearStart:'01-01',...(a.settings||{})};
    return a;
  }
  function account(code,state=S()){return ensureState(state)?.chart.find(a=>a.code===String(code))||{code:String(code),name:'حساب غير معروف',type:'ASSET',group:''}}
  function isClosed(date,state=S()){return !!ensureState(state)?.closedPeriods.some(p=>p.month===month(date)&&!p.reopenedAt)}
  function line(accountCode,debit,credit,extra={}){return{account:String(accountCode),debit:round(debit),credit:round(credit),...extra}}
  function journal(id,date,ref,description,source,lines,extra={}){
    return{id:String(id),date:String(date||today()).slice(0,10),ref:String(ref||''),description:String(description||''),source:String(source||''),lines:lines.filter(x=>round(x.debit)||round(x.credit)),...extra};
  }
  function totals(j){return(j.lines||[]).reduce((a,l)=>({debit:round(a.debit+n(l.debit)),credit:round(a.credit+n(l.credit))}),{debit:0,credit:0})}
  function validateJournal(j,state=S()){
    const errors=[],t=totals(j),known=new Set((ensureState(state)?.chart||[]).map(a=>a.code));
    if(!j.id)errors.push('معرّف القيد مفقود');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(j.date||'')))errors.push('تاريخ القيد غير صحيح');
    if(!Array.isArray(j.lines)||j.lines.length<2)errors.push('القيد يحتاج طرفين على الأقل');
    (j.lines||[]).forEach((l,i)=>{
      if(!known.has(String(l.account)))errors.push(`الحساب غير معروف في السطر ${i+1}`);
      if(n(l.debit)<0||n(l.credit)<0)errors.push(`قيمة سالبة في السطر ${i+1}`);
      if((n(l.debit)>0)===(n(l.credit)>0))errors.push(`السطر ${i+1} يجب أن يكون مديناً أو دائناً فقط`);
    });
    if(t.debit<=0)errors.push('قيمة القيد صفر');
    if(Math.abs(t.debit-t.credit)>0.009)errors.push(`القيد غير متوازن: الفرق ${round(t.debit-t.credit)}`);
    return{ok:errors.length===0,errors,debit:t.debit,credit:t.credit};
  }
  function paymentAccount(p){
    const method=String(p?.method||'').toLowerCase(),source=String(p?.source||'').toLowerCase();
    if(source.includes('collector'))return'1120';
    if(source==='cashbox_direct'||/تحويل|إيداع|بنك|bank|wallet|محفظة/.test(method))return'1110';
    return'1100';
  }
  function expenseAccount(category){return EXPENSE_MAP[String(category||'')]||'5900'}
  function creditAccountForExpense(e){return e?.paymentAccount==='bank'?'1110':e?.paymentAccount==='payable'?'2200':'1100'}
  function partyInfo(state,subId){const s=(state.subscribers||[]).find(x=>x.id===subId)||{};return{partyId:subId||'',partyCode:s.code||'',partyName:s.name||''}}

  function buildSubscriberJournals(state,output){
    (state.subscribers||[]).forEach(s=>{
      let ar=Math.max(0,n(s.openingArrears??Math.max(0,n(s.openingBalance))));
      let advance=Math.max(0,n(s.openingCredit??Math.max(0,-n(s.openingBalance))));
      const party={partyId:s.id,partyCode:s.code||'',partyName:s.name||''};
      const openingDate=String(s.openingBalanceDate||state.meta?.createdAt||'2000-01-01').slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(openingDate)){};
      const safeOpening=/^\d{4}-\d{2}-\d{2}$/.test(openingDate)?openingDate:'2000-01-01';
      if(ar)output.push(journal(`OPEN-AR-${s.id}`,safeOpening,s.code,'متأخرات افتتاحية للمشترك','OPENING',[line('1200',ar,0,party),line('3100',0,ar,party)]));
      if(advance)output.push(journal(`OPEN-ADV-${s.id}`,safeOpening,s.code,'رصيد مقدم افتتاحي للمشترك','OPENING',[line('3100',advance,0,party),line('2100',0,advance,party)]));
      const events=[];
      (state.invoices||[]).filter(x=>x.subscriberId===s.id).forEach(x=>events.push({kind:'invoice',date:x.date||'9999-12-31',priority:1,id:x.id||x.no,item:x}));
      (state.payments||[]).filter(x=>x.subscriberId===s.id&&x.confirmed!==false).forEach(x=>events.push({kind:'payment',date:x.date||'9999-12-31',priority:2,id:x.id||x.receiptNo,item:x}));
      events.sort((a,b)=>String(a.date).localeCompare(String(b.date))||a.priority-b.priority||String(a.id).localeCompare(String(b.id)));
      events.forEach(ev=>{
        const x=ev.item,amount=Math.max(0,n(x.amount));if(!amount)return;
        if(ev.kind==='invoice'){
          const used=Math.min(advance,amount),due=round(amount-used);advance=round(advance-used);ar=round(ar+due);
          output.push(journal(`INV-${x.id||x.no}`,x.date,x.no,'إثبات فاتورة استهلاك مياه','INVOICE',[line('2100',used,0,party),line('1200',due,0,party),line('4100',0,amount,party)],{sourceId:x.id||''}));
        }else{
          const income=x.incomeType||'WATER',cash=paymentAccount(x);
          const cashParty=cash==='1120'?{partyId:x.collectorId||'',partyCode:x.collectorCode||'',partyName:x.collector||'المحصل'}:party;
          if(income==='CONNECTION_FEE'){
            output.push(journal(`PAY-${x.id||x.receiptNo}`,x.date,x.receiptNo,'تحصيل رسوم إدخال الخدمة','PAYMENT',[line(cash,amount,0,cashParty),line('4200',0,amount,party)],{sourceId:x.id||''}));
          }else if(income==='WATER'){
            const applied=Math.min(ar,amount),over=round(amount-applied);ar=round(ar-applied);advance=round(advance+over);
            output.push(journal(`PAY-${x.id||x.receiptNo}`,x.date,x.receiptNo,'تحصيل من مشترك','PAYMENT',[line(cash,amount,0,cashParty),line('1200',0,applied,party),line('2100',0,over,party)],{sourceId:x.id||''}));
          }else{
            output.push(journal(`PAY-${x.id||x.receiptNo}`,x.date,x.receiptNo,'تحصيل إيراد آخر','PAYMENT',[line(cash,amount,0,cashParty),line('4900',0,amount,party)],{sourceId:x.id||''}));
          }
        }
      });
    });
  }
  function buildExpenseJournals(state,output){
    (state.expenses||[]).forEach(e=>{const amount=Math.max(0,n(e.amount));if(!amount)return;output.push(journal(`EXP-${e.id}`,e.date,e.refNo||e.id,e.description||e.category,'EXPENSE',[line(expenseAccount(e.category),amount,0,{partyName:e.payee||'',costCenter:e.costCenter||''}),line(creditAccountForExpense(e),0,amount,{partyName:e.payee||'',costCenter:e.costCenter||''})],{sourceId:e.id||''}))});
  }
  function buildCashboxJournals(state,output){
    const opening=Math.max(0,n(state.settings?.cashOpeningBalance));
    if(opening)output.push(journal('OPEN-CASHBOX',String(state.meta?.productionStartedAt||state.meta?.createdAt||today()).slice(0,10),'OPEN-CASH','رصيد الصندوق الافتتاحي','OPENING',[line('1100',opening,0),line('3100',0,opening)]));
    const expenseIds=new Set((state.expenses||[]).map(e=>String(e.id||'')));
    (state.cashboxTransactions||[]).forEach(t=>{
      const amount=Math.max(0,n(t.amount));if(!amount)return;
      const method=String(t.method||''),bank=/تحويل|إيداع|بنك|bank/.test(method.toLowerCase()),cash=bank?'1110':'1100';let lines=null,description=t.description||'';
      if(t.type==='collector_deposit')lines=[line('1100',amount,0,{partyName:t.party||''}),line('1120',0,amount,{partyName:t.party||''})];
      if(t.type==='other_income')lines=[line(cash,amount,0),line('4900',0,amount)];
      if(t.type==='bank_deposit')lines=[line('1110',amount,0),line('1100',0,amount)];
      if(t.type==='manager_delivery')lines=[line('1130',amount,0,{partyName:t.party||''}),line('1100',0,amount,{partyName:t.party||''})];
      if(t.type==='other_out')lines=[line('5900',amount,0),line('1100',0,amount)];
      if(t.type==='opening_adjustment')lines=[line('1100',amount,0),line('3100',0,amount)];
      if(t.type==='expense'&&!expenseIds.has('EXP-CASH-'+t.id))lines=[line(expenseAccount(t.category),amount,0),line('1100',0,amount)];
      if(lines)output.push(journal(`CBX-${t.id}`,t.date,t.refNo||t.id,description||'حركة صندوق','CASHBOX',lines,{sourceId:t.id||''}));
    });
  }
  function buildJournals(state=S(),options={}){
    if(!state)return[];ensureState(state);const output=[];
    buildSubscriberJournals(state,output);buildExpenseJournals(state,output);buildCashboxJournals(state,output);
    state.accounting.manualJournals.filter(j=>j.status!=='draft').forEach(j=>output.push(JSON.parse(JSON.stringify(j))));
    const from=options.from||'',to=options.to||'';
    return output.filter(j=>(!from||j.date>=from)&&(!to||j.date<=to)).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  }
  function validateLedger(state=S()){
    const journals=buildJournals(state),errors=[],ids=new Set();let debit=0,credit=0;
    journals.forEach(j=>{const v=validateJournal(j,state);debit=round(debit+v.debit);credit=round(credit+v.credit);if(ids.has(j.id))errors.push(`معرّف قيد مكرر: ${j.id}`);ids.add(j.id);v.errors.forEach(e=>errors.push(`${j.ref||j.id}: ${e}`))});
    const checkSource=(items,label,refKey,allowZero=false)=>{const sourceIds=new Set(),refs=new Set();(items||[]).forEach(x=>{if(!x.id)errors.push(`${label} بدون معرّف`);else if(sourceIds.has(x.id))errors.push(`معرّف ${label} مكرر: ${x.id}`);else sourceIds.add(x.id);const ref=String(x[refKey]||'');if(ref&&refs.has(ref))errors.push(`رقم ${label} مكرر: ${ref}`);if(ref)refs.add(ref);if(!/^\d{4}-\d{2}-\d{2}$/.test(String(x.date||'')))errors.push(`تاريخ ${label} غير صحيح: ${ref||x.id}`);if(allowZero?n(x.amount)<0:n(x.amount)<=0)errors.push(`مبلغ ${label} غير صحيح: ${ref||x.id}`)})};
    checkSource(state?.invoices,'فاتورة','no',true);checkSource(state?.payments,'سند قبض','receiptNo');checkSource(state?.expenses,'مصروف','refNo');
    (state?.invoices||[]).concat(state?.payments||[]).forEach(x=>{if(!(state.subscribers||[]).some(s=>s.id===x.subscriberId))errors.push(`حركة مرتبطة بمشترك غير موجود: ${x.no||x.receiptNo||x.id}`)});
    return{ok:errors.length===0&&Math.abs(debit-credit)<0.01,errors,debit,credit,difference:round(debit-credit),count:journals.length};
  }
  function accountActivity(state=S(),options={}){
    const map=new Map((ensureState(state)?.chart||[]).map(a=>[a.code,{...a,debit:0,credit:0,balance:0}]));
    buildJournals(state,options).forEach(j=>(j.lines||[]).forEach(l=>{const x=map.get(String(l.account));if(x){x.debit=round(x.debit+n(l.debit));x.credit=round(x.credit+n(l.credit));x.balance=round(x.debit-x.credit)}}));
    return Array.from(map.values());
  }
  function trialBalance(state=S(),options={}){
    const movements=accountActivity(state,options),balances=accountActivity(state,{to:options.to});
    const rows=movements.map(a=>{const balance=balances.find(x=>x.code===a.code)?.balance||0;return{...a,balance,debitBalance:Math.max(0,balance),creditBalance:Math.max(0,-balance)}});
    const totals=rows.reduce((x,r)=>({debit:round(x.debit+r.debit),credit:round(x.credit+r.credit),debitBalance:round(x.debitBalance+r.debitBalance),creditBalance:round(x.creditBalance+r.creditBalance)}),{debit:0,credit:0,debitBalance:0,creditBalance:0});
    return{rows,totals,difference:round(totals.debitBalance-totals.creditBalance)};
  }
  function incomeStatement(state=S(),options={}){
    const activity=accountActivity(state,options),revenues=activity.filter(a=>a.type==='REVENUE').map(a=>({...a,amount:round(a.credit-a.debit)})),expenses=activity.filter(a=>a.type==='EXPENSE').map(a=>({...a,amount:round(a.debit-a.credit)}));
    const revenue=round(revenues.reduce((s,a)=>s+a.amount,0)),expense=round(expenses.reduce((s,a)=>s+a.amount,0));return{revenues,expenses,revenue,expense,netIncome:round(revenue-expense)};
  }
  function balanceSheet(state=S(),asOf=today()){
    const activity=accountActivity(state,{to:asOf}),pl=incomeStatement(state,{to:asOf});
    const assets=activity.filter(a=>a.type==='ASSET').map(a=>({...a,amount:round(a.debit-a.credit)}));
    const liabilities=activity.filter(a=>a.type==='LIABILITY').map(a=>({...a,amount:round(a.credit-a.debit)}));
    const equity=activity.filter(a=>a.type==='EQUITY').map(a=>({...a,amount:round(a.credit-a.debit)}));
    equity.push({code:'CURRENT',name:'صافي نتيجة الفترة حتى التاريخ',type:'EQUITY',amount:pl.netIncome});
    const totalAssets=round(assets.reduce((s,a)=>s+a.amount,0)),totalLiabilities=round(liabilities.reduce((s,a)=>s+a.amount,0)),totalEquity=round(equity.reduce((s,a)=>s+a.amount,0));
    return{assets,liabilities,equity,totalAssets,totalLiabilities,totalEquity,difference:round(totalAssets-totalLiabilities-totalEquity)};
  }
  function daysBetween(a,b){const x=new Date(a+'T00:00:00'),y=new Date(b+'T00:00:00');return Math.max(0,Math.floor((y-x)/86400000))}
  function aging(state=S(),asOf=today()){
    const result=[];
    (state?.subscribers||[]).forEach(s=>{
      const dues=[];let advance=Math.max(0,n(s.openingCredit??Math.max(0,-n(s.openingBalance))));const opening=Math.max(0,n(s.openingArrears??Math.max(0,n(s.openingBalance))));
      if(opening)dues.push({date:String(s.openingBalanceDate||'2000-01-01').slice(0,10),amount:opening,ref:'افتتاحي'});
      const events=[];(state.invoices||[]).filter(x=>x.subscriberId===s.id&&x.date<=asOf).forEach(x=>events.push({kind:'invoice',date:x.date,priority:1,item:x}));(state.payments||[]).filter(x=>x.subscriberId===s.id&&x.date<=asOf&&x.confirmed!==false&&(x.incomeType||'WATER')==='WATER').forEach(x=>events.push({kind:'payment',date:x.date,priority:2,item:x}));events.sort((a,b)=>a.date.localeCompare(b.date)||a.priority-b.priority);
      const apply=value=>{let left=value;while(left>0.009&&dues.length){const used=Math.min(left,dues[0].amount);dues[0].amount=round(dues[0].amount-used);left=round(left-used);if(dues[0].amount<=0.009)dues.shift()}return left};
      if(advance)advance=apply(advance);
      events.forEach(e=>{const amount=Math.max(0,n(e.item.amount));if(e.kind==='invoice'){let due=amount;if(advance){const used=Math.min(advance,due);advance=round(advance-used);due=round(due-used)}if(due)dues.push({date:e.date,amount:due,ref:e.item.no||e.item.id})}else{const left=apply(amount);if(left)advance=round(advance+left)}});
      const buckets={'0-30':0,'31-60':0,'61-90':0,'90+':0};dues.forEach(d=>{const age=daysBetween(d.date,asOf),key=age<=30?'0-30':age<=60?'31-60':age<=90?'61-90':'90+';buckets[key]=round(buckets[key]+d.amount)});const total=round(Object.values(buckets).reduce((a,b)=>a+b,0));if(total||advance)result.push({subscriberId:s.id,code:s.code||'',name:s.name||'',phone:s.phone||'',...buckets,total,advance});
    });return result;
  }
  function cashFlow(state=S(),options={}){
    const rows=[];buildJournals(state,options).forEach(j=>{const cashLines=j.lines.filter(l=>l.account==='1100'||l.account==='1110'),movement=round(cashLines.reduce((s,l)=>s+n(l.debit)-n(l.credit),0));if(!movement)return;let category='تشغيلية';if(j.source==='OPENING'||j.source==='MANUAL')category='تمويلية';if(j.source==='CASHBOX'&&/BANK/.test(j.id))category='تحويل داخلي';rows.push({date:j.date,ref:j.ref,description:j.description,category,inflow:Math.max(0,movement),outflow:Math.max(0,-movement),net:movement})});const included=rows.filter(r=>r.category!=='تحويل داخلي'),inflow=round(included.reduce((s,r)=>s+r.inflow,0)),outflow=round(included.reduce((s,r)=>s+r.outflow,0));return{rows,inflow,outflow,net:round(inflow-outflow)}}

  function postManual(data,state=S()){
    const a=ensureState(state);if(!a)throw new Error('بيانات المحاسبة غير متاحة');if(isClosed(data.date,state))throw new Error('الفترة مقفلة ولا تقبل قيوداً جديدة');
    const j=journal(uid('JV'),data.date,data.ref,data.description,'MANUAL',(data.lines||[]).map(x=>line(x.account,n(x.debit),n(x.credit),{partyName:x.partyName||'',costCenter:x.costCenter||''})),{createdAt:now(),createdBy:currentUser(),status:'posted'}),v=validateJournal(j,state);if(!v.ok)throw new Error(v.errors.join('\n'));a.manualJournals.push(j);Y().save();audit('ACCOUNTING_MANUAL_JOURNAL_POSTED',{id:j.id,date:j.date,value:v.debit,createdBy:j.createdBy});return j;
  }
  function reverseManual(id,date,reason,state=S()){
    const a=ensureState(state),original=a.manualJournals.find(j=>j.id===id);if(!original)throw new Error('القيد اليدوي غير موجود');if(!String(reason||'').trim())throw new Error('سبب العكس مطلوب');if(isClosed(date,state))throw new Error('تاريخ القيد العكسي يقع في فترة مقفلة');if(a.manualJournals.some(j=>j.reversalOf===id))throw new Error('تم عكس هذا القيد سابقاً');const rev=journal(uid('REV'),date,original.ref,`عكس القيد ${original.id}: ${reason}`,'MANUAL',original.lines.map(l=>line(l.account,l.credit,l.debit,{partyName:l.partyName||'',costCenter:l.costCenter||''})),{createdAt:now(),createdBy:currentUser(),status:'posted',reversalOf:id,reason:String(reason)});a.manualJournals.push(rev);Y().save();audit('ACCOUNTING_JOURNAL_REVERSED',{id:rev.id,reversalOf:id,date:rev.date,reason:String(reason),createdBy:rev.createdBy});return rev;
  }
  function closePeriod(value,notes='',state=S()){
    const a=ensureState(state),m=String(value||'');if(!/^\d{4}-\d{2}$/.test(m))throw new Error('اختر شهراً صحيحاً');if(a.closedPeriods.some(p=>p.month===m&&!p.reopenedAt))throw new Error('الفترة مقفلة مسبقاً');const check=validateLedger(state);if(!check.ok)throw new Error('لا يمكن الإقفال قبل معالجة أخطاء القيود');const closedBy=currentUser();a.closedPeriods.push({month:m,closedAt:now(),closedBy,notes:String(notes||'')});Y().save();audit('ACCOUNTING_PERIOD_CLOSED',{month:m,closedBy,notes:String(notes||''),journalCount:check.count});return true;
  }
  function reopenPeriod(value,reason,state=S()){
    const p=ensureState(state)?.closedPeriods.slice().reverse().find(x=>x.month===value&&!x.reopenedAt);if(!p)throw new Error('الفترة ليست مقفلة');if(!String(reason||'').trim())throw new Error('سبب إعادة الفتح مطلوب');p.reopenedAt=now();p.reopenedBy=currentUser();p.reopenReason=String(reason);Y().save();audit('ACCOUNTING_PERIOD_REOPENED',{month:value,reopenedBy:p.reopenedBy,reason:p.reopenReason});return true;
  }
  function reconcile(data,state=S()){
    const a=ensureState(state),code=String(data.account||'1110');if(!['1100','1110'].includes(code))throw new Error('التسوية متاحة للصندوق أو البنك');const calculated=accountActivity(state,{to:data.date}).find(x=>x.code===code)?.balance||0,statement=round(n(data.statementBalance)),item={id:uid('REC'),date:data.date,account:code,calculated:round(calculated),statementBalance:statement,difference:round(statement-calculated),notes:String(data.notes||''),createdAt:now(),createdBy:currentUser()};a.reconciliations.push(item);Y().save();audit('ACCOUNTING_RECONCILIATION_SAVED',item);return item;
  }
  function addAccount(data,state=S()){
    const a=ensureState(state),code=String(data.code||'').trim(),name=String(data.name||'').trim(),type=String(data.type||'');
    if(!/^\d{4,8}$/.test(code))throw new Error('رمز الحساب يجب أن يتكون من 4 إلى 8 أرقام');if(!name)throw new Error('اسم الحساب مطلوب');if(!TYPES[type])throw new Error('نوع الحساب غير صحيح');if(a.chart.some(x=>x.code===code))throw new Error('رمز الحساب مستخدم مسبقاً');a.chart.push({code,name,type,group:String(data.group||'حسابات مخصصة'),system:false});a.chart.sort((x,y)=>x.code.localeCompare(y.code));Y().save();audit('ACCOUNTING_ACCOUNT_ADDED',{code,name,type,createdBy:currentUser()});return true;
  }

  function dateRange(){return{from:$('#accFrom')?.value||'',to:$('#accTo')?.value||today()}}
  function rowsHtml(rows,columns){return rows.map(r=>`<tr>${columns.map(c=>`<td class="${c.money?'money':''}">${c.money?money(r[c.key]):esc(r[c.key]??'')}</td>`).join('')}</tr>`).join('')}
  function tableHtml(headers,body,empty='لا توجد حركات'){return`<div class="table-wrap accounting-table-wrap" role="region" aria-label="جدول محاسبي" tabindex="0"><table class="accounting-responsive-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${body||`<tr><td colspan="${headers.length}">${empty}</td></tr>`}</tbody></table></div>`}
  function decorateAccountingTables(root=$('#accountingView')){
    if(!root)return;
    root.querySelectorAll('.accounting-responsive-table').forEach(table=>{
      const labels=Array.from(table.querySelectorAll('thead tr:first-child th')).map((th,index)=>th.textContent.trim()||`إجراء ${index+1}`);
      table.querySelectorAll('tbody tr').forEach(row=>{
        Array.from(row.children).forEach((cell,index)=>{
          if(cell.colSpan>1){cell.classList.add('accounting-empty-cell');return;}
          cell.dataset.label=labels[index]||'البيان';
        });
      });
    });
  }
  function summaryHtml(){const range=dateRange(),check=validateLedger(),pl=incomeStatement(S(),range),bs=balanceSheet(S(),range.to),age=aging(S(),range.to),due=age.reduce((s,x)=>s+x.total,0),activity=accountActivity(S(),{to:range.to}),cash=(activity.find(a=>a.code==='1100')?.balance||0)+(activity.find(a=>a.code==='1110')?.balance||0);return`<div class="accounting-kpis"><article><span>سلامة القيود</span><b class="${check.ok?'ok':'bad'}">${check.ok?'متوازن':'يحتاج مراجعة'}</b><small>${check.count} قيد · الفرق ${money(check.difference)}</small></article><article><span>إيرادات الفترة</span><b>${money(pl.revenue)}</b><small>من ${esc(range.from||'البداية')} إلى ${esc(range.to)}</small></article><article><span>مصروفات الفترة</span><b>${money(pl.expense)}</b><small>مصروفات مثبتة محاسبياً</small></article><article><span>صافي النتيجة</span><b class="${pl.netIncome>=0?'ok':'bad'}">${money(pl.netIncome)}</b><small>${pl.netIncome>=0?'فائض':'عجز'}</small></article><article><span>ذمم المشتركين</span><b>${money(due)}</b><small>حسب أعمار الديون</small></article><article><span>النقد والبنك</span><b>${money(cash)}</b><small>الرصيد الدفتري حتى التاريخ</small></article></div><div class="grid two"><div class="card"><h3>معادلة المركز المالي</h3><div class="accounting-equation"><b>${money(bs.totalAssets)}</b><span>الأصول</span><i>=</i><b>${money(bs.totalLiabilities+bs.totalEquity)}</b><span>الالتزامات + حقوق الملكية</span></div><div class="notice ${Math.abs(bs.difference)<0.01?'success':'warning'}">فرق المركز المالي: ${money(bs.difference)}</div></div><div class="card"><h3>مؤشرات رقابية</h3><ul class="accounting-checks"><li>${check.ok?'✓':'!'} القيود الآلية واليدوية متوازنة</li><li>${Math.abs(bs.difference)<0.01?'✓':'!'} معادلة المركز المالي متوازنة</li><li>✓ الزيادة في التحصيل تظهر كدفعة مقدمة لا كإيراد</li><li>✓ حركة الصندوق المستوردة لا تُحتسب مرتين</li></ul></div></div>${check.errors.length?`<div class="card"><h3>أخطاء يجب معالجتها</h3>${tableHtml(['م','الملاحظة'],check.errors.slice(0,100).map((e,i)=>`<tr><td>${i+1}</td><td>${esc(e)}</td></tr>`) )}</div>`:''}`}
  function journalHtml(){const r=dateRange(),list=buildJournals(S(),r),body=list.map(j=>{const t=totals(j);return`<tr><td>${esc(j.date)}</td><td dir="ltr">${esc(j.id)}</td><td>${esc(j.ref)}</td><td>${esc(j.description)}</td><td>${esc(j.source)}</td><td class="money">${money(t.debit)}</td><td><button class="mini light" onclick="QatraAccounting.showJournal('${esc(j.id)}')">تفاصيل</button></td></tr>`}).join('');return`<div class="accounting-report-head"><h3>دفتر اليومية</h3><button onclick="QatraAccounting.exportCurrent('journal')">تصدير Excel</button></div>${tableHtml(['التاريخ','رقم القيد','المرجع','البيان','المصدر','القيمة',''],body)}`}
  function chartHtml(){const chart=ensureState().chart,body=chart.map(a=>`<tr><td dir="ltr">${a.code}</td><td>${esc(a.name)}</td><td>${esc(TYPES[a.type])}</td><td>${esc(a.group)}</td><td>${a.system===false?'مخصص':'نظامي'}</td></tr>`).join('');return`<div class="accounting-report-head"><h3>دليل الحسابات</h3><button onclick="QatraAccounting.exportCurrent('chart')">تصدير Excel</button></div><div class="card"><h4>إضافة حساب فرعي مخصص</h4><div class="form-row"><div class="field"><label>رمز الحساب</label><input id="newAccCode" inputmode="numeric" placeholder="مثال: 5710"></div><div class="field"><label>اسم الحساب</label><input id="newAccName"></div><div class="field"><label>النوع</label><select id="newAccType"><option value="ASSET">أصل</option><option value="LIABILITY">التزام</option><option value="EQUITY">حقوق ملكية</option><option value="REVENUE">إيراد</option><option value="EXPENSE">مصروف</option></select></div><div class="field"><label>المجموعة</label><input id="newAccGroup" value="حسابات مخصصة"></div></div><button class="green" onclick="QatraAccounting.saveAccount()">إضافة الحساب</button></div>${tableHtml(['الرمز','اسم الحساب','النوع','المجموعة','التصنيف'],body)}`}
  function trialHtml(){const r=dateRange(),tb=trialBalance(S(),r),body=tb.rows.filter(x=>x.debit||x.credit||x.debitBalance||x.creditBalance).map(x=>`<tr><td dir="ltr">${x.code}</td><td>${esc(x.name)}</td><td class="money">${money(x.debit)}</td><td class="money">${money(x.credit)}</td><td class="money">${money(x.debitBalance)}</td><td class="money">${money(x.creditBalance)}</td></tr>`).join('');return`<div class="accounting-report-head"><h3>ميزان المراجعة</h3><button onclick="QatraAccounting.exportCurrent('trial')">تصدير Excel</button></div>${tableHtml(['الرمز','الحساب','حركة مدين','حركة دائن','رصيد مدين','رصيد دائن'],body)}<div class="accounting-total">إجمالي الأرصدة: ${money(tb.totals.debitBalance)} = ${money(tb.totals.creditBalance)} · الفرق: ${money(tb.difference)}</div>`}
  function ledgerHtml(){const r=dateRange(),chart=ensureState().chart,selected=$('#accLedgerAccount')?.value||'1100',opts=chart.map(a=>`<option value="${a.code}" ${a.code===selected?'selected':''}>${a.code} — ${esc(a.name)}</option>`).join(''),entries=[];buildJournals(S(),r).forEach(j=>j.lines.filter(l=>l.account===selected).forEach(l=>entries.push({...l,date:j.date,ref:j.ref,id:j.id,description:j.description})));let balance=0;if(r.from)buildJournals(S(),{to:r.to}).filter(j=>j.date<r.from).forEach(j=>j.lines.filter(l=>l.account===selected).forEach(l=>{balance=round(balance+n(l.debit)-n(l.credit))}));const opening=balance,body=(opening?`<tr><td>${esc(r.from)}</td><td></td><td></td><td><b>رصيد افتتاحي للفترة</b></td><td></td><td></td><td></td><td class="money"><b>${money(opening)}</b></td></tr>`:'')+entries.map(e=>{balance=round(balance+n(e.debit)-n(e.credit));return`<tr><td>${e.date}</td><td dir="ltr">${esc(e.id)}</td><td>${esc(e.ref)}</td><td>${esc(e.description)}</td><td>${esc(e.partyName||'')}</td><td class="money">${money(e.debit)}</td><td class="money">${money(e.credit)}</td><td class="money">${money(balance)}</td></tr>`}).join('');return`<div class="accounting-report-head"><h3>الأستاذ العام</h3><div><select id="accLedgerAccount" onchange="QatraAccounting.renderView('ledger')">${opts}</select><button onclick="QatraAccounting.exportCurrent('ledger')">تصدير Excel</button></div></div>${tableHtml(['التاريخ','القيد','المرجع','البيان','الطرف','مدين','دائن','الرصيد'],body)}`}
  function incomeHtml(){const r=dateRange(),pl=incomeStatement(S(),r),list=(title,rows)=>`<h4>${title}</h4>${tableHtml(['الرمز','الحساب','المبلغ'],rows.filter(x=>x.amount).map(x=>`<tr><td>${x.code}</td><td>${esc(x.name)}</td><td class="money">${money(x.amount)}</td></tr>`).join(''))}`;return`<div class="accounting-report-head"><h3>قائمة الدخل</h3><button onclick="QatraAccounting.exportCurrent('income')">تصدير Excel</button></div>${list('الإيرادات',pl.revenues)}<div class="accounting-total">إجمالي الإيرادات: ${money(pl.revenue)}</div>${list('المصروفات',pl.expenses)}<div class="accounting-total">إجمالي المصروفات: ${money(pl.expense)}</div><div class="accounting-grand ${pl.netIncome>=0?'profit':'loss'}">صافي ${pl.netIncome>=0?'الفائض':'العجز'}: ${money(Math.abs(pl.netIncome))}</div>`}
  function balanceHtml(){const asOf=dateRange().to,bs=balanceSheet(S(),asOf),list=(title,rows)=>`<h4>${title}</h4>${tableHtml(['الرمز','الحساب','الرصيد'],rows.filter(x=>Math.abs(x.amount)>0.009).map(x=>`<tr><td>${x.code}</td><td>${esc(x.name)}</td><td class="money">${money(x.amount)}</td></tr>`).join(''))}`;return`<div class="accounting-report-head"><h3>قائمة المركز المالي في ${esc(asOf)}</h3><button onclick="QatraAccounting.exportCurrent('balance')">تصدير Excel</button></div>${list('الأصول',bs.assets)}<div class="accounting-total">إجمالي الأصول: ${money(bs.totalAssets)}</div>${list('الالتزامات',bs.liabilities)}<div class="accounting-total">إجمالي الالتزامات: ${money(bs.totalLiabilities)}</div>${list('حقوق الملكية ونتيجة الفترة',bs.equity)}<div class="accounting-total">إجمالي حقوق الملكية: ${money(bs.totalEquity)}</div><div class="accounting-grand ${Math.abs(bs.difference)<0.01?'profit':'loss'}">فرق المعادلة المحاسبية: ${money(bs.difference)}</div>`}
  function agingHtml(){const asOf=dateRange().to,list=aging(S(),asOf),body=list.map(x=>`<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>${esc(x.phone)}</td><td class="money">${money(x['0-30'])}</td><td class="money">${money(x['31-60'])}</td><td class="money">${money(x['61-90'])}</td><td class="money">${money(x['90+'])}</td><td class="money">${money(x.total)}</td><td class="money">${money(x.advance)}</td></tr>`).join(''),t=k=>list.reduce((s,x)=>s+n(x[k]),0);return`<div class="accounting-report-head"><h3>أعمار ذمم المشتركين في ${esc(asOf)}</h3><button onclick="QatraAccounting.exportCurrent('aging')">تصدير Excel</button></div>${tableHtml(['الرقم','المشترك','الهاتف','0–30','31–60','61–90','أكثر من 90','الإجمالي','دفعة مقدمة'],body)}<div class="accounting-total">الإجمالي: ${money(t('total'))} · دفعات مقدمة: ${money(t('advance'))}</div>`}
  function cashFlowHtml(){const cf=cashFlow(S(),dateRange()),body=cf.rows.map(x=>`<tr><td>${x.date}</td><td>${esc(x.ref)}</td><td>${esc(x.description)}</td><td>${esc(x.category)}</td><td class="money">${money(x.inflow)}</td><td class="money">${money(x.outflow)}</td><td class="money">${money(x.net)}</td></tr>`).join('');return`<div class="accounting-report-head"><h3>التدفقات النقدية المباشرة</h3><button onclick="QatraAccounting.exportCurrent('cashflow')">تصدير Excel</button></div>${tableHtml(['التاريخ','المرجع','البيان','التصنيف','داخل','خارج','الصافي'],body)}<div class="accounting-total">داخل: ${money(cf.inflow)} · خارج: ${money(cf.outflow)} · صافي التدفق: ${money(cf.net)}</div>`}
  function manualHtml(){const opts=ensureState().chart.map(a=>`<option value="${a.code}">${a.code} — ${esc(a.name)}</option>`).join(''),list=ensureState().manualJournals.slice().reverse(),body=list.map(j=>`<tr><td>${j.date}</td><td dir="ltr">${j.id}</td><td>${esc(j.description)}</td><td>${money(totals(j).debit)}</td><td>${j.reversalOf?'قيد عكسي':`<button class="mini warn" onclick="QatraAccounting.reversePrompt('${j.id}')">عكس</button>`}</td></tr>`).join('');return`<div class="grid two"><div class="card"><h3>قيد يومية يدوي</h3><div class="notice">لا يمكن حذف قيد مرحّل. التصحيح يتم بقيد عكسي موثق.</div><div class="form-row"><div class="field"><label>التاريخ</label><input id="jvDate" type="date" value="${today()}"></div><div class="field"><label>المرجع</label><input id="jvRef"></div><div class="field wide"><label>البيان</label><input id="jvDesc"></div></div><div class="journal-entry-grid"><select id="jvDebitAccount">${opts}</select><input id="jvAmount" type="number" min="0" placeholder="المبلغ"><select id="jvCreditAccount">${opts}</select><input id="jvCostCenter" placeholder="مركز التكلفة (اختياري)"></div><button class="green" onclick="QatraAccounting.saveManual()">ترحيل القيد المتوازن</button></div><div class="card"><h3>إرشادات القيد</h3><p>اختر الحساب المدين والحساب الدائن وأدخل المبلغ. يمنع النظام ترحيل حساب واحد في الطرفين أو قيد غير متوازن أو تاريخ داخل فترة مقفلة.</p></div></div><div class="card"><h3>القيود اليدوية والعكسية</h3>${tableHtml(['التاريخ','القيد','البيان','القيمة','الإجراء'],body)}</div>`}
  function controlsHtml(){const m=month(today());return`<div class="accounting-controls"><div class="field"><label>من تاريخ</label><input id="accFrom" type="date" value="${m}-01" onchange="QatraAccounting.renderView()"></div><div class="field"><label>إلى تاريخ</label><input id="accTo" type="date" value="${today()}" onchange="QatraAccounting.renderView()"></div><button class="light" onclick="QatraAccounting.printCurrent()">طباعة / PDF</button></div>`}
  function periodHtml(){const a=ensureState(),body=a.closedPeriods.slice().reverse().map(p=>`<tr><td>${p.month}</td><td>${esc(p.closedAt)}</td><td>${p.reopenedAt?`أعيد فتحها: ${esc(p.reopenReason)}`:'مقفلة'}</td><td>${!p.reopenedAt?`<button class="mini warn" onclick="QatraAccounting.reopenPrompt('${p.month}')">إعادة فتح</button>`:''}</td></tr>`).join(''),recs=a.reconciliations.slice().reverse().map(r=>`<tr><td>${r.date}</td><td>${r.account}</td><td>${money(r.calculated)}</td><td>${money(r.statementBalance)}</td><td>${money(r.difference)}</td><td>${esc(r.notes)}</td></tr>`).join('');return`<div class="grid two"><div class="card"><h3>إقفال فترة محاسبية</h3><div class="notice warning">الإقفال يمنع إضافة فواتير أو تحصيلات أو مصروفات أو قيود يدوية داخل الشهر.</div><div class="form-row"><div class="field"><label>الشهر</label><input id="closeMonth" type="month" value="${month(today())}"></div><div class="field"><label>ملاحظات الإقفال</label><input id="closeNotes"></div></div><button class="warn" onclick="QatraAccounting.closePrompt()">فحص وإقفال الفترة</button></div><div class="card"><h3>تسوية صندوق / بنك</h3><div class="form-row"><div class="field"><label>الحساب</label><select id="recAccount"><option value="1110">1110 — البنك</option><option value="1100">1100 — الصندوق</option></select></div><div class="field"><label>التاريخ</label><input id="recDate" type="date" value="${today()}"></div><div class="field"><label>رصيد الكشف الفعلي</label><input id="recBalance" type="number"></div><div class="field"><label>ملاحظات</label><input id="recNotes"></div></div><button class="green" onclick="QatraAccounting.saveReconciliation()">حفظ نتيجة التسوية</button></div></div><div class="card"><h3>الفترات</h3>${tableHtml(['الشهر','تاريخ الإقفال','الحالة',''],body)}</div><div class="card"><h3>سجل التسويات</h3>${tableHtml(['التاريخ','الحساب','الدفتري','الفعلي','الفرق','ملاحظات'],recs)}</div>`}
  const VIEW_RENDERERS={summary:summaryHtml,journal:journalHtml,chart:chartHtml,trial:trialHtml,ledger:ledgerHtml,income:incomeHtml,balance:balanceHtml,aging:agingHtml,cashflow:cashFlowHtml,manual:manualHtml,periods:periodHtml};
  const VIEW_LABELS={summary:'الملخص',journal:'اليومية',chart:'دليل الحسابات',trial:'ميزان المراجعة',ledger:'الأستاذ العام',income:'قائمة الدخل',balance:'المركز المالي',aging:'أعمار الديون',cashflow:'التدفقات النقدية',manual:'قيد يدوي',periods:'الإقفال والتسوية'};
  function render(){
    const root=$('#accounting');if(!root||!S())return;
    ensureState();
    root.dataset.accountingView=currentView;
    const buttons=Object.keys(VIEW_RENDERERS).map(k=>`<button class="${currentView===k?'active':''}" onclick="QatraAccounting.renderView('${k}')">${VIEW_LABELS[k]}</button>`).join('');
    root.innerHTML=`<div class="accounting-shell"><div class="accounting-hero"><div><small>نظام مالي بالقيد المزدوج</small><h2>المحاسبة العامة والرقابة المالية</h2><p>قيود آلية من الفواتير والتحصيلات والمصروفات والصندوق، مع تقارير مالية مترابطة.</p></div><span>⚖️</span></div>${controlsHtml()}<nav class="accounting-nav" aria-label="واجهات المحاسبة">${buttons}</nav><div id="accountingView">${VIEW_RENDERERS[currentView]()}</div></div>`;
    decorateAccountingTables($('#accountingView'));
  }
  function renderView(view){
    const from=$('#accFrom')?.value,to=$('#accTo')?.value,ledger=$('#accLedgerAccount')?.value;
    if(view)currentView=view;
    render();
    if(from)$('#accFrom').value=from;
    if(to)$('#accTo').value=to;
    if(ledger&&$('#accLedgerAccount'))$('#accLedgerAccount').value=ledger;
    const content=$('#accountingView');
    if(content){content.innerHTML=VIEW_RENDERERS[currentView]();decorateAccountingTables(content);}
  }
  function showJournal(id){const j=buildJournals().find(x=>x.id===id);if(!j)return;const body=j.lines.map(l=>{const a=account(l.account);return`<tr><td>${l.account} — ${esc(a.name)}</td><td>${money(l.debit)}</td><td>${money(l.credit)}</td><td>${esc(l.partyName||'')}</td><td>${esc(l.costCenter||'')}</td></tr>`}).join('');Y().printWindow(`القيد ${j.id}`,`${Y().orgHeaderHtml(false,'report')}<h3>${esc(j.description)}</h3><p>${j.date} | ${esc(j.ref)}</p>${tableHtml(['الحساب','مدين','دائن','الطرف','مركز التكلفة'],body)}`,'A4')}
  function saveManual(){try{const amount=n($('#jvAmount')?.value),debit=$('#jvDebitAccount')?.value,credit=$('#jvCreditAccount')?.value;if(debit===credit)throw new Error('يجب اختيار حسابين مختلفين');const cc=$('#jvCostCenter')?.value||'';postManual({date:$('#jvDate')?.value,ref:$('#jvRef')?.value,description:$('#jvDesc')?.value||'قيد يدوي',lines:[{account:debit,debit:amount,credit:0,costCenter:cc},{account:credit,debit:0,credit:amount,costCenter:cc}]});renderView('manual');alert('تم ترحيل القيد بنجاح.')}catch(e){alert(e.message)}}
  function saveAccount(){try{addAccount({code:$('#newAccCode')?.value,name:$('#newAccName')?.value,type:$('#newAccType')?.value,group:$('#newAccGroup')?.value});renderView('chart');alert('تمت إضافة الحساب إلى الدليل.')}catch(e){alert(e.message)}}
  function reversePrompt(id){const reason=prompt('اكتب سبب عكس القيد:');if(reason===null)return;const date=prompt('تاريخ القيد العكسي YYYY-MM-DD:',today());if(date===null)return;try{reverseManual(id,date,reason);renderView('manual');alert('تم إنشاء قيد عكسي موثق.')}catch(e){alert(e.message)}}
  function closePrompt(){if(!confirm('بعد الإقفال لن تقبل الفترة حركات جديدة. متابعة؟'))return;try{closePeriod($('#closeMonth')?.value,$('#closeNotes')?.value);renderView('periods');alert('تم إقفال الفترة بنجاح.')}catch(e){alert(e.message)}}
  function reopenPrompt(m){const reason=prompt('اكتب سبب إعادة فتح الفترة:');if(reason===null)return;try{reopenPeriod(m,reason);renderView('periods');alert('تم فتح الفترة مع توثيق السبب.')}catch(e){alert(e.message)}}
  function saveReconciliation(){try{const r=reconcile({account:$('#recAccount')?.value,date:$('#recDate')?.value,statementBalance:$('#recBalance')?.value,notes:$('#recNotes')?.value});renderView('periods');alert(`تم حفظ التسوية. الفرق: ${money(r.difference)}`)}catch(e){alert(e.message)}}
  function printCurrent(){
    const view=$('#accountingView');if(!view)return;
    const columns=Array.from(view.querySelectorAll('table')).reduce((max,table)=>Math.max(max,table.querySelectorAll('thead tr:first-child th').length||table.querySelectorAll('tr:first-child th,tr:first-child td').length),0);
    const title=VIEW_LABELS[currentView],page=columns>7?'A4L':'A4',wide=columns>7?' report-wide':'';
    const generated=new Date().toLocaleString('ar-YE');
    const body=`<div class="report-document accounting-print-document${wide}">${Y().orgHeaderHtml(false,'report')}<div class="report-print-title"><small>تقرير محاسبي رسمي</small><h1>${esc(title)}</h1></div><div class="report-generated"><span>الفترة</span><b>${esc(dateRange().from||'البداية')} — ${esc(dateRange().to)}</b><span>تاريخ الإصدار</span><b>${esc(generated)}</b></div>${view.innerHTML}</div>`;
    Y().printWindow(title,body,page);
  }
  function exportCurrent(kind=currentView){const r=dateRange();let rows=[];
    if(kind==='journal')rows=[['التاريخ','القيد','المرجع','البيان','المصدر','الحساب','اسم الحساب','مدين','دائن','الطرف','مركز التكلفة']];
    if(kind==='journal')buildJournals(S(),r).forEach(j=>j.lines.forEach(l=>rows.push([j.date,j.id,j.ref,j.description,j.source,l.account,account(l.account).name,l.debit,l.credit,l.partyName||'',l.costCenter||''])));
    if(kind==='chart')rows=[['الرمز','الحساب','النوع','المجموعة']].concat(ensureState().chart.map(a=>[a.code,a.name,TYPES[a.type],a.group]));
    if(kind==='trial'){const tb=trialBalance(S(),r);rows=[['الرمز','الحساب','حركة مدين','حركة دائن','رصيد مدين','رصيد دائن']].concat(tb.rows.map(x=>[x.code,x.name,x.debit,x.credit,x.debitBalance,x.creditBalance]));}
    if(kind==='ledger'){const code=$('#accLedgerAccount')?.value||'1100';rows=[['التاريخ','القيد','المرجع','البيان','الطرف','مركز التكلفة','مدين','دائن']];buildJournals(S(),r).forEach(j=>j.lines.filter(l=>l.account===code).forEach(l=>rows.push([j.date,j.id,j.ref,j.description,l.partyName||'',l.costCenter||'',l.debit,l.credit])))}
    if(kind==='income'){const x=incomeStatement(S(),r);rows=[['النوع','الرمز','الحساب','المبلغ']].concat(x.revenues.map(a=>['إيراد',a.code,a.name,a.amount]),x.expenses.map(a=>['مصروف',a.code,a.name,a.amount]),[['صافي النتيجة','','',x.netIncome]]);}
    if(kind==='balance'){const x=balanceSheet(S(),r.to);rows=[['النوع','الرمز','الحساب','الرصيد']].concat(x.assets.map(a=>['أصل',a.code,a.name,a.amount]),x.liabilities.map(a=>['التزام',a.code,a.name,a.amount]),x.equity.map(a=>['حقوق ملكية',a.code,a.name,a.amount]));}
    if(kind==='aging')rows=[['رقم المشترك','الاسم','الهاتف','0-30','31-60','61-90','أكثر من 90','الإجمالي','دفعة مقدمة']].concat(aging(S(),r.to).map(x=>[x.code,x.name,x.phone,x['0-30'],x['31-60'],x['61-90'],x['90+'],x.total,x.advance]));
    if(kind==='cashflow')rows=[['التاريخ','المرجع','البيان','التصنيف','داخل','خارج','الصافي']].concat(cashFlow(S(),r).rows.map(x=>[x.date,x.ref,x.description,x.category,x.inflow,x.outflow,x.net]));
    const filename=`qatra-accounting-${kind}-${today()}`;
    if(global.AndroidBridge&&typeof global.AndroidBridge.exportXlsx==='function')global.AndroidBridge.exportXlsx(filename+'.xlsx',VIEW_LABELS[kind]||'المحاسبة',JSON.stringify(rows));else Y().exportCSV(filename+'.csv',rows);
  }
  function blockedDate(label,date){if(!isClosed(date))return false;alert(`الفترة ${month(date)} مقفلة. لا يمكن ${label}. افتح الفترة من شاشة المحاسبة بصلاحية الإدارة مع توثيق السبب.`);return true}
  function wrapOperations(){if(!global.App)return;const wrap=(name,dateOf,label)=>{const old=global.App[name];if(typeof old!=='function'||old.__qatraAccountingGuard)return;const guarded=function(...args){const date=dateOf(...args);if(date&&blockedDate(label,date))return;const result=old.apply(this,args);setTimeout(()=>{ensureState();render()},250);return result};guarded.__qatraAccountingGuard=true;global.App[name]=guarded};wrap('savePayment',()=>$('#payDate')?.value||today(),'تسجيل التحصيل');wrap('saveExpense',()=>$('#expDate')?.value||today(),'تسجيل المصروف');wrap('generateInvoices',id=>(S().cycles||[]).find(c=>c.id===id)?.cycleDate,'إنشاء الفواتير');wrap('saveCycleReadings',id=>(S().cycles||[]).find(c=>c.id===id)?.cycleDate,'تعديل قراءات دورة مقفلة');const oldMerge=global.App.mergeSyncData;if(typeof oldMerge==='function'&&!oldMerge.__qatraAccountingGuard){const guardedMerge=function(data){const locked=[...(data?.invoices||[]),...(data?.payments||[]),...(data?.expenses||[])].find(x=>isClosed(x.date));if(locked&&blockedDate('استيراد حركة إلى فترة مقفلة',locked.date))return;return oldMerge.apply(this,arguments)};guardedMerge.__qatraAccountingGuard=true;global.App.mergeSyncData=guardedMerge}}
  function init(){if(!S())return;ensureState();try{Y().save()}catch(e){}setTimeout(()=>{wrapOperations();render()},500);setTimeout(wrapOperations,1800)}
  global.QatraAccounting={DEFAULT_CHART,EXPENSE_MAP,ensureState,account,isClosed,journal,line,totals,validateJournal,buildJournals,validateLedger,accountActivity,trialBalance,incomeStatement,balanceSheet,aging,cashFlow,postManual,reverseManual,closePeriod,reopenPeriod,reconcile,addAccount,decorateAccountingTables,render,renderView,showJournal,saveManual,saveAccount,reversePrompt,closePrompt,reopenPrompt,saveReconciliation,printCurrent,exportCurrent,wrapOperations};
  global.document?.addEventListener('DOMContentLoaded',init);
})(typeof window!=='undefined'?window:globalThis);
