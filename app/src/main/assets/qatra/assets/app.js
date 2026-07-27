/* Qatra Pro Production Safety v11 Editable Cycles + Excel Gray Half-Cycle Subscribers - Complete Offline PWA
   نظام محاسبي وتشغيلي لمشروع مياه: مشتركين، قراءات، فواتير، تحصيل، مصروفات، تقارير، تصدير/استيراد.
*/
const YWP_KEY = 'qatra_pro_v6_editable_cycles_from_gray_excel';
const QATRA_BACKUPS_KEY = 'qatra_pro_local_backups_v1';
const QATRA_LAST_AUTO_BACKUP_KEY = 'qatra_pro_last_auto_backup_date_v1';

const QATRA_INITIAL_STATE = {meta:{createdAt:"",version:"2.0.0-secure",type:"QATRA_PRO_FULL_BACKUP",appName:"Qatra Pro"},settings:{projectName:"",ownerName:"",projectLogo:"",projectEmail:"",projectPhone1:"",projectPhone2:"",projectWhatsApp:"",projectAddress:"",projectAccountNo:"",currency:"ريال يمني",currencyShort:"ر.ي",currencyFull:"ريال يمني",tariff:0,mainMeterSize:"",branchDescription:"",halfCycleDay:14,monthCycleDay:28,invoiceFooter:"",receiptFooter:"",thermalPrinterProfile:"Portable Bluetooth Thermal",paperPrinterProfile:"A4-A5",receiptThermalWidth:"58",documentPrinterNote:""},subscribers:[],cycles:[],readings:[],invoices:[],payments:[],expenses:[]};

const YWP = (() => {
  const today = () => new Date().toISOString().slice(0,10);
  const uid = (p='ID') => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  const money = n => Number(n||0).toLocaleString('en-US') + ' ' + (state?.settings?.currencyShort || 'ر.ي');
  const num = n => Number(n||0).toLocaleString('en-US');
  const toNumber = v => { const n = Number(String(v??'').replace(/,/g,'')); return Number.isFinite(n)?n:0; };
  const monthKey = d => (d || today()).slice(0,7);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const arCycle = t => t === 'HALF' ? 'دورة نصف الشهر - يوم 14' : 'دورة نهاية الشهر - يوم 28';
  const arStatus = status => status === 'paid' ? '<span class="badge green">مسددة/مغطاة</span>' : status === 'partial' ? '<span class="badge warn">جزئي</span>' : '<span class="badge red">مطالب بها</span>';

  function defaultState(){
    return JSON.parse(JSON.stringify(QATRA_INITIAL_STATE));
  }
  function load(){
    try{
      const saved = QatraStore.load('admin', defaultState, [YWP_KEY]);
      if(saved && Array.isArray(saved.subscribers)) return saved;
      return defaultState();
    }
    catch(e){ return defaultState(); }
  }
  let state = load();
  function openingArrears(s){ return toNumber(s?.openingArrears ?? Math.max(0, toNumber(s?.openingBalance))); }
  function openingCredit(s){ return toNumber(s?.openingCredit ?? Math.max(0, -toNumber(s?.openingBalance))); }
  function openingNet(s){ return openingArrears(s) - openingCredit(s); }
  function migrateState(){
    if(!state || !Array.isArray(state.subscribers)) return;
    state.subscribers.forEach(s => {
      if(s.openingReading === undefined) s.openingReading = 0;
      if(s.openingArrears === undefined) s.openingArrears = Math.max(0, toNumber(s.openingBalance));
      if(s.openingCredit === undefined) s.openingCredit = Math.max(0, -toNumber(s.openingBalance));
      if(s.previousPayments === undefined) s.previousPayments = 0;
      if(s.previousPaymentsDate === undefined) s.previousPaymentsDate = '';
      s.openingBalance = openingNet(s);
    });
    // المدفوعات السابقة المستوردة من كشف Excel هي بيان تاريخي للعرض فقط.
    // لا تعتبر تحصيلاً جديداً، ولا تنقص الفاتورة الحالية، ولا تدخل في الصندوق.
    state.payments ||= [];
    const importedPreviousPayments = state.payments.filter(p => p && (p.method === 'مدفوعات سابقة' || String(p.id||'').startsWith('PAY-EXCEL-')));
    if(importedPreviousPayments.length){
      const totals = {};
      importedPreviousPayments.forEach(p => {
        const x = totals[p.subscriberId] ||= {amount:0,date:''};
        x.amount += toNumber(p.amount);
        if((p.date||'') > x.date) x.date = p.date || '';
      });
      Object.entries(totals).forEach(([subId,x]) => {
        const s = state.subscribers.find(row => row.id === subId);
        if(s){
          s.previousPayments = toNumber(s.previousPayments) + toNumber(x.amount);
          s.previousPaymentsDate = s.previousPaymentsDate || x.date || '';
          s.previousPaymentsSource = 'كشف Excel المعتمد';
        }
      });
      state.payments = state.payments.filter(p => !(p && (p.method === 'مدفوعات سابقة' || String(p.id||'').startsWith('PAY-EXCEL-'))));
    }
    state.meta ||= {};
    state.meta.version = '13.0.0-official-invoice-native-intents';
    state.settings ||= {};
    if(state.settings.projectLogo === undefined) state.settings.projectLogo = '';
    if(state.settings.projectEmail === undefined) state.settings.projectEmail = '';
    if(state.settings.projectPhone1 === undefined) state.settings.projectPhone1 = '';
    if(state.settings.projectPhone2 === undefined) state.settings.projectPhone2 = '';
    if(state.settings.projectWhatsApp === undefined) state.settings.projectWhatsApp = '';
    if(state.settings.projectAddress === undefined) state.settings.projectAddress = '';
    if(!state.settings.thermalPrinterProfile) state.settings.thermalPrinterProfile = 'Portable Bluetooth Thermal 58mm - ESC/POS - سندات القبض فقط';
    if(!state.settings.paperPrinterProfile) state.settings.paperPrinterProfile = 'Epson EcoTank L3110 - A5 للفواتير والسندات، A4 للكشوفات';
    if(!state.settings.receiptThermalWidth) state.settings.receiptThermalWidth = '58';
    if(!state.settings.documentPrinterNote) state.settings.documentPrinterNote = 'الطابعة الورقية Epson L3110 تستخدم من نافذة الطباعة عبر الكمبيوتر/الجهاز المثبت عليه تعريف الطابعة.';
    if(!state.settings.projectName) state.settings.projectName = 'قطرة برو';
    if(!state.settings.ownerName) state.settings.ownerName = '';
    if(!state.settings.projectPhone1) state.settings.projectPhone1 = '';
    if(!state.settings.projectWhatsApp) state.settings.projectWhatsApp = '';
    if(!state.settings.projectAddress) state.settings.projectAddress = '';
    if(!state.settings.projectAccountNo) state.settings.projectAccountNo = '';
if(!state.settings.currencyFull) state.settings.currencyFull = 'ريال يمني';
    if(!state.settings.currencyShort || state.settings.currencyShort === 'ر.س') state.settings.currencyShort = 'ر.ي';
    if(!state.settings.currency || state.settings.currency === 'ريال' || state.settings.currency === 'ر.س') state.settings.currency = 'ريال يمني';
    if(!state.settings.invoiceHeaderTitle) state.settings.invoiceHeaderTitle = state.settings.projectName;
    if(!state.settings.invoiceHeaderSubtitle) state.settings.invoiceHeaderSubtitle = '';
    if(!state.settings.receiptHeaderTitle) state.settings.receiptHeaderTitle = state.settings.projectName;
    if(!state.settings.receiptHeaderSubtitle) state.settings.receiptHeaderSubtitle = '';
    if(!state.settings.reportsHeaderTitle) state.settings.reportsHeaderTitle = state.settings.projectName;
    if(!state.settings.reportsHeaderSubtitle) state.settings.reportsHeaderSubtitle = '';
    if(!state.settings.documentHeaderLine1) state.settings.documentHeaderLine1 = '';
    if(!state.settings.documentHeaderLine2) state.settings.documentHeaderLine2 = '';
    if(!state.settings.documentHeaderLine3) state.settings.documentHeaderLine3 = '';
    if(!state.settings.documentHeaderLine4) state.settings.documentHeaderLine4 = '';
    if(!state.settings.invoiceTitle) state.settings.invoiceTitle = 'فاتورة استهلاك مياه';
    if(!state.settings.receiptTitle) state.settings.receiptTitle = 'سند قبض';
    if(!state.settings.reportsFooter) state.settings.reportsFooter = 'صادر عن نظام قطرة برو';
        const defaultInvoiceSms = 'الأخ/ {name}، فاتورة المياه رقم {invoiceNo}، رقم العداد {meterNo}، دورة {cycleName} بتاريخ {date}. القراءة السابقة {prevReading}، الحالية {currentReading}، الفارق {consumption} م³، استهلاك الدورة {amount} {currencyShort}، المتأخرات {arrears} {currencyShort}، إجمالي المبلغ المستحق {totalDue} {currencyShort}، حالة الفاتورة: {status}. المدفوعات السابقة {previousPayments} {currencyShort} هي آخر مدفوعات الفاتورة السابقة، ولا تعد سداداً لهذه الفاتورة. {project}';
    const defaultInvoiceWa = 'فاتورة استهلاك مياه\nالمشروع: {project}\nرقم الفاتورة: {invoiceNo}\nالمشترك: {name}\nرقم العداد: {meterNo}\nالدورة: {cycleName} - {date}\nق. سابقة: {prevReading}\nق. حالية: {currentReading}\nالفارق: {consumption} م³\nسعر الوحدة: {tariff} {currencyShort}\nاستهلاك الدورة: {amount} {currencyShort}\nالمتأخرات: {arrears} {currencyShort}\nالرصيد المقدم: {openingCredit} {currencyShort}\nإجمالي المبلغ المستحق: {totalDue} {currencyShort}\nإجمالي المستحق كتابة: {totalDueWords}\nالمدفوعات السابقة: {previousPayments} {currencyShort} (آخر مدفوعات الفاتورة السابقة، للعرض فقط)\nحالة الفاتورة: {status}';
    const defaultReceiptSms = 'الأخ/ {name}، تم استلام مبلغ {paymentAmount} {currencyShort} بطريقة {paymentMethod}. سند رقم {receiptNo} بتاريخ {paymentDate}. الرصيد بعد السداد: {balanceAfter}. {project}';
    const defaultReceiptWa = 'سند قبض\nالمشترك: {name}\nرقم المشترك: {subscriberCode}\nرقم السند: {receiptNo}\nالتاريخ: {paymentDate}\nالمبلغ المقبوض: {paymentAmount} {currencyShort}\nطريقة الدفع: {paymentMethod}\nالمحصل: {collector}\nالرصيد بعد السداد: {balanceAfter}\n{project}';
    if(!state.settings.messageTemplatesV12){
      if(!state.settings.invoiceSmsTemplate || state.settings.invoiceSmsTemplate.includes('{lastPayment}') || state.settings.invoiceSmsTemplate.includes('آخر مدفوعات')) state.settings.invoiceSmsTemplate = defaultInvoiceSms;
      if(!state.settings.invoiceWhatsappTemplate || state.settings.invoiceWhatsappTemplate.includes('{lastPayment}') || state.settings.invoiceWhatsappTemplate.includes('آخر مدفوعات')) state.settings.invoiceWhatsappTemplate = defaultInvoiceWa;
      state.settings.messageTemplatesV12 = true;
    }
    // Never overwrite a template that the operator already saved. Older releases
    // replaced both invoice templates while migrating to v13, which made the
    // messaging center appear to ignore Settings.
    if(!state.settings.messageTemplatesV13) state.settings.messageTemplatesV13 = true;
    if(!state.settings.invoiceSmsTemplate) state.settings.invoiceSmsTemplate = state.settings.smsTemplate || defaultInvoiceSms;
    if(!state.settings.invoiceWhatsappTemplate) state.settings.invoiceWhatsappTemplate = defaultInvoiceWa;
    if(!state.settings.receiptSmsTemplate) state.settings.receiptSmsTemplate = defaultReceiptSms;
    if(!state.settings.receiptWhatsappTemplate) state.settings.receiptWhatsappTemplate = defaultReceiptWa;
    const defaultGeneralSms = 'الأخ/ {name}، هذا إشعار من {project}. رقم المشترك: {subscriberCode}. رقم العداد: {meterNo}. الرصيد الحالي: {balance}.';
    const defaultGeneralWa = 'إشعار للمشترك\nالمشروع: {project}\nالاسم: {name}\nرقم المشترك: {subscriberCode}\nرقم العداد: {meterNo}\nالمنطقة: {area}\nالرصيد الحالي: {balance}';
    if(!state.settings.generalSmsTemplate) state.settings.generalSmsTemplate = state.settings.bulkMessageTemplate || defaultGeneralSms;
    if(!state.settings.generalWhatsappTemplate) state.settings.generalWhatsappTemplate = state.settings.bulkMessageTemplate || defaultGeneralWa;
    // Kept only for backwards-compatible imports. The messaging center reads the
    // channel-specific templates above and never exposes an editable message box.
    if(!state.settings.bulkMessageTemplate) state.settings.bulkMessageTemplate = state.settings.generalSmsTemplate;
    if(!['sms','whatsapp'].includes(state.settings.bulkDefaultChannel)) state.settings.bulkDefaultChannel = 'sms';
    if(!['group','personalized'].includes(state.settings.bulkDefaultMode)) state.settings.bulkDefaultMode = 'personalized';
    if(!['general','invoice'].includes(state.settings.bulkDefaultTemplateKind)) state.settings.bulkDefaultTemplateKind = 'general';
    state.settings.smsTemplate = state.settings.invoiceSmsTemplate;
  }
  migrateState();
  // بعد فصل المدفوعات السابقة التاريخية عن التحصيلات، أعد احتساب حالة كل فاتورة من سندات القبض الحقيقية فقط.
  recomputeInvoiceStatuses();
  function save(){ migrateState(); QatraStore.save('admin', state); }
  function setState(s){ state = s; save(); }
  function subscriber(id){ return state.subscribers.find(s => s.id === id); }
  function cycle(id){ return state.cycles.find(c => c.id === id); }
  function invoice(id){ return state.invoices.find(i => i.id === id); }
  function activeSubscribers(type){
    return state.subscribers.filter(s => s.status !== 'stopped' && (type === 'HALF' ? s.readingGroup === 'HALF' : true));
  }
  function lastReading(subId, beforeDate=null){
    const rows = state.readings
      .filter(r => r.subscriberId === subId)
      .filter(r => !beforeDate || (cycle(r.cycleId)?.cycleDate || '') < beforeDate)
      .sort((a,b)=>(cycle(b.cycleId)?.cycleDate||'').localeCompare(cycle(a.cycleId)?.cycleDate||''));
    if(rows[0]) return rows[0];
    const s = subscriber(subId) || {};
    return {id:'OPENING', subscriberId:subId, prev:toNumber(s.openingReading), current:toNumber(s.openingReading), consumption:0, notes:'قراءة افتتاحية'};
  }
  function lastMainCurrent(beforeDate=null){
    const rows = state.cycles.filter(c => c.type === 'MONTHLY' && c.mainCurrent !== null && c.mainCurrent !== undefined && c.mainCurrent !== '')
      .filter(c => !beforeDate || c.cycleDate < beforeDate)
      .sort((a,b)=>b.cycleDate.localeCompare(a.cycleDate));
    return rows.length ? toNumber(rows[0].mainCurrent) : 0;
  }
  function balance(subId, beforeInvoiceId=null){
    let bal = openingNet(subscriber(subId));
    const invs = state.invoices.filter(i => i.subscriberId === subId && (!beforeInvoiceId || i.id !== beforeInvoiceId));
    invs.forEach(i => bal += toNumber(i.amount));
    state.payments.filter(p => p.subscriberId === subId && (p.incomeType || 'WATER') === 'WATER' && p.confirmed !== false).forEach(p => bal -= toNumber(p.amount));
    return bal;
  }
  function invoicePaidAmount(inv){
    const info = invoiceAllocation(inv.subscriberId)[inv.id];
    return info ? info.paid : 0;
  }
  function invoiceAllocation(subId){
    const s = subscriber(subId) || {};
    const invs = state.invoices
      .filter(i => i.subscriberId === subId)
      .sort((a,b)=>((a.date||'')+(a.no||'')).localeCompare((b.date||'')+(b.no||'')));
    const opening = openingNet(s);
    const totalPayments = state.payments.filter(p => p.subscriberId === subId && (p.incomeType || 'WATER') === 'WATER' && p.confirmed !== false).reduce((a,p)=>a+toNumber(p.amount),0);
    // أي رصيد افتتاحي سالب يعتبر مقدم، وأي مبلغ مدفوع يوزع على أقدم المديونيات أولاً.
    let available = totalPayments + Math.max(0, -opening);
    const priorDebt = Math.max(0, opening);
    available = Math.max(0, available - priorDebt);
    const map = {};
    invs.forEach(inv => {
      const amount = Math.max(0, toNumber(inv.amount));
      const paid = Math.min(available, amount);
      available = Math.max(0, available - paid);
      const remaining = Math.max(0, amount - paid);
      map[inv.id] = {paid, remaining, status: remaining <= 0 ? 'paid' : (paid > 0 ? 'partial' : 'due')};
    });
    return map;
  }
  function recomputeInvoiceStatuses(){
    const grouped = {};
    state.invoices.forEach(inv => { (grouped[inv.subscriberId] ||= []).push(inv); });
    Object.keys(grouped).forEach(subId => {
      const map = invoiceAllocation(subId);
      grouped[subId].forEach(inv => {
        const info = map[inv.id] || {paid:0, remaining:toNumber(inv.amount), status:'due'};
        inv.paidAmount = info.paid;
        inv.remainingAmount = info.remaining;
        inv.status = info.status;
        inv.totalDue = balance(subId);
      });
    });
    save();
  }
  function readingsForCycle(cycleId){ return state.readings.filter(r => r.cycleId === cycleId); }
  function consumptionInMonth(month){
    const cycleIds = state.cycles.filter(c => monthKey(c.cycleDate) === month).map(c => c.id);
    return state.readings.filter(r => cycleIds.includes(r.cycleId)).reduce((a,r)=>a+toNumber(r.consumption),0);
  }
  function invoicesInMonth(month){ return state.invoices.filter(i => monthKey(i.date) === month); }
  function paymentsInMonth(month){ return state.payments.filter(p => monthKey(p.date) === month); }
  function expensesInMonth(month){ return state.expenses.filter(e => monthKey(e.date) === month); }
  function download(filename, content, type='text/plain;charset=utf-8'){
    // داخل تطبيق Android نستخدم الجسر الأصلي حتى يظهر مربع الحفظ/المشاركة فعلياً.
    if(window.AndroidBridge && typeof AndroidBridge.saveFile === 'function'){
      AndroidBridge.saveFile(String(filename), String(content), String(type));
      return;
    }
    const blob = new Blob([content], {type});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  }
  function backupStamp(){
    const d = new Date();
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }
  function backupSummary(payload=state){
    return {
      subscribers: payload.subscribers?.length || 0,
      cycles: payload.cycles?.length || 0,
      invoices: payload.invoices?.length || 0,
      payments: payload.payments?.length || 0,
      expenses: payload.expenses?.length || 0,
      exportedAt: new Date().toISOString()
    };
  }
  function backupPayload(source='manual'){
    const payload = JSON.parse(JSON.stringify(state));
    payload.meta ||= {};
    payload.meta.type = 'QATRA_PRO_FULL_BACKUP';
    payload.meta.appName = 'Qatra Pro';
    payload.meta.version = '13.0.0-official-invoice-native-intents';
    payload.meta.backupSource = source;
    payload.meta.backupAt = new Date().toISOString();
    payload.meta.summary = backupSummary(payload);
    return payload;
  }
  function localBackups(){
    try{ return QatraStore.load('admin.backups', () => ({items:[], lastAutoDate:''})).items || []; }
    catch(e){ return []; }
  }
  function saveLocalBackups(list){
    try{
      const box = QatraStore.load('admin.backups', () => ({items:[], lastAutoDate:''}));
      box.items = list.slice(0,3);
      QatraStore.save('admin.backups', box);
    }
    catch(e){ console.warn('تعذر حفظ النسخة المحلية في SQLite', e); }
  }
  function rememberLocalBackup(source='auto'){
    const payload = backupPayload(source);
    const list = localBackups();
    const item = {
      id: uid('BKP'),
      source,
      createdAt: payload.meta.backupAt,
      filename: `qatra-pro-backup-${backupStamp()}.json`,
      summary: payload.meta.summary,
      payload
    };
    list.unshift(item);
    saveLocalBackups(list);
    return item;
  }
  function ensureDailyAutoBackup(){
    const d = today();
    const box = QatraStore.load('admin.backups', () => ({items:[], lastAutoDate:''}));
    if(box.lastAutoDate !== d){
      rememberLocalBackup('daily-auto');
      const next = QatraStore.load('admin.backups', () => ({items:[], lastAutoDate:''}));
      next.lastAutoDate = d;
      QatraStore.save('admin.backups', next);
    }
  }
  function lastBackupInfo(){
    return localBackups()[0] || null;
  }
  function exportBackupFile(source='manual'){
    const item = rememberLocalBackup(source);
    item.filename = `qatra-pro-backup-${backupStamp()}.qbackup`;
    QatraBackup.export(item.filename, 'FULL_BACKUP');
    return item;
  }
  function restoreLocalBackup(id){
    const item = localBackups().find(b=>b.id===id);
    if(!item) return false;
    const startedAt=state.meta?.productionStartedAt;
    rememberLocalBackup('before-local-restore');
    const restored=JSON.parse(JSON.stringify(item.payload));
    restored.meta={...(restored.meta||{}),productionStartedAt:restored.meta?.productionStartedAt||startedAt||null};
    setState(restored);
    return true;
  }
  function deleteLocalBackup(id){
    saveLocalBackups(localBackups().filter(b=>b.id!==id));
  }
  function exportLocalBackup(id){
    const item = localBackups().find(b=>b.id===id);
    if(item) QatraBackup.export(`qatra-pro-local-backup-${today()}.qbackup`, 'FULL_BACKUP', item.payload);
  }
  function exportCSV(filename, rows){
    const csv = rows.map(row => row.map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
    download(filename, '\ufeff' + csv, 'text/csv;charset=utf-8');
  }
  function marketingMarkHtml(){
    return `<div class="qatra-print-brand" aria-label="Qatra Pro"><img src="assets/qatra-pro-mark.svg" alt="Qatra Pro"><span><b>QATRA PRO</b><small>نظام قطرة برو لإدارة خدمات المياه</small></span></div>`;
  }
  function orgHeaderHtml(compact=false, docType='general'){
    const st = state.settings || {};
    const logoUrl = st.projectLogo || 'assets/qatra-pro-mark.svg';
    const logo = `<img class="org-logo" src="${esc(logoUrl)}" alt="شعار ${esc(st.projectName || 'قطرة برو')}">`;
    const title = docType === 'invoice' ? (st.invoiceHeaderTitle || st.projectName) : docType === 'receipt' ? (st.receiptHeaderTitle || st.projectName) : docType === 'report' ? (st.reportsHeaderTitle || st.projectName) : (st.projectName || 'قطرة برو');
    const subtitle = docType === 'invoice' ? (st.invoiceHeaderSubtitle || st.ownerName) : docType === 'receipt' ? (st.receiptHeaderSubtitle || st.ownerName) : docType === 'report' ? (st.reportsHeaderSubtitle || st.ownerName) : (st.ownerName || '');
    const headerItems = [
      ['العنوان',st.documentHeaderLine1 || st.projectAddress],
      ['التواصل',st.documentHeaderLine2 || st.projectPhone1],
      ['الحساب',st.documentHeaderLine3 || st.projectAccountNo],
      ['',st.documentHeaderLine4],
      ['البريد',st.projectEmail]
    ].filter(([,value])=>String(value||'').trim());
    if(docType==='report'){
      const details=headerItems.map(([label,value])=>`<span>${label?`<b>${esc(label)}</b>`:''}<i>${esc(value)}</i></span>`).join('');
      return `<div class="org-header report-org-header ${compact?'compact':''}"><div class="report-org-identity">${logo}<div class="org-text"><small>الجهة المصدرة</small><h2>${esc(title || '')}</h2>${subtitle?`<div>${esc(subtitle)}</div>`:''}</div></div><div class="report-org-details">${details||'<span><i>تقرير نظامي صادر من قطرة برو</i></span>'}</div><div class="report-org-seal"><b>QATRA PRO</b><span>تقرير رسمي</span></div></div>`;
    }
    const lines = headerItems.map(([label,value])=>label?`${label}: ${value}`:value).map(esc).join(' | ');
    return `<div class="org-header ${compact?'compact':''}">${logo}<div class="org-text"><h2>${esc(title || '')}</h2><div>${esc(subtitle || '')}</div>${lines?`<small>${lines}</small>`:''}</div></div>`;
  }
  function printWindow(title, body, page='A4'){
    const cleanPage = String(page || 'A4');
    const pageCss = cleanPage === 'A5L' ? 'A5 landscape' : (cleanPage === 'A4L' ? 'A4 landscape' : cleanPage);
    const margin = cleanPage.includes('58mm') ? '3mm' : (cleanPage.includes('A5') ? '2mm' : '8mm');
    const printClass = cleanPage === 'A5L' ? 'print-page-a5 print-landscape' : (cleanPage.includes('A5') ? 'print-page-a5' : (cleanPage === 'A4L' ? 'print-page-a4 print-landscape' : 'print-page-a4'));
    const css = `
      <style>
      @page{size:${pageCss};margin:${margin}} body{direction:rtl;font-family:Tahoma,Arial,sans-serif;color:#000;background:#fff;margin:0} h1,h2,h3{text-align:center;margin:4px 0 8px} table{width:100%;border-collapse:collapse;font-size:12px} th,td{border:1px solid #111;padding:5px;text-align:right;vertical-align:top}.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0}.box{border:1px solid #111;padding:6px}.sig{display:flex;justify-content:space-between;margin-top:30px}.a5{width:142mm;min-height:0;margin:auto;page-break-after:always;break-after:page}.a5:last-child{page-break-after:auto!important;break-after:auto!important}.a4{width:194mm;min-height:281mm;margin:auto}.thermal{width:52mm;margin:auto;font-size:12px}.line{border-top:1px dashed #000;margin:6px 0}.center{text-align:center}.big{font-size:18px;font-weight:bold}.badge{border:1px solid #111;padding:2px 6px}.footer{margin-top:16px;font-size:12px}.no-border td{border:0}.ltr{direction:ltr;display:inline-block}.print-note{font-size:11px;text-align:center;color:#444;margin-bottom:5px}.print-a5-label::before{content:'طباعة ورق A5 - فاتورة/سند قبض';display:block;text-align:center;font-size:11px;margin-bottom:3px}.print-a4-label::before{content:'طباعة ورق A4 - كشف/تقرير';display:block;text-align:center;font-size:11px;margin-bottom:3px}.org-header{display:flex;align-items:center;justify-content:center;gap:10px;border-bottom:1px solid #111;padding-bottom:6px;margin-bottom:8px;text-align:center}.org-logo{max-width:22mm;max-height:22mm;object-fit:contain}.org-text h2{margin:0 0 3px}.org-text small{display:block;font-size:10.5px;margin-top:2px}.thermal .org-header{display:block;border-bottom:1px dashed #000}.thermal .org-logo{max-width:28mm;max-height:18mm}.qatra-qr{display:flex;flex-direction:column;align-items:center;justify-content:center;margin:2mm auto;page-break-inside:avoid;break-inside:avoid}.qatra-qr img{display:block;width:28mm!important;height:28mm!important;object-fit:contain;image-rendering:pixelated}.qatra-qr figcaption{font-size:8pt;text-align:center;margin-top:1mm}.qatra-print-brand{display:flex;align-items:center;justify-content:center;gap:2mm;margin:3mm auto 0;padding-top:2mm;border-top:1px solid #c6d1d7;color:#405665;font-size:7.5pt;break-inside:avoid;page-break-inside:avoid}.qatra-print-brand img{width:8mm;height:8mm;object-fit:contain}.qatra-print-brand span{display:flex;flex-direction:column;line-height:1.35}.qatra-print-brand b{font-family:Georgia,"Times New Roman",serif;letter-spacing:.5px;color:#102A43}.qatra-print-brand small{font-size:6.5pt;color:#657985}
.invoice-official{border:1.6px solid #0b64a0;border-radius:12px;overflow:hidden;padding:0!important;box-sizing:border-box;background:#fff}.official-header{display:grid;grid-template-columns:1.55fr .75fr;gap:8px;padding:8px 10px 6px;background:linear-gradient(135deg,#f9fdff,#eaf6ff)}.official-brand{display:flex;align-items:center;gap:8px}.official-logo{width:24mm;height:24mm;object-fit:contain;border-radius:8px}.official-drop{width:22mm;height:22mm;border-radius:50% 50% 55% 55%;display:flex;align-items:center;justify-content:center;font-size:32px;background:#eef8ff}.official-brand h2{text-align:right;color:#073b70;font-size:18px;margin:0}.official-brand h4{text-align:right;color:#0879bd;font-size:14px;margin:2px 0}.official-brand p{margin:1px 0;font-size:10.5px;color:#223}.official-invoice-meta{border:1px solid #0b73b8;border-radius:8px;overflow:hidden;background:#fff}.official-invoice-meta .official-title{background:#0879bd;color:#fff;text-align:center;font-weight:800;padding:5px;font-size:14px}.official-invoice-meta>div:not(.official-title){display:flex;justify-content:space-between;gap:5px;padding:4px 6px;border-top:1px solid #c9e2f3;font-size:10.5px}.official-wave{height:10px;background:linear-gradient(170deg,#0879bd 45%,#36aee8 46% 64%,#fff 65%)}.official-section{margin:6px 8px}.official-section h3{background:#0879bd;color:#fff;border-radius:6px 6px 0 0;padding:4px 8px;text-align:right;font-size:12px;margin:0}.official-info-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #8bc3e5;border-top:0}.official-info-grid>div{display:grid;grid-template-columns:90px 1fr;gap:4px;padding:5px 7px;border-bottom:1px dotted #acd0e6;font-size:10.5px}.official-info-grid>div:nth-last-child(-n+2){border-bottom:0}.official-info-grid span{color:#075783;font-weight:700}.official-table{font-size:10.5px}.official-table th{background:#eaf6ff;color:#075783;text-align:center;border-color:#7fbce1}.official-table td{text-align:center;border-color:#7fbce1;font-weight:700}.official-finance th{text-align:right;width:25%}.official-finance td{width:25%}.official-finance .history-row th,.official-finance .history-row td{background:#fff9df}.official-finance .history-note{font-size:9px;color:#745d00;font-weight:400}.official-balance{margin:8px auto;width:62%;border:2px solid #075783;border-radius:10px;text-align:center;padding:6px;background:#f6fbff}.official-balance span{display:block;color:#075783;font-size:11px}.official-balance b{display:block;color:#073b70;font-size:17px;margin:2px}.official-balance small{font-size:9.5px}.invoice-status{margin:6px 8px;padding:6px;border-radius:7px;text-align:center;font-size:13px;font-weight:800;border:1.5px solid}.invoice-status.paid{color:#076b38;background:#eafaf1;border-color:#19a45b}.invoice-status.partial{color:#8a5b00;background:#fff8df;border-color:#d99a00}.invoice-status.due{color:#a01616;background:#fff0f0;border-color:#d63737}.official-info-grid.official-info-3{grid-template-columns:1fr 1fr 1fr}.official-info-grid.official-info-3>div{grid-template-columns:88px 1fr;border-bottom:0}.official-main-finance th{width:33.333%;text-align:center}.official-main-finance td{text-align:center;font-size:13px}.official-main-finance .total-due-cell{font-size:16px;color:#073b70}.invoice-three-fields{display:grid;grid-template-columns:1fr 1fr;gap:6px}.invoice-field-box{border:1.4px solid #78b9df;border-radius:8px;padding:7px;text-align:center;background:#f8fcff}.invoice-field-box span{display:block;color:#075783;font-size:10.5px;font-weight:700}.invoice-field-box b{display:block;color:#073b70;font-size:14px;margin:3px 0}.invoice-field-box small{display:block;font-size:8.5px;line-height:1.4;color:#555}.invoice-field-box.history{background:#fff9e8;border-color:#e1b94f}.invoice-field-box.credit{background:#effcf5;border-color:#4fbd7b}.invoice-field-box.words{grid-column:1 / -1;background:#f5f8ff;border-color:#6d94d5}.invoice-field-box.words b{font-size:12px;line-height:1.8}.official-footer{margin:8px 10px 6px;border-top:1px solid #9bc9e4;padding-top:5px;text-align:center;font-size:9.5px}.official-signatures{display:flex;justify-content:space-between;margin:10px 0 7px;font-size:10px}.official-footer strong{color:#075783;font-size:11px}

/* v12.3.4 A5 one-page + unit-label package: Android WebView-safe compact invoice */
*{box-sizing:border-box}.a5{width:142mm!important;min-height:0!important;max-width:142mm!important;margin:0 auto!important;page-break-after:always;break-after:page}.a5:last-child{page-break-after:auto!important;break-after:auto!important}.invoice-v13,.receipt-v13{width:100%!important;min-height:0!important;background:#fff;color:#000;page-break-inside:avoid!important;break-inside:avoid!important}.invoice-v13{border:1.4px solid #0b6fa4;border-radius:8px;padding:2mm;overflow:hidden;zoom:.94;width:106.3829787%!important;transform-origin:top center!important;line-height:1.15!important}.v13-doc-header,.v13-receipt-header{display:grid!important;grid-template-columns:minmax(0,1fr) 36mm minmax(0,1fr)!important;align-items:center!important;column-gap:3mm!important;border-bottom:1.4px solid #0b6fa4;padding:.8mm 1.5mm 1mm;margin:0 0 1mm;direction:rtl;page-break-inside:avoid!important;break-inside:avoid!important}.v13-head-center{text-align:center!important;min-width:32mm}.v13-head-center img{display:block!important;width:14mm!important;height:14mm!important;max-width:14mm!important;max-height:14mm!important;object-fit:contain!important;margin:0 auto .2mm!important}.v13-head-center h2{font-size:11pt!important;line-height:1.2;margin:.3mm 0!important;color:#075985}.v13-head-center h3{font-size:10pt!important;line-height:1.2;margin:.5mm 0!important;color:#075985}.invoice-only-header{grid-template-columns:minmax(0,1fr) 46mm minmax(0,1fr)!important}.invoice-only-header .v13-head-center{min-width:44mm!important}.invoice-only-header .v13-head-center h3{font-size:10.5pt!important;white-space:nowrap!important}.v13-head-side{font-size:7.5pt!important;line-height:1.55!important;min-height:0!important;overflow-wrap:anywhere}.v13-head-side.right{text-align:right}.v13-head-side.left{text-align:left}.v13-doc-meta{display:flex;justify-content:space-between;gap:2mm;padding:1mm 1.5mm;border:1px solid #8bc4de;background:#f5fbff;border-radius:4px;margin-bottom:.8mm;font-size:7.7pt;page-break-inside:avoid!important}.invoice-v13 section{page-break-inside:avoid!important;break-inside:avoid!important}.invoice-v13 section h4{background:#0b6fa4;color:#fff;padding:.7mm 1.5mm;margin:.8mm 0 .6mm;border-radius:3px;font-size:8.5pt}.v13-grid3,.v13-grid2,.v13-finance-grid{display:grid;gap:1mm}.v13-grid3{grid-template-columns:repeat(3,minmax(0,1fr))}.v13-grid2{grid-template-columns:repeat(2,minmax(0,1fr))}.v13-finance-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.v13-grid3>div,.v13-grid2>div,.v13-finance-grid>div{border:1px solid #a9cddd;border-radius:4px;padding:1.1mm;background:#fbfdff;min-width:0}.v13-grid3 small,.v13-grid2 small,.v13-finance-grid small,.v13-bottom-pair small{display:block;color:#0b5a82;font-size:7pt}.v13-grid3 b,.v13-grid2 b,.v13-finance-grid b,.v13-bottom-pair b{display:block;margin-top:.35mm;font-size:8.2pt;overflow-wrap:anywhere}.v13-finance-grid .grand{background:#eaf7ff;border-color:#0b6fa4}.invoice-v13 table{font-size:7.8pt!important;margin:0!important}.invoice-v13 th,.invoice-v13 td{padding:.8mm!important;text-align:center!important}.v13-bottom-pair{display:grid;grid-template-columns:.7fr 1.3fr;gap:1mm;margin-top:.8mm;page-break-inside:avoid!important}.v13-bottom-pair>div,.v13-final-balance{border:1.3px solid #82bad2;border-radius:5px;padding:1.2mm;text-align:center}.v13-bottom-pair .mini{background:#fff9e8;border-color:#d6b251}.balance.due,.v13-final-balance.due{background:#fff1f1;border-color:#d65858}.balance.credit,.v13-final-balance.credit{background:#effcf4;border-color:#49a86e}.balance.zero,.v13-final-balance.zero{background:#f4f6f8;border-color:#9aa4ab}.v13-words,.v13-note{margin-top:.7mm;padding:.8mm;border:1px solid #b8cfda;border-radius:4px;background:#f9fcfd;text-align:center;font-size:7.2pt;line-height:1.15;page-break-inside:avoid!important}.receipt-v13-frame{border:1.5px solid #0b6fa4;border-radius:8px;padding:3mm;min-height:0!important;page-break-inside:avoid!important}.receipt-v13 .v13-receipt-header{border-bottom:1px solid #0b6fa4}.receipt-amount{text-align:center;margin:3mm 0;border:1.5px solid #0b6fa4;border-radius:6px;padding:2.5mm}.receipt-amount small{display:block}.receipt-amount b{font-size:18pt;color:#075985}.v13-receipt-footer{text-align:center;font-weight:bold;margin:4mm 0 2mm}.v13-signatures,.v13-approvals{display:flex;justify-content:space-between;gap:5mm;margin-top:5mm;text-align:center;font-size:8pt}.v13-approvals span{flex:1;border-top:1px solid #777;padding-top:1.5mm}.v13-summary-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:2mm;margin:2mm 0}.v13-summary-cards>div{border:1px solid #9bc6d9;border-radius:5px;padding:2mm;background:#f7fcff;text-align:center}.v13-summary-cards small{display:block;color:#0b5a82}.v13-summary-cards b{display:block;margin-top:1mm;font-size:10pt}
/* Unified A4 report output */
.print-page-a4{font-size:10pt;line-height:1.45;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.print-page-a4 .report-document{width:100%;margin:0;padding:0}.print-page-a4 .report-print-title{text-align:center;margin:3mm 0 4mm;padding-bottom:3mm;border-bottom:1.5px solid #075985}.print-page-a4 .report-print-title small{display:block;color:#547080;font-size:8pt;font-weight:700}.print-page-a4 .report-print-title h1{margin:1mm 0 0;color:#073b5b;font-size:16pt}.print-page-a4 .report-generated{display:flex;justify-content:space-between;gap:8mm;margin:0 0 4mm;padding:2mm 3mm;border:1px solid #b7ced9;background:#f3f8fa;font-size:8.5pt}.print-page-a4 .report-generated span{color:#4a6473}.print-page-a4 .report-table-viewport{overflow:visible;border:0}.print-page-a4 table{width:100%;border-collapse:collapse;table-layout:auto;font-size:8.8pt}.print-page-a4 .report-wide table{font-size:7.5pt}.print-page-a4 thead{display:table-header-group}.print-page-a4 tfoot{display:table-footer-group}.print-page-a4 tr,.print-page-a4 .accounting-total,.print-page-a4 .accounting-grand,.print-page-a4 .v13-summary-cards{break-inside:avoid;page-break-inside:avoid}.print-page-a4 th{padding:2.2mm 1.5mm;background:#dcecf3!important;color:#123a53;border:1px solid #6e98aa;text-align:right;font-weight:800}.print-page-a4 td{padding:1.9mm 1.5mm;border:1px solid #9db5c0;text-align:right;vertical-align:top;overflow-wrap:anywhere}.print-page-a4 tbody tr:nth-child(even) td{background:#f7fafb!important}.print-page-a4 tfoot th,.print-page-a4 tfoot td{background:#e9f3f6!important;font-weight:900}.print-page-a4 .v13-summary-cards{grid-template-columns:repeat(4,1fr);gap:2mm}.print-page-a4 .v13-summary-cards>div{padding:2.5mm;border:1px solid #87adbd}.print-page-a4 .notice{padding:2.5mm 3mm;margin:2mm 0;border:1px solid #9eb8c4;border-right:3px solid #0878a8;background:#f4f9fb;font-size:8.5pt}.print-page-a4 .accounting-report-head{justify-content:center;border-bottom:1.5px solid #075985;padding-bottom:2mm}.print-page-a4 .accounting-report-head h3{font-size:14pt}.print-page-a4 .card{border:1px solid #a8c0cb;box-shadow:none;padding:3mm;margin:2mm 0}.print-page-a4 button,.print-page-a4 input,.print-page-a4 select,.print-page-a4 textarea,.print-page-a4 .no-print,.print-page-a4 .report-end{display:none!important}.print-page-a4 details,.print-page-a4 details>*{display:block!important}.print-page-a4 details>summary{font-size:11pt;font-weight:800;margin:3mm 0 2mm}.print-page-a4 .org-header{border-bottom:2px solid #075985;padding-bottom:3mm;margin-bottom:3mm}.print-page-a4 .org-logo{max-width:24mm;max-height:24mm}.print-page-a4 .org-text h2{font-size:15pt;color:#073b5b}.print-page-a4 .sig,.print-page-a4 .v13-approvals{break-inside:avoid;page-break-inside:avoid}.print-page-a5{width:148mm!important;max-width:148mm!important;margin:0!important;padding:0!important;overflow:visible!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
.print-page-a4 .report-org-header{display:grid!important;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) auto!important;align-items:center!important;gap:4mm!important;position:relative!important;padding:0 0 3mm!important;margin:0 0 3mm!important;border-bottom:0!important}.print-page-a4 .report-org-header::after{content:"";position:absolute;right:0;left:0;bottom:0;height:1mm;background:linear-gradient(90deg,#0f9f8f,#0878c9,#071d32)}.print-page-a4 .report-org-identity{display:flex;align-items:center;gap:3mm;min-width:0}.print-page-a4 .report-org-header .org-logo{width:20mm!important;height:20mm!important;max-width:20mm!important;max-height:20mm!important;padding:1mm;border:1px solid #b8ced8;border-radius:3mm}.print-page-a4 .report-org-header .org-text{text-align:right!important}.print-page-a4 .report-org-header .org-text>small{display:block;margin:0;color:#0878c9;font-size:7pt;font-weight:800}.print-page-a4 .report-org-header .org-text h2{margin:.5mm 0!important;color:#071d32;font-size:14pt!important}.print-page-a4 .report-org-header .org-text>div{color:#4b6473;font-size:8pt;font-weight:700}.print-page-a4 .report-org-details{display:grid;gap:.8mm;padding-inline:3mm;border-inline:1px solid #b9cbd3}.print-page-a4 .report-org-details span{display:grid;grid-template-columns:14mm minmax(0,1fr);gap:1mm;font-size:7pt}.print-page-a4 .report-org-details b{color:#426176}.print-page-a4 .report-org-details i{color:#1e3c50;font-style:normal;overflow-wrap:anywhere}.print-page-a4 .report-org-seal{display:flex;align-items:center;justify-content:center;flex-direction:column;min-width:25mm;min-height:16mm;padding:2mm;border:1px solid #b9d2dd;border-radius:3mm;background:#eef8fb;text-align:center}.print-page-a4 .report-org-seal b{font:800 8pt Georgia,"Times New Roman",serif;letter-spacing:.5pt;color:#071d32}.print-page-a4 .report-org-seal span{margin-top:1mm;color:#0878c9;font-size:7pt;font-weight:800}
.print-page-a4 .accounting-print-document>.accounting-report-head{display:none!important}
      @media print{body{margin:0!important;padding:0!important}.invoice-v13{page-break-before:avoid!important;page-break-after:avoid!important;break-before:avoid-page!important;break-after:avoid-page!important}.invoice-v13 .v13-note{orphans:1!important;widows:1!important}}

/* Marketing identity belongs to the physical page footer, not to the end of
   variable-length content. A4 uses one fixed footer; every A5 sheet owns its
   own absolutely positioned footer so batch invoices do not overlap. */
.print-page-a4{padding-bottom:13mm!important}.print-page-a4>.qatra-print-brand{position:fixed!important;right:8mm;left:8mm;bottom:1.5mm;margin:0!important;padding-top:1.2mm!important;background:#fff;z-index:50}
.print-page-a5 .a5{position:relative!important;min-height:200mm!important;padding-bottom:13mm!important}.print-page-a5.print-landscape .a5{min-height:136mm!important}.print-page-a5 .a5 .qatra-print-brand{position:absolute!important;right:3mm;left:3mm;bottom:1.5mm;margin:0!important;padding-top:1mm!important;background:#fff;z-index:5}
@media print{.print-page-a4>.qatra-print-brand{position:fixed!important}.print-page-a5 .a5 .qatra-print-brand{position:absolute!important}}

      </style>`;
    const brandedBody = String(body || '').includes('qatra-print-brand') ? body : `${body}${marketingMarkHtml()}`;
    const fullHtml = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>${css}</head><body class="${printClass}">${brandedBody}</body></html>`;
    if(window.AndroidBridge && typeof AndroidBridge.printHtml === 'function'){
      AndroidBridge.printHtml(String(title), fullHtml, cleanPage);
      return;
    }
    const w = window.open('', '_blank');
    if(!w){ alert('تعذر فتح نافذة الطباعة. اسمح للنوافذ المنبثقة لهذا التطبيق ثم حاول مرة أخرى.'); return; }
    w.document.write(fullHtml.replace('</body>', '<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body>'));
    w.document.close();
  }
  function invoiceDisplayStatus(inv){
    const originalDue = Math.max(0, toNumber(inv.amount) + Math.max(0,toNumber(inv.prevBalance)) - Math.max(0,-toNumber(inv.prevBalance)));
    const accountDue = Math.max(0, balance(inv.subscriberId));
    if(originalDue <= 0 || accountDue <= 0) return 'paid';
    const paidAfterIssue = state.payments.filter(p=>p.subscriberId===inv.subscriberId && (p.incomeType || 'WATER') === 'WATER' && p.confirmed !== false && (!inv.date || (p.date||'') >= inv.date)).reduce((a,p)=>a+toNumber(p.amount),0);
    return paidAfterIssue > 0 || inv.status === 'partial' ? 'partial' : 'due';
  }
  function invoiceStatusText(inv){ const st=invoiceDisplayStatus(inv); return st === 'paid' ? 'مسددة بالكامل' : st === 'partial' ? 'مسددة جزئياً' : 'غير مسددة'; }
  function arabicUnder1000(value){
    let n = Math.floor(Math.abs(toNumber(value)));
    if(n===0) return '';
    const units=['','واحد','اثنان','ثلاثة','أربعة','خمسة','ستة','سبعة','ثمانية','تسعة'];
    const teens={10:'عشرة',11:'أحد عشر',12:'اثنا عشر',13:'ثلاثة عشر',14:'أربعة عشر',15:'خمسة عشر',16:'ستة عشر',17:'سبعة عشر',18:'ثمانية عشر',19:'تسعة عشر'};
    const tens={20:'عشرون',30:'ثلاثون',40:'أربعون',50:'خمسون',60:'ستون',70:'سبعون',80:'ثمانون',90:'تسعون'};
    const hundreds={100:'مائة',200:'مائتان',300:'ثلاثمائة',400:'أربعمائة',500:'خمسمائة',600:'ستمائة',700:'سبعمائة',800:'ثمانمائة',900:'تسعمائة'};
    const parts=[];
    const h=Math.floor(n/100)*100; n%=100;
    if(h) parts.push(hundreds[h]);
    if(n){
      let tail='';
      if(n<10) tail=units[n];
      else if(n<20) tail=teens[n];
      else {
        const u=n%10, t=n-u;
        tail=u ? units[u]+' و'+tens[t] : tens[t];
      }
      parts.push(tail);
    }
    return parts.join(' و');
  }
  function arabicGroupWords(group, singular, dual, plural){
    if(group===0) return '';
    if(group===1) return singular;
    if(group===2) return dual;
    if(group>=3 && group<=10) return arabicUnder1000(group)+' '+plural;
    return arabicUnder1000(group)+' '+singular;
  }
  function arabicNumberWords(value){
    let n=Math.round(Math.abs(toNumber(value)));
    if(n===0) return 'صفر';
    const parts=[];
    const billions=Math.floor(n/1000000000); n%=1000000000;
    const millions=Math.floor(n/1000000); n%=1000000;
    const thousands=Math.floor(n/1000); n%=1000;
    if(billions) parts.push(arabicGroupWords(billions,'مليار','ملياران','مليارات'));
    if(millions) parts.push(arabicGroupWords(millions,'مليون','مليونان','ملايين'));
    if(thousands) parts.push(arabicGroupWords(thousands,'ألف','ألفان','آلاف'));
    if(n) parts.push(arabicUnder1000(n));
    return parts.filter(Boolean).join(' و');
  }
  function moneyWords(value){ return arabicNumberWords(value)+' ريال يمني فقط لا غير'; }
  function lastPaymentForSubscriber(subId){
    return state.payments.filter(p=>p.subscriberId===subId).sort((a,b)=>(b.date||'').localeCompare(a.date||'') || (b.createdAt||'').localeCompare(a.createdAt||''))[0] || null;
  }
  function historicalPreviousPayments(subOrId){
    const s = typeof subOrId === 'string' ? subscriber(subOrId) : (subOrId || {});
    return Math.max(0, toNumber(s.previousPayments));
  }
  function messageFieldsForInvoice(inv){
    const s = subscriber(inv.subscriberId) || {};
    const c = cycle(inv.cycleId) || {};
    const latestCurrentPayment = lastPaymentForSubscriber(inv.subscriberId);
    const previousPayments = historicalPreviousPayments(s);
    const due = Math.max(0, balance(inv.subscriberId));
    const credit = balance(inv.subscriberId) < 0 ? Math.abs(balance(inv.subscriberId)) : 0;
    const arrears = Math.max(0, toNumber(inv.prevBalance));
    const openingCredit = Math.max(0, -toNumber(inv.prevBalance));
    const currentPaid = toNumber(inv.paidAmount || 0);
    const totalDue = Math.max(0, toNumber(inv.amount) + arrears - openingCredit);
    return {
      project: state.settings.projectName || '', owner: state.settings.ownerName || '', phone: state.settings.projectPhone1 || '', whatsapp: state.settings.projectWhatsApp || '', address: state.settings.projectAddress || '', accountNo: state.settings.projectAccountNo || '', currencyShort: state.settings.currencyShort || 'ر.ي', currencyFull: state.settings.currencyFull || 'ريال يمني', currency: state.settings.currencyShort || 'ر.ي',
      name: s.name || '', subscriberName: s.name || '', subscriberCode: s.code || '', phoneNumber: s.phone || '', area: s.area || '', meterNo: s.meterNo || '',
      invoiceNo: inv.no || '', date: inv.date || '', cycleName: c.type ? arCycle(c.type) : '', prevReading: num(inv.prevReading ?? 0), currentReading: num(inv.currentReading ?? 0), consumption: num(inv.consumption), tariff: num(inv.tariff || state.settings.tariff || 0), amount: num(inv.amount), arrears: num(arrears), openingCredit: num(openingCredit), prevBalance: num(inv.prevBalance), totalDue: num(totalDue), totalDueWords: moneyWords(totalDue), due: num(due), credit: num(credit), paid: num(currentPaid), currentPaid: num(currentPaid), remaining: num(inv.remainingAmount || Math.max(0, toNumber(inv.amount)-currentPaid)), previousPayments: num(previousPayments), previousPaymentsDate: s.previousPaymentsDate || '',
      // توافق خلفي: lastPayment الآن يشير للمدفوعات السابقة الواردة في الكشف، وليس سداد الفاتورة الحالية.
      lastPayment: num(previousPayments), lastPaymentDate: s.previousPaymentsDate || '', latestCurrentPayment: latestCurrentPayment ? num(latestCurrentPayment.amount) : '0', latestCurrentPaymentDate: latestCurrentPayment ? (latestCurrentPayment.date || '') : '', status: invoiceStatusText(inv)
    };
  }
  function messageFieldsForPayment(p){
    const s = subscriber(p.subscriberId) || {};
    const b = balance(p.subscriberId);
    return {
      project: state.settings.projectName || '', owner: state.settings.ownerName || '', phone: state.settings.projectPhone1 || '', whatsapp: state.settings.projectWhatsApp || '', address: state.settings.projectAddress || '', accountNo: state.settings.projectAccountNo || '', currencyShort: state.settings.currencyShort || 'ر.ي', currencyFull: state.settings.currencyFull || 'ريال يمني', currency: state.settings.currencyShort || 'ر.ي',
      name: s.name || '', subscriberName: s.name || '', subscriberCode: s.code || '', phoneNumber: s.phone || '', area: s.area || '', meterNo: s.meterNo || '',
      receiptNo: p.receiptNo || '', paymentDate: p.date || '', paymentAmount: num(p.amount), paymentMethod: p.method || '', collector: p.collector || '', paymentNote: p.note || '', balanceAfter: b>0?num(b)+' '+(state.settings.currencyShort||'ر.ي')+' عليكم':b<0?num(Math.abs(b))+' '+(state.settings.currencyShort||'ر.ي')+' رصيد مقدم':'صفر'
    };
  }
  function fillTemplate(template, fields){
    return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (m,k)=> Object.prototype.hasOwnProperty.call(fields,k) ? fields[k] : m);
  }
  function smsText(inv, channel='sms'){
    const tpl = channel === 'whatsapp' ? (state.settings.invoiceWhatsappTemplate || state.settings.invoiceSmsTemplate || state.settings.smsTemplate || '') : (state.settings.invoiceSmsTemplate || state.settings.smsTemplate || '');
    return fillTemplate(tpl, messageFieldsForInvoice(inv));
  }
  function normalizePhone(phone){
    let p = String(phone||'').replace(/[^0-9+]/g,'').replace(/^\+/, '');
    if(p.startsWith('00')) p = p.slice(2);
    if(p.startsWith('0')) p = '967' + p.slice(1);
    // أرقام الجوال اليمنية في الكشف مخزنة غالباً 9 أرقام وتبدأ بـ 7.
    if(/^7\d{8}$/.test(p)) p = '967' + p;
    return p;
  }
  function whatsappLink(phone, text){
    const p = normalizePhone(phone);
    return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
  }
  function smsLink(phone, text){
    const p = normalizePhone(phone);
    // Android يقبل غالباً body بعد ?، وبعض الأجهزة تستخدم &body. هذا الرابط يفتح تطبيق الرسائل بنص جاهز للمراجعة والإرسال.
    return `sms:${p}?body=${encodeURIComponent(text)}`;
  }
  function openWhatsApp(phone, text){
    const p = normalizePhone(phone);
    if(!p){ alert('لا يوجد رقم هاتف للمشترك. أدخل رقم الهاتف أولاً.'); return false; }
    if(window.AndroidBridge && typeof AndroidBridge.openWhatsApp === 'function'){
      AndroidBridge.openWhatsApp(p, String(text || ''));
      return true;
    }
    window.open(whatsappLink(p, text), '_blank');
    return true;
  }
  function openSms(phone, text){
    const p = normalizePhone(phone);
    if(!p){ alert('لا يوجد رقم هاتف للمشترك. أدخل رقم الهاتف أولاً.'); return false; }
    if(window.AndroidBridge && typeof AndroidBridge.openSms === 'function'){
      AndroidBridge.openSms(p, String(text || ''));
      return true;
    }
    window.location.href = smsLink(p, text);
    return true;
  }
  function invoiceHtml(inv){
    const s = subscriber(inv.subscriberId) || {};
    const c = cycle(inv.cycleId) || {};
    const previousDebt = Math.max(0, toNumber(inv.prevBalance));
    const openingCredit = Math.max(0, -toNumber(inv.prevBalance));
    const consumptionAmount = Math.max(0, toNumber(inv.amount));
    const totalDue = Math.max(0, previousDebt + consumptionAmount - openingCredit);
    const previousPayments = historicalPreviousPayments(s);
    const statusText = invoiceStatusText(inv);
    const displayStatus = invoiceDisplayStatus(inv);
    const statusClass = displayStatus === 'paid' ? 'paid' : displayStatus === 'partial' ? 'partial' : 'due';
    const logo = state.settings.projectLogo ? `<img class="official-logo" src="${state.settings.projectLogo}" alt="شعار المشروع">` : `<div class="official-drop">💧</div>`;
    const phoneLine = state.settings.projectPhone1 ? `موبايل: ${esc(state.settings.projectPhone1)}` : '';
    const accountLine = state.settings.projectAccountNo ? `رقم الحساب: ${esc(state.settings.projectAccountNo)}` : '';
    return `<div class="a5 invoice-official">
      <div class="official-header">
        <div class="official-brand">${logo}<div><h2>${esc(state.settings.invoiceHeaderTitle || state.settings.projectName || 'مشروع مياه الروضة')}</h2><h4>${esc(state.settings.invoiceHeaderSubtitle || state.settings.ownerName || 'للمياه النقية')}</h4><p>${esc(state.settings.documentHeaderLine1 || state.settings.projectAddress || '')}</p><p>${phoneLine}${phoneLine&&accountLine?' | ':''}${accountLine}</p></div></div>
        <div class="official-invoice-meta"><div class="official-title">${esc(state.settings.invoiceTitle || 'فاتورة استهلاك مياه')}</div><div><span>التاريخ</span><b>${esc(inv.date)}</b></div><div><span>رقم الفاتورة</span><b>${esc(inv.no)}</b></div><div><span>الدورة</span><b>${esc(arCycle(c.type))}</b></div></div>
      </div>
      <div class="official-wave"></div>
      <div class="invoice-status ${statusClass}">حالة الفاتورة: ${statusText}</div>
      <section class="official-section"><h3>بيانات المشترك</h3><div class="official-info-grid official-info-3"><div><span>اسم المشترك</span><b>${esc(s.name)}</b></div><div><span>رقم العداد</span><b>${esc(s.meterNo)}</b></div><div><span>العنوان</span><b>${esc(s.area)}</b></div></div></section>
      <section class="official-section"><h3>قراءة العداد</h3><table class="official-table"><thead><tr><th>ق. سابقة</th><th>ق. حالية</th><th>الفارق</th><th>سعر الوحدة</th></tr></thead><tbody><tr><td>${num(inv.prevReading ?? 0)}</td><td>${num(inv.currentReading ?? 0)}</td><td>${num(inv.consumption)} م³</td><td>${money(inv.tariff)}</td></tr></tbody></table></section>
      <section class="official-section"><h3>البيان المالي</h3><table class="official-table official-main-finance"><thead><tr><th>استهلاك الدورة</th><th>المتأخرات</th><th>إجمالي المبلغ المستحق</th></tr></thead><tbody><tr><td>${money(consumptionAmount)}</td><td>${money(previousDebt)}</td><td class="total-due-cell">${money(totalDue)}</td></tr></tbody></table></section>
      <section class="official-section invoice-three-fields">
        <div class="invoice-field-box history"><span>المدفوعات السابقة</span><b>${money(previousPayments)}</b><small>آخر مدفوعات الفاتورة السابقة؛ للعرض فقط، ولا تعتبر سداداً من قيمة هذه الفاتورة</small></div>
        <div class="invoice-field-box credit"><span>الرصيد المقدم</span><b>${money(openingCredit)}</b><small>يخصم عند حساب إجمالي المبلغ المستحق</small></div>
        <div class="invoice-field-box words"><span>إجمالي المبلغ المستحق كتابة</span><b>${esc(moneyWords(totalDue))}</b></div>
      </section>
      <div class="official-footer"><p>${esc(state.settings.invoiceFooter || '')}</p><div class="official-signatures"><span>المحاسب: __________________</span><span>المستلم: __________________</span></div><strong>شكراً لاستخدامكم مياه الروضة</strong></div>
    </div>`;
  }
  function receiptHtml(p, mode='thermal'){
    const s = subscriber(p.subscriberId) || {};
    const b = balance(p.subscriberId);
    if(mode === 'paper') {
      return `<div class="a5">
        ${orgHeaderHtml(false,'receipt')}
        <h3>${esc(state.settings.receiptTitle || 'سند قبض')}</h3>
        <div class="meta">
          <div class="box"><b>رقم السند:</b> ${esc(p.receiptNo)}</div>
          <div class="box"><b>التاريخ:</b> ${esc(p.date)}</div>
          <div class="box"><b>رقم المشترك:</b> ${esc(s.code)}</div>
          <div class="box"><b>اسم المشترك:</b> ${esc(s.name)}</div>
          <div class="box"><b>الهاتف:</b> ${esc(s.phone)}</div>
          <div class="box"><b>طريقة الدفع:</b> ${esc(p.method)}</div>
        </div>
        <table>
          <tr><th>البيان</th><th>القيمة</th></tr>
          <tr><td>المبلغ المقبوض</td><td class="big">${money(p.amount)}</td></tr>
          <tr><td>اسم المحصل</td><td>${esc(p.collector)}</td></tr>
          <tr><td>ملاحظات</td><td>${esc(p.note || '')}</td></tr>
          <tr><td>الرصيد بعد السداد</td><td>${b>0?money(b)+' عليكم':b<0?money(Math.abs(b))+' لكم':'صفر'}</td></tr>
        </table>
        <p class="footer">${esc(state.settings.receiptFooter)}</p>
        <div class="sig"><span>توقيع المحصل</span><span>توقيع المستلم</span></div>
      </div>`;
    }
    return `<div class="thermal">
      ${orgHeaderHtml(true,'receipt')}
      <div class="center">${esc(state.settings.receiptTitle || 'سند قبض')}</div>
      <div class="line"></div>
      <table class="no-border">
        <tr><td>رقم السند:</td><td>${esc(p.receiptNo)}</td></tr>
        <tr><td>التاريخ:</td><td>${esc(p.date)}</td></tr>
        <tr><td>المشترك:</td><td>${esc(s.code)} - ${esc(s.name)}</td></tr>
        <tr><td>المبلغ:</td><td><b>${money(p.amount)}</b></td></tr>
        <tr><td>طريقة الدفع:</td><td>${esc(p.method)}</td></tr>
        <tr><td>المحصل:</td><td>${esc(p.collector)}</td></tr>
        <tr><td>الرصيد بعد السداد:</td><td>${b>0?money(b)+' عليكم':b<0?money(Math.abs(b))+' لكم':'صفر'}</td></tr>
      </table>
      <div class="line"></div>
      <div class="center">${esc(state.settings.receiptFooter)}</div>
    </div>`;
  }
  function receiptMessage(p, channel='sms'){
    const tpl = channel === 'whatsapp' ? (state.settings.receiptWhatsappTemplate || state.settings.receiptSmsTemplate || '') : (state.settings.receiptSmsTemplate || '');
    return fillTemplate(tpl, messageFieldsForPayment(p));
  }
  function pdfWhatsAppNotice(kind){
    return `سيتم فتح ${kind} في نافذة طباعة. للطباعة الورقية اختر الطابعة مباشرة، ولإرساله PDF اختر حفظ كـ PDF ثم أرفقه داخل واتساب. أزرار واتساب/SMS في التطبيق ترسل النص جاهزاً للمشترك.`;
  }
  return {today,uid,money,num,toNumber,monthKey,esc,arCycle,arStatus,openingArrears,openingCredit,openingNet,defaultState,load,save,setState,get state(){return state},subscriber,cycle,invoice,activeSubscribers,lastReading,lastMainCurrent,balance,invoiceAllocation,recomputeInvoiceStatuses,readingsForCycle,consumptionInMonth,invoicesInMonth,paymentsInMonth,expensesInMonth,download,backupStamp,backupPayload,localBackups,rememberLocalBackup,ensureDailyAutoBackup,lastBackupInfo,exportBackupFile,restoreLocalBackup,deleteLocalBackup,exportLocalBackup,exportCSV,marketingMarkHtml,orgHeaderHtml,printWindow,fillTemplate,messageFieldsForInvoice,messageFieldsForPayment,smsText,historicalPreviousPayments,normalizePhone,whatsappLink,smsLink,openWhatsApp,openSms,invoiceHtml,receiptHtml,receiptMessage,pdfWhatsAppNotice,arabicNumberWords,moneyWords,invoiceDisplayStatus,invoiceStatusText};
})();

const App = (() => {
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const invoiceFilters={from:'',to:'',query:'',status:'all'};
  const paymentFilters={from:'',to:'',query:''};
  function init(){
    if(!$('#dashboard')) return;
    YWP.ensureDailyAutoBackup();
    $$('.tabs button').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    document.body.dataset.activeTab = 'dashboard';
    renderAll();
    QatraIncoming?.route?.({
      READING_BATCH:'manager_reader.html',
      COLLECTION_BATCH:'manager_collectors.html',
      CASHBOX_BATCH:'manager_cashbox.html',
      DIRECT_PAYMENT_BATCH:'manager_cashbox.html',
      FULL_BACKUP:importBackup
    });
    if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
  }
  function switchTab(id){
    $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab===id));
    $$('.tab').forEach(s => s.classList.toggle('active', s.id===id));
    document.body.dataset.activeTab = id;
    render(id);
    window.scrollTo({top:0,behavior:'auto'});
  }
  function activeTab(){
    return document.body.dataset.activeTab || document.querySelector('.tabs button.active')?.dataset.tab || 'dashboard';
  }
  function closeCurrentReport(){
    if(activeTab() !== 'reports') return false;
    const output = $('#reportOutput');
    if(!output?.querySelector('#currentReportHtml')) return false;
    document.body.classList.remove('report-focus-open');
    output.closest('.report-center-card')?.classList.remove('report-preview-open');
    output.innerHTML = '';
    document.querySelector('#reports .card')?.scrollIntoView({behavior:'smooth',block:'start'});
    return true;
  }
  function handleAndroidBack(){
    const focusedReport = document.querySelector('.report-focus-mode');
    if(focusedReport){
      focusedReport.classList.remove('report-focus-mode');
      document.body.classList.remove('report-focus-open');
      const button = focusedReport.querySelector('[data-report-focus]');
      if(button) button.innerHTML = '<span>⛶</span> عرض مكبّر';
      return true;
    }
    if(closeCurrentReport()) return true;
    const active = activeTab();
    if(active !== 'dashboard'){
      switchTab('dashboard');
      return true;
    }
    return false;
  }
  function renderAll(){ ['dashboard','settings','subscribers','readings','invoices','payments','expenses','reports'].forEach(render); }
  function render(id){
    ({dashboard:renderDashboard,settings:renderSettings,subscribers:renderSubscribers,readings:renderReadings,invoices:renderInvoices,payments:renderPayments,expenses:renderExpenses,reports:renderReports,messages:()=>window.QatraBulkMessages?.render?.()}[id]||(()=>{}))();
  }
  function renderDashboard(){
    const month = YWP.monthKey(YWP.today());
    const state = YWP.state;
    const subs = state.subscribers.length;
    const active = state.subscribers.filter(s=>s.status!=='stopped').length;
    const billed = YWP.invoicesInMonth(month).reduce((a,i)=>a+YWP.toNumber(i.amount),0);
    const collections = YWP.paymentsInMonth(month).reduce((a,p)=>a+YWP.toNumber(p.amount),0);
    const exp = YWP.expensesInMonth(month).reduce((a,e)=>a+YWP.toNumber(e.amount),0);
    const balances = state.subscribers.map(s=>YWP.balance(s.id));
    const dues = balances.filter(b=>b>0).reduce((a,b)=>a+b,0);
    const credits = balances.filter(b=>b<0).reduce((a,b)=>a+Math.abs(b),0);
    const cycles = state.cycles.slice().sort((a,b)=>(b.cycleDate||'').localeCompare(a.cycleDate||''));
    const currentCycle = cycles.find(c=>c.status!=='closed') || cycles[0] || null;
    const cycleConsumption = currentCycle ? YWP.readingsForCycle(currentCycle.id).reduce((a,r)=>a+YWP.toNumber(r.consumption),0) : 0;
    const today = YWP.today();
    const todayObj = new Date(today + 'T00:00:00');
    const displayDate = today.split('-').reverse().join('-');
    const dayName = new Intl.DateTimeFormat('ar-YE',{weekday:'long'}).format(todayObj);
    const todayReadings = state.readings.filter(r=>(YWP.cycle(r.cycleId)?.cycleDate||'')===today).length;
    const todayInvoices = state.invoices.filter(i=>i.date===today).length;
    const todayPayments = state.payments.filter(p=>p.date===today);
    const todayCollections = todayPayments.reduce((a,p)=>a+YWP.toNumber(p.amount),0);
    const lastBackup = YWP.lastBackupInfo();
    const lastBackupText = lastBackup ? new Date(lastBackup.createdAt).toLocaleString('ar-YE') : 'لا توجد نسخة حتى الآن';
    const history = cycles.slice(0,6).reverse().map(c=>({
      label:(c.cycleDate||'').slice(0,7),
      value:YWP.readingsForCycle(c.id).reduce((a,r)=>a+YWP.toNumber(r.consumption),0)
    }));
    const maxHistory = Math.max(1,...history.map(x=>x.value));
    const historyBars = history.length ? history.map(x=>`<div class="dash-chart-col"><b>${YWP.num(x.value)}</b><div class="dash-chart-bar" style="height:${Math.max(10,Math.round((x.value/maxHistory)*112))}px"></div><small>${YWP.esc(x.label)}</small></div>`).join('') : '<p class="dash-empty">لا توجد دورات سابقة لعرضها.</p>';
    const stat = (tone,icon,label,value,unit='',meta='') => `<article class="dash-stat ${tone}"><div class="dash-stat-icon">${icon}</div><div class="dash-stat-body"><span>${label}</span><strong>${value}${unit?` <small>${unit}</small>`:''}</strong>${meta?`<em>${meta}</em>`:''}</div></article>`;
    $('#dashboard').innerHTML = `
      <div class="dash-shell">
        <section class="dash-topline">
          <div><h1>لوحة التحكم</h1><p>ملخص مباشر لأداء مشروع مياه الروضة</p></div>
          <div class="dash-date"><span>▣</span><b>${dayName}</b><small>${displayDate}</small></div>
        </section>

        <section class="dash-stat-grid">
          ${stat('blue','👥','إجمالي المشتركين',YWP.num(subs),'مشترك')}
          ${stat('green','✓','المشتركين النشطين',YWP.num(active),'مشترك')}
          ${stat('purple','💧','إجمالي استهلاك الدورة',YWP.num(cycleConsumption),'م³',currentCycle?`حتى تاريخ ${YWP.esc((currentCycle.cycleDate||'').split('-').reverse().join('-'))}`:'لا توجد دورة حالية')}
          ${stat('blue','◆','قيمة فواتير هذا الشهر',YWP.money(billed),'')}
          ${stat('green','▣','تحصيل هذا الشهر',YWP.money(collections),'',`حتى تاريخ ${displayDate}`)}
          ${stat('red','!','متأخرات على المشتركين',YWP.money(dues),'')}
          ${stat('cyan','▰','أرصدة مقدمة للمشتركين',YWP.money(credits),'')}
          ${stat('orange','▤','مصروفات الشهر',YWP.money(exp),'',`حتى تاريخ ${displayDate}`)}
          ${stat(collections-exp>=0?'teal':'red','◎','صافي النقدية هذا الشهر',YWP.money(collections-exp),'',`حتى تاريخ ${displayDate}`)}
        </section>

        <section class="dash-field-hub">
          <header><div><h2>إدارة التشغيل الميداني</h2><p>إدارة المستخدمين والتكليفات وملفات التسليم من مكان واحد</p></div><span>⇄</span></header>
          <div class="dash-role-grid">
            <a href="manager_reader.html"><i>📟</i><span><b>إدارة الكاشف</b><small>توزيع القراءات واستلامها</small></span><em>‹</em></a>
            <a href="manager_collectors.html"><i>🧾</i><span><b>إدارة المحصل</b><small>التكليفات وسندات التحصيل</small></span><em>‹</em></a>
            <a href="manager_cashbox.html"><i>🏦</i><span><b>إدارة الصندوق</b><small>الإعداد والحركات والتحويلات</small></span><em>‹</em></a>
            <a href="manager_users.html"><i>👥</i><span><b>المستخدمون والصلاحيات</b><small>الحسابات والرموز والصلاحيات</small></span><em>‹</em></a>
          </div>
        </section>

        <section class="dash-lower-grid">
          <article class="dash-panel dash-chart-panel">
            <header><div><h2>إجمالي الاستهلاك خلال آخر 6 دورات</h2><p>مقارنة سريعة تساعد على متابعة اتجاه الاستهلاك</p></div><span>م³</span></header>
            <div class="dash-chart">${historyBars}</div>
          </article>
          <article class="dash-panel dash-today-panel">
            <header><h2>ملخص اليوم</h2><span>▣</span></header>
            <ul>
              <li><i class="green-dot">✓</i><span>قراءات مسجلة</span><b>${YWP.num(todayReadings)}</b></li>
              <li><i class="blue-dot">▤</i><span>فواتير صادرة</span><b>${YWP.num(todayInvoices)}</b></li>
              <li><i class="cyan-dot">▣</i><span>مبالغ محصلة</span><b>${YWP.money(todayCollections)}</b></li>
              <li><i class="blue-dot">▰</i><span>سندات قبض</span><b>${YWP.num(todayPayments.length)}</b></li>
              <li class="alert"><i>!</i><span>مشتركون عليهم رصيد</span><b>${YWP.num(balances.filter(b=>b>0).length)}</b></li>
            </ul>
          </article>
        </section>

        <section class="dash-lower-grid">
          <article class="dash-panel dash-actions-panel">
            <header><h2>إجراءات سريعة</h2><span>⚡</span></header>
            <div class="dash-actions">
              <button onclick="App.switchTab('readings')"><i>＋</i><b>دورة جديدة</b></button>
              <button onclick="location.href='manager_reader.html'"><i>📟</i><b>إدارة الكاشف</b></button>
              <button onclick="App.switchTab('subscribers')"><i>⇧</i><b>استيراد بيانات</b></button>
              <button onclick="App.exportBackup()"><i>◉</i><b>نسخة احتياطية</b></button>
              <button onclick="App.switchTab('reports')"><i>▥</i><b>التقارير</b></button>
              <button onclick="App.switchTab('settings')"><i>⚙</i><b>الإعدادات</b></button>
            </div>
          </article>
          <article class="dash-panel dash-info-panel">
            <header><h2>معلومات النظام</h2><span>i</span></header>
            <dl>
              <div><dt>الدورة الحالية</dt><dd>${currentCycle?`${YWP.arCycle(currentCycle.type)} — ${YWP.esc(currentCycle.cycleDate)}`:'لا توجد دورة حالية'}</dd></div>
              <div><dt>آخر نسخة احتياطية</dt><dd>${YWP.esc(lastBackupText)}</dd></div>
              <div><dt>وضع التشغيل</dt><dd>${state.meta?.productionStartedAt?'تشغيل فعلي':'بيانات أولية/تجريبية'}</dd></div>
              <div><dt>الإصدار</dt><dd>v2.9.5</dd></div>
            </dl>
          </article>
        </section>

        <section class="dash-backup-panel">
          <div><h2>النسخ الاحتياطي ضروري</h2><p>بعد نهاية كل يوم قراءة أو تحصيل، نزّل نسخة كاملة واحفظها خارج التطبيق.</p></div>
          <button onclick="App.exportBackup()">تنزيل نسخة احتياطية كاملة الآن</button>
        </section>
      </div>`;
  }
  const INVOICE_MESSAGE_FIELDS = [
    ['project','اسم المشروع'],['name','اسم المشترك'],['meterNo','رقم العداد'],['area','العنوان'],['invoiceNo','رقم الفاتورة'],['date','التاريخ'],['cycleName','الدورة'],['prevReading','ق. سابقة'],['currentReading','ق. حالية'],['consumption','الفارق'],['tariff','سعر الوحدة'],['amount','استهلاك الدورة'],['arrears','المتأخرات'],['openingCredit','الرصيد المقدم'],['totalDue','إجمالي المبلغ المستحق'],['totalDueWords','الإجمالي كتابة'],['previousPayments','المدفوعات السابقة'],['status','حالة الفاتورة'],['currencyShort','العملة']
  ];
  const RECEIPT_MESSAGE_FIELDS = [
    ['project','اسم المشروع'],['name','اسم المشترك'],['subscriberCode','رقم المشترك'],['receiptNo','رقم السند'],['paymentDate','تاريخ السداد'],['paymentAmount','المبلغ المقبوض'],['paymentMethod','طريقة الدفع'],['collector','اسم المحصل'],['paymentNote','ملاحظة'],['balanceAfter','الرصيد بعد السداد'],['currencyShort','العملة']
  ];
  function messageFieldButtons(targetId, fields){
    return `<div class="message-field-picker"><div class="picker-title">اضغط على الحقل لإضافته إلى موضع المؤشر داخل الرسالة:</div><div class="field-chips">${fields.map(([key,label])=>`<button type="button" class="field-chip" onclick="App.insertMessageField('${targetId}','{${key}}')">${label}</button>`).join('')}</div></div>`;
  }
  function insertMessageField(targetId, token){
    const el = document.getElementById(targetId);
    if(!el){ alert('تعذر العثور على مربع الرسالة.'); return; }
    const start = Number.isFinite(el.selectionStart) ? el.selectionStart : el.value.length;
    const end = Number.isFinite(el.selectionEnd) ? el.selectionEnd : start;
    const before = el.value.slice(0,start), after = el.value.slice(end);
    const spacerBefore = before && !/\s$/.test(before) ? ' ' : '';
    const spacerAfter = after && !/^\s/.test(after) ? ' ' : '';
    el.value = before + spacerBefore + token + spacerAfter + after;
    const pos = (before + spacerBefore + token).length;
    el.focus(); el.setSelectionRange(pos,pos);
  }
  function renderSettings(){
    const s = YWP.state.settings;
    const startedAt = YWP.state.meta?.productionStartedAt;
    const productionStartPanel = startedAt
      ? `<div class="notice success"><b>التشغيل الفعلي مفعّل</b><br>${YWP.esc(new Date(startedAt).toLocaleString('ar'))}. تم تعطيل المسح وترحيل JSON غير المشفر.</div>`
      : `<button class="red" onclick="App.resetSystem()">بدء التشغيل الفعلي ومسح البيانات التجريبية</button><div class="notice danger-box production-start-card"><h2>بدء التشغيل الفعلي</h2><p class="production-warning">إجراء لمرة واحدة: يحتفظ بإعدادات المشروع، ينشئ نسخة حماية، ثم يحذف جميع البيانات التجريبية. لا يمكن تكراره بعد التفعيل.</p></div>`;
    $('#settings').innerHTML = `<div class="card">
      <h2>إعدادات المشروع</h2>
      <div class="form-row">
        ${field('اسم النظام/المشروع','projectName',s.projectName)}
        ${field('اسم المالك/المشروع','ownerName',s.ownerName)}
        ${field('العنوان','projectAddress',s.projectAddress || '')}
        ${field('رقم التواصل 1','projectPhone1',s.projectPhone1 || '')}
        ${field('رقم التواصل 2','projectPhone2',s.projectPhone2 || '')}
        ${field('رقم واتساب','projectWhatsApp',s.projectWhatsApp || '')}
        ${field('رقم الحساب','projectAccountNo',s.projectAccountNo || '')}
        ${field('العملة المختصرة','currencyShort',s.currencyShort || 'ر.ي')}
        ${field('اسم العملة الكامل','currencyFull',s.currencyFull || 'ريال يمني')}
        ${field('البريد الإلكتروني','projectEmail',s.projectEmail || '','email')}
        ${field('تعرفة المتر المكعب','tariff',s.tariff,'number')}
        ${field('مقاس العداد الرئيسي','mainMeterSize',s.mainMeterSize)}
        ${field('يوم دورة نصف الشهر','halfCycleDay',s.halfCycleDay,'number')}
        ${field('يوم دورة نهاية الشهر','monthCycleDay',s.monthCycleDay,'number')}
      </div>

      <div class="card soft" style="margin-top:10px">
        <h3>شعار المشروع</h3>
        <div class="notice">يمكنك رفع شعار المشروع ليظهر في الفواتير وسندات القبض والكشوفات. يحفظ الشعار داخل النسخة الاحتياطية.</div>
        <div class="toolbar"><input type="file" accept="image/*" onchange="App.loadProjectLogo(event)"><button class="red" onclick="App.removeProjectLogo()">حذف الشعار</button></div>
        ${s.projectLogo ? `<img src="${s.projectLogo}" style="max-width:110px;max-height:110px;border:1px solid #ddd;border-radius:12px;padding:5px;background:#fff">` : '<div class="hint">لم يتم رفع شعار بعد.</div>'}
      </div>
      <div class="card soft" style="margin-top:10px">
        <h3>رأس الفاتورة وسند القبض والكشوفات</h3>
        <div class="notice success">هذه الحقول قابلة للتعديل والإضافة، وتظهر في رأس الفاتورة وسند القبض والكشوفات والتقارير.</div>
        <div class="form-row">
          ${field('عنوان رأس الفاتورة','invoiceHeaderTitle',s.invoiceHeaderTitle || s.projectName || '')}
          ${field('العنوان الفرعي للفاتورة','invoiceHeaderSubtitle',s.invoiceHeaderSubtitle || s.ownerName || '')}
          ${field('عنوان رأس سند القبض','receiptHeaderTitle',s.receiptHeaderTitle || s.projectName || '')}
          ${field('العنوان الفرعي للسند','receiptHeaderSubtitle',s.receiptHeaderSubtitle || s.ownerName || '')}
          ${field('عنوان رأس الكشوفات والتقارير','reportsHeaderTitle',s.reportsHeaderTitle || s.projectName || '')}
          ${field('العنوان الفرعي للكشوفات','reportsHeaderSubtitle',s.reportsHeaderSubtitle || s.ownerName || '')}
          ${field('سطر رأس 1','documentHeaderLine1',s.documentHeaderLine1 || s.projectAddress || '')}
          ${field('سطر رأس 2','documentHeaderLine2',s.documentHeaderLine2 || (s.projectPhone1 ? 'موبايل: '+s.projectPhone1 : ''))}
          ${field('سطر رأس 3','documentHeaderLine3',s.documentHeaderLine3 || (s.projectAccountNo ? 'رقم الحساب: '+s.projectAccountNo : ''))}
          ${field('سطر رأس 4 / إضافة اختيارية','documentHeaderLine4',s.documentHeaderLine4 || '')}
          ${field('عنوان الفاتورة','invoiceTitle',s.invoiceTitle || 'فاتورة استهلاك مياه')}
          ${field('عنوان سند القبض','receiptTitle',s.receiptTitle || 'سند قبض')}
        </div>
        <div class="field"><label>نص أسفل الكشوفات والتقارير</label><textarea id="reportsFooter">${YWP.esc(s.reportsFooter || '')}</textarea></div>
      </div>
      <div class="form-row">
        <div class="field"><label>وصف الشبكة</label><textarea id="branchDescription">${YWP.esc(s.branchDescription)}</textarea></div>
        <div class="field"><label>نص أسفل الفاتورة</label><textarea id="invoiceFooter">${YWP.esc(s.invoiceFooter)}</textarea></div>
      </div>
      <div class="card soft" style="margin-top:10px">
        <h3>إعدادات الرسائل والقوالب المعتمدة</h3>
        <div class="notice success">هذه الصفحة هي المصدر الوحيد لنصوص الرسائل. اختر القناة وطريقة الإرسال الافتراضيتين، ثم احفظ قوالب SMS وواتساب. مركز رسائل المشتركين يعرض القالب المختار للمعاينة فقط ولا يسمح بكتابة نص بديل.</div>
        <div class="form-row">
          <div class="field"><label>قناة الإرسال الافتراضية</label><select id="bulkDefaultChannel"><option value="sms" ${(s.bulkDefaultChannel||'sms')==='sms'?'selected':''}>SMS</option><option value="whatsapp" ${s.bulkDefaultChannel==='whatsapp'?'selected':''}>واتساب</option></select></div>
          <div class="field"><label>طريقة الإرسال الافتراضية</label><select id="bulkDefaultMode"><option value="personalized" ${(s.bulkDefaultMode||'personalized')==='personalized'?'selected':''}>مخصص لكل مشترك</option><option value="group" ${s.bulkDefaultMode==='group'?'selected':''}>جماعي</option></select></div>
          <div class="field"><label>نوع القالب الافتراضي</label><select id="bulkDefaultTemplateKind"><option value="general" ${(s.bulkDefaultTemplateKind||'general')==='general'?'selected':''}>رسالة عامة للمشتركين</option><option value="invoice" ${s.bulkDefaultTemplateKind==='invoice'?'selected':''}>آخر فاتورة</option></select></div>
        </div>
        <div class="form-row">
          <div class="field"><label>قالب الرسالة العامة SMS</label><textarea id="generalSmsTemplate">${YWP.esc(s.generalSmsTemplate || s.bulkMessageTemplate || '')}</textarea>${messageFieldButtons('generalSmsTemplate', [['project','اسم المشروع'],['name','اسم المشترك'],['subscriberCode','رقم المشترك'],['meterNo','رقم العداد'],['area','العنوان'],['phoneNumber','الهاتف'],['balance','الرصيد']])}</div>
          <div class="field"><label>قالب الرسالة العامة واتساب</label><textarea id="generalWhatsappTemplate">${YWP.esc(s.generalWhatsappTemplate || s.bulkMessageTemplate || '')}</textarea>${messageFieldButtons('generalWhatsappTemplate', [['project','اسم المشروع'],['name','اسم المشترك'],['subscriberCode','رقم المشترك'],['meterNo','رقم العداد'],['area','العنوان'],['phoneNumber','الهاتف'],['balance','الرصيد']])}</div>
          <div class="field"><label>رسالة الفاتورة SMS</label><textarea id="invoiceSmsTemplate">${YWP.esc(s.invoiceSmsTemplate || s.smsTemplate || '')}</textarea>${messageFieldButtons('invoiceSmsTemplate', INVOICE_MESSAGE_FIELDS)}</div>
          <div class="field"><label>رسالة الفاتورة واتساب</label><textarea id="invoiceWhatsappTemplate">${YWP.esc(s.invoiceWhatsappTemplate || '')}</textarea>${messageFieldButtons('invoiceWhatsappTemplate', INVOICE_MESSAGE_FIELDS)}</div>
          <div class="field"><label>رسالة سند القبض SMS</label><textarea id="receiptSmsTemplate">${YWP.esc(s.receiptSmsTemplate || '')}</textarea>${messageFieldButtons('receiptSmsTemplate', RECEIPT_MESSAGE_FIELDS)}</div>
          <div class="field"><label>رسالة سند القبض واتساب</label><textarea id="receiptWhatsappTemplate">${YWP.esc(s.receiptWhatsappTemplate || '')}</textarea>${messageFieldButtons('receiptWhatsappTemplate', RECEIPT_MESSAGE_FIELDS)}</div>
        </div>
        <details open><summary>الحقول المعتمدة للفواتير</summary><div class="hint ltr" style="direction:ltr;text-align:left;line-height:1.8">{project} {owner} {phone} {whatsapp} {address} {accountNo} {currencyShort} {currencyFull} {name} {subscriberName} {subscriberCode} {phoneNumber} {area} {meterNo} {invoiceNo} {date} {cycleName} {prevReading} {currentReading} {consumption} {tariff} {amount} {arrears} {prevBalance} {previousPayments} {previousPaymentsDate} {currentPaid} {remaining} {due} {credit} {latestCurrentPayment} {latestCurrentPaymentDate} {status}</div></details>
        <details><summary>الحقول المعتمدة لسند القبض</summary><div class="hint ltr" style="direction:ltr;text-align:left;line-height:1.8">{project} {owner} {phone} {whatsapp} {address} {accountNo} {currencyShort} {currencyFull} {name} {subscriberName} {subscriberCode} {phoneNumber} {area} {meterNo} {receiptNo} {paymentDate} {paymentAmount} {paymentMethod} {collector} {paymentNote} {balanceAfter}</div></details>
        <div class="toolbar"><button class="secondary" onclick="App.resetMessageTemplates()">استعادة القوالب الافتراضية</button><button class="light" onclick="App.previewMessageTemplates()">معاينة رسالة تجريبية</button></div>
      </div>
      <div class="card soft" style="margin-top:10px"><h3>إعدادات الطابعات المعتمدة</h3><div class="notice">حسب الصور المرسلة: الطابعة الحرارية المحمولة لسندات القبض فقط، والطابعة الورقية Epson L3110 للفواتير A5 والكشوفات A4.</div><div class="form-row">
        ${field('الطابعة الورقية للفواتير والكشوفات','paperPrinterProfile',s.paperPrinterProfile || 'Epson EcoTank L3110 - A5 للفواتير والسندات، A4 للكشوفات')}
        ${field('الطابعة الحرارية لسندات القبض','thermalPrinterProfile',s.thermalPrinterProfile || 'Portable Bluetooth Thermal 58mm - ESC/POS - سندات القبض فقط')}
        <div class="field"><label>مقاس رول الطابعة الحرارية</label><select id="receiptThermalWidth"><option value="58" ${(s.receiptThermalWidth||'58')==='58'?'selected':''}>58mm - الأكثر احتمالاً للطابعة الظاهرة</option><option value="80" ${(s.receiptThermalWidth||'58')==='80'?'selected':''}>80mm</option></select></div>
      </div><div class="field"><label>ملاحظة تشغيل الطابعة الورقية</label><textarea id="documentPrinterNote">${YWP.esc(s.documentPrinterNote || 'الطابعة الورقية Epson L3110 تستخدم من نافذة الطباعة عبر الكمبيوتر/الجهاز المثبت عليه تعريف الطابعة.')}</textarea></div></div>
      <div class="toolbar"><button onclick="App.saveSettings()" class="green">حفظ الإعدادات</button><button class="secondary" onclick="App.loadExcelData()">إعادة تحميل بيانات الكشف المرفوع</button></div>${productionStartPanel}
    </div>${backupManagementPanel()}`;
  }
  function field(label,id,value,type='text'){
    const numberAttributes = type === 'number' ? ' min="0" step="any" inputmode="decimal"' : '';
    return `<div class="field"><label>${label}</label><input id="${id}" type="${type}" value="${YWP.esc(value)}"${numberAttributes}></div>`;
  }
  function backupMiniPanel(){
    const last = YWP.lastBackupInfo();
    const status = last ? `آخر نسخة محفوظة: ${new Date(last.createdAt).toLocaleString('ar')} | المصدر: ${backupSourceLabel(last.source)} | المشتركين: ${YWP.num(last.summary?.subscribers || 0)}` : 'لا توجد نسخة محلية بعد.';
    return `<div class="card backup-card" style="margin-top:14px">
      <h2>النسخ الاحتياطي ضروري</h2>
      <div class="notice warning"><b>قاعدة العمل:</b> بعد نهاية كل يوم تحصيل أو قراءة، أنشئ نسخة محمولة واحفظ الملف ورمز الاستعادة في مكانين منفصلين. يمكن استعادتها بعد حذف التطبيق أو على جهاز بديل.</div>
      <div class="toolbar"><button onclick="App.exportBackup()" class="green">تنزيل نسخة احتياطية كاملة الآن</button><button onclick="App.switchTab('settings')" class="secondary">إدارة النسخ المحلية</button></div>
      <p class="hint">${YWP.esc(status)}</p>
    </div>`;
  }
  function backupSourceLabel(src){
    return src === 'manual' ? 'يدوية' : src === 'daily-auto' ? 'تلقائية يومية' : src === 'before-import' ? 'قبل الاستيراد' : src === 'before-local-restore' ? 'قبل الاسترجاع' : src || 'غير محدد';
  }
  function backupManagementPanel(){
    const list = YWP.localBackups();
    const rows = list.map(b=>`<tr><td>${new Date(b.createdAt).toLocaleString('ar')}</td><td>${backupSourceLabel(b.source)}</td><td>${YWP.num(b.summary?.subscribers||0)}</td><td>${YWP.num(b.summary?.invoices||0)}</td><td>${YWP.num(b.summary?.payments||0)}</td><td class="actions"><button class="mini secondary" onclick="App.exportLocalBackup('${b.id}')">تنزيل</button><button class="mini warn" onclick="App.restoreLocalBackup('${b.id}')">استرجاع</button><button class="mini red" onclick="App.deleteLocalBackup('${b.id}')">حذف</button></td></tr>`).join('') || '<tr><td colspan="6">لا توجد نسخ محلية محفوظة بعد.</td></tr>';
    return `<div class="card" style="margin-top:14px">
      <h2>إدارة النسخ الاحتياطية</h2>
      <div class="notice success">يمكن استخدام Google Drive لنسخ SQLite تلقائيًا واستعادتها بعد إعادة التثبيت باختيار حساب Google نفسه ثم اسم المستخدم والدور، دون كلمة مرور منفصلة للنسخة.</div>
      <div class="toolbar"><button onclick="QatraDriveBackup.open()" class="green">Google Drive والنسخ التلقائي</button><button onclick="App.exportBackup()" class="secondary">إنشاء نسخة محمولة</button><label class="file-btn">استيراد نسخة/ترحيل JSON قديم <input type="file" accept=".qadmin,.qbackup,.json,application/octet-stream,application/json" onchange="App.importBackup(event)"></label></div>
      <div class="table-wrap"><table><thead><tr><th>تاريخ النسخة</th><th>النوع</th><th>المشتركين</th><th>الفواتير</th><th>التحصيلات</th><th>إجراءات</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  }
  function loadProjectLogo(event){
    const file = event.target.files && event.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      YWP.state.settings.projectLogo = String(reader.result || '');
      YWP.save();
      renderSettings();
      alert('تم حفظ شعار المشروع');
    };
    reader.readAsDataURL(file);
  }
  function removeProjectLogo(){
    if(confirm('حذف شعار المشروع من التطبيق؟')){
      YWP.state.settings.projectLogo = '';
      YWP.save();
      renderSettings();
    }
  }
  function resetMessageTemplates(){
    if(!confirm('استعادة قوالب الرسائل الافتراضية؟')) return;
    const s = YWP.state.settings;
    s.invoiceSmsTemplate = 'الأخ/ {name}، فاتورة المياه رقم {invoiceNo}، رقم العداد {meterNo}، دورة {cycleName} بتاريخ {date}. ق. سابقة {prevReading}، ق. حالية {currentReading}، الفارق {consumption} م³، استهلاك الدورة {amount} {currencyShort}، المتأخرات {arrears} {currencyShort}، الرصيد المقدم {openingCredit} {currencyShort}، إجمالي المبلغ المستحق {totalDue} {currencyShort}، حالة الفاتورة: {status}. المدفوعات السابقة {previousPayments} {currencyShort} هي آخر مدفوعات الفاتورة السابقة، ولا تعد سداداً لهذه الفاتورة. {project}';
    s.invoiceWhatsappTemplate = 'فاتورة استهلاك مياه\nالمشروع: {project}\nرقم الفاتورة: {invoiceNo}\nالمشترك: {name}\nرقم العداد: {meterNo}\nالدورة: {cycleName} - {date}\nق. سابقة: {prevReading}\nق. حالية: {currentReading}\nالفارق: {consumption} م³\nسعر الوحدة: {tariff} {currencyShort}\nاستهلاك الدورة: {amount} {currencyShort}\nالمتأخرات: {arrears} {currencyShort}\nالرصيد المقدم: {openingCredit} {currencyShort}\nإجمالي المبلغ المستحق: {totalDue} {currencyShort}\nالإجمالي كتابة: {totalDueWords}\nالمدفوعات السابقة: {previousPayments} {currencyShort} (آخر مدفوعات الفاتورة السابقة، للعرض فقط)\nحالة الفاتورة: {status}';
    s.receiptSmsTemplate = 'الأخ/ {name}، تم استلام مبلغ {paymentAmount} {currencyShort} بطريقة {paymentMethod}. سند رقم {receiptNo} بتاريخ {paymentDate}. الرصيد بعد السداد: {balanceAfter}. {project}';
    s.receiptWhatsappTemplate = 'سند قبض\nالمشترك: {name}\nرقم المشترك: {subscriberCode}\nرقم السند: {receiptNo}\nالتاريخ: {paymentDate}\nالمبلغ المقبوض: {paymentAmount} {currencyShort}\nطريقة الدفع: {paymentMethod}\nالمحصل: {collector}\nالرصيد بعد السداد: {balanceAfter}\n{project}';
    s.generalSmsTemplate = 'الأخ/ {name}، هذا إشعار من {project}. رقم المشترك: {subscriberCode}. رقم العداد: {meterNo}. الرصيد الحالي: {balance}.';
    s.generalWhatsappTemplate = 'إشعار للمشترك\nالمشروع: {project}\nالاسم: {name}\nرقم المشترك: {subscriberCode}\nرقم العداد: {meterNo}\nالمنطقة: {area}\nالرصيد الحالي: {balance}';
    s.bulkMessageTemplate = s.generalSmsTemplate;
    s.smsTemplate = s.invoiceSmsTemplate;
    YWP.save(); renderSettings();
  }
  function previewMessageTemplates(){
    const inv = YWP.state.invoices[0];
    const pay = YWP.state.payments[0];
    let msg = '';
    if(inv){
      const st = YWP.state.settings;
      const old = {invoiceSmsTemplate:st.invoiceSmsTemplate, invoiceWhatsappTemplate:st.invoiceWhatsappTemplate, receiptSmsTemplate:st.receiptSmsTemplate, receiptWhatsappTemplate:st.receiptWhatsappTemplate};
      ['invoiceSmsTemplate','invoiceWhatsappTemplate','receiptSmsTemplate','receiptWhatsappTemplate'].forEach(k=>{ const el=document.getElementById(k); if(el) st[k]=el.value; });
      msg += 'معاينة فاتورة SMS:\n' + YWP.smsText(inv,'sms') + '\n\nمعاينة فاتورة واتساب:\n' + YWP.smsText(inv,'whatsapp');
      if(pay) msg += '\n\nمعاينة سند SMS:\n' + YWP.receiptMessage(pay,'sms') + '\n\nمعاينة سند واتساب:\n' + YWP.receiptMessage(pay,'whatsapp');
      Object.assign(st, old);
    } else msg = 'لا توجد فاتورة لاستخدامها في المعاينة.';
    alert(msg);
  }
  function saveSettings(){
    ['projectName','ownerName','projectAddress','projectPhone1','projectPhone2','projectWhatsApp','projectAccountNo','currencyShort','currencyFull','projectEmail','tariff','mainMeterSize','halfCycleDay','monthCycleDay','branchDescription','invoiceHeaderTitle','invoiceHeaderSubtitle','receiptHeaderTitle','receiptHeaderSubtitle','reportsHeaderTitle','reportsHeaderSubtitle','documentHeaderLine1','documentHeaderLine2','documentHeaderLine3','documentHeaderLine4','invoiceTitle','receiptTitle','invoiceFooter','receiptFooter','reportsFooter','generalSmsTemplate','generalWhatsappTemplate','invoiceSmsTemplate','invoiceWhatsappTemplate','receiptSmsTemplate','receiptWhatsappTemplate','bulkDefaultChannel','bulkDefaultMode','bulkDefaultTemplateKind','smsTemplate','paperPrinterProfile','thermalPrinterProfile','receiptThermalWidth','documentPrinterNote'].forEach(k=>{
      const el = document.getElementById(k); if(el) YWP.state.settings[k] = ['tariff','halfCycleDay','monthCycleDay'].includes(k)?YWP.toNumber(el.value):el.value;
    });
    YWP.state.settings.bulkMessageTemplate = YWP.state.settings.generalSmsTemplate || YWP.state.settings.bulkMessageTemplate || '';
    YWP.save(); renderAll(); alert('تم حفظ الإعدادات');
  }
  function resetSystem(){
    if(YWP.state.meta?.productionStartedAt)return alert('تم بدء التشغيل الفعلي سابقًا. مسح بيانات التشغيل معطل.');
    if(!confirm('بدء التشغيل الفعلي سيحذف جميع البيانات التجريبية: المشتركين والدورات والقراءات والفواتير والسندات والمصروفات. سيتم الاحتفاظ بإعدادات المشروع والشعار والطابعات، وإنشاء نسخة حماية قبل الحذف. متابعة؟'))return;
    const phrase=prompt('للتأكيد اكتب: بدء التشغيل الفعلي');
    if(String(phrase||'').trim()!=='بدء التشغيل الفعلي')return alert('لم يتم الحذف لأن عبارة التأكيد غير صحيحة.');
    YWP.rememberLocalBackup('before-production-start');
    const clean=YWP.defaultState();
    clean.settings=JSON.parse(JSON.stringify(YWP.state.settings||clean.settings||{}));
    Object.keys(clean).forEach(k=>{if(Array.isArray(clean[k]))clean[k]=[];});
    clean.meta={...(clean.meta||{}),version:'12.3.5',productionStartedAt:new Date().toISOString(),mode:'PRODUCTION_CLEAN_START',notes:'تم بدء التشغيل الفعلي ببيانات فارغة مع الاحتفاظ بإعدادات المشروع.'};
    YWP.setState(clean);
    renderAll();
    alert('تم حذف البيانات التجريبية بنجاح. النظام جاهز الآن لاستيراد المشتركين الفعليين.');
  }
  function renderSubscribers(){
    const automaticCode = nextSubscriberCode();
    const rows = YWP.state.subscribers.map(s => {
      const b = YWP.balance(s.id);
      const last = YWP.lastReading(s.id);
      return `<tr class="${s.readingGroup==='HALF'?'half-cycle-row':''}"><td>${YWP.esc(s.code)}</td><td>${YWP.esc(s.name)}</td><td>${YWP.esc(s.phone)}</td><td>${YWP.esc(s.area)}</td><td>${YWP.esc(s.meterNo)}</td><td><select class="mini-select ${s.readingGroup==='HALF'?'half-select':''}" onchange="App.quickSetSubscriberGroup('${s.id}', this.value)"><option value="HALF" ${s.readingGroup==='HALF'?'selected':''}>نصف شهري</option><option value="MONTHLY" ${s.readingGroup!=='HALF'?'selected':''}>شهري فقط</option></select></td><td>${YWP.num(YWP.openingArrears(s))}</td><td>${YWP.num(YWP.openingCredit(s))}</td><td>${YWP.num(s.openingReading||0)}</td><td>${YWP.num(last?.current||0)}</td><td class="money ${b>0?'positive':b<0?'negative':'zero'}">${b>0?YWP.money(b)+' عليكم':b<0?YWP.money(Math.abs(b))+' لكم':'صفر'}</td><td class="actions"><button class="mini" onclick="App.editSubscriber('${s.id}')">تعديل البيانات</button><button class="mini secondary" onclick="App.quickSetSubscriberGroup('${s.id}', '${s.readingGroup==='HALF'?'MONTHLY':'HALF'}')">تحويل الدورة</button><button class="mini red" onclick="App.deleteSubscriber('${s.id}')">حذف</button></td></tr>`;
    }).join('');
    $('#subscribers').innerHTML = `<div class="card">
      <h2>إدارة المشتركين</h2>
      <div class="notice warning"><b>مهم للمشروع القائم:</b> لكل مشترك له قراءة سابقة/افتتاحية ومتأخرات ورصيد مقدم إن وجد. الصفوف الرمادية في الكشف المعتمد صارت تلقائيًا نصف شهرية، وتستطيع تحويل أي مشترك بين نصف شهري وشهري من الجدول أو من نموذج التعديل.</div>
      <div class="form-row">
        <input type="hidden" id="subId">
        <div class="field"><label>رقم المشترك</label><input id="subCode" value="${YWP.esc(automaticCode)}" readonly class="readonly generated-code" aria-readonly="true"><small class="field-note">يُنشأ تلقائيًا ولا يمكن تعديله أو تكراره.</small></div>
        ${field('اسم المشترك','subName','')}
        ${field('الهاتف','subPhone','')}
        ${field('الحي/المنطقة','subArea','')}
        ${field('رقم العداد','subMeterNo','')}
        ${field('مقاس العداد','subMeterSize','إنش إلا ربع')}
        <div class="field"><label>مجموعة القراءة</label><select id="subGroup"><option value="HALF">نصف شهري</option><option value="MONTHLY">شهري فقط</option></select></div>
        <div class="field"><label>الحالة</label><select id="subStatus"><option value="active">نشط</option><option value="stopped">موقوف</option></select></div>
        <div class="field"><label>القراءة السابقة/الافتتاحية</label><input id="subOpeningReading" type="number" value="0" min="0" step="any" inputmode="decimal" required></div>
        <div class="field"><label>متأخرات سابقة عليه</label><input id="subOpeningArrears" type="number" value="0" min="0" step="any" inputmode="decimal" required><small class="field-note">عند إدخال متأخرات يتوقف حقل الرصيد المقدم.</small></div>
        <div class="field"><label>رصيد مقدم سابق له</label><input id="subOpeningCredit" type="number" value="0" min="0" step="any" inputmode="decimal" required><small class="field-note">لا يمكن جمعه مع المتأخرات السابقة.</small></div>
      </div>
      <div class="notice success">المعادلة المعتمدة: الرصيد الافتتاحي = المتأخرات السابقة - الرصيد المقدم السابق. عند السداد الجزئي يبقى المتبقي، وعند السداد الزائد يتحول الفرق إلى رصيد مقدم.</div>
      <div class="toolbar"><button onclick="App.saveSubscriber()" class="green">حفظ المشترك</button><button onclick="App.clearSubscriberForm()" class="light">تفريغ</button><button onclick="App.downloadSubscriberTemplate()" class="warn">تنزيل قالب إدخال المشتركين</button><label class="file-btn">استيراد بيانات المشتركين Excel / CSV <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onchange="App.importSubscribersCSV(event)"></label><button onclick="App.exportSubscribers()" class="secondary">تصدير Excel/CSV</button></div>
      <div class="notice success"><b>التوسع متاح:</b> لا يوجد حد ثابت لعدد المشتركين. أضف مشتركًا واحدًا أو أضف مجموعة دفعة واحدة، وسيتم إدخالهم تلقائيًا في دورة نهاية الشهر، ومن تختاره فقط يدخل دورة نصف الشهر.</div>
      <details class="card" style="margin:10px 0;padding:10px"><summary><b>إضافة مجموعة مشتركين دفعة واحدة</b></summary><div class="form-row" style="margin-top:10px">${field('عدد المشتركين المراد إضافتهم','bulkCount','1','number')}${field('رقم البداية','bulkStart','')}${field('بادئة الاسم','bulkNamePrefix','مشترك')}${field('الحي الافتراضي','bulkArea','')}${field('مقاس العداد','bulkMeterSize','إنش إلا ربع')}<div class="field"><label>الدورة</label><select id="bulkGroup"><option value="MONTHLY">شهري فقط</option><option value="HALF">نصف شهري</option></select></div></div><button onclick="App.bulkAddSubscribers()" class="green">إضافة الدفعة</button></details>
      <div class="table-wrap"><table><thead><tr><th>رقم</th><th>الاسم</th><th>الهاتف</th><th>الحي</th><th>العداد</th><th>الدورة</th><th>متأخرات سابقة</th><th>رصيد مقدم</th><th>قراءة افتتاحية</th><th>آخر قراءة</th><th>الرصيد الحالي</th><th>إجراءات</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
    bindOpeningBalanceExclusivity();
  }
  function normalizeIdentifier(value){ return String(value || '').trim().toLocaleLowerCase('en-US'); }
  function strictNonNegativeField(id,label){
    const el=$(`#${id}`), raw=String(el?.value ?? '').trim();
    if(raw==='' || !/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(`${label} يجب أن تكون أرقامًا فقط.`);
    const value=Number(raw);
    if(!Number.isFinite(value)||value<0) throw new Error(`${label} يجب أن تكون صفرًا أو رقمًا موجبًا.`);
    return value;
  }
  function syncOpeningBalanceFields(){
    const arrears=$('#subOpeningArrears'),credit=$('#subOpeningCredit');if(!arrears||!credit)return;
    const arrearsValue=Number(arrears.value||0),creditValue=Number(credit.value||0);
    credit.disabled=Number.isFinite(arrearsValue)&&arrearsValue>0;
    arrears.disabled=Number.isFinite(creditValue)&&creditValue>0;
    arrears.closest('.field')?.classList.toggle('mutually-disabled',arrears.disabled);
    credit.closest('.field')?.classList.toggle('mutually-disabled',credit.disabled);
  }
  function bindOpeningBalanceExclusivity(){
    ['subOpeningArrears','subOpeningCredit'].forEach(id=>{
      const el=$(`#${id}`);if(!el||el.dataset.balanceBound==='1')return;
      el.dataset.balanceBound='1';el.addEventListener('input',syncOpeningBalanceFields);
    });
    syncOpeningBalanceFields();
  }
  function clearSubscriberForm(){
    ['subId','subName','subPhone','subArea','subMeterNo'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
    const code=$('#subCode');if(code)code.value=nextSubscriberCode();
    ['subOpeningReading','subOpeningArrears','subOpeningCredit'].forEach(id=>{const el=$(`#${id}`);if(el){el.value='0';el.disabled=false;}});
    const sz=$('#subMeterSize'); if(sz) sz.value='إنش إلا ربع';
    const group=$('#subGroup');if(group)group.value='HALF';const status=$('#subStatus');if(status)status.value='active';
    syncOpeningBalanceFields();
  }
  function nextSubscriberCode(){
    const max = YWP.state.subscribers.map(s=>parseInt(String(s.code||'').replace(/\D/g,''),10)).filter(Number.isFinite).reduce((a,b)=>Math.max(a,b),0);
    return String(max+1).padStart(3,'0');
  }
  function saveSubscriber(){
    const editingId=$('#subId').value;
    const id = editingId || YWP.uid('SUB');
    const oldSub = YWP.state.subscribers.find(s=>s.id===id) || {};
    const code = editingId ? String(oldSub.code || $('#subCode').value).trim() : nextSubscriberCode();
    let openingReading,openingArrears,openingCredit;
    try{
      openingReading=strictNonNegativeField('subOpeningReading','القراءة الافتتاحية');
      openingArrears=strictNonNegativeField('subOpeningArrears','المتأخرات السابقة');
      openingCredit=strictNonNegativeField('subOpeningCredit','الرصيد المقدم');
    }catch(error){alert(error.message);return;}
    if(openingArrears>0&&openingCredit>0){alert('لا يمكن إدخال متأخرات سابقة ورصيد مقدم للمشترك نفسه. أدخل قيمة في حقل واحد فقط.');return;}
    const meterNo=$('#subMeterNo').value.trim() || `WM-${code}`;
    const obj = {id, code, name:$('#subName').value.trim(), phone:$('#subPhone').value.trim(), area:$('#subArea').value.trim(), meterNo, meterSize:$('#subMeterSize').value.trim(), readingGroup:$('#subGroup').value, status:$('#subStatus').value, openingReading, openingArrears, openingCredit, openingBalance:openingArrears-openingCredit, notes:oldSub.notes || '', excelRow:oldSub.excelRow || '', initialImportGroup:oldSub.initialImportGroup || $('#subGroup').value, updatedAt:new Date().toISOString()};
    if(!obj.name){ alert('أدخل اسم المشترك'); return; }
    if(YWP.state.subscribers.some(s=>s.id!==id && normalizeIdentifier(s.code)===normalizeIdentifier(obj.code))){ alert('رقم المشترك مستخدم مسبقاً'); return; }
    if(YWP.state.subscribers.some(s=>s.id!==id && normalizeIdentifier(s.meterNo)===normalizeIdentifier(obj.meterNo))){ alert('رقم العداد مستخدم لمشترك آخر ولا يمكن تكراره.'); return; }
    const i = YWP.state.subscribers.findIndex(s=>s.id===id);
    if(i>=0) YWP.state.subscribers[i] = obj; else YWP.state.subscribers.push(obj);
    YWP.save(); renderSubscribers(); renderDashboard();alert(i>=0?'تم تحديث بيانات المشترك.':'تم إنشاء المشترك برقم تلقائي '+code+'.');
  }
  function bulkAddSubscribers(){
    const count = Math.min(1000, Math.max(1, YWP.toNumber($('#bulkCount')?.value || 1)));
    let startRaw = ($('#bulkStart')?.value || '').trim();
    let start = parseInt(startRaw || nextSubscriberCode(), 10);
    if(!Number.isFinite(start) || start < 1){ alert('رقم البداية غير صحيح'); return; }
    const prefix = ($('#bulkNamePrefix')?.value || 'مشترك').trim();
    const area = ($('#bulkArea')?.value || '').trim();
    const meterSize = ($('#bulkMeterSize')?.value || 'إنش إلا ربع').trim();
    const group = $('#bulkGroup')?.value || 'MONTHLY';
    const existingCodes = new Set(YWP.state.subscribers.map(s=>String(s.code)));
    let added = 0, codeNum = start;
    while(added < count){
      const code = String(codeNum).padStart(3,'0');
      if(!existingCodes.has(code)){
        YWP.state.subscribers.push({id:YWP.uid('SUB'), code, name:`${prefix} ${code}`, phone:'', area, meterNo:`WM-${code}`, meterSize, readingGroup:group, status:'active', openingReading:0, openingArrears:0, openingCredit:0, openingBalance:0, notes:''});
        existingCodes.add(code); added++;
      }
      codeNum++;
    }
    YWP.save(); renderSubscribers(); renderDashboard(); alert(`تم إضافة ${added} مشترك جديد. إجمالي المشتركين الآن: ${YWP.state.subscribers.length}`);
  }
  function editSubscriber(id){
    const s = YWP.subscriber(id); if(!s) return;
    $('#subId').value=s.id; $('#subCode').value=s.code; $('#subName').value=s.name; $('#subPhone').value=s.phone; $('#subArea').value=s.area; $('#subMeterNo').value=s.meterNo; $('#subMeterSize').value=s.meterSize; $('#subGroup').value=s.readingGroup; $('#subStatus').value=s.status; $('#subOpeningReading').value=s.openingReading||0; $('#subOpeningArrears').value=YWP.openingArrears(s); $('#subOpeningCredit').value=YWP.openingCredit(s);
    bindOpeningBalanceExclusivity();window.scrollTo({top:0,behavior:'smooth'});
  }
  function quickSetSubscriberGroup(id, group){
    const s = YWP.subscriber(id); if(!s) return;
    const next = group === 'HALF' ? 'HALF' : 'MONTHLY';
    if(s.readingGroup === next) return;
    s.readingGroup = next;
    s.updatedAt = new Date().toISOString();
    YWP.save();
    renderSubscribers();
    renderReadings();
    renderDashboard();
    alert(`تم تحويل ${s.name} إلى ${next === 'HALF' ? 'دورة نصف الشهر' : 'دورة نهاية الشهر فقط'}`);
  }
  function deleteSubscriber(id){
    if(!confirm('حذف المشترك؟')) return;
    YWP.state.subscribers = YWP.state.subscribers.filter(s=>s.id!==id); YWP.save(); renderSubscribers(); renderDashboard();
  }
  function exportSubscribers(){
    YWP.exportCSV('subscribers.csv', [['رقم','الاسم','الهاتف','الحي','رقم العداد','المقاس','الدورة','الحالة','قراءة افتتاحية','متأخرات سابقة','رصيد مقدم سابق','الرصيد الحالي']].concat(YWP.state.subscribers.map(s=>[s.code,s.name,s.phone,s.area,s.meterNo,s.meterSize,s.readingGroup,s.status,s.openingReading||0,YWP.openingArrears(s),YWP.openingCredit(s),YWP.balance(s.id)])));
  }

  function downloadSubscriberTemplate(){
    YWP.exportCSV('qatra-pro-subscribers-template.csv', [[
      'رقم المشترك','اسم المشترك','الهاتف','الحي','رقم العداد','مقاس العداد','الدورة','الحالة','قراءة افتتاحية','متأخرات سابقة','رصيد مقدم سابق'
    ]]);
  }
  function parseCsvLine(line, delimiter=','){
    const out=[]; let cur='', q=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){
        if(q && line[i+1]==='"'){ cur+='"'; i++; }
        else q=!q;
      }else if(ch===delimiter && !q){ out.push(cur.trim()); cur=''; }
      else cur+=ch;
    }
    out.push(cur.trim()); return out;
  }
  function decodeTextBuffer(buffer){
    const bytes=new Uint8Array(buffer);
    if(bytes[0]===0xFF&&bytes[1]===0xFE) return new TextDecoder('utf-16le').decode(bytes);
    if(bytes[0]===0xFE&&bytes[1]===0xFF){
      const swapped=new Uint8Array(bytes.length-2); for(let i=2;i+1<bytes.length;i+=2){swapped[i-2]=bytes[i+1];swapped[i-1]=bytes[i];}
      return new TextDecoder('utf-16le').decode(swapped);
    }
    try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(e){}
    try{return new TextDecoder('windows-1256').decode(bytes);}catch(e){}
    return new TextDecoder('utf-8').decode(bytes);
  }
  function detectDelimiter(text){
    const first=(text.replace(/^\uFEFF/,'').split(/\r?\n/).find(x=>x.trim())||'');
    const options=[',',';','\t']; let best=',',count=-1;
    options.forEach(d=>{let c=0,q=false;for(let i=0;i<first.length;i++){if(first[i]==='"')q=!q;else if(first[i]===d&&!q)c++;}if(c>count){count=c;best=d;}});
    return best;
  }
  function parseDelimitedText(text){
    text=String(text||'').replace(/^\uFEFF/,'');
    const delimiter=detectDelimiter(text),rows=[]; let row=[],cur='',q=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(ch==='"'){
        if(q&&text[i+1]==='"'){cur+='"';i++;}else q=!q;
      }else if(ch===delimiter&&!q){row.push(cur.trim());cur='';}
      else if((ch==='\n'||ch==='\r')&&!q){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cur.trim());cur='';if(row.some(v=>String(v).trim()!==''))rows.push(row);row=[];}
      else cur+=ch;
    }
    row.push(cur.trim());if(row.some(v=>String(v).trim()!==''))rows.push(row);
    return rows;
  }
  function xlsxColumnIndex(ref){
    const m=String(ref||'').match(/[A-Z]+/i);if(!m)return 0;let n=0;for(const ch of m[0].toUpperCase())n=n*26+(ch.charCodeAt(0)-64);return n-1;
  }
  function xmlNodeText(node){return Array.from(node?node.getElementsByTagName('t'):[]).map(x=>x.textContent||'').join('');}
  async function parseXlsxBuffer(buffer){
    if(typeof JSZip==='undefined') throw new Error('تعذر تشغيل قارئ Excel داخل التطبيق.');
    const zip=await JSZip.loadAsync(buffer);
    const readXml=async path=>{const f=zip.file(path);if(!f)throw new Error(`ملف Excel ناقص: ${path}`);return new DOMParser().parseFromString(await f.async('text'),'application/xml');};
    let shared=[];
    if(zip.file('xl/sharedStrings.xml')){
      const doc=await readXml('xl/sharedStrings.xml');
      shared=Array.from(doc.getElementsByTagName('si')).map(xmlNodeText);
    }
    const workbook=await readXml('xl/workbook.xml');
    const rels=await readXml('xl/_rels/workbook.xml.rels');
    const relMap={};Array.from(rels.getElementsByTagName('Relationship')).forEach(r=>relMap[r.getAttribute('Id')]=r.getAttribute('Target'));
    const sheets=Array.from(workbook.getElementsByTagName('sheet'));
    const selected=sheets.find(s=>(s.getAttribute('name')||'').includes('مشترك'))||sheets[0];
    if(!selected)throw new Error('لا توجد ورقة عمل داخل ملف Excel.');
    const rid=selected.getAttribute('r:id')||selected.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
    let target=relMap[rid]||'worksheets/sheet1.xml';
    target=target.replace(/^\//,''); if(!target.startsWith('xl/'))target='xl/'+target.replace(/^\.\//,'');
    const sheet=await readXml(target);
    return Array.from(sheet.getElementsByTagName('row')).map(r=>{
      const out=[];
      Array.from(r.getElementsByTagName('c')).forEach(c=>{
        const idx=xlsxColumnIndex(c.getAttribute('r'));
        const type=c.getAttribute('t')||'';
        let value='';
        if(type==='inlineStr') value=xmlNodeText(c);
        else{
          const v=c.getElementsByTagName('v')[0]?.textContent||'';
          value=type==='s'?(shared[Number(v)]??''):v;
        }
        out[idx]=String(value??'').trim();
      });
      return out;
    }).filter(r=>r.some(v=>String(v||'').trim()!==''));
  }
  async function spreadsheetRows(file){
    const buffer=await file.arrayBuffer();
    const bytes=new Uint8Array(buffer,0,Math.min(4,buffer.byteLength));
    const isZip=bytes[0]===0x50&&bytes[1]===0x4B;
    if(isZip||/\.xlsx$/i.test(file.name||'')) return parseXlsxBuffer(buffer);
    return parseDelimitedText(decodeTextBuffer(buffer));
  }
  function importSubscribersFromRows(rows, replaceMode){
    if(!Array.isArray(rows)||rows.length<2)throw new Error('الملف لا يحتوي على صفوف بيانات.');
    const header=rows[0].map(x=>String(x||'').trim());
    const norm=x=>String(x||'').replace(/[\s_\-\/\\.]+/g,'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').toLowerCase();
    const find=names=>{for(const name of names){const i=header.findIndex(h=>norm(h)===norm(name));if(i>=0)return i;}return -1;};
    const idx={
      code:find(['رقم المشترك','رقم','الكود','code']),
      name:find(['اسم المشترك','الاسم','اسم','name']),
      phone:find(['الهاتف','الجوال','رقم الهاتف','phone']),
      area:find(['الحي','المنطقة','الحارة','العنوان','area','address']),
      meterNo:find(['رقم العداد','العداد','meter no','meterno']),
      meterSize:find(['مقاس العداد','المقاس','metersize']),
      group:find(['الدورة','مجموعة القراءة','readinggroup']),
      status:find(['الحالة','status']),
      openingReading:find(['القراءة الافتتاحية','قراءة افتتاحية','القراءة السابقة','قراءة سابقة','openingreading']),
      arrears:find(['المتأخرات الافتتاحية','متأخرات افتتاحية','متأخرات سابقة','متأخرات','arrears']),
      credit:find(['الرصيد المقدم','رصيد مقدم سابق','رصيد مقدم','credit']),
      previousPayments:find(['المدفوعات السابقة','مدفوعات سابقة','previouspayments'])
    };
    if(idx.name<0)throw new Error(`لم يتم العثور على عمود الاسم. الأعمدة الموجودة: ${header.join(' | ')}`);
    const errors=[];let added=0,updated=0;
    const seenImportCodes=new Set(),seenImportMeters=new Set();
    if(replaceMode){
      Object.keys(YWP.state).forEach(k=>{if(Array.isArray(YWP.state[k]))YWP.state[k]=[];});
    }
    for(let n=1;n<rows.length;n++){
      const c=rows[n]||[];
      const name=String(idx.name>=0?(c[idx.name]??''):'').trim();
      if(!name){errors.push(`الصف ${n+1}: الاسم فارغ`);continue;}
      const rawCode=idx.code>=0?String(c[idx.code]??'').trim():'';
      const code=rawCode||nextSubscriberCode();
      const meterNo=idx.meterNo>=0?String(c[idx.meterNo]??'').trim():'';
      const normalizedCode=normalizeIdentifier(code),normalizedMeter=normalizeIdentifier(meterNo||`WM-${code}`);
      if(seenImportCodes.has(normalizedCode)){errors.push(`الصف ${n+1}: رقم المشترك ${code} مكرر داخل الملف`);continue;}
      if(seenImportMeters.has(normalizedMeter)){errors.push(`الصف ${n+1}: رقم العداد ${meterNo||`WM-${code}`} مكرر داخل الملف`);continue;}
      const duplicateMeter=meterNo&&YWP.state.subscribers.find(s=>normalizeIdentifier(s.meterNo)===normalizeIdentifier(meterNo)&&normalizeIdentifier(s.code)!==normalizeIdentifier(code));
      if(duplicateMeter){errors.push(`الصف ${n+1}: رقم العداد ${meterNo} مكرر`);continue;}
      const numericCell=(column,label)=>{
        const raw=column>=0?String(c[column]??'').replace(/[,،\s]/g,'').trim():'0';
        if(raw==='')return 0;
        if(!/^\d+(?:\.\d+)?$/.test(raw))throw new Error(`${label} يجب أن تكون أرقامًا موجبة أو صفرًا`);
        const value=Number(raw);if(!Number.isFinite(value)||value<0)throw new Error(`${label} غير صالحة`);return value;
      };
      let openingReading,openingArrears,openingCredit,previousPayments;
      try{
        openingReading=numericCell(idx.openingReading,'القراءة الافتتاحية');
        openingArrears=numericCell(idx.arrears,'المتأخرات السابقة');
        openingCredit=numericCell(idx.credit,'الرصيد المقدم');
        previousPayments=numericCell(idx.previousPayments,'المدفوعات السابقة');
      }catch(error){errors.push(`الصف ${n+1}: ${error.message}`);continue;}
      if(openingArrears>0&&openingCredit>0){errors.push(`الصف ${n+1}: لا يمكن جمع المتأخرات السابقة والرصيد المقدم للمشترك نفسه`);continue;}
      seenImportCodes.add(normalizedCode);seenImportMeters.add(normalizedMeter);
      const rawGroup=String(idx.group>=0?(c[idx.group]??''):'MONTHLY').toUpperCase();
      const group=(rawGroup.includes('HALF')||rawGroup.includes('نصف'))?'HALF':'MONTHLY';
      const rawStatus=String(idx.status>=0?(c[idx.status]??''):'active').toLowerCase();
      const status=(rawStatus.includes('stop')||rawStatus.includes('موق')||rawStatus.includes('غيرنشط'))?'stopped':'active';
      const obj={
        id:YWP.uid('SUB'),code:String(code),name,
        phone:idx.phone>=0?String(c[idx.phone]??'').trim():'',
        area:idx.area>=0?String(c[idx.area]??'').trim():'',
        meterNo:meterNo||`WM-${String(code)}`,
        meterSize:(idx.meterSize>=0?String(c[idx.meterSize]??'').trim():'')||'إنش إلا ربع',
        readingGroup:group,status,
        openingReading,
        openingArrears,openingCredit,openingBalance:openingArrears-openingCredit,
        previousPayments,
        previousPaymentsDate:'',notes:'استيراد من ملف Excel/CSV',updatedAt:new Date().toISOString()
      };
      const oldIndex=YWP.state.subscribers.findIndex(s=>String(s.code)===String(obj.code)||String(s.meterNo)===String(obj.meterNo));
      if(oldIndex>=0){obj.id=YWP.state.subscribers[oldIndex].id;YWP.state.subscribers[oldIndex]={...YWP.state.subscribers[oldIndex],...obj};updated++;}
      else{YWP.state.subscribers.push(obj);added++;}
    }
    if(!added&&!updated)throw new Error(errors[0]||'لم يتم استيراد أي مشترك.');
    YWP.save();renderSubscribers();renderDashboard();
    const preview=errors.slice(0,8).join('\n');
    alert(`اكتمل الاستيراد بنجاح.\n\nجديد: ${added}\nمحدّث: ${updated}\nمرفوض: ${errors.length}${preview?`\n\nأسباب الرفض:\n${preview}${errors.length>8?'\n...':''}`:''}`);
  }
  async function importSubscribersCSV(ev){
    const file=ev.target.files&&ev.target.files[0];if(!file)return;
    try{
      const rows=await spreadsheetRows(file);
      const replaceMode=confirm('طريقة الاستيراد:\n\nموافق = استبدال جميع البيانات الحالية والبدء بالمشتركين الموجودين في الملف.\nإلغاء = إضافة المشتركين الجدد وتحديث الموجودين فقط.');
      if(replaceMode){
        if(!confirm('سيتم إنشاء نسخة حماية ثم حذف المشتركين والعمليات الحالية قبل الاستيراد. هل تريد المتابعة؟'))return;
        YWP.rememberLocalBackup('before-import');
      }
      importSubscribersFromRows(rows,replaceMode);
    }catch(e){
      console.error(e);
      alert(`تعذر استيراد الملف.\n\nالسبب: ${e&&e.message?e.message:'ملف غير صالح'}\n\nيدعم النظام ملفات Excel XLSX وملفات CSV العربية.`);
    }finally{ev.target.value='';}
  }
  function renderReadings(){
    const cycles = YWP.state.cycles.slice().sort((a,b)=>b.cycleDate.localeCompare(a.cycleDate));
    const selected = cycles[0]?.id || '';
    const latestSaved = latestSavedCycleDate();
    $('#readings').innerHTML = `<section class="reading-cycle-hero"><div><small>دورة القراءة والفوترة</small><h1>إدارة قراءات العدادات</h1><p>دورة مؤرخة، قراءة سابقة محمية، وتحقق فوري قبل الحفظ.</p></div><span>▥</span></section><div class="grid two reading-cycle-grid">
      <div class="card cycle-create-card">
        <h2>إنشاء دورة قراءة جديدة</h2>
        <div class="form-row">
          <div class="field"><label>نوع الدورة</label><select id="cycleType"><option value="HALF">دورة نصف الشهر - قراءة مشتركي نصف الشهر</option><option value="MONTHLY">دورة نهاية الشهر - قراءة جميع المشتركين + العداد الرئيسي</option></select></div>
          <div class="field"><label>تاريخ الدورة</label><input id="cycleDate" type="date" value="${YWP.today()}"></div>
        </div>
        <div class="toolbar"><button onclick="App.createCycle()" class="green">إنشاء الدورة</button><button onclick="App.printReadingSheet()" class="secondary">طباعة كشف جمع قراءة فارغ</button></div>
        <div class="cycle-rule-note"><b>ضوابط الحفظ</b><span>القراءة السابقة تُجلب تلقائيًا ولا يمكن تعديلها.</span><span>القراءة الحالية يجب أن تساوي السابقة أو تزيد عليها.</span><span>لا يمكن إنشاء دورة أقدم من آخر دورة من النوع نفسه لديها قراءات.</span></div>
        ${latestSaved?`<p class="hint">آخر تاريخ توجد فيه قراءات محفوظة: <b>${YWP.esc(latestSaved)}</b></p>`:''}
      </div>
      <div class="card cycle-history-card">
        <h2>الدورات السابقة</h2>
        <div class="field"><label>اختر دورة للعمل عليها</label><select id="selectedCycle" onchange="App.renderCycleWork()">${cycles.map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${YWP.arCycle(c.type)} - ${c.cycleDate}</option>`).join('')}</select></div>
        <div id="cycleSummary"></div>
      </div>
    </div>
    <div id="cycleWork" style="margin-top:14px"></div>`;
    renderCycleWork();
  }
  function latestSavedCycleDate(type=''){
    return YWP.state.cycles
      .filter(c=>(!type||c.type===type)&&YWP.readingsForCycle(c.id).length>0)
      .map(c=>c.cycleDate||'').filter(Boolean).sort().pop()||'';
  }
  function laterSavedCycle(cycle){
    return YWP.state.cycles.find(c=>c.id!==cycle.id&&c.cycleDate>cycle.cycleDate&&YWP.readingsForCycle(c.id).length>0)||null;
  }
  function createCycle(){
    const type = $('#cycleType').value; const date = $('#cycleDate').value || YWP.today();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){alert('أدخل تاريخًا صحيحًا للدورة.');return;}
    const exists = YWP.state.cycles.find(c=>c.type===type && c.cycleDate===date);
    if(exists){ alert('هذه الدورة موجودة مسبقاً'); return; }
    const latestDate=latestSavedCycleDate();
    if(latestDate&&date<=latestDate){alert(`لا يمكن إنشاء دورة بتاريخ ${date}. توجد دورة سابقة تحتوي قراءات محفوظة بتاريخ ${latestDate}، ويجب أن يكون تاريخ الدورة الجديدة بعد آخر تاريخ محفوظ.`);return;}
    const occupiedDate=YWP.state.cycles.find(c=>c.cycleDate===date&&YWP.readingsForCycle(c.id).length>0);
    if(occupiedDate){alert(`يوجد بالفعل قراءات محفوظة في دورة بتاريخ ${date}، ولا يمكن إدخال دورة أخرى بالتاريخ نفسه.`);return;}
    const c = {id:YWP.uid('CYC'), type, cycleDate:date, periodLabel:YWP.arCycle(type), mainPrev:type==='MONTHLY'?YWP.lastMainCurrent(date):'', mainCurrent:'', status:'open'};
    YWP.state.cycles.push(c); YWP.save(); renderReadings();
  }
  function renderCycleWork(){
    const sel = $('#selectedCycle');
    if(!sel || !sel.value){ $('#cycleWork').innerHTML='<div class="card"><p>لا توجد دورات بعد.</p></div>'; return; }
    const c = YWP.cycle(sel.value); if(!c) return;
    const targets = YWP.activeSubscribers(c.type);
    const readMap = Object.fromEntries(YWP.readingsForCycle(c.id).map(r=>[r.subscriberId,r]));
    const rows = targets.map((s,index)=>{
      const last = YWP.lastReading(s.id, c.cycleDate);
      const r = readMap[s.id] || {};
      const prev = r.prev ?? last?.current ?? 0;
      return `<tr data-sub="${s.id}"><td class="reading-seq" data-label="م">${index+1}</td><td data-label="رقم المشترك"><b>${YWP.esc(s.code)}</b></td><td data-label="اسم المشترك">${YWP.esc(s.name)}</td><td data-label="الحي">${YWP.esc(s.area)}</td><td data-label="رقم العداد">${YWP.esc(s.meterNo)}</td><td data-label="القراءة السابقة"><input class="prev readonly locked-reading" type="number" min="0" step="any" inputmode="decimal" autocomplete="off" aria-label="القراءة السابقة للمشترك ${YWP.esc(s.code)}" value="${YWP.esc(prev)}" readonly aria-readonly="true" tabindex="-1"><small class="locked-note">محفوظة تلقائيًا</small></td><td data-label="القراءة الحالية"><div class="reading-current-field"><input class="current" type="number" min="${YWP.esc(prev)}" step="any" inputmode="decimal" autocomplete="off" data-prev="${YWP.esc(prev)}" aria-label="القراءة الحالية للمشترك ${YWP.esc(s.code)}" value="${YWP.esc(r.current ?? '')}"><small class="reading-validation-message">يجب ألا تقل عن ${YWP.esc(prev)}</small></div></td><td class="cons" data-label="الاستهلاك">${YWP.num(r.consumption||0)}</td><td data-label="ملاحظات"><input class="notes" autocomplete="off" aria-label="ملاحظات المشترك ${YWP.esc(s.code)}" value="${YWP.esc(r.notes||'')}"></td></tr>`;
    }).join('');
    const reads = YWP.readingsForCycle(c.id);
    const total = reads.reduce((a,r)=>a+YWP.toNumber(r.consumption),0);
    $('#cycleSummary').innerHTML = `<div class="notice">${YWP.arCycle(c.type)} بتاريخ ${c.cycleDate} | المستهدف: ${targets.length} عداد | المدخل: ${reads.length} | الاستهلاك المسجل: ${YWP.num(total)} م³</div>`;
    $('#cycleWork').innerHTML = `<div class="card">
      <h2>إدخال القراءات: ${YWP.arCycle(c.type)} - ${c.cycleDate}</h2>
      ${c.type==='MONTHLY'?`<div class="notice warning main-meter-panel"><b>قراءة العداد الرئيسي:</b><div class="form-row"><div class="field"><label>القراءة السابقة للعداد الرئيسي</label><input id="mainPrev" class="readonly locked-reading" type="number" value="${YWP.esc(c.mainPrev??0)}" readonly aria-readonly="true"><small class="locked-note">مأخوذة من آخر دورة نهاية شهر</small></div><div class="field"><label>القراءة الحالية للعداد الرئيسي</label><input id="mainCurrent" type="number" min="${YWP.esc(c.mainPrev??0)}" step="any" inputmode="decimal" data-prev="${YWP.esc(c.mainPrev??0)}" value="${YWP.esc(c.mainCurrent??'')}"><small class="reading-validation-message">يجب ألا تقل عن القراءة السابقة</small></div></div></div>`:''}
      <div class="toolbar cycle-actions"><button id="saveCycleReadingsButton" onclick="App.saveCycleReadings('${c.id}')" class="green">حفظ القراءات</button><label class="file-btn reading-import-btn">استيراد قراءات Excel / CSV<input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onchange="App.importCycleReadings(event,'${c.id}')"></label><button onclick="App.downloadCycleReadingsTemplate('${c.id}')" class="light">تنزيل قالب القراءات</button><button onclick="App.generateInvoices('${c.id}')" class="secondary">إنشاء/تحديث فواتير الدورة</button><button onclick="App.printCycleInvoices('${c.id}')" class="warn">طباعة فواتير A5</button><button onclick="App.exportCycleReadings('${c.id}')" class="light">تصدير القراءات CSV</button></div><div id="readingFormStatus" class="reading-form-status" aria-live="polite"></div><div id="readingImportResult"></div>
      <div class="table-wrap quick-reading-table-wrap"><table id="readingTable" class="quick-reading-table"><thead><tr><th>م</th><th>رقم المشترك</th><th>الاسم</th><th>الحي</th><th>العداد</th><th>السابقة</th><th>الحالية</th><th>الاستهلاك</th><th>ملاحظات</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
    $$('#readingTable .current').forEach(inp=>{
      inp.addEventListener('input',()=>validateCurrentReadingInput(inp));
      validateCurrentReadingInput(inp);
    });
    if($('#mainCurrent')){
      $('#mainCurrent').addEventListener('input',e=>validateCurrentReadingInput(e.target,true));
      validateCurrentReadingInput($('#mainCurrent'),true);
    }
    validateReadingForm();
  }
  function validateCurrentReadingInput(input,isMain=false){
    const raw=String(input?.value??'').trim(),prev=Number(input?.dataset?.prev??input?.min??0);
    const current=raw===''?null:Number(raw);
    const invalid=current!==null&&(!Number.isFinite(current)||current<prev);
    input?.classList.toggle('reading-input-invalid',invalid);input?.setAttribute('aria-invalid',invalid?'true':'false');
    if(input&&typeof input.setCustomValidity==='function')input.setCustomValidity(invalid?`القراءة الحالية لا يمكن أن تقل عن ${prev}`:'');
    const message=input?.parentElement?.querySelector('.reading-validation-message');if(message)message.classList.toggle('visible',invalid);
    if(!isMain){const tr=input?.closest('tr');if(tr){tr.classList.toggle('reading-error',invalid);const cons=tr.querySelector('.cons');if(cons)cons.textContent=current===null?'0':invalid?'خطأ':YWP.num(current-prev);}}
    validateReadingForm();return !invalid;
  }
  function validateReadingForm(){
    const invalid=$$('.current.reading-input-invalid').length+($('#mainCurrent')?.classList.contains('reading-input-invalid')?1:0);
    const button=$('#saveCycleReadingsButton'),status=$('#readingFormStatus');if(button)button.disabled=invalid>0;
    if(status)status.textContent=invalid?`يوجد ${invalid} حقل قراءة أقل من السابقة. صحح القيم قبل الحفظ.`:'';
    return invalid===0;
  }
  function syncInvoiceFromReading(reading){
    const c = YWP.cycle(reading.cycleId); if(!c) return false;
    const inv = YWP.state.invoices.find(i=>i.cycleId===reading.cycleId && i.subscriberId===reading.subscriberId);
    if(!inv) return false;
    inv.prevReading = reading.prev;
    inv.currentReading = reading.current;
    inv.consumption = reading.consumption;
    inv.tariff = YWP.toNumber(YWP.state.settings.tariff);
    inv.amount = YWP.toNumber(reading.consumption) * inv.tariff;
    inv.prevBalance = YWP.balance(reading.subscriberId, inv.id);
    inv.totalDue = inv.prevBalance + inv.amount;
    inv.updatedAt = new Date().toISOString();
    inv.editNote = 'تم تحديث الفاتورة تلقائياً بعد تعديل القراءة.';
    return true;
  }

  function saveCycleReadings(cycleId){
    const c = YWP.cycle(cycleId); if(!c) return;
    const later=laterSavedCycle(c);if(later){alert(`لا يمكن إدخال أو تعديل قراءات بتاريخ ${c.cycleDate} لأن دورة أحدث من النوع نفسه تحتوي قراءات بتاريخ ${later.cycleDate}.`);return;}
    $$('#readingTable .current').forEach(input=>validateCurrentReadingInput(input));if($('#mainCurrent'))validateCurrentReadingInput($('#mainCurrent'),true);
    if(!validateReadingForm()){alert('صحح القراءات الحالية الأقل من القراءة السابقة قبل الحفظ.');return;}
    if(c.type==='MONTHLY'){
      const mainRaw=$('#mainCurrent').value;c.mainCurrent=mainRaw===''?'':YWP.toNumber(mainRaw);
    }
    $$('#readingTable tbody tr').forEach(tr=>{
      const subId = tr.dataset.sub; const existing=YWP.state.readings.find(r=>r.cycleId===cycleId && r.subscriberId===subId);const last=YWP.lastReading(subId,c.cycleDate);const prev=YWP.toNumber(existing?.prev??last?.current??YWP.subscriber(subId)?.openingReading??0); const curVal=tr.querySelector('.current').value;
      if(curVal === '') return;
      const current=YWP.toNumber(curVal);if(current<prev)return;const consumption = current-prev;
      const obj = {id: existing?.id || YWP.uid('READ'), cycleId, subscriberId:subId, prev, current, consumption, notes:tr.querySelector('.notes').value, createdAt:new Date().toISOString()};
      if(existing) Object.assign(existing,obj); else YWP.state.readings.push(obj);
      syncInvoiceFromReading(existing || obj);
    });
    YWP.recomputeInvoiceStatuses(); renderReadings(); renderInvoices(); renderDashboard(); alert('تم حفظ القراءات وتحديث أي فواتير مرتبطة بها تلقائياً');
  }
  function generateInvoices(cycleId){
    const c = YWP.cycle(cycleId); if(!c) return;
    const reads = YWP.readingsForCycle(cycleId);
    if(reads.length===0){ alert('لا توجد قراءات محفوظة لهذه الدورة'); return; }
    let created=0, updated=0;
    reads.forEach(r=>{
      const existing = YWP.state.invoices.find(i=>i.cycleId===cycleId && i.subscriberId===r.subscriberId);
      if(existing){ syncInvoiceFromReading(r); updated++; return; }
      const prevBal = YWP.balance(r.subscriberId);
      const amount = YWP.toNumber(r.consumption) * YWP.toNumber(YWP.state.settings.tariff);
      const totalDue = prevBal + amount;
      YWP.state.invoices.push({id:YWP.uid('INV'), no:`INV-${c.cycleDate.replace(/-/g,'')}-${YWP.subscriber(r.subscriberId)?.code||created+1}`, cycleId, subscriberId:r.subscriberId, date:c.cycleDate, prevReading:r.prev, currentReading:r.current, prevBalance:prevBal, consumption:r.consumption, tariff:YWP.state.settings.tariff, amount, totalDue, status: totalDue<=0?'paid':'due', sentSms:false, sentWhatsApp:false, updatedAt:new Date().toISOString()});
      created++;
    });
    YWP.recomputeInvoiceStatuses(); renderReadings(); renderInvoices(); renderDashboard(); alert(`تم إنشاء ${created} فاتورة وتحديث ${updated} فاتورة موجودة`);
  }
  function exportCycleReadings(cycleId){
    const c = YWP.cycle(cycleId); const rows = YWP.readingsForCycle(cycleId).map(r=>{ const s=YWP.subscriber(r.subscriberId)||{}; return [c.cycleDate,YWP.arCycle(c.type),s.code,s.name,s.area,s.meterNo,r.prev,r.current,r.consumption,r.notes]; });
    YWP.exportCSV(`readings-${c?.cycleDate||''}.csv`, [['التاريخ','الدورة','رقم المشترك','الاسم','الحي','رقم العداد','السابقة','الحالية','الاستهلاك','ملاحظات']].concat(rows));
  }
  function normalizeImportHeader(value){
    return String(value||'').replace(/[\s_\-\/\\.]+/g,'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').toLowerCase();
  }
  function numericImportValue(value){
    const cleaned=String(value??'').replace(/[,،\s]/g,'').trim();
    if(cleaned==='')return null;
    const n=Number(cleaned);return Number.isFinite(n)?n:null;
  }
  function downloadCycleReadingsTemplate(cycleId){
    const c=YWP.cycle(cycleId);if(!c)return alert('اختر دورة أولاً.');
    const rows=YWP.activeSubscribers(c.type).map(s=>{
      const existing=YWP.state.readings.find(r=>r.cycleId===cycleId&&r.subscriberId===s.id);
      const last=YWP.lastReading(s.id,c.cycleDate);
      const prev=existing?.prev??last?.current??s.openingReading??0;
      return [s.code,s.name,s.meterNo,prev,'',c.cycleDate,YWP.arCycle(c.type),''];
    });
    YWP.exportCSV(`reading-template-${c.cycleDate}.csv`,[['رقم المشترك','اسم المشترك','رقم العداد','القراءة السابقة','القراءة الحالية','التاريخ','الدورة','ملاحظات']].concat(rows));
  }
  function importCycleReadingsFromRows(rows,cycleId){
    const c=YWP.cycle(cycleId);if(!c)throw new Error('لم يتم العثور على الدورة المحددة.');
    if(c.status==='closed')throw new Error('الدورة مغلقة ولا يمكن استيراد قراءات إليها.');
    const later=laterSavedCycle(c);if(later)throw new Error(`لا يمكن استيراد قراءات بتاريخ ${c.cycleDate} لأن دورة أحدث تحتوي قراءات محفوظة بتاريخ ${later.cycleDate}.`);
    if(!Array.isArray(rows)||rows.length<2)throw new Error('الملف لا يحتوي على قراءات.');
    const header=rows[0].map(x=>String(x||'').trim());
    const find=names=>{for(const name of names){const i=header.findIndex(h=>normalizeImportHeader(h)===normalizeImportHeader(name));if(i>=0)return i;}return -1;};
    const idx={
      meter:find(['رقم العداد','العداد','meter no','meterno']),
      current:find(['القراءة الحالية','قراءة حالية','الحالية','اخر قراءة','آخر قراءة','current reading','currentreading']),
      previous:find(['القراءة السابقة','قراءة سابقة','السابقة','prev reading','previousreading']),
      date:find(['التاريخ','تاريخ القراءة','تاريخ الدورة','date']),
      notes:find(['ملاحظات','ملاحظة','notes']),
      name:find(['اسم المشترك','الاسم','name'])
    };
    if(idx.meter<0)throw new Error(`لم يتم العثور على عمود رقم العداد. الأعمدة الموجودة: ${header.join(' | ')}`);
    if(idx.current<0)throw new Error(`لم يتم العثور على عمود القراءة الحالية. الأعمدة الموجودة: ${header.join(' | ')}`);
    const allowed=new Set(YWP.activeSubscribers(c.type).map(s=>s.id));
    const byMeter=new Map(YWP.state.subscribers.map(s=>[String(s.meterNo||'').trim(),s]));
    const seen=new Set(),valid=[],errors=[],warnings=[];
    for(let i=1;i<rows.length;i++){
      const row=rows[i]||[];
      if(!row.some(v=>String(v??'').trim()!==''))continue;
      const meter=String(row[idx.meter]??'').trim().replace(/\.0$/,'');
      const current=numericImportValue(row[idx.current]);
      const rowDate=idx.date>=0?String(row[idx.date]??'').trim():'';
      if(!meter){errors.push(`الصف ${i+1}: رقم العداد فارغ.`);continue;}
      if(rowDate&&rowDate!==c.cycleDate){errors.push(`الصف ${i+1}: تاريخ القراءة ${rowDate} لا يطابق تاريخ الدورة ${c.cycleDate}.`);continue;}
      if(seen.has(meter)){errors.push(`الصف ${i+1}: رقم العداد ${meter} مكرر داخل الملف.`);continue;}
      seen.add(meter);
      const sub=byMeter.get(meter);
      if(!sub){errors.push(`الصف ${i+1}: العداد ${meter} غير موجود بين المشتركين.`);continue;}
      if(!allowed.has(sub.id)){errors.push(`الصف ${i+1}: ${sub.name} ليس ضمن مشتركي هذه الدورة.`);continue;}
      if(current===null){errors.push(`الصف ${i+1}: القراءة الحالية للعداد ${meter} غير صالحة.`);continue;}
      const existing=YWP.state.readings.find(r=>r.cycleId===cycleId&&r.subscriberId===sub.id);
      const last=YWP.lastReading(sub.id,c.cycleDate);
      const prev=YWP.toNumber(existing?.prev??last?.current??sub.openingReading??0);
      const filePrev=idx.previous>=0?numericImportValue(row[idx.previous]):null;
      if(filePrev!==null&&Math.abs(filePrev-prev)>0.000001)warnings.push(`${sub.name}: السابقة في الملف ${filePrev} بينما المعتمدة في النظام ${prev}. تم اعتماد قراءة النظام.`);
      const special=(YWP.state.meterChanges||[]).find(m=>m.cycleId===cycleId&&m.subscriberId===sub.id);
      if(current<prev&&!special){errors.push(`الصف ${i+1}: قراءة ${sub.name} (${current}) أقل من السابقة (${prev}).`);continue;}
      const consumption=special?YWP.toNumber(special.consumption):current-prev;
      valid.push({sub,existing,prev,current,consumption,notes:idx.notes>=0?String(row[idx.notes]??'').trim():'',rowNo:i+1});
    }
    if(errors.length)throw new Error(`لم يتم استيراد أي قراءة لأن الملف يحتوي ${errors.length} خطأ. صحح الملف ثم أعد المحاولة.\n- ${errors.slice(0,12).join('\n- ')}`);
    if(!valid.length)throw new Error('لم توجد أي قراءة صالحة للاستيراد.');
    const preview=`سيتم استيراد ${valid.length} قراءة إلى ${YWP.arCycle(c.type)} بتاريخ ${c.cycleDate}.`+
      `\nالصفوف المرفوضة: ${errors.length}. التحذيرات: ${warnings.length}.`+
      `\n\nلن تُنشأ الفواتير تلقائياً. بعد التحقق اضغط «إنشاء/تحديث فواتير الدورة».`+
      (errors.length?`\n\nأول الأخطاء:\n- ${errors.slice(0,8).join('\n- ')}`:'')+
      (warnings.length?`\n\nأول التحذيرات:\n- ${warnings.slice(0,5).join('\n- ')}`:'');
    if(!confirm(preview+'\n\nهل تريد الحفظ الآن؟'))return {cancelled:true};
    YWP.rememberLocalBackup('before-readings-import');
    valid.forEach(item=>{
      const obj={id:item.existing?.id||YWP.uid('READ'),cycleId,subscriberId:item.sub.id,prev:item.prev,current:item.current,consumption:item.consumption,notes:item.notes,createdAt:item.existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),source:'excel-import'};
      if(item.existing)Object.assign(item.existing,obj);else YWP.state.readings.push(obj);
      syncInvoiceFromReading(item.existing||obj);
    });
    YWP.recomputeInvoiceStatuses();YWP.save();
    return {imported:valid.length,rejected:errors.length,warnings:warnings.length,errors,warnings};
  }
  async function importCycleReadings(ev,cycleId){
    const file=ev.target.files?.[0];if(!file)return;
    const resultBox=$('#readingImportResult');
    try{
      const rows=await spreadsheetRows(file);
      const result=importCycleReadingsFromRows(rows,cycleId);
      if(!result||result.cancelled)return;
      if(resultBox)resultBox.innerHTML=`<div class="notice success"><b>تم حفظ ${result.imported} قراءة.</b> مرفوض: ${result.rejected} | تحذيرات: ${result.warnings}. تم إنشاء نسخة حماية قبل الاستيراد.</div>`;
      renderCycleWork();renderInvoices();renderDashboard();
      alert(`تم حفظ ${result.imported} قراءة بنجاح.\nمرفوض: ${result.rejected}\nتحذيرات: ${result.warnings}`);
    }catch(e){
      console.error(e);
      if(resultBox)resultBox.innerHTML=`<div class="notice danger-box">${YWP.esc(e?.message||'تعذر استيراد القراءات.')}</div>`;
      alert(`تعذر استيراد القراءات.\n\n${e?.message||'ملف غير صالح'}`);
    }finally{ev.target.value='';}
  }
  function printCycleInvoices(cycleId){
    const invs = YWP.state.invoices.filter(i=>i.cycleId===cycleId);
    if(!invs.length){ alert('لا توجد فواتير لهذه الدورة'); return; }
    YWP.printWindow('فواتير A5', invs.map(YWP.invoiceHtml).join('<div style="page-break-after:always"></div>'), 'A5');
  }
  function printReadingSheet(){
    const type = $('#cycleType')?.value || 'HALF'; const date = $('#cycleDate')?.value || YWP.today();
    const targets = YWP.activeSubscribers(type);
    const rows = targets.map((s,i)=>{ const last = YWP.lastReading(s.id, date); return `<tr><td>${i+1}</td><td>${YWP.esc(s.code)}</td><td>${YWP.esc(s.name)}</td><td>${YWP.esc(s.area)}</td><td>${YWP.esc(s.meterNo)}</td><td>${YWP.num(last?.current||0)}</td><td></td><td></td><td></td></tr>`; }).join('');
    const html = `${YWP.orgHeaderHtml()}<h3>كشف جمع القراءات - ${YWP.arCycle(type)} - ${date}</h3><table><thead><tr><th>م</th><th>رقم</th><th>الاسم</th><th>الحي</th><th>رقم العداد</th><th>القراءة السابقة</th><th>القراءة الحالية</th><th>الاستهلاك</th><th>توقيع/ملاحظة</th></tr></thead><tbody>${rows}</tbody></table><div class="sig"><span>جامع القراءة</span><span>المراجع</span></div>`;
    YWP.printWindow('كشف جمع القراءات', html, 'A4');
  }
  function normalizedUiSearch(value){return String(value||'').trim().toLowerCase();}
  function filteredInvoices(){
    const query=normalizedUiSearch(invoiceFilters.query);
    return YWP.state.invoices.slice().filter(inv=>{
      const s=YWP.subscriber(inv.subscriberId)||{},status=YWP.invoiceDisplayStatus(inv),date=String(inv.date||'');
      if(invoiceFilters.from&&date<invoiceFilters.from)return false;
      if(invoiceFilters.to&&date>invoiceFilters.to)return false;
      if(invoiceFilters.status!=='all'&&status!==invoiceFilters.status)return false;
      if(query&&!normalizedUiSearch([inv.no,s.code,s.name,s.phone,s.area,s.address,s.meterNo].join(' ')).includes(query))return false;
      return true;
    }).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.no||'').localeCompare(String(a.no||'')));
  }
  function invoiceStatusCard(status){return status==='paid'?'paid':status==='partial'?'partial':'due';}
  function renderInvoiceResults(){
    const host=$('#invoiceResults');if(!host)return;
    const rows=filteredInvoices();
    const total=rows.reduce((sum,inv)=>sum+YWP.toNumber(inv.amount),0),paid=rows.reduce((sum,inv)=>sum+YWP.toNumber(inv.paidAmount),0),remaining=rows.reduce((sum,inv)=>sum+YWP.toNumber(inv.remainingAmount),0);
    const cards=rows.map(inv=>{
      const s=YWP.subscriber(inv.subscriberId)||{},overall=YWP.balance(inv.subscriberId),displayStatus=YWP.invoiceDisplayStatus(inv),statusClass=invoiceStatusCard(displayStatus);
      const balanceText=overall>0?YWP.money(overall)+' عليكم':overall<0?YWP.money(Math.abs(overall))+' رصيد مقدم':'صفر';
      return `<article class="invoice-ledger-card ${statusClass}">
        <header class="invoice-ledger-top"><div><small>رقم الفاتورة</small><h3>${YWP.esc(inv.no||'—')}</h3></div><div class="invoice-ledger-date"><small>تاريخ الإصدار</small><b>${YWP.esc(inv.date||'—')}</b></div>${YWP.arStatus(displayStatus)}</header>
        <section class="invoice-ledger-section"><h4>بيانات المشترك</h4><div class="invoice-info-grid"><div class="wide"><small>الاسم</small><b>${YWP.esc(s.name||'—')}</b></div><div><small>رقم المشترك</small><b>${YWP.esc(s.code||'—')}</b></div><div><small>رقم العداد</small><b>${YWP.esc(s.meterNo||'—')}</b></div><div><small>رقم الهاتف</small><b dir="ltr">${YWP.esc(s.phone||'—')}</b></div><div><small>العنوان / المنطقة</small><b>${YWP.esc(s.address||s.area||'—')}</b></div></div></section>
        <section class="invoice-ledger-section"><h4>معلومات الفاتورة والحساب</h4><div class="invoice-money-grid"><div><small>القراءة السابقة</small><b>${YWP.num(inv.prevReading??0)}</b></div><div><small>القراءة الحالية</small><b>${YWP.num(inv.currentReading??0)}</b></div><div><small>الاستهلاك</small><b>${YWP.num(inv.consumption)} م³</b></div><div><small>قيمة الفاتورة</small><b>${YWP.money(inv.amount)}</b></div><div class="paid"><small>المسدد</small><b>${YWP.money(inv.paidAmount||0)}</b></div><div class="remaining"><small>المتبقي من الفاتورة</small><b>${YWP.money(inv.remainingAmount||0)}</b></div><div class="account"><small>الرصيد الحالي للحساب</small><b>${balanceText}</b></div></div></section>
        <footer class="invoice-card-actions"><button class="mini light" onclick="App.goEditInvoiceReading('${inv.id}')">تعديل القراءة</button><button class="mini" onclick="App.printInvoice('${inv.id}')">طباعة A5 / PDF</button><button class="mini secondary" onclick="App.previewThermalInvoice('${encodeURIComponent(inv.id)}')">معاينة حراري</button><button class="mini warn" onclick="App.printThermalInvoice('${encodeURIComponent(inv.id)}')">طباعة حراري</button><button class="mini green" onclick="App.sendInvoiceWhatsApp('${inv.id}')">إرسال واتساب</button><button class="mini secondary" onclick="App.sendInvoiceSms('${inv.id}')">إرسال SMS</button><button class="mini warn" onclick="App.invoicePdfWhatsApp('${inv.id}')">PDF ثم واتساب</button><button class="mini light" onclick="App.copySms('${inv.id}')">نسخ النص</button></footer>
      </article>`;
    }).join('');
    host.innerHTML=`<div class="invoice-filter-summary"><div><small>النتائج</small><b>${rows.length}</b></div><div><small>إجمالي الفواتير</small><b>${YWP.money(total)}</b></div><div class="paid"><small>إجمالي المسدد</small><b>${YWP.money(paid)}</b></div><div class="remaining"><small>إجمالي المتبقي</small><b>${YWP.money(remaining)}</b></div></div><div class="invoice-card-list">${cards||'<div class="invoice-empty-state"><span>⌕</span><b>لا توجد فواتير مطابقة</b><small>غيّر التاريخ أو كلمة البحث أو حالة الفاتورة.</small></div>'}</div>`;
  }
  function updateInvoiceFilters(){
    invoiceFilters.from=$('#invoiceFilterFrom')?.value||'';invoiceFilters.to=$('#invoiceFilterTo')?.value||'';invoiceFilters.query=$('#invoiceFilterQuery')?.value||'';invoiceFilters.status=$('#invoiceFilterStatus')?.value||'all';
    renderInvoiceResults();
  }
  function clearInvoiceFilters(){Object.assign(invoiceFilters,{from:'',to:'',query:'',status:'all'});renderInvoices();}
  function renderInvoices(){
    YWP.recomputeInvoiceStatuses();
    $('#invoices').innerHTML=`<div class="card invoice-register-card"><div class="invoice-register-head"><div><small>السجل المالي والتواصل</small><h2>الفواتير والرسائل النصية</h2><p>ابحث بالاسم أو الهاتف أو العنوان، وحدد فترة الإصدار وحالة الفاتورة.</p></div><span>▤</span></div>
      <section class="invoice-filter-panel"><div class="field"><label>من تاريخ</label><input id="invoiceFilterFrom" type="date" value="${YWP.esc(invoiceFilters.from)}" onchange="App.updateInvoiceFilters()"></div><div class="field"><label>إلى تاريخ</label><input id="invoiceFilterTo" type="date" value="${YWP.esc(invoiceFilters.to)}" onchange="App.updateInvoiceFilters()"></div><div class="field invoice-filter-search"><label>بحث بالاسم أو الهاتف أو العنوان</label><input id="invoiceFilterQuery" value="${YWP.esc(invoiceFilters.query)}" placeholder="اسم المشترك، رقم الهاتف، العنوان، الرقم أو العداد" oninput="App.updateInvoiceFilters()"></div><div class="field"><label>حالة الفاتورة</label><select id="invoiceFilterStatus" onchange="App.updateInvoiceFilters()"><option value="all" ${invoiceFilters.status==='all'?'selected':''}>كل الحالات</option><option value="due" ${invoiceFilters.status==='due'?'selected':''}>غير مسددة</option><option value="partial" ${invoiceFilters.status==='partial'?'selected':''}>مسددة جزئيًا</option><option value="paid" ${invoiceFilters.status==='paid'?'selected':''}>مسددة</option></select></div><button class="light invoice-filter-reset" onclick="App.clearInvoiceFilters()">مسح الفلاتر</button></section>
      <div class="toolbar invoice-register-toolbar"><button onclick="App.exportInvoices()" class="secondary">تصدير النتائج Excel</button><button onclick="App.printUnpaidInvoices()" class="warn">طباعة غير المسدد من النتائج A5</button></div><div id="invoiceResults"></div></div>`;
    renderInvoiceResults();
  }
  function printInvoice(id){ const inv=YWP.invoice(id); if(inv) YWP.printWindow(inv.no, YWP.invoiceHtml(inv), 'A5'); }
  function goEditInvoiceReading(id){
    const inv = YWP.invoice(id); if(!inv) return;
    switchTab('readings');
    setTimeout(()=>{
      const sel = $('#selectedCycle');
      if(sel){ sel.value = inv.cycleId; renderCycleWork(); }
      const row = document.querySelector(`#readingTable tbody tr[data-sub="${inv.subscriberId}"]`);
      if(row){
        row.scrollIntoView({behavior:'smooth', block:'center'});
        row.classList.add('focus-edit-row');
        const cur = row.querySelector('.current'); if(cur){ cur.focus(); cur.select(); }
        setTimeout(()=>row.classList.remove('focus-edit-row'), 5000);
      }
    }, 80);
  }
  function sendInvoiceWhatsApp(id){ const inv=YWP.invoice(id); if(!inv)return; const s=YWP.subscriber(inv.subscriberId)||{}; YWP.openWhatsApp(s.phone, YWP.smsText(inv,'whatsapp')); inv.sentWhatsApp=true; YWP.save(); }
  function sendInvoiceSms(id){ const inv=YWP.invoice(id); if(!inv)return; const s=YWP.subscriber(inv.subscriberId)||{}; YWP.openSms(s.phone, YWP.smsText(inv,'sms')); inv.sentSms=true; YWP.save(); }
  function invoicePdfWhatsApp(id){ const inv=YWP.invoice(id); if(!inv)return; const s=YWP.subscriber(inv.subscriberId)||{}; alert(YWP.pdfWhatsAppNotice('الفاتورة')); YWP.printWindow(inv.no, YWP.invoiceHtml(inv), 'A5'); if(s.phone) setTimeout(()=>YWP.openWhatsApp(s.phone, YWP.smsText(inv,'whatsapp')), 700); }
  function printUnpaidInvoices(){ const invs=filteredInvoices().filter(i=>YWP.invoiceDisplayStatus(i)!=='paid'); if(!invs.length){alert('لا توجد فواتير غير مسددة أو جزئية ضمن نتائج الفلترة');return;} YWP.printWindow('الفواتير غير المسددة والجزئية', invs.map(YWP.invoiceHtml).join('<div style="page-break-after:always"></div>'), 'A5'); }
  function copySms(id){ const inv=YWP.invoice(id); if(!inv)return; navigator.clipboard?.writeText(YWP.smsText(inv)); alert(YWP.smsText(inv)); }
  function exportInvoices(){
    YWP.recomputeInvoiceStatuses();
    const rows = filteredInvoices().map(i=>{const s=YWP.subscriber(i.subscriberId)||{};return [i.no,i.date,s.code,s.name,s.phone,s.address||s.area||'',i.prevReading||0,i.currentReading||0,i.consumption,i.tariff,i.amount,i.prevBalance,i.paidAmount||0,i.remainingAmount||0,YWP.balance(i.subscriberId),YWP.invoiceStatusText(i),YWP.smsText(i)];});
    YWP.exportCSV('invoices-filtered.csv', [['رقم الفاتورة','التاريخ','رقم المشترك','الاسم','الهاتف','العنوان','القراءة السابقة','القراءة الحالية','الاستهلاك','التعرفة','مبلغ الدورة','الرصيد السابق','المسدد','المتبقي من الفاتورة','الرصيد الحالي','الحالة','نص الرسالة']].concat(rows));
  }
  function filteredPayments(){
    const query=normalizedUiSearch(paymentFilters.query);
    return YWP.state.payments.slice().filter(p=>{const s=YWP.subscriber(p.subscriberId)||{},date=String(p.date||'');if(paymentFilters.from&&date<paymentFilters.from)return false;if(paymentFilters.to&&date>paymentFilters.to)return false;return !query||normalizedUiSearch([p.receiptNo,p.method,p.collector,p.note,s.code,s.name,s.phone,s.area,s.address].join(' ')).includes(query);}).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  }
  function refreshPaymentAccount(){
    const host=$('#paymentAccountPreview'),sub=YWP.subscriber($('#paySub')?.value);if(!host)return;if(!sub){host.innerHTML='<div class="payment-account-empty">ابحث عن المشترك واختره لعرض حسابه.</div>';return;}
    const balance=YWP.balance(sub.id),unpaid=YWP.state.invoices.filter(i=>i.subscriberId===sub.id&&YWP.invoiceDisplayStatus(i)!=='paid'),balanceText=balance>0?YWP.money(balance)+' عليكم':balance<0?YWP.money(Math.abs(balance))+' رصيد مقدم':'صفر';
    host.innerHTML=`<div class="payment-account-name"><span>حساب المشترك</span><h3>${YWP.esc(sub.name||'—')}</h3><small>${YWP.esc(sub.code||'—')} · العداد ${YWP.esc(sub.meterNo||'—')}</small></div><div class="payment-account-grid"><div><small>الهاتف</small><b dir="ltr">${YWP.esc(sub.phone||'—')}</b></div><div><small>العنوان</small><b>${YWP.esc(sub.address||sub.area||'—')}</b></div><div><small>فواتير مفتوحة</small><b>${unpaid.length}</b></div><div class="balance ${balance>0?'due':balance<0?'credit':'zero'}"><small>الرصيد الحالي</small><b>${balanceText}</b></div></div>${balance>0?`<button class="light" onclick="App.useOutstandingBalance()">استخدام كامل الرصيد المستحق</button>`:''}`;
  }
  function useOutstandingBalance(){const sub=YWP.subscriber($('#paySub')?.value),input=$('#payAmount');if(sub&&input)input.value=String(Math.max(0,YWP.balance(sub.id)));}
  function filterPaymentSubscribers(){
    const select=$('#paySub');if(!select)return;const current=select.value,query=normalizedUiSearch($('#paySubscriberSearch')?.value),subs=YWP.state.subscribers.filter(s=>!query||normalizedUiSearch([s.code,s.name,s.phone,s.area,s.address,s.meterNo].join(' ')).includes(query));
    select.innerHTML=subs.map(s=>`<option value="${YWP.esc(s.id)}">${YWP.esc(s.code)} — ${YWP.esc(s.name)}</option>`).join('');if(subs.some(s=>s.id===current))select.value=current;refreshPaymentAccount();
  }
  function renderPaymentResults(){
    const host=$('#paymentResults');if(!host)return;const rows=filteredPayments(),total=rows.reduce((sum,p)=>sum+YWP.toNumber(p.amount),0);
    const cards=rows.map(p=>{const s=YWP.subscriber(p.subscriberId)||{};return `<article class="payment-ledger-card"><header><div><small>سند قبض</small><h3>${YWP.esc(p.receiptNo||'—')}</h3></div><div><small>التاريخ</small><b>${YWP.esc(p.date||'—')}</b></div><span>${YWP.esc(p.method||'—')}</span></header><div class="payment-ledger-info"><div class="wide"><small>المشترك</small><b>${YWP.esc(s.code||'—')} — ${YWP.esc(s.name||'—')}</b></div><div><small>الهاتف</small><b dir="ltr">${YWP.esc(s.phone||'—')}</b></div><div><small>العنوان</small><b>${YWP.esc(s.address||s.area||'—')}</b></div><div class="amount"><small>المبلغ المقبوض</small><b>${YWP.money(p.amount)}</b></div><div><small>المحصل</small><b>${YWP.esc(p.collector||'—')}</b></div><div class="wide"><small>الملاحظة</small><b>${YWP.esc(p.note||'لا توجد')}</b></div></div><footer><button class="mini" onclick="App.printReceipt('${p.id}')">طباعة A5 / PDF</button><button class="mini secondary" onclick="App.previewThermalReceipt('${encodeURIComponent(p.id)}')">معاينة حراري</button><button class="mini warn" onclick="App.printThermalReceipt('${encodeURIComponent(p.id)}')">طباعة حراري</button><button class="mini green" onclick="App.sendReceiptWhatsApp('${p.id}')">واتساب</button><button class="mini secondary" onclick="App.sendReceiptSms('${p.id}')">SMS</button><button class="mini warn" onclick="App.receiptPdfWhatsApp('${p.id}')">PDF ثم واتساب</button><button class="mini red" onclick="App.deletePayment('${p.id}')">حذف</button></footer></article>`;}).join('');
    host.innerHTML=`<div class="payment-result-summary"><span>عدد السندات <b>${rows.length}</b></span><span>إجمالي النتائج <b>${YWP.money(total)}</b></span></div><div class="payment-card-list">${cards||'<div class="invoice-empty-state"><span>⌕</span><b>لا توجد سندات مطابقة</b><small>غيّر فترة البحث أو بيانات المشترك.</small></div>'}</div>`;
  }
  function updatePaymentFilters(){paymentFilters.from=$('#paymentFilterFrom')?.value||'';paymentFilters.to=$('#paymentFilterTo')?.value||'';paymentFilters.query=$('#paymentFilterQuery')?.value||'';renderPaymentResults();}
  function clearPaymentFilters(){Object.assign(paymentFilters,{from:'',to:'',query:''});renderPayments();}
  function renderPayments(){
    const options=YWP.state.subscribers.map(s=>`<option value="${YWP.esc(s.id)}">${YWP.esc(s.code)} — ${YWP.esc(s.name)}</option>`).join('');
    $('#payments').innerHTML=`<section class="payment-entry-hero"><div><small>التحصيل النقدي</small><h1>تسجيل تحصيل / سند قبض</h1><p>تحقق من بيانات المشترك ورصيده، ثم احفظ السند واطبعه على A5.</p></div><span>▣</span></section><div class="payment-entry-grid"><article class="card payment-form-card"><div class="payment-step-title"><b>1</b><div><h2>بيانات السند</h2><small>اختيار الحساب وإدخال تفاصيل الدفعة</small></div></div><div class="field"><label>بحث عن المشترك</label><input id="paySubscriberSearch" placeholder="الاسم، الرقم، الهاتف، العنوان أو العداد" oninput="App.filterPaymentSubscribers()"></div><div class="form-row"><div class="field"><label>المشترك</label><select id="paySub" onchange="App.refreshPaymentAccount()">${options}</select></div>${field('التاريخ','payDate',YWP.today(),'date')}${field('المبلغ المدفوع','payAmount','','number')}<div class="field"><label>طريقة الدفع</label><select id="payMethod"><option>نقداً</option><option>تحويل</option><option>محفظة</option><option>أخرى</option></select></div>${field('اسم المحصل','payCollector','')}${field('ملاحظة','payNote','')}</div><div class="notice success">أي مبلغ زائد عن المستحق يُحفظ تلقائيًا كرصيد مقدم لصالح المشترك.</div><div class="payment-save-actions"><button class="green" onclick="App.savePayment()">حفظ وطباعة سند A5 / PDF</button><button class="light" onclick="App.printCollectionBackup()">كشف تحصيل احتياطي A4</button></div></article><aside class="card payment-account-card"><div class="payment-step-title"><b>2</b><div><h2>مراجعة الحساب</h2><small>البيانات والرصيد قبل الحفظ</small></div></div><div id="paymentAccountPreview"></div></aside></div><article class="card payment-register-card"><div class="payment-register-head"><div><small>الأرشيف المالي</small><h2>سندات القبض والتحصيلات</h2></div><button class="secondary" onclick="App.exportPayments()">تصدير النتائج CSV</button></div><section class="payment-filter-panel"><div class="field"><label>من تاريخ</label><input id="paymentFilterFrom" type="date" value="${YWP.esc(paymentFilters.from)}" onchange="App.updatePaymentFilters()"></div><div class="field"><label>إلى تاريخ</label><input id="paymentFilterTo" type="date" value="${YWP.esc(paymentFilters.to)}" onchange="App.updatePaymentFilters()"></div><div class="field payment-filter-search"><label>بحث في السندات</label><input id="paymentFilterQuery" value="${YWP.esc(paymentFilters.query)}" placeholder="الاسم، الهاتف، العنوان، رقم السند أو المحصل" oninput="App.updatePaymentFilters()"></div><button class="light" onclick="App.clearPaymentFilters()">مسح الفلاتر</button></section><div id="paymentResults"></div></article>`;
    refreshPaymentAccount();renderPaymentResults();
  }
  function savePayment(){
    const subId=$('#paySub').value; const amount=YWP.toNumber($('#payAmount').value);
    if(!subId || amount<=0){ alert('حدد المشترك والمبلغ'); return; }
    const p={id:YWP.uid('PAY'), receiptNo:`RCPT-${YWP.today().replace(/-/g,'')}-${String(YWP.state.payments.length+1).padStart(4,'0')}`, subscriberId:subId, invoiceId:null, date:$('#payDate').value||YWP.today(), amount, method:$('#payMethod').value, collector:$('#payCollector').value, note:$('#payNote').value, createdAt:new Date().toISOString()};
    YWP.state.payments.push(p); YWP.recomputeInvoiceStatuses(); renderPayments(); renderDashboard(); YWP.printWindow(p.receiptNo, YWP.receiptHtml(p,'paper'), 'A5');
  }
  function printReceipt(id){ const p=YWP.state.payments.find(p=>p.id===id); if(p) YWP.printWindow(p.receiptNo, YWP.receiptHtml(p,'paper'), 'A5'); }
  function sendReceiptWhatsApp(id){ const p=YWP.state.payments.find(p=>p.id===id); if(!p)return; const s=YWP.subscriber(p.subscriberId)||{}; YWP.openWhatsApp(s.phone, YWP.receiptMessage(p,'whatsapp')); }
  function sendReceiptSms(id){ const p=YWP.state.payments.find(p=>p.id===id); if(!p)return; const s=YWP.subscriber(p.subscriberId)||{}; YWP.openSms(s.phone, YWP.receiptMessage(p,'sms')); }
  function receiptPdfWhatsApp(id){ const p=YWP.state.payments.find(p=>p.id===id); if(!p)return; const s=YWP.subscriber(p.subscriberId)||{}; alert(YWP.pdfWhatsAppNotice('سند القبض')); YWP.printWindow(p.receiptNo, YWP.receiptHtml(p,'paper'), 'A5'); if(s.phone) setTimeout(()=>YWP.openWhatsApp(s.phone, YWP.receiptMessage(p,'whatsapp')), 700); }
  function deletePayment(id){ if(!confirm('حذف سند القبض؟'))return; YWP.state.payments=YWP.state.payments.filter(p=>p.id!==id); YWP.recomputeInvoiceStatuses(); renderPayments(); renderDashboard(); }
  function exportPayments(){ const rows=filteredPayments().map(p=>{const s=YWP.subscriber(p.subscriberId)||{}; return [p.receiptNo,p.date,s.code,s.name,s.phone,s.address||s.area||'',p.amount,p.method,p.collector,p.note];}); YWP.exportCSV('payments-filtered.csv', [['رقم السند','التاريخ','رقم المشترك','الاسم','الهاتف','العنوان','المبلغ','طريقة الدفع','المحصل','ملاحظات']].concat(rows)); }
  function printCollectionBackup(){
    const rows=YWP.state.subscribers.map((s,i)=>{const b=YWP.balance(s.id); return `<tr><td>${i+1}</td><td>${YWP.esc(s.code)}</td><td>${YWP.esc(s.name)}</td><td>${YWP.esc(s.area)}</td><td>${YWP.esc(s.phone)}</td><td>${b>0?YWP.money(b):b<0?'مقدم '+YWP.money(Math.abs(b)):'صفر'}</td><td></td><td></td></tr>`;}).join('');
    YWP.printWindow('كشف تحصيل احتياطي', `${YWP.orgHeaderHtml()}<h3>كشف تحصيل احتياطي</h3><table><thead><tr><th>م</th><th>رقم</th><th>الاسم</th><th>الحي</th><th>الهاتف</th><th>الرصيد</th><th>المبلغ المحصل</th><th>التوقيع</th></tr></thead><tbody>${rows}</tbody></table><div class="sig"><span>المحصل</span><span>المحاسب</span></div>`, 'A4');
  }
  function renderExpenses(){
    const rows=YWP.state.expenses.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(e=>`<tr><td>${e.date}</td><td>${YWP.esc(e.category)}</td><td>${YWP.esc(e.description)}</td><td class="money positive">${YWP.money(e.amount)}</td><td>${YWP.esc(e.payee)}</td><td>${YWP.esc(e.refNo)}</td><td>${e.paymentAccount==='bank'?'البنك':e.paymentAccount==='payable'?'آجل / مورد':'الصندوق'}</td><td>${YWP.esc(e.costCenter||'')}</td><td class="actions"><button class="mini red" onclick="App.deleteExpense('${e.id}')">حذف</button></td></tr>`).join('');
    $('#expenses').innerHTML = `<div class="card"><h2>إدخال المصروفات</h2><div class="form-row">${field('التاريخ','expDate',YWP.today(),'date')}<div class="field"><label>نوع المصروف</label><select id="expCat"><option>ديزل / وقود</option><option>كهرباء</option><option>صيانة مضخات</option><option>صيانة شبكة</option><option>رواتب</option><option>مواسير وقطع غيار</option><option>مواصلات</option><option>مصروفات إدارية</option><option>أخرى</option></select></div>${field('البيان','expDesc','')}${field('المبلغ','expAmount','','number')}${field('المستلم/المورد','expPayee','')}${field('رقم السند/المرجع','expRef','')}<div class="field"><label>حساب الدفع</label><select id="expPaymentAccount"><option value="cash">الصندوق / نقداً</option><option value="bank">الحساب البنكي</option><option value="payable">آجل / ذمم موردين</option></select></div>${field('مركز التكلفة','expCostCenter','')}</div><div class="notice success">يُنشئ الحفظ قيداً محاسبياً متوازناً تلقائياً حسب نوع المصروف وحساب الدفع.</div><div class="toolbar"><button class="green" onclick="App.saveExpense()">حفظ المصروف</button><button class="secondary" onclick="App.exportExpenses()">تصدير CSV</button></div><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>المبلغ</th><th>المستلم</th><th>المرجع</th><th>حساب الدفع</th><th>مركز التكلفة</th><th>إجراء</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }
  function saveExpense(){ const amount=YWP.toNumber($('#expAmount').value); if(amount<=0){alert('أدخل مبلغ المصروف');return;} YWP.state.expenses.push({id:YWP.uid('EXP'),date:$('#expDate').value||YWP.today(),category:$('#expCat').value,description:$('#expDesc').value,amount,payee:$('#expPayee').value,refNo:$('#expRef').value,paymentAccount:$('#expPaymentAccount')?.value||'cash',costCenter:$('#expCostCenter')?.value||'',createdAt:new Date().toISOString()}); YWP.save(); renderExpenses(); renderDashboard(); }
  function deleteExpense(id){ if(!confirm('حذف المصروف؟'))return; YWP.state.expenses=YWP.state.expenses.filter(e=>e.id!==id); YWP.save(); renderExpenses(); renderDashboard(); }
  function exportExpenses(){ YWP.exportCSV('expenses.csv', [['التاريخ','النوع','البيان','المبلغ','المستلم','المرجع','حساب الدفع','مركز التكلفة']].concat(YWP.state.expenses.map(e=>[e.date,e.category,e.description,e.amount,e.payee,e.refNo,e.paymentAccount||'cash',e.costCenter||'']))); }
  function renderReports(){
    const months = Array.from(new Set([...YWP.state.cycles.map(c=>YWP.monthKey(c.cycleDate)), ...YWP.state.invoices.map(i=>YWP.monthKey(i.date)), ...YWP.state.payments.map(p=>YWP.monthKey(p.date)), ...YWP.state.expenses.map(e=>YWP.monthKey(e.date)), YWP.monthKey(YWP.today())])).sort().reverse();
    const opts=months.map(m=>`<option value="${m}">${m}</option>`).join('');
    const subOpts=YWP.state.subscribers.map(s=>`<option value="${s.id}">${YWP.esc(s.code)} - ${YWP.esc(s.name)}</option>`).join('');
    const logo=YWP.state.settings.projectLogo||'assets/qatra-pro-mark.svg';
    $('#reports').innerHTML = `<div class="card report-center-card"><section class="report-center-hero"><div class="report-center-brand"><img src="${YWP.esc(logo)}" alt="شعار المشروع المختار من الإعدادات"><div><small>مركز التقارير الاحترافي</small><h1>${YWP.esc(YWP.state.settings.reportsHeaderTitle||YWP.state.settings.projectName||'قطرة برو')}</h1><p>تقارير تشغيلية ومالية موحدة، جاهزة للمعاينة والطباعة والتصدير.</p></div></div><div class="report-center-badge"><span>▤</span><b>A4 / PDF / Excel</b></div></section><div class="report-filter-panel"><div class="field"><label>الفترة المالية</label><select id="reportMonth">${opts}</select></div><div class="field"><label>مشترك لكشف الحساب</label><select id="statementSub">${subOpts}</select></div></div><div class="report-category"><header><span>💧</span><div><b>تقارير التشغيل والقراءات</b><small>الاستهلاك، الفاقد، والفواتير</small></div></header><div class="report-button-grid"><button onclick="App.lossReport()">تقرير القراءة والفاقد</button><button onclick="App.matchingReport()" class="light">التقرير الشهري الشامل</button><button onclick="App.invoiceRegisterReport?.()" class="secondary">كشف الفواتير</button></div></div><div class="report-category"><header><span>◈</span><div><b>التقارير المالية</b><small>التحصيل والإيرادات والمصروفات</small></div></header><div class="report-button-grid"><button onclick="App.collectionReport()" class="green">تقرير التحصيل</button><button onclick="App.revenueReport()" class="secondary">كشف الإيرادات المحصلة</button><button onclick="App.expenseReport()" class="warn">كشف المصروفات</button></div></div><div class="report-category"><header><span>👥</span><div><b>تقارير المشتركين</b><small>الحسابات والأرصدة المستحقة والمقدمة</small></div></header><div class="report-button-grid"><button onclick="App.statementReport()" class="secondary">كشف حساب مشترك</button><button onclick="App.balancesReport()" class="warn">كشف أرصدة المشتركين</button></div></div><div class="report-print-note"><span class="report-print-note-icon" aria-hidden="true">✓</span><span><b>هوية موحدة في جميع المطبوعات</b><small>يظهر شعار المشروع المختار مرة واحدة، وتثبت علامة Qatra Pro داخل تذييل الورقة.</small></span></div><div id="reportOutput"></div></div>`;
  }
  function reportMonth(){ return $('#reportMonth').value || YWP.monthKey(YWP.today()); }
  function showReport(title, html, csvRows=null, filename='report.csv'){
    $('#reportOutput').innerHTML = `<div class="card"><h2>${title}</h2><div class="toolbar"><button onclick="App.printCurrentReport('${YWP.esc(title)}')">طباعة / PDF</button>${csvRows?`<button onclick='App.downloadCurrentCSV(${JSON.stringify(filename)})' class="secondary">تصدير Excel/CSV</button>`:''}</div><div id="currentReportHtml">${YWP.orgHeaderHtml(false,'report')}${html}${YWP.state.settings.reportsFooter?`<p class="footer">${YWP.esc(YWP.state.settings.reportsFooter)}</p>`:''}</div></div>`;
    $('#reportOutput').closest('.report-center-card')?.classList.add('report-preview-open');
    App._currentCsv = csvRows;
  }
  function printCurrentReport(title){ YWP.printWindow(title, $('#currentReportHtml').innerHTML, 'A4'); }
  function downloadCurrentCSV(filename){ if(App._currentCsv) YWP.exportCSV(filename, App._currentCsv); }
  function lossReport(){
    const m=reportMonth();
    const monthlyCycles=YWP.state.cycles.filter(c=>c.type==='MONTHLY' && YWP.monthKey(c.cycleDate)===m);
    let rows=[], htmlRows='';
    monthlyCycles.forEach(c=>{
      const mainCons=Math.max(0,YWP.toNumber(c.mainCurrent)-YWP.toNumber(c.mainPrev));
      const homes=YWP.consumptionInMonth(m);
      const loss=mainCons-homes; const pct=mainCons>0?(loss/mainCons*100):0;
      rows.push([c.cycleDate,c.mainPrev,c.mainCurrent,mainCons,homes,loss,pct.toFixed(2)+'%']);
      htmlRows += `<tr><td>${c.cycleDate}</td><td>${YWP.num(c.mainPrev)}</td><td>${YWP.num(c.mainCurrent)}</td><td>${YWP.num(mainCons)}</td><td>${YWP.num(homes)}</td><td>${YWP.num(loss)}</td><td>${pct.toFixed(2)}%</td></tr>`;
    });
    if(!monthlyCycles.length) htmlRows='<tr><td colspan="7">لا توجد دورة نهاية شهر لهذا الشهر</td></tr>';
    showReport('تقرير القراءة والفاقد', `<h3>تقرير القراءة والفاقد لشهر ${m}</h3><table><thead><tr><th>تاريخ دورة النهاية</th><th>رئيسي سابق</th><th>رئيسي حالي</th><th>استهلاك العداد الرئيسي</th><th>إجمالي استهلاك المنازل في الشهر</th><th>الفاقد</th><th>نسبة الفاقد</th></tr></thead><tbody>${htmlRows}</tbody></table><p><b>المعادلة:</b> الفاقد = فرق قراءة العداد الرئيسي - مجموع استهلاك المنازل في نفس الشهر، بما في ذلك دورة يوم 14 ودورة يوم 28.</p>`, [['التاريخ','رئيسي سابق','رئيسي حالي','استهلاك الرئيسي','استهلاك المنازل','الفاقد','النسبة']].concat(rows), 'loss-report.csv');
  }
  function collectionReport(){ const m=reportMonth(); const rows=YWP.paymentsInMonth(m).map(p=>{const s=YWP.subscriber(p.subscriberId)||{};return [p.date,p.receiptNo,s.code,s.name,p.amount,p.method,p.collector,p.note];}); const total=rows.reduce((a,r)=>a+YWP.toNumber(r[4]),0); const html=`<h3>تقرير التحصيل لشهر ${m}</h3><table><thead><tr><th>التاريخ</th><th>السند</th><th>رقم</th><th>الاسم</th><th>المبلغ</th><th>الطريقة</th><th>المحصل</th><th>ملاحظة</th></tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${YWP.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><th colspan="4">الإجمالي</th><th>${YWP.money(total)}</th><th colspan="3"></th></tr></tfoot></table>`; showReport('تقرير التحصيل', html, [['التاريخ','السند','رقم المشترك','الاسم','المبلغ','الطريقة','المحصل','ملاحظة']].concat(rows), 'collection-report.csv'); }
  function revenueReport(){ const m=reportMonth(); const rows=YWP.invoicesInMonth(m).map(i=>{const s=YWP.subscriber(i.subscriberId)||{};return [i.date,i.no,s.code,s.name,i.prevReading||0,i.currentReading||0,i.consumption,i.tariff,i.amount,i.paidAmount||0,i.remainingAmount||0,YWP.balance(i.subscriberId),i.status];}); const total=rows.reduce((a,r)=>a+YWP.toNumber(r[8]),0); const html=`<h3>كشف الإيرادات/الفواتير لشهر ${m}</h3><table><thead><tr><th>التاريخ</th><th>الفاتورة</th><th>رقم</th><th>الاسم</th><th>سابقة</th><th>حالية</th><th>الاستهلاك</th><th>التعرفة</th><th>الإيراد</th><th>المسدد</th><th>المتبقي</th><th>الرصيد الحالي</th><th>الحالة</th></tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${YWP.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><th colspan="8">إجمالي إيراد الفواتير</th><th>${YWP.money(total)}</th><th colspan="4"></th></tr></tfoot></table>`; showReport('كشف الإيرادات', html, [['التاريخ','الفاتورة','رقم','الاسم','قراءة سابقة','قراءة حالية','الاستهلاك','التعرفة','الإيراد','المسدد','المتبقي','الرصيد الحالي','الحالة']].concat(rows), 'revenue-report.csv'); }
  function expenseReport(){ const m=reportMonth(); const rows=YWP.expensesInMonth(m).map(e=>[e.date,e.category,e.description,e.amount,e.payee,e.refNo]); const total=rows.reduce((a,r)=>a+YWP.toNumber(r[3]),0); const html=`<h3>كشف المصروفات لشهر ${m}</h3><table><thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>المبلغ</th><th>المستلم</th><th>المرجع</th></tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${YWP.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><th colspan="3">الإجمالي</th><th>${YWP.money(total)}</th><th colspan="2"></th></tr></tfoot></table>`; showReport('كشف المصروفات', html, [['التاريخ','النوع','البيان','المبلغ','المستلم','المرجع']].concat(rows), 'expenses-report.csv'); }
  function matchingReport(){ const m=reportMonth(); const collections=YWP.paymentsInMonth(m).reduce((a,p)=>a+YWP.toNumber(p.amount),0); const inv=YWP.invoicesInMonth(m).reduce((a,i)=>a+YWP.toNumber(i.amount),0); const exp=YWP.expensesInMonth(m).reduce((a,e)=>a+YWP.toNumber(e.amount),0); const net=collections-exp; const html=`<h3>مطابقة الإيرادات والمصروفات لشهر ${m}</h3><table><tr><th>البند</th><th>المبلغ</th></tr><tr><td>إجمالي إيرادات الفواتير المستحقة</td><td>${YWP.money(inv)}</td></tr><tr><td>إجمالي التحصيل النقدي الفعلي</td><td>${YWP.money(collections)}</td></tr><tr><td>إجمالي المصروفات</td><td>${YWP.money(exp)}</td></tr><tr><td><b>صافي النقدية = التحصيل - المصروفات</b></td><td><b>${YWP.money(net)}</b></td></tr><tr><td>فرق المستحق عن المحصل</td><td>${YWP.money(inv-collections)}</td></tr></table>`; showReport('مطابقة الإيرادات والمصروفات', html, [['البند','المبلغ'],['إيرادات الفواتير',inv],['التحصيل الفعلي',collections],['المصروفات',exp],['صافي النقدية',net],['فرق المستحق عن المحصل',inv-collections]], 'matching-report.csv'); }
  function statementReport(){
    const subId=$('#statementSub').value; const s=YWP.subscriber(subId); if(!s)return;
    let bal=YWP.openingNet(s); const ledger=[{date:'افتتاحي',type:`رصيد افتتاحي | قراءة افتتاحية ${YWP.num(s.openingReading||0)}`,ref:'',debit:YWP.openingArrears(s),credit:YWP.openingCredit(s),balance:bal}];
    const entries=[]; YWP.state.invoices.filter(i=>i.subscriberId===subId).forEach(i=>entries.push({date:i.date,type:'فاتورة',ref:i.no,debit:i.amount,credit:0})); YWP.state.payments.filter(p=>p.subscriberId===subId).forEach(p=>entries.push({date:p.date,type:'سند قبض',ref:p.receiptNo,debit:0,credit:p.amount})); entries.sort((a,b)=>a.date.localeCompare(b.date)).forEach(e=>{bal += YWP.toNumber(e.debit)-YWP.toNumber(e.credit); ledger.push({...e,balance:bal});});
    const rows=ledger.map(e=>[e.date,e.type,e.ref,e.debit,e.credit,e.balance]);
    const html=`<h3>كشف حساب مشترك</h3><p><b>${YWP.esc(s.code)} - ${YWP.esc(s.name)}</b> | ${YWP.esc(s.area)} | ${YWP.esc(s.phone)}</p><table><thead><tr><th>التاريخ</th><th>البيان</th><th>المرجع</th><th>مدين/فاتورة</th><th>دائن/سداد</th><th>الرصيد</th></tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${YWP.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table><p><b>الرصيد النهائي:</b> ${bal>0?YWP.money(bal)+' عليكم':bal<0?YWP.money(Math.abs(bal))+' لكم':'صفر'}</p>`;
    showReport('كشف حساب مشترك', html, [['التاريخ','البيان','المرجع','مدين','دائن','الرصيد']].concat(rows), `statement-${s.code}.csv`);
  }
  function balancesReport(){
    const rows = YWP.state.subscribers.map(s=>{
      const last=YWP.lastReading(s.id);
      const b=YWP.balance(s.id);
      const invs=YWP.state.invoices.filter(i=>i.subscriberId===s.id);
      const payments=YWP.state.payments.filter(p=>p.subscriberId===s.id).reduce((a,p)=>a+YWP.toNumber(p.amount),0);
      return [s.code,s.name,s.phone,s.area,s.meterNo,s.openingReading||0,last?.current||0,YWP.openingArrears(s),YWP.openingCredit(s),invs.reduce((a,i)=>a+YWP.toNumber(i.amount),0),payments,b>0?b:0,b<0?Math.abs(b):0];
    });
    const html=`<h3>كشف أرصدة المشتركين</h3><table><thead><tr><th>رقم</th><th>الاسم</th><th>الهاتف</th><th>الحي</th><th>العداد</th><th>قراءة افتتاحية</th><th>آخر قراءة</th><th>متأخرات سابقة</th><th>رصيد مقدم سابق</th><th>إجمالي الفواتير</th><th>إجمالي المدفوعات</th><th>الرصيد المتبقي عليكم</th><th>رصيد مقدم حالي</th></tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${YWP.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    showReport('كشف أرصدة المشتركين', html, [['رقم','الاسم','الهاتف','الحي','رقم العداد','قراءة افتتاحية','آخر قراءة','متأخرات سابقة','رصيد مقدم سابق','إجمالي الفواتير','إجمالي المدفوعات','الرصيد المتبقي عليكم','رصيد مقدم حالي']].concat(rows), 'subscriber-balances.csv');
  }
  function exportBackup(){
    YWP.exportBackupFile('manual');
    renderAll();
  }
  async function importBackup(ev, preInspected){
    const file=ev.target.files[0]; if(!file)return;
    try{
      if(file.name.toLowerCase().endsWith('.json')){
        if(YWP.state.meta?.productionStartedAt) throw new Error('تم بدء التشغيل الفعلي؛ ترحيل JSON غير المشفر معطل نهائيًا. استخدم نسخة مشفرة فقط.');
        const data=JSON.parse(await file.text());
        if(!data.subscribers && !data.readings && !data.payments) throw new Error('ملف JSON القديم غير صالح');
        if(confirm('سيتم ترحيل ملف JSON القديم إلى SQLite بعد حفظ نسخة حماية من البيانات الحالية. متابعة؟')){
          YWP.rememberLocalBackup('before-legacy-json-migration');
          YWP.setState(data);
          YWP.rememberLocalBackup('after-legacy-json-migration');
          renderAll();
          alert('تم ترحيل بيانات JSON إلى SQLite بنجاح.');
        }
      } else {
        const inspected = preInspected || await QatraBackup.inspectFile(file);
        if(inspected.duplicate){ alert(inspected.message || 'تم استيراد هذا الملف سابقًا.'); return; }
        if(inspected.operationType !== 'FULL_BACKUP') throw new Error('الملف ليس نسخة احتياطية كاملة للإدارة');
        const data = QatraBackup.state(inspected, 'admin');
        if(!data?.subscribers || !Array.isArray(data.subscribers)) throw new Error('محتوى النسخة الاحتياطية غير صالح');
        if(confirm('النسخة مشفرة وصحيحة. سيتم استبدال بيانات الإدارة الحالية. متابعة؟')){
          YWP.rememberLocalBackup('before-encrypted-import');
          const startedAt=YWP.state.meta?.productionStartedAt;
          const restored={...data,meta:{...(data.meta||{}),productionStartedAt:data.meta?.productionStartedAt||startedAt||null}};
          QatraBackup.commit('admin', inspected, restored);
          if(QatraBackup.isPortable(inspected)){
            alert('تمت استعادة بيانات الإدارة والمستخدمين والتكليفات في SQLite. سيعاد تحميل الواجهة الآن.');
            location.reload();
          }else{
            YWP.setState(restored);
            renderAll();
            alert('تم استيراد النسخة القديمة بعد التحقق من مفتاح الربط.');
          }
        }
      }
    }catch(e){ alert(e.message || 'ملف غير صالح أو لا يخص قطرة برو'); }
    finally{ ev.target.value=''; }
  }
  function restoreLocalBackup(id){
    if(confirm('استرجاع هذه النسخة سيستبدل البيانات الحالية. سيتم حفظ نسخة حماية قبل الاسترجاع. متابعة؟')){
      if(YWP.restoreLocalBackup(id)){ renderAll(); alert('تم استرجاع النسخة المحلية بنجاح.'); }
    }
  }
  function deleteLocalBackup(id){
    if(confirm('حذف هذه النسخة المحلية؟ تأكد أن لديك نسخة خارجية محفوظة.')){ YWP.deleteLocalBackup(id); renderAll(); }
  }
  function exportLocalBackup(id){ YWP.exportLocalBackup(id); }


  function loadExcelData(){
    alert('لا توجد بيانات مشتركين مضمّنة في النسخة الآمنة. استخدم استيراد CSV/Excel أو رحّل نسخة JSON القديمة من شاشة النسخ الاحتياطي.');
  }

  function mergeSyncData(data){
    ['subscribers','cycles','readings','invoices','payments','expenses'].forEach(k=>{ if(!Array.isArray(data[k])) return; data[k].forEach(item=>{ const list=YWP.state[k]; const idx=list.findIndex(x=>x.id===item.id); if(idx>=0) list[idx]=item; else list.push(item); }); });
    YWP.recomputeInvoiceStatuses(); renderAll();
  }

  document.addEventListener('DOMContentLoaded', init);
  return {switchTab,handleAndroidBack,closeCurrentReport,renderAll,renderCycleWork,insertMessageField,loadProjectLogo,removeProjectLogo,resetMessageTemplates,previewMessageTemplates,saveSettings,resetSystem,saveSubscriber,bulkAddSubscribers,editSubscriber,quickSetSubscriberGroup,deleteSubscriber,clearSubscriberForm,exportSubscribers,downloadSubscriberTemplate,importSubscribersCSV,createCycle,saveCycleReadings,generateInvoices,exportCycleReadings,downloadCycleReadingsTemplate,importCycleReadings,printCycleInvoices,printReadingSheet,printInvoice,goEditInvoiceReading,sendInvoiceWhatsApp,sendInvoiceSms,invoicePdfWhatsApp,printUnpaidInvoices,copySms,exportInvoices,updateInvoiceFilters,clearInvoiceFilters,savePayment,printReceipt,sendReceiptWhatsApp,sendReceiptSms,receiptPdfWhatsApp,deletePayment,exportPayments,printCollectionBackup,refreshPaymentAccount,useOutstandingBalance,filterPaymentSubscribers,updatePaymentFilters,clearPaymentFilters,saveExpense,deleteExpense,exportExpenses,lossReport,collectionReport,revenueReport,expenseReport,matchingReport,statementReport,balancesReport,printCurrentReport,downloadCurrentCSV,exportBackup,importBackup,restoreLocalBackup,deleteLocalBackup,exportLocalBackup,loadExcelData,mergeSyncData};
})();

/* Expose globals for Production Safety Layer */
try { window.YWP = YWP; window.App = App; } catch(e) {}
