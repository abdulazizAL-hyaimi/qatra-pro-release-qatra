/* مياه الروضة - نسخة المحصل المستقلة
   تستورد مستحقات محدودة من نسخة النظام وتصدر سندات التحصيل للمدير.
*/
const Collector = (() => {
  'use strict';

  const STORAGE_KEY = 'meyah_alrawdah_collector_v1';
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => Array.from(root.querySelectorAll(s));
  const today = () => new Date().toISOString().slice(0, 10);
  const nowIso = () => new Date().toISOString();
  const n = v => { const x = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(x) ? x : 0; };
  const money = v => `${n(v).toLocaleString('en-US')} ر.ي`;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const arg = v => encodeURIComponent(String(v ?? ''));
  const unarg = v => decodeURIComponent(String(v ?? ''));
  const uid = (p='ID') => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  const normalizePhone = phone => {
    let p = String(phone || '').replace(/[^0-9+]/g, '').replace(/^\+/, '');
    if (p.startsWith('00')) p = p.slice(2);
    if (p.startsWith('0')) p = `967${p.slice(1)}`;
    return p;
  };

  function freshState(){
    return {
      version: '1.3.0',
      operationalStartedAt: null,
      assignment: null,
      payments: [],
      preferences: {
        collectorName: 'المحصل',
        thermalWidth: '80',
        autoPrint: false
      },
      exports: [],
      lastUpdatedAt: nowIso()
    };
  }

  function load(){
    try {
      const parsed = QatraStore.load('collector', freshState, [STORAGE_KEY]);
      if (!parsed || typeof parsed !== 'object') return freshState();
      parsed.payments = Array.isArray(parsed.payments) ? parsed.payments : [];
      parsed.preferences = {...freshState().preferences, ...(parsed.preferences || {})};
      parsed.exports = Array.isArray(parsed.exports) ? parsed.exports : [];
      return parsed;
    } catch (_) { return freshState(); }
  }

  let state = load();
  let currentTab = 'home';
  let searchQuery = '';
  let receiptFilter = 'today';

  function save(){
    state.lastUpdatedAt = nowIso();
    QatraStore.save('collector', state);
  }

  function hasAssignment(){
    return !!(state.assignment && Array.isArray(state.assignment.subscribers));
  }

  function assignmentTime(){
    return state.assignment?.meta?.exportedAt || state.assignment?.importedAt || '1970-01-01T00:00:00.000Z';
  }

  function paymentsAfterCurrentAssignment(subscriberId){
    const cutoff = assignmentTime();
    return state.payments.filter(p => p.subscriberId === subscriberId && String(p.createdAt || '') > cutoff);
  }

  function baseDue(sub){
    return n(sub?.totalDue ?? sub?.due ?? 0);
  }

  function balanceFor(sub){
    const paid = paymentsAfterCurrentAssignment(sub.subscriberId).reduce((a,p) => a + n(p.amount), 0);
    return baseDue(sub) - paid;
  }

  function balanceLabel(value){
    const v = n(value);
    if (v > 0) return {label:'الرصيد المتبقي عليكم', amount:v, cls:'due'};
    if (v < 0) return {label:'الرصيد المتبقي لكم', amount:Math.abs(v), cls:'credit'};
    return {label:'لا يوجد رصيد', amount:0, cls:'zero'};
  }

  function findSubscriber(id){
    return state.assignment?.subscribers?.find(s => String(s.subscriberId) === String(id)) || null;
  }

  function projectName(){
    return state.assignment?.settings?.projectName || state.assignment?.meta?.projectName || 'قطرة برو';
  }

  function projectLogo(){ return state.assignment?.settings?.projectLogo || 'assets/qatra-pro-mark.svg'; }
  function receiptTitle(){ return state.assignment?.settings?.receiptTitle || 'سند قبض'; }
  function marketingMark(){ return '<div class="qatra-print-brand"><img src="assets/qatra-pro-mark.svg" alt="Qatra Pro"><span><b>QATRA PRO</b><small>نظام قطرة برو لإدارة خدمات المياه</small></span></div>'; }

  function collectorName(){
    return state.assignment?.meta?.collectorName || state.preferences.collectorName || 'المحصل';
  }

  function collectorId(){ return state.assignment?.meta?.collectorId || ''; }
  function collectorCode(){ const code=String(state.assignment?.meta?.collectorCode||'').toUpperCase(); return /^[A-Z]{2}$/.test(code)?code:'CO'; }
  function assignmentId(){ return state.assignment?.meta?.assignmentId || state.assignment?.meta?.id || ''; }
  function hasPermission(permission){ const list=state.assignment?.meta?.permissions; return !Array.isArray(list) || list.includes(permission); }
  function sessionUsername(){ const info=QatraStore.appInfo(); return String(info?.username||'').trim().toLowerCase(); }
  function identityMismatch(){ const assigned=String(state.assignment?.meta?.collectorUsername||'').trim().toLowerCase(); return !!assigned&&assigned!==sessionUsername(); }

  function footerText(){
    return state.assignment?.settings?.receiptFooter || 'هذا السند صادر من المشروع.';
  }

  function callAndroid(name, ...args){
    try {
      if (window.AndroidBridge && typeof AndroidBridge[name] === 'function') {
        AndroidBridge[name](...args.map(x => String(x ?? '')));
        return true;
      }
    } catch (_) {}
    return false;
  }

  function download(filename, content, mime='application/json;charset=utf-8'){
    if (callAndroid('saveFile', filename, content, mime)) return;
    const blob = new Blob([content], {type:mime});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importClick(){ $('#duesImportInput')?.click(); }

  async function importDues(ev){
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const inspected = await QatraSync.inspectFile(file);
      if(inspected.duplicate){ alert(inspected.message || 'تم استيراد هذه العملية سابقًا.'); return; }
      if(inspected.operationType !== 'ASSIGN_COLLECTIONS') throw new Error('نوع عملية المزامنة غير صحيح');
      const data = inspected.payload;
      if (data?.meta?.type !== 'QATRA_COLLECTOR_DUES' || !Array.isArray(data.subscribers)) {
        throw new Error('نوع الملف غير صحيح');
      }
      if(!data.meta.collectorId||!data.meta.assignmentId||!/^[A-Z]{2}$/.test(String(data.meta.collectorCode||''))||!Array.isArray(data.meta.permissions)||!/^[a-z0-9_.-]{3,32}$/.test(String(data.meta.collectorUsername||'')))throw new Error('هوية المحصل أو رمزه أو صلاحياته ناقصة');
      if(sessionUsername()!==String(data.meta.collectorUsername).toLowerCase())throw new Error('هذا التكليف صادر لمستخدم آخر. سجل الدخول باسم '+data.meta.collectorUsername);
      const pending=state.payments.filter(p=>!p.exportedAt);
      if(assignmentId()&&assignmentId()!==String(data.meta.assignmentId)&&pending.length)throw new Error('لا يمكن استيراد تكليف جديد قبل تسليم جميع السندات غير المسلمة');
      const seen = new Set();
      const subscribers = data.subscribers.map(raw => ({
        subscriberId: String(raw.subscriberId ?? raw.id ?? raw.code ?? raw.meterNo),
        code: String(raw.code ?? ''),
        meterNo: String(raw.meterNo ?? raw.code ?? ''),
        name: String(raw.name ?? ''),
        phone: String(raw.phone ?? ''),
        area: String(raw.area ?? ''),
        due: n(raw.totalDue ?? raw.due),
        totalDue: n(raw.totalDue ?? raw.due),
        lastInvoiceNo: String(raw.lastInvoiceNo ?? ''),
        lastInvoiceDate: String(raw.lastInvoiceDate ?? ''),
        lastReading: n(raw.lastReading),
        invoiceRemaining: n(raw.invoiceRemaining)
      })).filter(s => s.subscriberId && !seen.has(s.subscriberId) && seen.add(s.subscriberId));
      if (!subscribers.length) throw new Error('لا يحتوي الملف على مستحقات');

      const nextState = JSON.parse(JSON.stringify(state));
      nextState.assignment = {
        meta: {...data.meta},
        settings: {...(data.settings || {})},
        subscribers,
        importedAt: nowIso(),
        sourceFilename: file.name || ''
      };
      if (data.meta.collectorName) nextState.preferences.collectorName = String(data.meta.collectorName);
      if (data.settings?.receiptThermalWidth) nextState.preferences.thermalWidth = String(data.settings.receiptThermalWidth);
      nextState.lastUpdatedAt = nowIso();
      QatraSync.commit('collector', inspected, nextState);
      state = nextState;
      currentTab = 'home';
      alert(`تم استيراد مستحقات ${subscribers.length} مشترك بنجاح.`);
      render();
    } catch (e) {
      alert(`تعذر استيراد الملف. اختر ملف مستحقات صادرًا من نسخة النظام.\n${e.message || ''}`);
    } finally { ev.target.value = ''; }
  }

  function switchTab(tab){
    if(identityMismatch()){currentTab='home';render();return;}
    currentTab = tab;
    $$('.collector-nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.collector-tab').forEach(s => s.classList.toggle('active', s.id === tab));
    renderTab(tab);
    window.scrollTo({top:0, behavior:'smooth'});
  }

  function emptyAssignment(){
    return `<div class="card collector-empty">
      <img src="assets/rawdah-logo.png" alt="شعار مياه الروضة">
      <h3>ابدأ باستيراد ملف المستحقات</h3>
      <p>استلم ملف المستحقات من نسخة النظام ثم استورده هنا. لا تظهر في هذه النسخة إلا بيانات التحصيل اللازمة.</p>
      <label class="file-btn green">استيراد مستحقات من النظام<input id="duesImportInput" type="file" accept=".qsync,application/octet-stream" onchange="Collector.importDues(event)"></label>
    </div>`;
  }

  function totals(){
    const subs = state.assignment?.subscribers || [];
    const due = subs.reduce((a,s) => a + Math.max(0, balanceFor(s)), 0);
    const credits = subs.reduce((a,s) => a + Math.max(0, -balanceFor(s)), 0);
    const paidToday = state.payments.filter(p => p.date === today()).reduce((a,p) => a+n(p.amount), 0);
    const newCount = state.payments.filter(p => !p.exportedAt).length;
    return {count:subs.length,due,credits,paidToday,newCount};
  }

  function formatDateTime(value){
    if(!value) return '-';
    try{return new Intl.DateTimeFormat('ar-YE',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
    catch(_){return String(value);}
  }

  function collectorProgress(t){
    if(!t.due && !t.paidToday) return 0;
    return Math.max(0, Math.min(100, Math.round((t.paidToday / Math.max(1, t.due + t.paidToday))*100)));
  }

  function homeHtml(){
    if (!hasAssignment()) return emptyAssignment();
    const t = totals();
    const imported = formatDateTime(state.assignment.importedAt);
    const recent = state.payments.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,3);
    const progress = collectorProgress(t);
    const cashToday = state.payments.filter(p=>p.date===today() && p.method==='نقداً').reduce((a,p)=>a+n(p.amount),0);
    const transferToday = t.paidToday - cashToday;
    return `<div class="collector-hero collector-dashboard-hero">
      <div class="collector-hero-main"><div><span class="hero-eyebrow">لوحة المحصل</span><h2>${esc(projectName())}</h2><p>${esc(collectorName())}</p></div><div class="hero-date"><small>تاريخ اليوم</small><b>${esc(new Intl.DateTimeFormat('ar-YE',{year:'numeric',month:'long',day:'numeric'}).format(new Date()))}</b></div></div>
      <div class="hero-meta"><span>آخر تحديث: ${esc(imported)}</span><span>المشتركون: ${t.count}</span></div>
    </div>
    <div class="collector-stats premium-stats">
      <div class="collector-stat red"><span class="stat-icon">◉</span><small>إجمالي المستحق</small><b>${money(t.due)}</b><em>على المشتركين</em></div>
      <div class="collector-stat green"><span class="stat-icon">✓</span><small>تحصيل اليوم</small><b>${money(t.paidToday)}</b><em>${state.payments.filter(p=>p.date===today()).length} سند</em></div>
      <div class="collector-stat amber"><span class="stat-icon">↥</span><small>بانتظار التسليم</small><b>${t.newCount}</b><em>سند غير مُسلّم</em></div>
      <div class="collector-stat"><span class="stat-icon">♙</span><small>المشتركون</small><b>${t.count}</b><em>ضمن ملف المهمة</em></div>
    </div>
    <div class="collector-dashboard-grid">
      <section class="card collector-progress-card"><div class="section-title"><div><small>أداء اليوم</small><h3>نسبة التحصيل</h3></div><strong>${progress}%</strong></div><div class="progress-track"><span style="width:${progress}%"></span></div><div class="mini-breakdown"><div><small>نقداً</small><b>${money(cashToday)}</b></div><div><small>تحويل</small><b>${money(transferToday)}</b></div></div></section>
      <section class="card quick-actions-card"><div class="section-title"><div><small>وصول سريع</small><h3>الإجراءات الرئيسية</h3></div></div><div class="quick-action-grid"><button class="quick-action primary" onclick="Collector.switchTab('dues')"><span>＋</span><b>بدء التحصيل</b></button><button class="quick-action warning" onclick="Collector.switchTab('sync')"><span>↥</span><b>تسليم التحصيلات</b></button><label class="quick-action secondary"><span>↻</span><b>تحديث المستحقات</b><input id="duesImportInput" type="file" accept=".qsync,application/octet-stream" onchange="Collector.importDues(event)"></label></div></section>
    </div>
    <div class="card recent-card"><div class="section-title"><div><small>آخر العمليات</small><h3>أحدث السندات</h3></div><button class="light mini" onclick="Collector.switchTab('receipts')">عرض الكل</button></div>${recent.length ? recent.map(receiptCard).join('') : '<div class="notice">لم يتم تسجيل سندات بعد.</div>'}</div>
    <div class="collector-footer-note">نسخة المحصل مخصصة للتحصيل والتسليم فقط، ولا تسمح بتعديل الفواتير أو القراءات.</div>`;
  }

  function normalizeSearchText(value){
    return String(value ?? '')
      .normalize('NFKD')
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ـ/g, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function filteredSubscribers(){
    const q = normalizeSearchText(searchQuery);
    const list = (state.assignment?.subscribers || []).slice();
    list.sort((a,b) => String(a.code||a.meterNo).localeCompare(String(b.code||b.meterNo),'ar',{numeric:true}));
    if (!q) return list;
    return list.filter(s => normalizeSearchText([s.code,s.meterNo,s.name,s.phone,s.area].join(' ')).includes(q));
  }

  function dueCard(s){
    const bal = balanceFor(s); const bl = balanceLabel(bal);
    const cls = bl.cls === 'credit' ? 'credit' : (bl.cls === 'zero' ? 'paid' : '');
    const phone = normalizePhone(s.phone);
    return `<article class="due-card ${cls}">
      <div class="due-head">
        <div><div class="due-name">${esc(s.name)}</div><div class="due-code">رقم العداد: ${esc(s.meterNo || s.code || '-')}</div></div>
        <div class="due-amount"><small>${esc(bl.label)}</small><b>${money(bl.amount)}</b></div>
      </div>
      <div class="due-meta">
        <span>رقم المشترك: ${esc(s.code || '-')}</span>
        <span>الحي: ${esc(s.area || '-')}</span>
        <span>الهاتف: ${esc(s.phone || '-')}</span>
        <span>آخر فاتورة: ${esc(s.lastInvoiceNo || '-')}</span>
      </div>
      <div class="due-actions">
        ${bal > 0&&hasPermission('CREATE_RECEIPTS') ? `<button class="green" onclick="Collector.openPayment('${arg(s.subscriberId)}')">تسجيل سداد</button>` : ''}
        ${phone ? `<a class="file-btn secondary" href="tel:${esc(phone)}">اتصال</a>` : ''}
        ${phone && bal > 0 ? `<button class="warn" onclick="Collector.sendPaymentReminder('${arg(s.subscriberId)}')">رسالة</button>` : ''}
        <button class="light" onclick="Collector.showSubscriberReceipts('${arg(s.subscriberId)}')">السندات</button>
      </div>
    </article>`;
  }

  function duesHtml(){
    if (!hasAssignment()) return emptyAssignment();
    const list = filteredSubscribers();
    return `<div class="collector-search"><input id="collectorSearch" dir="rtl" autocomplete="off" value="${esc(searchQuery)}" oninput="Collector.setSearch(this.value)" placeholder="بحث بالاسم أو رقم العداد أو الهاتف أو الحي"></div>
      <div class="notice success">تظهر هنا بيانات التحصيل فقط. اضغط «تسجيل سداد» ثم أدخل المبلغ وطريقة الدفع.</div>
      <div id="duesList" class="dues-list">${list.length ? list.map(dueCard).join('') : '<div class="card collector-empty"><h3>لا توجد نتائج</h3><p>غيّر كلمات البحث وحاول مرة أخرى.</p></div>'}</div>`;
  }

  function receiptCard(p){
    const exported = p.exportedAt ? 'تم تضمينه في ملف تسليم' : 'لم يُسلّم بعد';
    return `<article class="receipt-card">
      <div class="receipt-top"><div><h4>${esc(p.subscriberName)}</h4><small>${esc(p.receiptNo)} — ${esc(p.date)}</small></div><div class="amount">${money(p.amount)}</div></div>
      <div class="receipt-meta"><span>رقم العداد: ${esc(p.meterNo || p.subscriberCode || '-')}</span><span>${esc(p.method)}</span><span>${esc(exported)}</span></div>
      <div class="receipt-actions">${hasPermission('PRINT_RECEIPTS')?`<button class="secondary" onclick="Collector.previewThermalById('${arg(p.id)}')">معاينة حراري</button><button class="light" onclick="Collector.printPaperById('${arg(p.id)}')">ورقي</button>`:''}</div>
    </article>`;
  }

  function receiptsHtml(){
    if (!hasAssignment() && !state.payments.length) return emptyAssignment();
    let list = state.payments.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
    if (receiptFilter === 'today') list = list.filter(p=>p.date===today());
    if (receiptFilter === 'pending') list = list.filter(p=>!p.exportedAt);
    return `<div class="card">
      <div class="form-row"><div class="field"><label>عرض السندات</label><select onchange="Collector.setReceiptFilter(this.value)"><option value="today" ${receiptFilter==='today'?'selected':''}>سندات اليوم</option><option value="pending" ${receiptFilter==='pending'?'selected':''}>غير المسلمة</option><option value="all" ${receiptFilter==='all'?'selected':''}>كل السندات</option></select></div></div>
    </div><div class="receipt-list" style="margin-top:10px">${list.length ? list.map(receiptCard).join('') : '<div class="card collector-empty"><h3>لا توجد سندات</h3><p>لم تُسجل سندات ضمن هذا الاختيار.</p></div>'}</div>`;
  }

  function syncHtml(){
    const t = totals();
    return `<div class="sync-grid">
      <div class="sync-card"><h3>تسليم التحصيلات للإدارة</h3><p>ملف مشفر مرتبط بالمحصل والتكليف ورمز السند.</p><div class="notice warning">السندات الجديدة غير المسلمة: <b>${t.newCount}</b></div>${hasPermission('EXPORT_COLLECTIONS')?'<div class="toolbar"><button class="green" onclick="Collector.exportNewPayments()">تصدير السندات الجديدة</button><button class="secondary" onclick="Collector.exportAllPayments()">تصدير كل السندات</button></div>':'<div class="notice danger-box">صلاحية تسليم التحصيلات غير مفعلة لهذا المستخدم.</div>'}</div>
      <div class="sync-card"><h3>كشف تحصيل المحصل</h3><p>للمراجعة اليومية أو التسليم للصندوق.</p><div class="toolbar"><button onclick="Collector.printDailyReport()">طباعة كشف اليوم</button><button class="secondary" onclick="Collector.exportDailyXlsx()">Excel حقيقي</button></div></div>
      <div class="sync-card"><h3>تحديث المستحقات</h3><p>استورد ملفًا مشفرًا جديدًا بعد أن يرحّل المدير تحصيلاتك في نسخة النظام.</p><div class="toolbar"><label class="file-btn warn">استيراد مستحقات محدثة<input id="duesImportInput" type="file" accept=".qcollector,.qsync,application/octet-stream" onchange="Collector.importDues(event)"></label></div></div>
      <div class="sync-card"><h3>النسخ الاحتياطي والاستعادة</h3><p>نسخ مشفر تلقائيًا إلى Google Drive واستعادة سريعة بالحساب نفسه واسم المستخدم والدور، دون كلمة مرور منفصلة.</p><div class="toolbar"><button class="green" onclick="QatraDriveBackup.open()">Google Drive</button><button class="light" onclick="Collector.exportBackup()">نسخة محمولة</button><label class="file-btn light">استعادة ملف<input type="file" accept=".qcollector,.qbackup,.json,application/octet-stream,application/json" onchange="Collector.importBackup(event)"></label></div></div>
    </div>`;
  }

  function renderTab(tab){
    const el = $('#'+tab); if (!el) return;
    if (tab === 'home') el.innerHTML = homeHtml();
    if (tab === 'dues') el.innerHTML = duesHtml();
    if (tab === 'receipts') el.innerHTML = receiptsHtml();
    if (tab === 'sync') el.innerHTML = syncHtml();
  }

  function render(){
    if(identityMismatch()){
      const assigned=esc(state.assignment?.meta?.collectorUsername||'-'),logged=esc(sessionUsername()||'-');
      const blocked=`<div class="card collector-empty"><h3>تم حجب بيانات المحصل</h3><p>التكليف مخصص للمستخدم <b dir="ltr">${assigned}</b> بينما الجلسة الحالية <b dir="ltr">${logged}</b>. اقفل التطبيق وادخل بالحساب الصحيح.</p></div>`;
      ['home','dues','receipts','sync'].forEach(id=>{const el=$('#'+id);if(el){el.innerHTML=id==='home'?blocked:'';el.classList.toggle('active',id==='home')}});$$('.collector-nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='home'));currentTab='home';return;
    }
    ['home','dues','receipts','sync'].forEach(renderTab);
    switchTab(currentTab);
  }

  function setSearch(v){
    searchQuery = v || '';
    const list = filteredSubscribers();
    const box = $('#duesList');
    if (box) box.innerHTML = list.length ? list.map(dueCard).join('') : '<div class="card collector-empty"><h3>لا توجد نتائج</h3><p>غيّر كلمات البحث وحاول مرة أخرى.</p></div>';
  }

  function sendPaymentReminder(encodedId){
    const sub = findSubscriber(unarg(encodedId));
    if (!sub) return;
    const phone = normalizePhone(sub.phone);
    const due = Math.max(0, balanceFor(sub));
    if (!phone) { alert('لا يوجد رقم هاتف مسجل لهذا المشترك.'); return; }
    if (due <= 0) { alert('لا يوجد مبلغ مستحق على هذا المشترك.'); return; }
    const text = `نرجو سرعة سداد المبلغ المستحق عليكم وقدره ${money(due)}. ${projectName()}`;
    if (!callAndroid('openSms', phone, text)) window.location.href = `smsto:${phone}?body=${encodeURIComponent(text)}`;
  }
  function setReceiptFilter(v){ receiptFilter = v; renderTab('receipts'); }

  function openPayment(encodedId){
    if(!hasPermission('CREATE_RECEIPTS')){alert('لا تملك صلاحية إنشاء سندات قبض.');return}
    const id = unarg(encodedId); const sub = findSubscriber(id); if (!sub) return;
    const bal = balanceFor(sub); if (bal <= 0) { alert('لا يوجد رصيد عليكم لهذا المشترك.'); return; }
    openModal('تسجيل سداد', `<div class="pay-summary"><div><small>اسم المشترك</small><b>${esc(sub.name)}</b></div><div><small>رقم العداد</small><b>${esc(sub.meterNo || sub.code)}</b></div><div><small>الرصيد قبل السداد</small><b>${money(bal)}</b></div><div><small>المحصل</small><b>${esc(collectorName())}</b></div></div>
      <div class="form-row"><div class="field"><label>المبلغ المسدد</label><input id="payAmount" class="big-input" inputmode="decimal" type="number" min="1" step="1" placeholder="0" oninput="Collector.updateBalancePreview('${arg(id)}')"></div><div class="field"><label>طريقة الدفع</label><select id="payMethod"><option>نقداً</option><option>تحويل</option></select></div></div>
      <div class="field"><label>ملاحظة اختيارية</label><textarea id="payNote" placeholder="مثال: رقم الحوالة أو ملاحظة التسليم"></textarea></div>
      <div class="qatra-photo-field"><label>📷 التقاط صورة إثبات السداد<input id="paymentPhoto" type="file" accept="image/*" capture="environment" onchange="QatraMedia.preview(this,'paymentPhotoPreview')"></label><div id="paymentPhotoPreview" class="qatra-photo-preview"></div></div>
      <div id="payBalancePreview" class="pay-balance-preview due"><small>الرصيد المتبقي عليكم</small><b>${money(bal)}</b></div>
      <div class="toolbar"><button class="green" onclick="Collector.savePayment('${arg(id)}')">حفظ وإصدار سند</button><button class="light" onclick="Collector.closeModal()">إلغاء</button></div>`);
    setTimeout(()=>$('#payAmount')?.focus(),150);
  }

  function updateBalancePreview(encodedId){
    const sub = findSubscriber(unarg(encodedId)); if (!sub) return;
    const after = balanceFor(sub) - n($('#payAmount')?.value); const bl = balanceLabel(after); const box = $('#payBalancePreview');
    if (box) { box.className = `pay-balance-preview ${bl.cls}`; box.innerHTML = `<small>${esc(bl.label)}</small><b>${money(bl.amount)}</b>`; }
  }

  function nextReceiptNo(){
    const date = today().replace(/-/g,'');
    const prefix=`${collectorCode()}-${date}-`,same=state.payments.filter(p=>String(p.receiptNo||'').startsWith(prefix));
    const max = same.reduce((m,p)=>Math.max(m,n(String(p.receiptNo).split('-').pop())),0);
    return `${prefix}${String(max+1).padStart(4,'0')}`;
  }

  function savePayment(encodedId){
    if(!hasPermission('CREATE_RECEIPTS')){alert('لا تملك صلاحية إنشاء سندات قبض.');return}
    const sub = findSubscriber(unarg(encodedId)); if (!sub) return;
    const amount = n($('#payAmount')?.value); const before = balanceFor(sub);
    if (amount <= 0) { alert('أدخل مبلغًا صحيحًا أكبر من صفر.'); return; }
    if (amount > before && !confirm(`المبلغ أكبر من الرصيد الحالي بمقدار ${money(amount-before)}. سيصبح للمشترك رصيد متبقٍ له. هل تريد المتابعة؟`)) return;
    const createdAt = nowIso();
    const p = {
      id: uid('COLPAY'), syncId: uid('SYNC'), receiptNo: nextReceiptNo(),
      subscriberId: sub.subscriberId, subscriberCode: sub.code, meterNo: sub.meterNo,
      subscriberName: sub.name, phone: sub.phone, area: sub.area,
      date: today(), amount, method: $('#payMethod')?.value || 'نقداً',
      collectorName: collectorName(), note: $('#payNote')?.value?.trim() || '', receiptPhoto:window.QatraMedia?.value?.('paymentPhoto') || '',
      collectorId:collectorId(),collectorCode:collectorCode(),assignmentId:assignmentId(),
      createdAt, sourceAssignmentExportedAt: assignmentTime(), exportedAt: null,
      balanceBefore: before, balanceAfter: before - amount,
      projectName: projectName(), projectLogo:projectLogo(), receiptTitle:receiptTitle(), receiptFooter: footerText()
    };
    state.payments.push(p); save(); render();
    const after = p.balanceAfter; const bl = balanceLabel(after);
    openModal('تم إصدار سند القبض', `<div class="notice success"><b>تم حفظ السند ${esc(p.receiptNo)}</b><br>المبلغ: ${money(p.amount)}</div><div class="pay-balance-preview ${bl.cls}"><small>${esc(bl.label)}</small><b>${money(bl.amount)}</b></div><div class="toolbar"><button class="green" onclick="Collector.previewThermalById('${arg(p.id)}')">معاينة الحراري</button><button onclick="Collector.printPaperById('${arg(p.id)}')">طباعة ورقية</button><button class="light" onclick="Collector.closeModal()">إغلاق</button></div>`);
    if (state.preferences.autoPrint) setTimeout(()=>printThermal(p),250);
  }

  function paymentById(id){ return state.payments.find(p=>String(p.id)===String(id)); }
  function subForPayment(p){ return findSubscriber(p.subscriberId) || {subscriberId:p.subscriberId,code:p.subscriberCode,meterNo:p.meterNo,name:p.subscriberName,phone:p.phone,area:p.area}; }
  function balanceAfterPayment(p){
    if (p.balanceAfter !== undefined && p.balanceAfter !== null) return n(p.balanceAfter);
    const sub = subForPayment(p); const cutoff=assignmentTime();
    const relevant = state.payments.filter(x=>x.subscriberId===p.subscriberId && String(x.createdAt||'')>cutoff && String(x.createdAt||'')<=String(p.createdAt||''));
    return baseDue(sub)-relevant.reduce((a,x)=>a+n(x.amount),0);
  }

  function printThermal(p){
    if(!hasPermission('PRINT_RECEIPTS')){alert('لا تملك صلاحية طباعة السندات.');return}
    const after = balanceAfterPayment(p); const bl = balanceLabel(after);
    const before = p.balanceBefore !== undefined && p.balanceBefore !== null
      ? n(p.balanceBefore)
      : after + n(p.amount);
    const payload = {
      receiptNo:p.receiptNo,date:p.date,subscriberCode:p.subscriberCode,subscriberName:p.subscriberName,
      meterNo:p.meterNo,phone:p.phone,area:p.area,amount:n(p.amount).toLocaleString('en-US'),method:p.method,
      collectorName:p.collectorName,projectName:p.projectName || projectName(),projectLogo:p.projectLogo||projectLogo(),receiptTitle:p.receiptTitle||receiptTitle(),marketingBrand:'QATRA PRO — نظام قطرة برو',
      balanceBeforeAmount:Math.abs(before).toLocaleString('en-US'),
      balanceBeforeSuffix:before < 0 ? ' لكم' : (before > 0 ? ' عليكم' : ''),
      balanceLabel:bl.label,balanceAmount:n(bl.amount).toLocaleString('en-US'),
      footer:p.receiptFooter || footerText(), thermalWidth:state.preferences.thermalWidth || '80',
      qrText:window.QatraQr?.receipt?.(p) || ''
    };
    if (!callAndroid('printThermalReceipt', JSON.stringify(payload))) printPaper(p, 'THERMAL');
  }

  function printThermalById(encodedId){ const p=paymentById(unarg(encodedId)); if(p) printThermal(p); }

  function previewThermalById(encodedId){
    const p = paymentById(unarg(encodedId));
    if (!p) return;
    const narrow = String(state.preferences.thermalWidth || '80') === '58';
    openModal('معاينة السند الحراري', `<div class="thermal-preview-wrap"><iframe id="thermalPreviewFrame" class="thermal-preview-frame" title="معاينة السند الحراري" scrolling="no"></iframe></div><div class="toolbar"><button class="green" onclick="Collector.printThermalById('${arg(p.id)}')">طباعة الآن</button><button class="light" onclick="Collector.closeModal()">إغلاق</button></div>`);
    setTimeout(() => {
      const frame = $('#thermalPreviewFrame');
      if (!frame) return;
      frame.style.width = narrow ? '64mm' : '86mm';
      const fitHeight = () => {
        try {
          const doc = frame.contentDocument;
          if (!doc) return;
          const bodyHeight = doc.body ? doc.body.scrollHeight : 0;
          const htmlHeight = doc.documentElement ? doc.documentElement.scrollHeight : 0;
          frame.style.height = `${Math.max(120, bodyHeight, htmlHeight) + 4}px`;
        } catch (_) {}
      };
      frame.onload = () => { fitHeight(); setTimeout(fitHeight, 180); setTimeout(fitHeight, 600); };
      frame.srcdoc = receiptHtml(p, true);
    }, 50);
  }

  function receiptHtml(p, thermal=false){
    const after = balanceAfterPayment(p); const bl = balanceLabel(after);
    const before = p.balanceBefore !== undefined && p.balanceBefore !== null
      ? n(p.balanceBefore)
      : after + n(p.amount);
    const beforeSuffix = before < 0 ? ' لكم' : (before > 0 ? ' عليكم' : '');
    const qrText = window.QatraQr?.receipt?.(p) || '';
    const qr = window.QatraQr?.html?.(qrText,'امسح للتحقق من السند') || '';

    if (thermal) {
      const width = String(state.preferences.thermalWidth || '80') === '58' ? '58mm' : '80mm';
      const narrow = width === '58mm';
      return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
        @page{size:${width} auto;margin:0}
        *{box-sizing:border-box}
        html{margin:0;padding:0;background:#fff}
        body{width:${width};max-width:${width};margin:0 auto;padding:${narrow?'2mm 2mm 2.5mm':'2.5mm 3mm 3mm'};background:#fff;color:#000;font-family:Tahoma,Arial,sans-serif;font-size:${narrow?'10.5px':'12px'};line-height:1.45;direction:rtl}
        .receipt{width:100%;margin:0;padding:0;page-break-inside:avoid;break-inside:avoid}
        .logo{width:${narrow?'17mm':'20mm'};height:${narrow?'17mm':'20mm'};object-fit:contain;display:block;margin:0 auto .7mm;filter:grayscale(100%) contrast(155%)}
        h1,h2{text-align:center;margin:0;font-weight:700;color:#000}
        h1{font-size:${narrow?'13px':'15px'};line-height:1.25}
        h2{font-size:${narrow?'11.5px':'13px'};margin-top:.5mm}
        .line{border-top:1px dashed #000;margin:1.7mm 0}
        .row{display:grid;grid-template-columns:${narrow?'40%':'37%'} minmax(0,1fr);direction:rtl;column-gap:2mm;align-items:start;padding:.85mm .4mm;border-bottom:1px dotted #b8b8b8}
        .row:last-of-type{border-bottom:0}
        .label{font-weight:600;text-align:right;white-space:nowrap}
        .value{min-width:0;text-align:left;direction:rtl;unicode-bidi:plaintext;overflow-wrap:anywhere;word-break:break-word;font-weight:500}
        .value.ltr{direction:ltr;unicode-bidi:isolate;text-align:left;white-space:normal}
        .value.b{font-weight:700}
        .amount{border:1.6px solid #000;text-align:center;font-weight:700;font-size:${narrow?'15px':'18px'};line-height:1.35;padding:${narrow?'1.8mm':'2.2mm'} 1mm;margin:2mm 0}
        .amount small{display:block;font-size:${narrow?'10px':'11.5px'};margin-bottom:.5mm}
        .balance-row{background:#fafafa}
        .foot{text-align:center;font-size:${narrow?'9px':'10px'};line-height:1.55;margin-top:1.7mm;padding:0 1mm}
        .collector-name{font-weight:700;margin-top:2.3mm}
        .qatra-qr{text-align:center;margin:2mm auto}.qatra-qr img{width:${narrow?'25mm':'30mm'}!important;height:${narrow?'25mm':'30mm'}!important}.qatra-qr figcaption{font-size:8px}
        .qatra-print-brand{display:flex;align-items:center;justify-content:center;gap:1mm;margin-top:2mm;padding-top:1mm;border-top:1px solid #aaa;font-size:7px}.qatra-print-brand img{width:6mm;height:6mm;object-fit:contain}.qatra-print-brand span{display:flex;flex-direction:column}
      </style></head><body><div class="receipt">
        <img class="logo" src="${esc(p.projectLogo||projectLogo())}" alt="شعار المشروع">
        <h1>${esc(p.projectName || projectName())}</h1>
        <h2>${esc(p.receiptTitle||receiptTitle())}</h2>
        <div class="line"></div>
        <div class="row"><span class="label">رقم السند</span><span class="value ltr b">${esc(p.receiptNo)}</span></div>
        <div class="row"><span class="label">التاريخ</span><span class="value ltr">${esc(p.date)}</span></div>
        <div class="row"><span class="label">اسم المشترك</span><span class="value b">${esc(p.subscriberName)}</span></div>
        <div class="row"><span class="label">رقم العداد</span><span class="value ltr b">${esc(p.meterNo || p.subscriberCode || '-')}</span></div>
        <div class="line"></div>
        <div class="amount"><small>المبلغ المسدد</small>${money(p.amount)}</div>
        <div class="row balance-row"><span class="label">الرصيد قبل السداد</span><span class="value">${money(Math.abs(before))}${beforeSuffix}</span></div>
        <div class="row balance-row"><span class="label">${esc(bl.label)}</span><span class="value b">${money(bl.amount)}</span></div>
        <div class="row"><span class="label">طريقة السداد</span><span class="value">${esc(p.method)}</span></div>
        ${qr}
        <div class="line"></div>
        <div class="foot">${esc(p.receiptFooter || footerText())}</div>
        <div class="foot collector-name">المحصل: ${esc(p.collectorName || collectorName())}</div>
        ${marketingMark()}
      </div></body></html>`;
    }

    const size = 'A5 landscape';
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
      @page{size:${size};margin:4mm}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;padding:0;overflow:hidden}body{font-family:Tahoma,Arial,sans-serif;color:#000;background:#fff;direction:rtl}.receipt{position:relative;border:2px solid #075985;border-radius:10px;padding:4mm 4mm 15mm;width:100%;height:100%;max-height:140mm;page-break-inside:avoid;break-inside:avoid;overflow:hidden}.head{text-align:center;border-bottom:1px solid #075985;padding-bottom:2px}.head img{width:18mm;height:18mm;object-fit:contain}.head h2{font-size:17px;margin:1px}.head h3{font-size:15px;margin:1px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-top:4px}.box{border:1px solid #9bbfce;border-radius:4px;padding:3px 5px;font-size:11px;line-height:1.25}.amount{text-align:center;border:2px solid #075985;border-radius:6px;padding:4px;margin:4px 0}.amount b{font-size:21px}.balance{text-align:center;border:1px solid #777;border-radius:6px;padding:4px;font-size:12px}.footer{text-align:center;font-weight:bold;margin-top:5px;font-size:10px}.sign{display:flex;justify-content:space-between;margin-top:7px;font-size:10px}.qatra-qr{text-align:center;margin:3px auto}.qatra-qr img{width:24mm!important;height:24mm!important}.qatra-qr figcaption{font-size:8px}.qatra-print-brand{position:absolute;right:3mm;left:3mm;bottom:2mm;display:flex;align-items:center;justify-content:center;gap:2mm;margin:0;padding-top:1mm;border-top:1px solid #aaa;background:#fff;font-size:8px;color:#405665}.qatra-print-brand img{width:7mm;height:7mm;object-fit:contain}.qatra-print-brand span{display:flex;flex-direction:column}</style></head><body><div class="receipt"><div class="head"><img src="${esc(p.projectLogo||projectLogo())}"><h2>${esc(p.projectName || projectName())}</h2><h3>${esc(p.receiptTitle||receiptTitle())}</h3></div><div class="meta"><div class="box"><b>رقم السند:</b> ${esc(p.receiptNo)}</div><div class="box"><b>التاريخ:</b> ${esc(p.date)}</div><div class="box"><b>اسم المشترك:</b> ${esc(p.subscriberName)}</div><div class="box"><b>رقم العداد:</b> ${esc(p.meterNo||p.subscriberCode)}</div><div class="box"><b>طريقة الدفع:</b> ${esc(p.method)}</div><div class="box"><b>المحصل:</b> ${esc(p.collectorName)}</div></div><div class="amount"><small>المبلغ المسدد</small><br><b>${money(p.amount)}</b></div><div class="balance"><b>${esc(bl.label)}:</b> ${money(bl.amount)}</div>${qr}<div class="footer">${esc(p.receiptFooter || footerText())}</div><div class="sign"><span>توقيع المحصل: ____________</span><span>توقيع المستلم: ____________</span></div>${marketingMark()}</div></body></html>`;
  }

  function printPaper(p, mode='A5L'){
    if(!hasPermission('PRINT_RECEIPTS')){alert('لا تملك صلاحية طباعة السندات.');return}
    const html = receiptHtml(p, mode==='THERMAL');
    if (!callAndroid('printHtml', `سند قبض ${p.receiptNo}`, html, mode==='THERMAL'?'A5': 'A5L')) {
      const w=window.open('','_blank'); if(w){w.document.write(html.replace('</body>','<script>window.onload=()=>window.print()<\/script></body>'));w.document.close();}
    }
  }
  function printPaperById(encodedId){ const p=paymentById(unarg(encodedId)); if(p) printPaper(p); }

  function showSubscriberReceipts(encodedId){
    const id=unarg(encodedId), sub=findSubscriber(id); const list=state.payments.filter(p=>p.subscriberId===id).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
    openModal(`سندات ${sub?.name||''}`, list.length ? `<div class="receipt-list">${list.map(receiptCard).join('')}</div>` : '<div class="notice">لا توجد سندات لهذا المشترك.</div>');
  }

  function exportPayload(payments){
    return {
      meta:{type:'QATRA_COLLECTOR_PAYMENTS',version:'2.0',exportedAt:nowIso(),date:today(),projectName:projectName(),collectorId:collectorId(),collectorCode:collectorCode(),collectorName:collectorName(),assignmentId:assignmentId(),count:payments.length,total:payments.reduce((a,p)=>a+n(p.amount),0)},
      payments:payments.map(p=>({id:p.id,syncId:p.syncId,receiptNo:p.receiptNo,subscriberId:p.subscriberId,subscriberCode:p.subscriberCode,meterNo:p.meterNo,subscriberName:p.subscriberName,date:p.date,amount:n(p.amount),method:p.method,collectorId:p.collectorId||collectorId(),collectorCode:p.collectorCode||collectorCode(),assignmentId:p.assignmentId||assignmentId(),collectorName:p.collectorName,note:p.note,receiptPhoto:p.receiptPhoto||'',createdAt:p.createdAt}))
    };
  }

  function exportPayments(list, mark){
    if(!hasPermission('EXPORT_COLLECTIONS')){alert('لا تملك صلاحية تسليم التحصيلات.');return}
    if (!list.length) { alert('لا توجد سندات ضمن هذا الاختيار.'); return; }
    const payload=exportPayload(list); const safe=collectorName().replace(/\s+/g,'-').replace(/[^ء-يA-Za-z0-9_-]/g,'');
    const filename=`qatra-collector-payments-${safe||'collector'}-${today()}.qsync`;
    try {
      QatraSync.export(filename,'ADMIN','COLLECTION_BATCH',payload,()=>{
        if(mark){const stamp=payload.meta.exportedAt;list.forEach(p=>p.exportedAt=stamp);state.exports.unshift({id:uid('EXP'),date:today(),createdAt:stamp,filename,count:list.length,total:payload.meta.total});save();render();}
        alert(`تم حفظ ملف التسليم.\nعدد السندات: ${list.length}\nالإجمالي: ${money(payload.meta.total)}`);
      },event=>alert(event?.error||'أُلغي حفظ الملف، وبقيت السندات غير مسلّمة.'));
    } catch(error) { alert(error.message); }
  }
  function exportNewPayments(){ exportPayments(state.payments.filter(p=>!p.exportedAt),true); }
  function exportAllPayments(){ exportPayments(state.payments.slice(),false); }
  function openDriveSync(){
    const rows=state.payments.filter(p=>!p.exportedAt);
    try{
      if(rows.length&&hasPermission('EXPORT_COLLECTIONS')){
        const payload=exportPayload(rows),safe=collectorName().replace(/\s+/g,'-').replace(/[^ء-يA-Za-z0-9_-]/g,'');
        QatraSync.queue(`qatra-collector-payments-${safe||'collector'}-${today()}.qsync`,'ADMIN','COLLECTION_BATCH',payload);
        const stamp=payload.meta.exportedAt;rows.forEach(p=>p.exportedAt=stamp);
        state.exports.unshift({id:uid('EXP'),date:today(),createdAt:stamp,count:rows.length,total:payload.meta.total,channel:'drive'});
        save();render();
      }
    }catch(error){alert(`تعذر تجهيز السندات للرفع: ${error.message||''}`)}
    QatraDriveSync.open();
  }

  function dayPayments(){ return state.payments.filter(p=>p.date===today()).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))); }

  function printDailyReport(){
    const list=dayPayments(); if(!list.length){alert('لا توجد تحصيلات اليوم.');return;}
    const rows=list.map((p,i)=>`<tr><td>${i+1}</td><td>${esc(p.receiptNo)}</td><td>${esc(p.meterNo||p.subscriberCode)}</td><td>${esc(p.subscriberName)}</td><td>${esc(p.method)}</td><td>${money(p.amount)}</td></tr>`).join('');
    const total=list.reduce((a,p)=>a+n(p.amount),0); const cash=list.filter(p=>p.method==='نقداً').reduce((a,p)=>a+n(p.amount),0); const transfer=total-cash;
    const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>@page{size:A4;margin:8mm}body{font-family:Tahoma,Arial,sans-serif;color:#000;padding-bottom:14mm}.head{text-align:center}.head img{width:24mm;height:24mm;object-fit:contain}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:10px 0}.summary div{border:1px solid #333;padding:7px;text-align:center}table{width:100%;border-collapse:collapse}th,td{border:1px solid #222;padding:6px;text-align:right;font-size:11px}th{background:#eef6fb}.sign{display:flex;justify-content:space-between;margin-top:28px}.qatra-print-brand{position:fixed;right:8mm;left:8mm;bottom:2mm;display:flex;align-items:center;justify-content:center;gap:2mm;margin:0;padding-top:1.5mm;border-top:1px solid #aaa;background:#fff;font-size:8px;color:#405665}.qatra-print-brand img{width:8mm;height:8mm;object-fit:contain}.qatra-print-brand span{display:flex;flex-direction:column}</style></head><body><div class="head"><img src="${esc(projectLogo())}"><h2>${esc(projectName())}</h2><h3>كشف تحصيل المحصل — ${esc(collectorName())}</h3><div>التاريخ: ${today()}</div></div><div class="summary"><div>عدد السندات<br><b>${list.length}</b></div><div>نقداً<br><b>${money(cash)}</b></div><div>تحويل<br><b>${money(transfer)}</b></div></div><table><thead><tr><th>م</th><th>رقم السند</th><th>رقم العداد</th><th>المشترك</th><th>الطريقة</th><th>المبلغ</th></tr></thead><tbody>${rows}<tr><th colspan="5">الإجمالي</th><th>${money(total)}</th></tr></tbody></table><div class="sign"><span>المحصل: ____________</span><span>المستلم في الصندوق: ____________</span></div>${marketingMark()}</body></html>`;
    callAndroid('printHtml','كشف تحصيل المحصل',html,'A4');
  }

  function exportDailyXlsx(){
    const list=dayPayments(); if(!list.length){alert('لا توجد تحصيلات اليوم.');return;}
    const rows=[['م','رقم السند','التاريخ','رقم العداد','اسم المشترك','الحي','طريقة الدفع','المبلغ','حالة التسليم']];
    list.forEach((p,i)=>rows.push([i+1,p.receiptNo,p.date,p.meterNo||p.subscriberCode,p.subscriberName,p.area||'',p.method,n(p.amount),p.exportedAt?'تم التسليم':'لم يُسلّم']));
    rows.push(['','','','','','','الإجمالي',list.reduce((a,p)=>a+n(p.amount),0),'']);
    if(!callAndroid('exportXlsx',`collector-collections-${today()}.xlsx`,'تحصيل المحصل',JSON.stringify(rows))){
      const csv='\uFEFF'+rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');download(`collector-collections-${today()}.csv`,csv,'text/csv;charset=utf-8');
    }
  }

  function exportBackup(){
    try{QatraBackup.export(`qatra-collector-backup-${today()}.qbackup`,'ROLE_BACKUP');}
    catch(e){alert(e.message);}
  }
  async function importBackup(ev,preInspected){
    const file=ev.target.files?.[0];if(!file)return;
    try{if(file.name.toLowerCase().endsWith('.json')){if(state.operationalStartedAt)throw new Error('تم بدء التشغيل الفعلي؛ ترحيل JSON غير المشفر معطل نهائيًا.');const data=JSON.parse(await file.text());if(data?.meta?.type!=='QATRA_COLLECTOR_BACKUP'||!data.state)throw new Error('نسخة JSON القديمة غير صالحة');if(!confirm('سيتم ترحيل نسخة المحصل القديمة إلى SQLite. متابعة؟'))return;state=data.state;save();render();alert('تم ترحيل نسخة JSON القديمة إلى SQLite بنجاح.');return}const inspected=preInspected||await QatraBackup.inspectFile(file);if(inspected.duplicate){alert(inspected.message);return}if(inspected.operationType!=='ROLE_BACKUP')throw new Error('ملف النسخة الاحتياطية غير صالح');const data=QatraBackup.state(inspected,'collector');if(!confirm('سيتم استبدال بيانات نسخة المحصل الحالية بالنسخة الاحتياطية. متابعة؟'))return;const started=state.operationalStartedAt;const restored={...data,operationalStartedAt:data.operationalStartedAt||started||null};QatraBackup.commit('collector',inspected,restored);if(QatraBackup.isPortable(inspected)){alert('تمت الاستعادة بعد التحقق من رمز الاستعادة. سيعاد تحميل التطبيق الآن.');location.reload()}else{state=restored;render();alert('تمت استعادة النسخة القديمة بنجاح.')}}catch(e){alert(e.message||'ملف النسخة الاحتياطية غير صالح.');}finally{ev.target.value='';}
  }

  function openSettings(){
    const activation=state.operationalStartedAt?`<div class="notice success"><b>التشغيل الفعلي مفعّل</b><br>${esc(state.operationalStartedAt)}. تم تعطيل مسح التشغيل وترحيل JSON غير المشفر.</div>`:`<div class="danger-zone"><h4>بدء نسخة محصل فارغة</h4><p>إجراء لمرة واحدة يمسح المستحقات والسندات التجريبية مع إبقاء الإعدادات.</p><button class="danger" onclick="Collector.confirmReset()">مسح التجريبي وبدء التشغيل</button></div>`;
    openModal('إعدادات نسخة المحصل', `<div class="notice success"><b>المستخدم المرتبط:</b> ${esc(collectorName())}<br><b>رمز السند:</b> ${esc(collectorCode())}<br><b>اسم المستخدم:</b> ${esc(state.assignment?.meta?.collectorUsername||'-')}</div><div class="form-row"><div class="field"><label>عرض الطابعة الحرارية</label><select id="settingsThermalWidth"><option value="58" ${state.preferences.thermalWidth==='58'?'selected':''}>58 مم</option><option value="80" ${state.preferences.thermalWidth==='80'?'selected':''}>80 مم</option></select></div></div><div class="field"><label><input id="settingsAutoPrint" type="checkbox" ${state.preferences.autoPrint?'checked':''}> طباعة السند الحراري تلقائيًا بعد الحفظ</label></div><p class="settings-note">هوية المحصل ورمز السند يصلان من ملف التكليف ولا يمكن تغييرهما من هذه النسخة.</p><div class="toolbar"><button class="green" onclick="Collector.saveSettings()">حفظ الإعدادات</button><button class="light" onclick="Collector.closeModal()">إلغاء</button></div>${activation}`);
  }

  function confirmReset(){
    if(state.operationalStartedAt){alert('تم بدء التشغيل الفعلي سابقًا؛ المسح معطل.');return;}
    openModal('تأكيد بدء التشغيل الفعلي', `<div class="notice warning"><b>تنبيه مهم</b><br>سيتم حذف المستحقات والسندات وسجل ملفات التسليم من هذه النسخة فقط.</div><div class="field"><label>للتأكيد اكتب: بدء فعلي</label><input id="resetPhrase" autocomplete="off" placeholder="بدء فعلي"></div><div class="toolbar"><button class="danger" onclick="Collector.resetOperationalData()">تنفيذ المسح</button><button class="light" onclick="Collector.closeModal()">إلغاء</button></div>`);
  }

  function resetOperationalData(){
    if(state.operationalStartedAt){alert('تم بدء التشغيل الفعلي سابقًا؛ المسح معطل.');return;}
    if(String($('#resetPhrase')?.value||'').trim()!=='بدء فعلي'){alert('عبارة التأكيد غير صحيحة.');return;}
    const prefs={...state.preferences};
    state=freshState();
    state.preferences={...state.preferences,...prefs};
    state.operationalStartedAt=nowIso();
    save();searchQuery='';receiptFilter='today';currentTab='home';closeModal();render();
    alert('تم مسح بيانات المحصل التجريبية وتثبيت بدء التشغيل الفعلي. لن يظهر خيار المسح مرة أخرى.');
  }
  function saveSettings(){
    state.preferences.thermalWidth=$('#settingsThermalWidth')?.value||'80';state.preferences.autoPrint=!!$('#settingsAutoPrint')?.checked;save();closeModal();render();
  }

  function openModal(title, html){
    $('#collectorModalTitle').textContent=title;$('#collectorModalBody').innerHTML=html;$('#collectorModal').hidden=false;document.body.style.overflow='hidden';
  }
  function closeModal(){ $('#collectorModal').hidden=true;document.body.style.overflow=''; }

  function handleAndroidBack(){ if(!$('#collectorModal')?.hidden){closeModal();return true;} if(currentTab!=='home'){switchTab('home');return true;} return false; }

  function init(){
    $$('.collector-nav button').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
    window.App={handleAndroidBack};
    render();
    QatraIncoming?.register?.({ASSIGN_COLLECTIONS:importDues,ROLE_BACKUP:importBackup});
  }

  document.addEventListener('DOMContentLoaded',init);
  return {switchTab,importDues,importClick,setSearch,setReceiptFilter,sendPaymentReminder,openPayment,updateBalancePreview,savePayment,previewThermalById,printThermalById,printPaperById,showSubscriberReceipts,exportNewPayments,exportAllPayments,openDriveSync,printDailyReport,exportDailyXlsx,exportBackup,importBackup,openSettings,saveSettings,confirmReset,resetOperationalData,closeModal,handleAndroidBack};
})();
