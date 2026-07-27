/* Qatra Pro - Manager/Collector synchronization
   Multiple collectors, explicit assignments and collector-specific receipt prefixes.
*/
const QATRA_MANAGER_KEY = 'qatra_pro_v6_editable_cycles_from_gray_excel';
const QATRA_COLLECTOR_ASSIGN_KEY = 'qatra_pro_collector_single_v71';
const QATRA_MANAGER_BACKUPS = 'qatra_pro_local_backups_v1';

const MC = (() => {
  const $ = s => document.querySelector(s);
  const today = () => new Date().toISOString().slice(0,10);
  const uid = (p='ID') => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  const money = n => Number(n||0).toLocaleString('en-US') + ' ر.ي';
  const num = n => Number(n||0).toLocaleString('en-US');
  const toNumber = v => { const n=Number(String(v??'').replace(/,/g,'')); return Number.isFinite(n)?n:0; };
  const esc = s => String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function emptyAdmin(){return{meta:{version:'2.0.0-secure'},settings:{projectName:'قطرة برو'},subscribers:[],cycles:[],readings:[],invoices:[],payments:[],expenses:[]}}
  function loadState(){ try{return QatraStore.load('admin',emptyAdmin,[QATRA_MANAGER_KEY]);}catch(e){return null;} }
  function periodClosed(st,date){return !!st?.accounting?.closedPeriods?.some(p=>p.month===String(date||today()).slice(0,7)&&!p.reopenedAt)}
  function saveState(st){ QatraStore.save('admin', st); }
  function loadConfig(){
    try{
      const c = QatraStore.load('admin.collector.config',()=>({version:'2.0.0',assignments:{},issuedAssignments:[]}),[QATRA_COLLECTOR_ASSIGN_KEY]);
      return {version:'2.0.0',assignments:c&&typeof c.assignments==='object'&&c.assignments?c.assignments:{},issuedAssignments:Array.isArray(c?.issuedAssignments)?c.issuedAssignments:[]};
    }catch(e){}
    return {version:'2.0.0',assignments:{},issuedAssignments:[]};
  }
  function saveConfig(c){ QatraStore.save('admin.collector.config', c); }
  function backupState(st, source='before-collector-import'){
    try{
      const box = QatraStore.load('admin.backups',()=>({items:[],lastAutoDate:''}));
      const list = box.items || [];
      list.unshift({id:uid('BKP'),source,createdAt:new Date().toISOString(),filename:`qatra-pro-${source}-${today()}.json`,payload:st});
      box.items = list.slice(0,3); QatraStore.save('admin.backups',box);
    }catch(e){}
  }
  function download(filename, content, type='application/json;charset=utf-8'){
    if(window.AndroidBridge && typeof AndroidBridge.saveFile === 'function'){
      AndroidBridge.saveFile(String(filename), String(content), String(type));
      return;
    }
    const blob=new Blob([content],{type}); const a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download=filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  function printHtml(title, body, page='A4'){
    const st=loadState()||{},logo=st.settings?.projectLogo||'assets/qatra-pro-mark.svg';
    const css=`<style>@page{size:${page};margin:8mm}body{direction:rtl;font-family:Tahoma,Arial,sans-serif;color:#000;background:#fff;padding-bottom:14mm}h2,h3{text-align:center;margin:4px 0 8px}.print-logo{display:block;width:24mm;height:24mm;object-fit:contain;margin:0 auto 2mm}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #111;padding:5px;text-align:right}th{background:#eef6fb}.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0}.box{border:1px solid #111;padding:6px}.sig{display:flex;justify-content:space-between;margin-top:30px}.footer{text-align:center;margin-top:14px;font-size:10px}.qatra-print-brand{position:fixed;right:8mm;left:8mm;bottom:2mm;display:flex;align-items:center;justify-content:center;gap:2mm;margin:0;padding-top:1.5mm;border-top:1px solid #bbb;background:#fff;font-size:8px;color:#405665}.qatra-print-brand img{width:8mm;height:8mm;object-fit:contain}.qatra-print-brand span{display:flex;flex-direction:column}</style>`;
    const brand=`<div class="qatra-print-brand"><img src="assets/qatra-pro-mark.svg"><span><b>QATRA PRO</b><small>نظام قطرة برو لإدارة خدمات المياه</small></span></div>`;
    const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>${css}</head><body><img class="print-logo" src="${esc(logo)}" alt="شعار المشروع">${body}${brand}</body></html>`;
    if(window.AndroidBridge && typeof AndroidBridge.printHtml === 'function'){
      AndroidBridge.printHtml(String(title), html, String(page));
      return;
    }
    const w=window.open('','_blank');
    if(!w){alert('تعذر فتح نافذة الطباعة');return;}
    w.document.write(html.replace('</body>','<script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body>')); w.document.close();
  }
  function openingNet(s){ return toNumber(s?.openingArrears ?? Math.max(0,toNumber(s?.openingBalance))) - toNumber(s?.openingCredit ?? Math.max(0,-toNumber(s?.openingBalance))); }
  function balance(st, subId){
    const s = st.subscribers.find(x=>x.id===subId) || {};
    let bal = openingNet(s);
    st.invoices.filter(i=>i.subscriberId===subId).forEach(i=> bal += toNumber(i.amount));
    st.payments.filter(p=>p.subscriberId===subId && (p.incomeType||'WATER')==='WATER' && p.confirmed!==false).forEach(p=> bal -= toNumber(p.amount));
    return bal;
  }
  function invoiceAllocation(st, subId){
    const s = st.subscribers.find(x=>x.id===subId) || {};
    const invs = st.invoices.filter(i=>i.subscriberId===subId).sort((a,b)=>((a.date||'')+(a.no||'')).localeCompare((b.date||'')+(b.no||'')));
    const opening = openingNet(s);
    const totalPayments = st.payments.filter(p=>p.subscriberId===subId && (p.incomeType||'WATER')==='WATER' && p.confirmed!==false).reduce((a,p)=>a+toNumber(p.amount),0);
    let available = totalPayments + Math.max(0, -opening);
    available = Math.max(0, available - Math.max(0, opening));
    const map = {};
    invs.forEach(inv=>{
      const amount = Math.max(0, toNumber(inv.amount));
      const paid = Math.min(available, amount);
      available = Math.max(0, available - paid);
      const remaining = Math.max(0, amount - paid);
      map[inv.id] = {paid, remaining, status: remaining <= 0 ? 'paid' : (paid > 0 ? 'partial' : 'due')};
    });
    return map;
  }
  function recompute(st){
    const ids=[...new Set(st.invoices.map(i=>i.subscriberId))];
    ids.forEach(subId=>{
      const map=invoiceAllocation(st,subId);
      st.invoices.filter(i=>i.subscriberId===subId).forEach(inv=>{
        const inf=map[inv.id] || {paid:0,remaining:toNumber(inv.amount),status:'due'};
        inv.paidAmount=inf.paid; inv.remainingAmount=inf.remaining; inv.status=inf.status; inv.totalDue=balance(st,subId);
      });
    });
    return st;
  }
  function lastInvoice(st, subId){ return st.invoices.filter(i=>i.subscriberId===subId).sort((a,b)=>(b.date||'').localeCompare(a.date||'') || String(b.no||'').localeCompare(String(a.no||'')))[0] || null; }
  function dueRows(st){
    return (st.subscribers||[]).filter(s=>s.status !== 'stopped').map(s=>{
      const due=Math.max(0,balance(st,s.id)); const inv=lastInvoice(st,s.id);
      return {s,due,inv};
    }).filter(x=>x.due>0).sort((a,b)=>String(a.s.code||'').localeCompare(String(b.s.code||''), 'ar'));
  }
  function receiptMessage(st, p){
    const s=(st.subscribers||[]).find(x=>x.id===p.subscriberId)||{}; const b=balance(st,p.subscriberId);
    return `الأخ/ ${s.name||''}\nتم استلام مبلغ ${num(p.amount)} ر.ي.\nرقم السند: ${p.receiptNo}\nالتاريخ: ${p.date}\nالرصيد بعد السداد: ${b>0?num(b)+' ر.ي عليكم':b<0?num(Math.abs(b))+' ر.ي لكم':'صفر'}\n${st.settings?.projectName||'Qatra Pro'}`;
  }
  function normalizePhone(phone){ let p=String(phone||'').replace(/[^0-9+]/g,'').replace(/^\+/,''); if(p.startsWith('00'))p=p.slice(2); if(p.startsWith('0'))p='967'+p.slice(1); return p; }
  function smsLink(phone,text){ return `sms:${normalizePhone(phone)}?body=${encodeURIComponent(text)}`; }
  function waLink(phone,text){ return `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text)}`; }
  let lastImported = [];

  function activeCollectors(){return QatraStaff.activeByRole('COLLECTOR')}
  function assignedRows(st,cfg,collectorId){return dueRows(st).filter(x=>String(cfg.assignments[x.s.id]||'')===String(collectorId))}
  function collectorOptions(collectors,selected){return `<option value="">غير مكلّف</option>`+collectors.map(c=>`<option value="${esc(c.id)}" ${String(c.id)===String(selected)?'selected':''}>${esc(c.code)} — ${esc(c.name)}</option>`).join('')}
  function render(){
    const root=$('#managerCollectorsRoot'),st=loadState(),cfg=loadConfig(),collectors=activeCollectors();
    if(!st||!Array.isArray(st.subscribers)){root.innerHTML='<h2>لا توجد بيانات رئيسية على هذا الجهاز</h2><div class="notice danger-box">افتح النسخة الرئيسية أو استورد نسخة الإدارة أولًا.</div>';return}
    recompute(st);saveState(st);const dues=dueRows(st),totalDue=dues.reduce((a,x)=>a+x.due,0),activeIds=new Set(collectors.map(c=>c.id)),unassigned=dues.filter(x=>!activeIds.has(cfg.assignments[x.s.id])).length;
    const stats=collectors.map(c=>{const rows=assignedRows(st,cfg,c.id),total=rows.reduce((a,x)=>a+x.due,0);return`<div class="card stat"><div class="label">${esc(c.code)} — ${esc(c.name)}</div><div class="num">${rows.length}</div><div>${money(total)}</div><div class="toolbar"><button class="mini green" onclick="MC.exportCollector('${encodeURIComponent(c.id)}')">ملف التكليف</button><button class="mini secondary" onclick="MC.printDuesSheet('${encodeURIComponent(c.id)}')">طباعة</button><button class="mini light" onclick="MC.exportDuesCSV('${encodeURIComponent(c.id)}')">Excel</button></div></div>`}).join('');
    const rows=dues.map((x,i)=>`<tr data-search="${esc((x.s.code+' '+x.s.name+' '+x.s.phone+' '+x.s.area).toLowerCase())}"><td>${i+1}</td><td>${esc(x.s.code)}</td><td>${esc(x.s.name)}</td><td>${esc(x.s.area)}</td><td>${esc(x.s.phone)}</td><td>${x.inv?esc(x.inv.no):'-'}</td><td class="money positive">${money(x.due)}</td><td><select data-sub-assignment="${esc(x.s.id)}">${collectorOptions(collectors,cfg.assignments[x.s.id])}</select></td></tr>`).join('');
    root.innerHTML=`<div class="workflow-steps"><div><b>1</b><span>أنشئ محصلًا نشطًا</span></div><div><b>2</b><span>وزّع المستحقات</span></div><div><b>3</b><span>صدّر ملف التكليف</span></div><div><b>4</b><span>استورد سندات التحصيل</span></div></div><h2>إدارة المحصلين والتكليفات</h2><div class="notice success">كل محصل يحصل على ملفه المشفر فقط، وتبدأ سنداته برمز الحرفين الفريد المسجل في إدارة المستخدمين.</div>${collectors.length?'':`<div class="notice warning">أضف محصلًا نشطًا من <a href="manager_users.html">إدارة المستخدمين والصلاحيات</a> أولًا.</div>`}<div class="grid cards"><div class="card stat green"><div class="label">إجمالي المستحقات</div><div class="num">${dues.length}</div><div>${money(totalDue)}</div></div><div class="card stat warn"><div class="label">غير موزع</div><div class="num">${unassigned}</div></div>${stats}</div><div class="card"><h3>توزيع المشتركين</h3><div class="toolbar"><button class="green" onclick="MC.saveAssignments()">حفظ التوزيع</button><button class="secondary" onclick="MC.autoSplit()">توزيع تلقائي متوازن</button></div><div class="form-row"><div class="field"><label>بحث</label><input id="collectorSearch" oninput="MC.filterRows()" placeholder="الاسم أو الرقم أو الحي"></div></div><div class="table-wrap"><table id="duesTable"><thead><tr><th>م</th><th>رقم</th><th>الاسم</th><th>الحي</th><th>الهاتف</th><th>آخر فاتورة</th><th>المستحق</th><th>المحصل</th></tr></thead><tbody>${rows}</tbody></table></div></div><div class="card"><h3>استيراد تحصيلات المحصل</h3><div class="notice warning">يُقبل الملف فقط إذا طابق محصلًا مسجلًا وتكليفًا صادرًا له ورمز سنداته.</div><label class="file-btn">استيراد ملف التحصيلات المشفر<input type="file" accept=".qsync,application/octet-stream" onchange="MC.importCollectorPayments(event)"></label><div id="importResult"></div></div>`;
  }
  function saveCollectorNames(){render()}
  function saveAssignments(renderAfter=true){const cfg=loadConfig();document.querySelectorAll('[data-sub-assignment]').forEach(el=>{const id=el.dataset.subAssignment,value=el.value;if(value)cfg.assignments[id]=value;else delete cfg.assignments[id]});saveConfig(cfg);if(renderAfter)render()}
  function autoSplit(){const collectors=activeCollectors();if(!collectors.length){alert('أضف محصلًا نشطًا أولًا.');return}const st=loadState(),cfg=loadConfig();dueRows(st).forEach((x,i)=>cfg.assignments[x.s.id]=collectors[i%collectors.length].id);saveConfig(cfg);render()}
  function filterRows(){ const q=($('#collectorSearch')?.value||'').trim().toLowerCase(); document.querySelectorAll('#duesTable tbody tr').forEach(tr=>{ tr.style.display = !q || tr.dataset.search.includes(q) ? '' : 'none'; }); }
  function buildFile(collectorId){
    const st=loadState(),cfg=loadConfig(),collector=QatraStaff.find(collectorId);if(!collector||collector.role!=='COLLECTOR'||!collector.active)throw new Error('المحصل غير موجود أو موقوف');
    const rows=assignedRows(st,cfg,collector.id),assignmentId=uid('CASG');
    return {meta:{type:'QATRA_COLLECTOR_DUES',version:'8.0',id:assignmentId,assignmentId,exportedAt:new Date().toISOString(),date:today(),projectName:st.settings?.projectName||'Qatra Pro',collectorId:collector.id,collectorName:collector.name,collectorUsername:collector.username,collectorCode:collector.code,permissions:collector.permissions,notes:'تكليف تحصيل خاص بهذا المحصل.'},settings:{projectName:st.settings?.projectName||'Qatra Pro',projectLogo:st.settings?.projectLogo||'',projectPhone1:st.settings?.projectPhone1||'',projectWhatsApp:st.settings?.projectWhatsApp||'',projectAddress:st.settings?.projectAddress||'',receiptTitle:st.settings?.receiptTitle||'سند قبض',receiptFooter:st.settings?.receiptFooter||'هذا السند صادر من المشروع.',receiptThermalWidth:st.settings?.receiptThermalWidth||'58'},subscribers:rows.map(x=>({subscriberId:x.s.id,code:x.s.code,name:x.s.name,phone:x.s.phone,area:x.s.area,meterNo:x.s.meterNo,due:x.due,lastInvoiceNo:x.inv?.no||'',lastInvoiceDate:x.inv?.date||'',lastReading:x.inv?.currentReading??x.s.openingReading??0,invoiceRemaining:x.inv?.remainingAmount??0,totalDue:x.due})),payments:[]};
  }
  function exportCollector(encoded){
    saveAssignments(false);const id=decodeURIComponent(encoded),c=QatraStaff.find(id);let file;try{file=buildFile(id)}catch(e){alert(e.message);return}
    if(!file.subscribers.length){alert('لا توجد مستحقات مكلفة لهذا المحصل. استخدم «التوزيع التلقائي» أو اختره من جدول المشتركين ثم احفظ.'); return;}
    const filename=`qatra-pro-dues-${c.code}-${today()}.qsync`;
    try{QatraSync.export(filename,'COLLECTOR','ASSIGN_COLLECTIONS',file,event=>{const cfg=loadConfig();cfg.issuedAssignments.unshift({id:file.meta.assignmentId,collectorId:c.id,collectorCode:c.code,subscriberIds:file.subscribers.map(s=>s.subscriberId),createdAt:file.meta.exportedAt});cfg.issuedAssignments=cfg.issuedAssignments.slice(0,100);saveConfig(cfg);alert(`تم حفظ تكليف ${c.name}.\nالمسار: ${event?.location||'Downloads/QatraPro/Admin'}\nعدد المشتركين: ${file.subscribers.length}\nاسم الدخول: ${c.username}`)},event=>alert(event?.error||'تعذر حفظ الملف ولم يُعتمد التكليف.'))}catch(e){alert(e.message)}
  }
  function exportAllDues(){alert('صدّر ملف كل محصل من بطاقته لضمان تسليمه للجهاز الصحيح.')}
  function printDuesSheet(encoded){
    const id=decodeURIComponent(encoded||''),st=loadState(),cfg=loadConfig(),c=QatraStaff.find(id);if(!st||!c)return;const rows=assignedRows(st,cfg,id);
    if(!rows.length){alert('لا توجد مستحقات حالية للطباعة');return;}
    const total=rows.reduce((a,x)=>a+x.due,0);
    const trs=rows.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.s.code)}</td><td>${esc(x.s.name)}</td><td>${esc(x.s.area)}</td><td>${esc(x.s.phone)}</td><td>${esc(x.inv?.no||'-')}</td><td>${money(x.due)}</td><td></td><td></td></tr>`).join('');
    const body=`<h2>${esc(st.settings?.projectName||'قطرة برو')}</h2><h3>كشف مستحقات المحصل - ${esc(c.name||'المحصل')}</h3><div class="meta"><div class="box">التاريخ: ${today()}</div><div class="box">عدد المشتركين: ${rows.length} | الإجمالي: ${money(total)}</div></div><table><thead><tr><th>م</th><th>رقم</th><th>المشترك</th><th>الحي</th><th>الهاتف</th><th>آخر فاتورة</th><th>المستحق</th><th>المبلغ المحصل</th><th>التوقيع</th></tr></thead><tbody>${trs}</tbody></table><div class="sig"><span>المحصل: __________</span><span>المحاسب: __________</span></div><div class="footer">العملة: ريال يمني (ر.ي)</div>`;
    printHtml('كشف مستحقات المحصل',body,'A4');
  }
  function exportDuesCSV(encoded){
    const id=decodeURIComponent(encoded||''),st=loadState(),cfg=loadConfig(),c=QatraStaff.find(id);if(!st||!c)return;const rows=assignedRows(st,cfg,id);
    if(!rows.length){alert('لا توجد مستحقات حالية للتصدير');return;}
    const data=[['م','رقم المشترك','الاسم','الحي','الهاتف','آخر فاتورة','الرصيد المتبقي عليكم ر.ي']].concat(rows.map((x,i)=>[i+1,x.s.code,x.s.name,x.s.area,x.s.phone,x.inv?.no||'',x.due]));
    if(window.AndroidBridge && typeof AndroidBridge.exportXlsx==='function'){
      AndroidBridge.exportXlsx(`collector-dues-${c.code}-${today()}.xlsx`,`مستحقات ${c.name}`,JSON.stringify(data));
      return;
    }
    const xe=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const body=data.map((r,i)=>`<Row>${r.map(c=>`<Cell${i===0?' ss:StyleID="H"':''}><Data ss:Type="String">${xe(c)}</Data></Cell>`).join('')}</Row>`).join('');
    const xml=`<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default"><Alignment ss:Horizontal="Right"/><Font ss:FontName="Tahoma"/></Style><Style ss:ID="H"><Font ss:Bold="1"/></Style></Styles><Worksheet ss:Name="مستحقات المحصل"><Table>${body}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/></WorksheetOptions></Worksheet></Workbook>`;
    download(`collector-dues-${c.code}-${today()}.xls`,'\uFEFF'+xml,'application/vnd.ms-excel');
  }
  async function importCollectorPayments(ev){
    const file=ev.target.files[0]; if(!file)return;
    try{
      const inspected=await QatraSync.inspectFile(file); if(inspected.duplicate){alert(inspected.message);return}
      if(inspected.operationType!=='COLLECTION_BATCH')throw new Error('نوع عملية المزامنة غير صحيح');
      const data=inspected.payload;if(data.meta?.type!=='QATRA_COLLECTOR_PAYMENTS'||!Array.isArray(data.payments))throw new Error('محتوى التحصيلات غير صالح');
      const cfg=loadConfig(),collector=QatraStaff.find(data.meta.collectorId),issued=cfg.issuedAssignments.find(x=>x.id===data.meta.assignmentId);
      if(!collector||collector.role!=='COLLECTOR')throw new Error('المحصل غير مسجل في النظام');
      if(collector.code!==data.meta.collectorCode)throw new Error('رمز المحصل لا يطابق السجل');
      if(!issued||issued.collectorId!==collector.id||issued.collectorCode!==collector.code)throw new Error('ملف التحصيل لا يرتبط بتكليف صادر من هذه الإدارة');
      const allowedSubscribers=new Set(issued.subscriberIds||[]),st=loadState(),locked=data.payments.find(p=>periodClosed(st,p.date||today()));if(locked)throw new Error(`الفترة ${String(locked.date||today()).slice(0,7)} مقفلة محاسبياً. أعد فتحها من شاشة المحاسبة قبل الاستيراد.`);backupState(JSON.parse(JSON.stringify(st)),'before-collector-import');
      let added=0, skipped=0; lastImported=[];
      data.payments.forEach(p=>{
        const syncId=p.syncId||p.id||p.receiptNo,receipt=String(p.receiptNo||'');const exists=(st.payments||[]).some(x=>x.externalSyncId===syncId||x.receiptNo===receipt);
        if(exists){ skipped++; return; }
        const sub=(st.subscribers||[]).find(s=>s.id===p.subscriberId || s.code===p.subscriberCode);
        const validReceipt=new RegExp(`^${collector.code}-[0-9]{8}-[0-9]{4,}$`).test(receipt);
        if(!sub||!allowedSubscribers.has(sub.id)||!validReceipt||p.collectorId!==collector.id||p.collectorCode!==collector.code||p.assignmentId!==issued.id){skipped++;return}
        const obj={id:uid('PAY-COL'),receiptNo:receipt,subscriberId:sub.id,invoiceId:null,date:p.date||today(),amount:toNumber(p.amount),method:p.method||'نقداً',collector:collector.name,collectorId:collector.id,collectorCode:collector.code,assignmentId:issued.id,note:p.note||'ترحيل من نسخة المحصل',createdAt:p.createdAt||new Date().toISOString(),source:'collector-app',incomeType:'WATER',confirmed:true,externalSyncId:syncId};
        if(obj.amount>0){ st.payments.push(obj); added++; lastImported.push(obj); }
      });
      recompute(st);QatraSync.commit('admin',inspected,st);render();renderImportResult(st,added,skipped,collector.name);
    }catch(e){ alert(e.message||'ملف غير صالح. يجب اختيار ملف تحصيلات صادر من نسخة المحصل.'); }
    finally{ev.target.value=''}
  }
  function renderImportResult(st, added, skipped, collectorName){
    const rows=lastImported.map(p=>{ const s=st.subscribers.find(x=>x.id===p.subscriberId)||{}; const msg=receiptMessage(st,p); return `<tr><td>${esc(p.receiptNo)}</td><td>${esc(s.code)}</td><td>${esc(s.name)}</td><td>${money(p.amount)}</td><td><a class="file-btn mini" href="${smsLink(s.phone,msg)}">SMS</a> <a class="file-btn mini" target="_blank" href="${waLink(s.phone,msg)}">واتساب</a></td></tr>`; }).join('');
    const el=$('#importResult'); if(!el)return;
    el.innerHTML=`<div class="notice success">تم استيراد ${added} سند من ${esc(collectorName)}. تم تجاهل ${skipped} سند مكرر/غير مطابق.</div>${rows?`<h4>إشعارات السداد للمشتركين</h4><div class="table-wrap"><table><thead><tr><th>السند</th><th>رقم</th><th>المشترك</th><th>المبلغ</th><th>إرسال من نسخة النظام</th></tr></thead><tbody>${rows}</tbody></table></div>`:''}`;
  }
  document.addEventListener('DOMContentLoaded',()=>{render();QatraIncoming?.register?.({COLLECTION_BATCH:(ev)=>MC.importCollectorPayments(ev)})});
  return {render,saveCollectorNames,saveAssignments,autoSplit,filterRows,exportCollector,exportAllDues,printDuesSheet,exportDuesCSV,importCollectorPayments};
})();
