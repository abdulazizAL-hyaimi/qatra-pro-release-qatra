/* Qatra Pro — subscriber messaging center driven only by saved Settings templates.
 * The app opens SMS/WhatsApp composers; delivery is confirmed manually because
 * Android does not report delivery from an external composer reliably.
 */
(function(){
  'use strict';
  const QUEUE_KEY='qatra_bulk_message_queue_v2';
  const GROUP_KEY='qatra_bulk_group_pending_v1';
  const DEFAULT_SMS='الأخ/ {name}، هذا إشعار من {project}. رقم المشترك: {subscriberCode}. رقم العداد: {meterNo}. الرصيد الحالي: {balance}.';
  const DEFAULT_WA='إشعار للمشترك\nالمشروع: {project}\nالاسم: {name}\nرقم المشترك: {subscriberCode}\nرقم العداد: {meterNo}\nالمنطقة: {area}\nالرصيد الحالي: {balance}';
  const PERSONAL_TOKENS=['name','subscriberName','subscriberCode','meterNo','area','phoneNumber','balance'];
  let queue=null;
  let groupPending=null;
  const historyFilters={from:'',to:'',query:'',status:'all',channel:'all'};

  const $=s=>document.querySelector(s);
  const esc=s=>window.YWP?YWP.esc(s):String(s||'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
  const state=()=>window.YWP&&YWP.state?YWP.state:{settings:{},subscribers:[],invoices:[],messageLog:[]};
  const settings=()=>state().settings||(state().settings={});
  const normalize=s=>String(s||'').trim().toLowerCase();
  const validPhone=sub=>window.YWP&&YWP.normalizePhone(sub?.phone||'');
  const allAreas=()=>Array.from(new Set(state().subscribers.map(s=>String(s.area||'').trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'ar'));
  const fill=(template,fields)=>String(template||'').replace(/\{([a-zA-Z0-9_]+)\}/g,(m,k)=>Object.prototype.hasOwnProperty.call(fields,k)?fields[k]:m);
  const latestInvoice=sub=>state().invoices.filter(i=>i.subscriberId===sub.id).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0]||null;

  function ensureSettings(){
    const st=settings();
    if(!st.generalSmsTemplate)st.generalSmsTemplate=st.bulkMessageTemplate||DEFAULT_SMS;
    if(!st.generalWhatsappTemplate)st.generalWhatsappTemplate=st.bulkMessageTemplate||DEFAULT_WA;
    if(!['sms','whatsapp'].includes(st.bulkDefaultChannel))st.bulkDefaultChannel='sms';
    if(!['group','personalized'].includes(st.bulkDefaultMode))st.bulkDefaultMode='personalized';
    if(!['general','invoice'].includes(st.bulkDefaultTemplateKind))st.bulkDefaultTemplateKind='general';
    return st;
  }

  function genericFields(sub){
    const st=ensureSettings(),balance=window.YWP?YWP.balance(sub.id):0;
    return {
      project:st.projectName||'Qatra Pro',owner:st.ownerName||'',phone:st.projectPhone1||'',whatsapp:st.projectWhatsApp||'',
      address:st.projectAddress||'',accountNo:st.projectAccountNo||'',currencyShort:st.currencyShort||'ر.ي',
      name:sub.name||'',subscriberName:sub.name||'',subscriberCode:sub.code||'',meterNo:sub.meterNo||'',area:sub.area||'',phoneNumber:sub.phone||'',
      balance:balance>0?YWP.money(balance)+' عليكم':balance<0?YWP.money(Math.abs(balance))+' رصيد مقدم':'صفر'
    };
  }

  function templateFor(ch=channel(),kind=templateKind()){
    const st=ensureSettings();
    if(kind==='invoice')return ch==='whatsapp'?(st.invoiceWhatsappTemplate||st.invoiceSmsTemplate||''):(st.invoiceSmsTemplate||'');
    return ch==='whatsapp'?(st.generalWhatsappTemplate||DEFAULT_WA):(st.generalSmsTemplate||DEFAULT_SMS);
  }
  function personalizedText(sub,ch=channel(),kind=templateKind()){
    if(kind==='invoice'&&window.YWP){const inv=latestInvoice(sub);if(inv)return YWP.smsText(inv,ch);}
    return fill(templateFor(ch,'general'),genericFields(sub));
  }
  function channel(){return $('#bulkChannel')?.value||ensureSettings().bulkDefaultChannel||'sms';}
  function sendMode(){return $('#bulkSendMode')?.value||ensureSettings().bulkDefaultMode||'personalized';}
  function templateKind(){return $('#bulkTemplateKind')?.value||ensureSettings().bulkDefaultTemplateKind||'general';}
  function templateLabel(ch=channel(),kind=templateKind()){return kind==='invoice'?`قالب آخر فاتورة — ${ch==='whatsapp'?'واتساب':'SMS'}`:`قالب الرسالة العامة — ${ch==='whatsapp'?'واتساب':'SMS'}`;}

  function selectedAudience(){
    const audience=$('#bulkAudience')?.value||'active',query=normalize($('#bulkSearch')?.value),area=$('#bulkArea')?.value||'',single=$('#bulkSingleSubscriber')?.value||'',from=$('#bulkInvoiceFrom')?.value||'',to=$('#bulkInvoiceTo')?.value||'';
    let rows=state().subscribers.slice();
    if(audience==='active')rows=rows.filter(s=>s.status!=='stopped');
    else if(audience==='due')rows=rows.filter(s=>s.status!=='stopped'&&YWP.balance(s.id)>0);
    else if(audience==='credit')rows=rows.filter(s=>s.status!=='stopped'&&YWP.balance(s.id)<0);
    else if(audience==='half')rows=rows.filter(s=>s.status!=='stopped'&&s.readingGroup==='HALF');
    else if(audience==='monthly')rows=rows.filter(s=>s.status!=='stopped'&&s.readingGroup!=='HALF');
    else if(audience==='stopped')rows=rows.filter(s=>s.status==='stopped');
    else if(audience==='area')rows=rows.filter(s=>s.status!=='stopped'&&String(s.area||'')===area);
    else if(audience==='single')rows=rows.filter(s=>s.id===single);
    if(query)rows=rows.filter(s=>normalize([s.code,s.name,s.phone,s.area,s.address,s.meterNo].join(' ')).includes(query));
    if(from||to)rows=rows.filter(s=>{const date=String(latestInvoice(s)?.date||'');return date&&(!from||date>=from)&&(!to||date<=to);});
    return rows;
  }
  function summary(){const rows=selectedAudience(),valid=rows.filter(validPhone);return {rows,valid,invalidRows:rows.filter(s=>!validPhone(s))};}

  function history(){
    const st=state();st.messageLog=Array.isArray(st.messageLog)?st.messageLog:[];
    if(!st.meta?.bulkMessageHistoryMigrated&&Array.isArray(settings().bulkMessageHistory)){
      settings().bulkMessageHistory.forEach(h=>st.messageLog.push({id:YWP.uid('MSG'),at:h.at||new Date().toISOString(),channel:h.channel||'',mode:'legacy',subscriberName:h.subscriber||'',status:/فشل|تخطي/.test(h.status||'')?'failed':'pending',failureReason:h.status||''}));
      st.meta=st.meta||{};st.meta.bulkMessageHistoryMigrated=true;
    }
    return st.messageLog;
  }
  function addHistory(item){
    const row={id:YWP.uid('MSG'),at:new Date().toISOString(),channel:item.channel||'',mode:item.mode||'',templateKind:item.templateKind||'',invoiceNo:item.invoiceNo||'',subscriberId:item.subscriberId||'',subscriberCode:item.subscriberCode||'',subscriberName:item.subscriberName||'',phone:item.phone||'',text:item.text||'',status:item.status||'pending',failureReason:item.failureReason||''};
    history().unshift(row);state().messageLog=history().slice(0,5000);YWP.save();renderHistory();return row.id;
  }
  function updateHistory(id,status,failureReason=''){
    const row=history().find(x=>x.id===id);if(!row)return;
    row.status=status;row.failureReason=failureReason;row.updatedAt=new Date().toISOString();YWP.save();renderHistory();
  }
  function recordInvalid(rows,ch,mode){rows.forEach(sub=>addHistory({channel:ch==='whatsapp'?'WhatsApp':'SMS',mode,templateKind:templateKind(),subscriberId:sub.id,subscriberCode:sub.code,subscriberName:sub.name,phone:sub.phone,status:'failed',failureReason:'رقم الهاتف مفقود أو غير صالح'}));}
  function statusText(row){return row.status==='sent'?'مرسلة — مؤكدة يدويًا':row.status==='failed'?'فاشلة':'بانتظار التأكيد';}
  function modeText(mode){return mode==='group'?'جماعي':mode==='single'?'فردي':'مخصص';}

  function render(){
    const host=$('#messages');if(!host)return;
    const st=ensureSettings(),subscribers=state().subscribers.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ar'));
    host.innerHTML=`<div class="bulk-message-shell">
      <section class="bulk-message-hero"><div><span class="bulk-kicker">QATRA PRO COMMUNICATION CENTER</span><h1>مركز رسائل المشتركين</h1><p>اختيار المستلمين والقناة وطريقة الإرسال، بينما يؤخذ النص حصراً من القوالب المحفوظة في الإعدادات.</p></div><span class="bulk-message-hero-icon">✉</span></section>
      <div class="grid two bulk-message-grid">
        <article class="card bulk-card"><h2>1. اختيار المستلمين</h2><div class="form-row">
          <div class="field"><label>الفئة</label><select id="bulkAudience" onchange="QatraBulkMessages.refreshSummary()"><option value="active">جميع المشتركين النشطين</option><option value="all">كل المشتركين</option><option value="due">المشتركون الذين عليهم رصيد</option><option value="credit">أصحاب الرصيد المقدم</option><option value="half">مجموعة نصف الشهر</option><option value="monthly">مجموعة نهاية الشهر</option><option value="area">حسب المنطقة</option><option value="single">مشترك واحد</option><option value="stopped">المشتركون الموقوفون</option></select></div>
          <div class="field"><label>المنطقة</label><select id="bulkArea" onchange="QatraBulkMessages.refreshSummary()"><option value="">اختر المنطقة</option>${allAreas().map(a=>`<option>${esc(a)}</option>`).join('')}</select></div>
          <div class="field"><label>مشترك محدد</label><select id="bulkSingleSubscriber" onchange="QatraBulkMessages.refreshSummary()"><option value="">اختر المشترك</option>${subscribers.map(s=>`<option value="${esc(s.id)}">${esc(s.code)} — ${esc(s.name)}</option>`).join('')}</select></div>
          <div class="field"><label>من تاريخ آخر فاتورة</label><input id="bulkInvoiceFrom" type="date" onchange="QatraBulkMessages.refreshSummary()"></div>
          <div class="field"><label>إلى تاريخ آخر فاتورة</label><input id="bulkInvoiceTo" type="date" onchange="QatraBulkMessages.refreshSummary()"></div>
          <div class="field bulk-recipient-search"><label>بحث بالاسم أو الهاتف أو العنوان</label><input id="bulkSearch" placeholder="الاسم، الرقم، الهاتف، العنوان أو العداد" oninput="QatraBulkMessages.refreshSummary()"></div>
        </div><div id="bulkAudienceSummary" class="bulk-summary"></div></article>
        <article class="card bulk-card"><h2>2. إعداد الإرسال</h2><div class="form-row">
          <div class="field"><label>قناة الإرسال</label><select id="bulkChannel" onchange="QatraBulkMessages.refreshDelivery()"><option value="sms" ${st.bulkDefaultChannel==='sms'?'selected':''}>SMS</option><option value="whatsapp" ${st.bulkDefaultChannel==='whatsapp'?'selected':''}>واتساب</option></select></div>
          <div class="field"><label>القالب المحفوظ</label><select id="bulkTemplateKind" onchange="QatraBulkMessages.refreshDelivery()"><option value="general" ${st.bulkDefaultTemplateKind==='general'?'selected':''}>رسالة عامة</option><option value="invoice" ${st.bulkDefaultTemplateKind==='invoice'?'selected':''}>آخر فاتورة</option></select></div>
          <div class="field"><label>طريقة الإرسال</label><select id="bulkSendMode" onchange="QatraBulkMessages.refreshDelivery()"><option value="personalized" ${st.bulkDefaultMode==='personalized'?'selected':''}>مخصص لكل مشترك</option><option value="group" ${st.bulkDefaultMode==='group'?'selected':''}>جماعي</option></select></div>
        </div><div id="bulkTemplateSource" class="bulk-template-source"></div><div class="notice">لتعديل النص افتح <b>الإعدادات ← إعدادات الرسائل والقوالب المعتمدة</b>. لا يوجد مربع كتابة في مركز الرسائل حتى لا يُستبدل القالب المعتمد بالخطأ.</div><div class="toolbar"><button class="light" onclick="QatraBulkMessages.preview()">معاينة أول 5 رسائل</button><button class="secondary" onclick="App.switchTab('settings')">فتح إعدادات القوالب</button></div></article>
      </div>
      <article class="card bulk-card bulk-actions-card"><h2>3. التنفيذ</h2><div class="notice warning">يفتح قطرة برو تطبيق SMS أو واتساب للمراجعة. سجل «مرسلة» يعتمد على تأكيدك اليدوي بعد العودة، أما الرقم غير الصالح أو التخطي فيظهر ضمن «فاشلة».</div><div class="bulk-action-grid"><button class="bulk-action queue" onclick="QatraBulkMessages.startDelivery()"><b>بدء الإرسال حسب الإعداد</b><small>جماعي أو مخصص، وبالقالب والقناة المختارين أعلاه</small></button></div><div id="bulkQueuePanel"></div></article>
      <section id="bulkHistoryPanel"></section>
      <div id="bulkPreviewModal" class="bulk-preview" hidden><div class="bulk-preview-backdrop" onclick="QatraBulkMessages.closePreview()"></div><div class="bulk-preview-card"><header><h3>معاينة القالب المحفوظ</h3><button onclick="QatraBulkMessages.closePreview()">إغلاق</button></header><div id="bulkPreviewBody"></div></div></div>
    </div>`;
    restoreQueue();refreshSummary();refreshDelivery();renderQueue();renderHistory();
  }

  function refreshSummary(){const box=$('#bulkAudienceSummary');if(!box)return;const s=summary();box.innerHTML=`<div><strong>${s.rows.length}</strong><span>إجمالي المحددين</span></div><div class="ok"><strong>${s.valid.length}</strong><span>لديهم رقم صالح</span></div><div class="bad"><strong>${s.invalidRows.length}</strong><span>سيسجلون كفاشلة</span></div>`;}
  function refreshDelivery(){
    const box=$('#bulkTemplateSource');if(!box)return;
    const kind=templateKind(),ch=channel(),mode=sendMode();
    box.innerHTML=`<span>القالب المعتمد</span><b>${esc(templateLabel(ch,kind))}</b><small>${mode==='group'?'إرسال جماعي':'رسالة مخصصة لكل مشترك'}${kind==='invoice'?'؛ ومن لا يملك فاتورة يستخدم القالب العام للقناة نفسها.':''}</small>`;
  }
  function preview(){const s=summary();if(!s.valid.length){alert('لا توجد أرقام صالحة ضمن الفئة المحددة.');return;}const ch=channel(),kind=templateKind();$('#bulkPreviewBody').innerHTML=s.valid.slice(0,5).map((sub,i)=>`<article><header><b>${i+1}. ${esc(sub.name)}</b><span>${esc(validPhone(sub))}</span></header><pre>${esc(personalizedText(sub,ch,kind))}</pre></article>`).join('')+`<p class="hint">القالب: ${esc(templateLabel(ch,kind))}. الإجمالي ${s.valid.length}، والأرقام غير الصالحة ${s.invalidRows.length}.</p>`;$('#bulkPreviewModal').hidden=false;}
  function closePreview(){const modal=$('#bulkPreviewModal');if(modal)modal.hidden=true;}

  function startDelivery(){
    const s=summary(),ch=channel(),mode=sendMode(),kind=templateKind();
    recordInvalid(s.invalidRows,ch,mode);
    if(!s.valid.length){alert('لا توجد أرقام صالحة ضمن الفئة المحددة. تم تسجيل الأرقام غير الصالحة في كشف الفاشلة.');return;}
    if(mode==='group'&&ch==='sms'&&kind==='general'&&!PERSONAL_TOKENS.some(t=>templateFor(ch,kind).includes('{'+t+'}'))){sendGroupSms(s);return;}
    if(mode==='group'&&ch==='sms')alert('القالب المختار يحتوي بيانات شخصية أو بيانات فاتورة؛ لذلك سيُنفذ جماعيًا بالتتابع حتى يحصل كل مشترك على بياناته الصحيحة.');
    if(mode==='group'&&ch==='whatsapp')alert('واتساب لا يتيح فتح مجموعة مستلمين من رابط واحد؛ سيُفتح كل مشترك بالتتابع مع الحفاظ على وضع الإرسال الجماعي.');
    startQueue(s.valid,ch,kind,mode);
  }
  function sendGroupSms(s){
    const phones=s.valid.slice(0,50).map(validPhone),text=fill(templateFor('sms','general'),genericFields({id:'',name:'',code:'',phone:'',area:'',meterNo:''}));
    if(s.valid.length>50&&!confirm(`سيتم فتح أول 50 رقمًا الآن من أصل ${s.valid.length}. متابعة؟`))return;
    if(!confirm(`سيتم فتح تطبيق SMS برسالة موحدة إلى ${phones.length} مستلمًا. متابعة؟`))return;
    const id=addHistory({channel:'SMS',mode:'group',templateKind:'general',subscriberName:`مجموعة (${phones.length})`,phone:phones.join(';'),text,status:'pending'});
    groupPending={historyId:id,count:phones.length};persistQueue();renderQueue();window.location.href='sms:'+phones.join(';')+'?body='+encodeURIComponent(text);
  }
  function confirmGroup(status){if(!groupPending)return;updateHistory(groupPending.historyId,status,status==='failed'?'تعذر إرسال الدفعة أو أُلغي الإرسال':'');groupPending=null;persistQueue();renderQueue();}

  function startQueue(valid,ch,kind,mode){queue={ids:valid.map(x=>x.id),index:0,channel:ch,templateKind:kind,mode,logIds:{},startedAt:new Date().toISOString()};persistQueue();renderQueue();openCurrent();}
  function restoreQueue(){try{const raw=sessionStorage.getItem(QUEUE_KEY),group=sessionStorage.getItem(GROUP_KEY);queue=raw?JSON.parse(raw):queue;groupPending=group?JSON.parse(group):groupPending;}catch(e){queue=null;groupPending=null;}}
  function persistQueue(){if(queue)sessionStorage.setItem(QUEUE_KEY,JSON.stringify(queue));else sessionStorage.removeItem(QUEUE_KEY);if(groupPending)sessionStorage.setItem(GROUP_KEY,JSON.stringify(groupPending));else sessionStorage.removeItem(GROUP_KEY);}
  function currentSubscriber(){if(!queue)return null;return state().subscribers.find(s=>s.id===queue.ids[queue.index])||null;}
  function renderQueue(){
    const host=$('#bulkQueuePanel');if(!host)return;
    if(groupPending){host.innerHTML=`<div class="bulk-queue"><div class="bulk-current"><strong>دفعة SMS جماعية — ${groupPending.count} مستلمًا</strong><span>اختر النتيجة بعد الرجوع من تطبيق الرسائل</span></div><div class="toolbar"><button class="green" onclick="QatraBulkMessages.confirmGroup('sent')">تم إرسال الدفعة</button><button class="red" onclick="QatraBulkMessages.confirmGroup('failed')">فشل / إلغاء الإرسال</button></div></div>`;return;}
    if(!queue||queue.index>=queue.ids.length){host.innerHTML='';return;}
    const sub=currentSubscriber();host.innerHTML=`<div class="bulk-queue"><div class="bulk-queue-progress"><b>${queue.index+1} / ${queue.ids.length}</b><span>اختر نتيجة الرسالة الحالية قبل الانتقال</span><div><i style="width:${Math.round(((queue.index+1)/queue.ids.length)*100)}%"></i></div></div><div class="bulk-current"><strong>${esc(sub?.code||'')} — ${esc(sub?.name||'')}</strong><span>${esc(validPhone(sub||{}))}</span></div><div class="toolbar"><button class="light" onclick="QatraBulkMessages.openCurrent()">فتح الرسالة الحالية</button><button class="green" onclick="QatraBulkMessages.markSent()">تم الإرسال — التالي</button><button class="red" onclick="QatraBulkMessages.markFailed()">فشل الإرسال — التالي</button><button class="warn" onclick="QatraBulkMessages.skip()">تخطي</button><button class="secondary" onclick="QatraBulkMessages.stopQueue()">إيقاف القائمة</button></div></div>`;
  }
  function currentLogId(sub,text){
    queue.logIds=queue.logIds||{};if(queue.logIds[sub.id])return queue.logIds[sub.id];
    const inv=queue.templateKind==='invoice'?latestInvoice(sub):null;
    const id=addHistory({channel:queue.channel==='whatsapp'?'WhatsApp':'SMS',mode:queue.mode,templateKind:queue.templateKind,invoiceNo:inv?.no||'',subscriberId:sub.id,subscriberCode:sub.code,subscriberName:sub.name,phone:sub.phone,text,status:'pending'});queue.logIds[sub.id]=id;persistQueue();return id;
  }
  function openCurrent(){const sub=currentSubscriber();if(!sub){finishQueue();return;}const text=personalizedText(sub,queue.channel,queue.templateKind);currentLogId(sub,text);if(queue.channel==='whatsapp')YWP.openWhatsApp(sub.phone,text);else YWP.openSms(sub.phone,text);}
  function markSent(){const sub=currentSubscriber();if(sub)updateHistory(currentLogId(sub,personalizedText(sub,queue.channel,queue.templateKind)),'sent');advanceQueue();}
  function markFailed(){const sub=currentSubscriber();if(sub)updateHistory(currentLogId(sub,personalizedText(sub,queue.channel,queue.templateKind)),'failed','أكد المستخدم فشل الإرسال');advanceQueue();}
  function skip(){const sub=currentSubscriber();if(sub)updateHistory(currentLogId(sub,personalizedText(sub,queue.channel,queue.templateKind)),'failed','تم التخطي دون إرسال');advanceQueue();}
  function advanceQueue(){if(!queue)return;queue.index++;if(queue.index>=queue.ids.length){finishQueue();return;}persistQueue();renderQueue();openCurrent();}
  function finishQueue(){const total=queue?.ids?.length||0;queue=null;persistQueue();renderQueue();alert(`اكتملت قائمة الإرسال (${total} مستلمًا). راجع كشف المرسلة والفاشلة أدناه.`);}
  function stopQueue(){if(!queue)return;if(confirm('إيقاف قائمة الإرسال الحالية؟ ستبقى الرسائل المفتوحة دون تأكيد بحالة «بانتظار التأكيد».')){queue=null;persistQueue();renderQueue();}}

  function historyDate(row){const d=new Date(row?.at||row?.updatedAt||'');return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);}
  function filteredHistory(){
    const query=normalize(historyFilters.query);
    return history().filter(row=>{const date=historyDate(row),sub=state().subscribers.find(s=>s.id===row.subscriberId)||{};if(historyFilters.from&&date<historyFilters.from)return false;if(historyFilters.to&&date>historyFilters.to)return false;if(historyFilters.status!=='all'&&(historyFilters.status==='pending'?!['sent','failed'].includes(row.status):row.status!==historyFilters.status))return false;if(historyFilters.channel!=='all'&&normalize(row.channel)!==historyFilters.channel)return false;return !query||normalize([row.subscriberName,row.subscriberCode,row.phone,sub.name,sub.phone,sub.area,sub.address].join(' ')).includes(query);});
  }
  function applyHistoryFilters(){historyFilters.from=$('#messageHistoryFrom')?.value||'';historyFilters.to=$('#messageHistoryTo')?.value||'';historyFilters.query=$('#messageHistoryQuery')?.value||'';historyFilters.status=$('#messageHistoryStatus')?.value||'all';historyFilters.channel=$('#messageHistoryChannel')?.value||'all';renderHistory();}
  function clearHistoryFilters(){Object.assign(historyFilters,{from:'',to:'',query:'',status:'all',channel:'all'});renderHistory();}
  function renderHistory(){
    const host=$('#bulkHistoryPanel');if(!host)return;const all=history(),rows=filteredHistory(),sent=rows.filter(x=>x.status==='sent').length,failed=rows.filter(x=>x.status==='failed').length,pending=rows.filter(x=>!['sent','failed'].includes(x.status)).length;
    host.innerHTML=`<article class="card bulk-card bulk-history-card"><div class="bulk-history-head"><div><h2>كشف الرسائل المرسلة والفاشلة</h2><p>فلترة حسب تاريخ العملية، اسم المشترك، الهاتف، العنوان، القناة والحالة.</p></div><button class="secondary" onclick="QatraBulkMessages.exportHistory()">تصدير النتائج Excel</button></div><section class="message-history-filters"><div class="field"><label>من تاريخ</label><input id="messageHistoryFrom" type="date" value="${esc(historyFilters.from)}"></div><div class="field"><label>إلى تاريخ</label><input id="messageHistoryTo" type="date" value="${esc(historyFilters.to)}"></div><div class="field message-history-search"><label>بحث بالاسم أو الهاتف أو العنوان</label><input id="messageHistoryQuery" value="${esc(historyFilters.query)}" placeholder="اسم المشترك، رقم الهاتف أو العنوان"></div><div class="field"><label>الحالة</label><select id="messageHistoryStatus"><option value="all" ${historyFilters.status==='all'?'selected':''}>كل الحالات</option><option value="sent" ${historyFilters.status==='sent'?'selected':''}>مرسلة</option><option value="failed" ${historyFilters.status==='failed'?'selected':''}>فاشلة</option><option value="pending" ${historyFilters.status==='pending'?'selected':''}>بانتظار التأكيد</option></select></div><div class="field"><label>القناة</label><select id="messageHistoryChannel"><option value="all" ${historyFilters.channel==='all'?'selected':''}>SMS وواتساب</option><option value="sms" ${historyFilters.channel==='sms'?'selected':''}>SMS</option><option value="whatsapp" ${historyFilters.channel==='whatsapp'?'selected':''}>واتساب</option></select></div><button onclick="QatraBulkMessages.applyHistoryFilters()">تطبيق الفلاتر</button><button class="light" onclick="QatraBulkMessages.clearHistoryFilters()">مسح</button></section><div class="bulk-log-stats"><div class="sent"><b>${sent}</b><span>مرسلة</span></div><div class="failed"><b>${failed}</b><span>فاشلة</span></div><div class="pending"><b>${pending}</b><span>بانتظار التأكيد</span></div></div><div class="message-history-count">عرض ${rows.length} من أصل ${all.length} عملية</div><div class="table-wrap"><table class="message-history-table"><thead><tr><th>الوقت</th><th>القناة</th><th>الطريقة</th><th>المشترك</th><th>الهاتف</th><th>العنوان</th><th>الحالة</th><th>سبب الفشل</th></tr></thead><tbody>${rows.length?rows.slice(0,250).map(h=>{const sub=state().subscribers.find(s=>s.id===h.subscriberId)||{};return `<tr class="message-log-${esc(h.status||'pending')}"><td>${esc(new Date(h.at).toLocaleString('ar-YE'))}</td><td>${esc(h.channel)}</td><td>${esc(modeText(h.mode))}</td><td>${esc(h.subscriberName||h.subscriber||sub.name||'—')}</td><td>${esc(h.phone||sub.phone||'—')}</td><td>${esc(sub.address||sub.area||'—')}</td><td>${esc(statusText(h))}</td><td>${esc(h.failureReason||'—')}</td></tr>`;}).join(''):'<tr><td colspan="8">لا توجد عمليات مطابقة للفلاتر الحالية.</td></tr>'}</tbody></table></div></article>`;
  }
  function exportHistory(){const rows=[['الوقت','القناة','الطريقة','نوع القالب','رقم المشترك','اسم المشترك','الهاتف','العنوان','الحالة','سبب الفشل']].concat(filteredHistory().map(h=>{const sub=state().subscribers.find(s=>s.id===h.subscriberId)||{};return [h.at,h.channel,modeText(h.mode),h.templateKind||'',h.subscriberCode||sub.code||'',h.subscriberName||sub.name||'',h.phone||sub.phone||'',sub.address||sub.area||'',statusText(h),h.failureReason||''];}));YWP.exportCSV('message-delivery-log-filtered.csv',rows);}

  function claimCenter(){if(window.QatraProduction)QatraProduction.renderMessages=render;}
  function install(){
    if(!window.App||!window.YWP)return;
    const originalSwitch=App.switchTab;App.switchTab=function(id){const result=originalSwitch.apply(this,arguments);if(id==='messages')render();return result;};
    window.addEventListener('focus',()=>{if(document.body?.dataset?.activeTab==='messages'){restoreQueue();renderQueue();renderHistory();}});
    setTimeout(claimCenter,750);
  }

  window.QatraBulkMessages={render,refreshSummary,refreshDelivery,preview,closePreview,startDelivery,sendGroupSms,startQueue,openCurrent,markSent,markFailed,skip,stopQueue,confirmGroup,renderHistory,applyHistoryFilters,clearHistoryFilters,exportHistory,templateFor,personalizedText,__test:{templateFor,personalizedText,history,filteredHistory,statusText}};
  install();
})();
