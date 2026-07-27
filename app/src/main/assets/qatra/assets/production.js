/* Qatra Pro Production Safety Layer v11
   طبقة حماية وتشغيل تجريبي لمشروع مياه الروضة: تدقيق الحسابات، سجل عمليات، منع الحذف، ومركز رسائل اختياري.
*/
(function(){
  const messageFilters={search:'',status:'all',group:'all'};
  function $(s){return document.querySelector(s)}
  function $all(s){return Array.from(document.querySelectorAll(s))}
  function safe(v){return String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}
  function now(){return new Date().toISOString()}
  function fmt(n){return Number(n||0).toLocaleString('en-US')}
  function state(){return window.YWP?.state}
  function ywp(){return window.YWP}
  function migrateProduction(){
    const st = state(); if(!st || !window.YWP) return;
    st.meta ||= {}; st.meta.productionVersion = 'Qatra Pro Production Safety v11'; st.meta.productionPreparedAt ||= now();
    st.settings ||= {};
    st.settings.currency = 'ريال يمني';
    st.settings.currencyShort = 'ر.ي';
    st.settings.currencyFull = 'ريال يمني';
    st.settings.productionMode = st.settings.productionMode !== false;
    st.settings.requireBackupBeforeImport = st.settings.requireBackupBeforeImport !== false;
    st.settings.requireReviewBeforeBulkSend = st.settings.requireReviewBeforeBulkSend !== false;
    st.settings.requireReasonForCorrections = st.settings.requireReasonForCorrections !== false;
    st.auditLog ||= [];
    st.messageLog ||= [];
    st.correctionLog ||= [];
    try{ window.YWP.save(); }catch(e){}
  }
  function audit(action, details={}){
    const st=state(); if(!st) return;
    st.auditLog ||= [];
    st.auditLog.unshift({id:(window.YWP?.uid?window.YWP.uid('AUD'):'AUD-'+Date.now()), at:now(), action, details});
    if(st.auditLog.length>3000) st.auditLog = st.auditLog.slice(0,3000);
    try{ window.YWP.save(); }catch(e){}
  }
  function logMessage(channel, inv, sub, text, mode){
    const st=state(); if(!st) return;
    st.messageLog ||= [];
    st.messageLog.unshift({id:window.YWP.uid('MSG'), at:now(), channel, mode, invoiceNo:inv?.no||'', subscriberId:sub?.id||'', subscriberCode:sub?.code||'', subscriberName:sub?.name||'', phone:sub?.phone||'', text});
    if(st.messageLog.length>5000) st.messageLog=st.messageLog.slice(0,5000);
    try{ window.YWP.save(); }catch(e){}
  }
  function validateAccounting(){
    migrateProduction();
    const st=state(); const Y=window.YWP; const issues=[]; if(!st||!Y) return {ok:false, issues:[['خطأ','لم يتم تحميل التطبيق']]};
    try{ Y.recomputeInvoiceStatuses(); }catch(e){ issues.push(['خطأ نظام','تعذر تحديث حالات الفواتير: '+e.message]); }
    const invoiceNos=new Set(), receiptNos=new Set(), paymentIds=new Set(), invoiceIds=new Set();
    st.invoices.forEach(inv=>{
      const sub=Y.subscriber(inv.subscriberId)||{};
      const con=Y.toNumber(inv.consumption);
      const prev=Y.toNumber(inv.prevReading);
      const cur=Y.toNumber(inv.currentReading);
      const tariff=Y.toNumber(inv.tariff || st.settings.tariff);
      const expected=con*tariff;
      const amount=Y.toNumber(inv.amount);
      if(invoiceIds.has(inv.id)) issues.push(['تكرار','معرّف فاتورة مكرر: '+inv.id]); else invoiceIds.add(inv.id);
      if(invoiceNos.has(inv.no)) issues.push(['تكرار','رقم فاتورة مكرر: '+inv.no]); else invoiceNos.add(inv.no);
      if(cur<prev) issues.push(['قراءة','القراءة الحالية أقل من السابقة للفاتورة '+inv.no+' / '+(sub.name||'')]);
      if(con!==cur-prev) issues.push(['حساب استهلاك','الفاتورة '+inv.no+' الاستهلاك لا يساوي الحالية - السابقة']);
      if(Math.round(expected)!==Math.round(amount)) issues.push(['قيمة الفاتورة','الفاتورة '+inv.no+' مبلغها '+amount+' والصحيح حسب التعرفة '+expected]);
      if(!sub.phone) issues.push(['هاتف','لا يوجد رقم هاتف للمشترك '+(sub.code||'')+' '+(sub.name||'')]);
      if((inv.remainingAmount||0)<0) issues.push(['رصيد','المتبقي من الفاتورة سالب في '+inv.no]);
    });
    st.payments.forEach(p=>{
      const sub=Y.subscriber(p.subscriberId)||{};
      if(paymentIds.has(p.id)) issues.push(['تكرار','معرّف سند مكرر: '+p.id]); else paymentIds.add(p.id);
      if(receiptNos.has(p.receiptNo)) issues.push(['تكرار','رقم سند قبض مكرر: '+p.receiptNo]); else receiptNos.add(p.receiptNo);
      if(Y.toNumber(p.amount)<=0) issues.push(['سند قبض','مبلغ سند قبض غير صحيح: '+(p.receiptNo||p.id)+' / '+(sub.name||'')]);
      if(!p.date) issues.push(['سند قبض','سند قبض بدون تاريخ: '+(p.receiptNo||p.id)]);
    });
    st.subscribers.forEach(s=>{
      const b=Y.balance(s.id);
      if(!Number.isFinite(b)) issues.push(['رصيد','رصيد غير قابل للحساب للمشترك '+(s.code||'')+' '+(s.name||'')]);
      const last=Y.lastReading(s.id);
      if(Y.toNumber(s.openingReading)<0 || Y.toNumber(last?.current)<0) issues.push(['قراءة','قراءة سالبة للمشترك '+(s.code||'')+' '+(s.name||'')]);
    });
    const ledger=window.QatraAccounting?.validateLedger?.(st);
    if(ledger&&!ledger.ok)ledger.errors.forEach(message=>issues.push(['القيد المزدوج',message]));
    const totals={
      subscribers: st.subscribers.length,
      invoices: st.invoices.length,
      payments: st.payments.length,
      invoiceAmount: st.invoices.reduce((a,i)=>a+Y.toNumber(i.amount),0),
      paidAmount: st.payments.reduce((a,p)=>a+Y.toNumber(p.amount),0),
      due: st.subscribers.reduce((a,s)=>a+Math.max(0,Y.balance(s.id)),0),
      credit: st.subscribers.reduce((a,s)=>a+Math.max(0,-Y.balance(s.id)),0),
      ledgerDifference: ledger?.difference||0,
      journalCount: ledger?.count||0,
      issues: issues.length
    };
    audit('ACCOUNTING_VALIDATION_RUN', {issues:issues.length, totals});
    return {ok:issues.length===0, issues, totals};
  }
  function exportAuditLog(){
    const st=state(); if(!st) return;
    const rows=[['التاريخ','العملية','التفاصيل']].concat((st.auditLog||[]).map(x=>[x.at,x.action,JSON.stringify(x.details||{})]));
    window.YWP.exportCSV('qatra-audit-log.csv', rows);
  }
  function exportMessageLog(){
    const st=state(); if(!st) return;
    const rows=[['التاريخ','القناة','الوضع','رقم الفاتورة','رقم المشترك','الاسم','الهاتف','النص']].concat((st.messageLog||[]).map(x=>[x.at,x.channel,x.mode,x.invoiceNo,x.subscriberCode,x.subscriberName,x.phone,x.text]));
    window.YWP.exportCSV('qatra-message-log.csv', rows);
  }
  function renderSafety(){
    migrateProduction();
    const el=$('#safety'); if(!el) return;
    const res=validateAccounting(); const st=state(); const Y=window.YWP;
    const rows=res.issues.slice(0,200).map((r,i)=>`<tr><td>${i+1}</td><td>${safe(r[0])}</td><td>${safe(r[1])}</td></tr>`).join('');
    el.innerHTML=`<div class="card"><h2>نسخة الأمان المحاسبي والقانوني - Production Safety</h2>
      <div class="notice ${res.ok?'success':'warn'}"><b>حالة الفحص:</b> ${res.ok?'لا توجد أخطاء حسابية ظاهرة في الفحص الحالي.':'توجد ملاحظات يجب مراجعتها قبل التشغيل الرسمي.'}<br>هذه النسخة تمنع الحذف المباشر للسندات والمصروفات عند تفعيل وضع التشغيل الرسمي، وتحتفظ بسجل تدقيق للعمليات.</div>
      <div class="stats"><div class="card stat"><div class="label">الفواتير</div><div class="num">${fmt(res.totals.invoices)}</div></div><div class="card stat green"><div class="label">إجمالي الفواتير</div><div class="num">${Y.money(res.totals.invoiceAmount)}</div></div><div class="card stat green"><div class="label">إجمالي السداد</div><div class="num">${Y.money(res.totals.paidAmount)}</div></div><div class="card stat red"><div class="label">الرصيد المتبقي عليكم</div><div class="num">${Y.money(res.totals.due)}</div></div><div class="card stat"><div class="label">الرصيد المقدم</div><div class="num">${Y.money(res.totals.credit)}</div></div><div class="card stat ${res.issues.length?'warn':'green'}"><div class="label">ملاحظات الفحص</div><div class="num">${fmt(res.issues.length)}</div></div></div>
      <div class="toolbar"><button onclick="QatraProduction.renderSafety()">إعادة الفحص</button><button class="secondary" onclick="QatraProduction.exportAccountingValidation()">تصدير تقرير الفحص CSV</button><button class="secondary" onclick="QatraProduction.exportAuditLog()">تصدير سجل التدقيق</button><button class="secondary" onclick="QatraProduction.exportMessageLog()">تصدير سجل الرسائل</button><button class="warn" onclick="QatraProduction.forceBackup()">نسخة احتياطية قبل التشغيل</button></div>
      <div class="notice"><b>تنبيه تشغيل رسمي:</b> اعمل شهر تشغيل تجريبي بالتوازي مع الكشوفات اليدوية، وبعد التطابق اعتمد التطبيق رسميًا. أي تعديل بعد الاعتماد يجب أن يكون بتصحيح موثق وليس حذفًا.</div>
      <h3>ملاحظات الفحص</h3><div class="table-wrap"><table><thead><tr><th>م</th><th>النوع</th><th>الملاحظة</th></tr></thead><tbody>${rows||'<tr><td colspan="3">لا توجد ملاحظات حالياً.</td></tr>'}</tbody></table></div>
      <h3>آخر عمليات التدقيق</h3><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>العملية</th><th>التفاصيل</th></tr></thead><tbody>${(st.auditLog||[]).slice(0,40).map(x=>`<tr><td>${safe(x.at)}</td><td>${safe(x.action)}</td><td class="ltr" style="direction:ltr;text-align:left">${safe(JSON.stringify(x.details||{}))}</td></tr>`).join('')||'<tr><td colspan="3">لا توجد عمليات بعد.</td></tr>'}</tbody></table></div>
    </div>`;
  }
  function exportAccountingValidation(){
    const res=validateAccounting();
    const rows=[['النوع','الملاحظة']].concat(res.issues);
    rows.push([]); rows.push(['ملخص','القيمة']);
    Object.entries(res.totals).forEach(([k,v])=>rows.push([k,v]));
    window.YWP.exportCSV('qatra-accounting-validation.csv', rows);
  }
  function forceBackup(){
    window.YWP.exportBackupFile('production-safety');
  }
  function filteredInvoices(){
    const st=state(); const Y=window.YWP; if(!st) return [];
    const status=messageFilters.status; const group=messageFilters.group; const q=messageFilters.search.trim();
    return st.invoices.filter(inv=>{
      const sub=Y.subscriber(inv.subscriberId)||{};
      const remaining=Y.toNumber(inv.remainingAmount);
      const sOk=status==='all'||(status==='due'&&remaining>0)||(status==='paid'&&remaining<=0)||(status==='partial'&&inv.status==='partial');
      const gOk=group==='all'||sub.readingGroup===group;
      const text=(sub.code+' '+sub.name+' '+sub.phone+' '+inv.no).toLowerCase();
      return sOk&&gOk&&(!q||text.includes(q.toLowerCase()));
    });
  }
  function renderMessages(){
    if(window.QatraBulkMessages?.render){window.QatraBulkMessages.render();return;}
    migrateProduction(); const el=$('#messages'); if(!el) return;
    if($('#msgSearch')) messageFilters.search=$('#msgSearch').value||'';
    if($('#msgStatus')) messageFilters.status=$('#msgStatus').value||'all';
    if($('#msgGroup')) messageFilters.group=$('#msgGroup').value||'all';
    const Y=window.YWP; const invs=filteredInvoices();
    el.innerHTML=`<div class="card"><h2>مركز الرسائل الاختيارية</h2><div class="notice success">يمكنك تحديد مشتركين معينين أو الإرسال لكل النتائج بعد الفلترة. قبل الإرسال تظهر رسالة تأكيد، ويتم حفظ سجل الرسائل.</div>
      <div class="form-row"><div class="field"><label>بحث</label><input id="msgSearch" oninput="QatraProduction.renderMessages()" value="${safe(messageFilters.search)}" placeholder="اسم/رقم/هاتف"></div><div class="field"><label>الحالة</label><select id="msgStatus" onchange="QatraProduction.renderMessages()"><option value="all" ${messageFilters.status==='all'?'selected':''}>الكل</option><option value="due" ${messageFilters.status==='due'?'selected':''}>غير مسدد/عليه رصيد</option><option value="partial" ${messageFilters.status==='partial'?'selected':''}>سداد جزئي</option><option value="paid" ${messageFilters.status==='paid'?'selected':''}>مسدد</option></select></div><div class="field"><label>الدورة</label><select id="msgGroup" onchange="QatraProduction.renderMessages()"><option value="all" ${messageFilters.group==='all'?'selected':''}>كل الدورات</option><option value="HALF" ${messageFilters.group==='HALF'?'selected':''}>نصف الشهر</option><option value="MONTHLY" ${messageFilters.group==='MONTHLY'?'selected':''}>نهاية الشهر فقط</option></select></div></div>
      <div class="toolbar"><button onclick="QatraProduction.selectMessageRows(true)">تحديد الكل الظاهر</button><button class="light" onclick="QatraProduction.selectMessageRows(false)">إلغاء التحديد</button><button class="secondary" onclick="QatraProduction.sendSelectedMessages('sms')">إرسال SMS للمحدد</button><button class="green" onclick="QatraProduction.sendSelectedMessages('whatsapp')">إرسال واتساب للمحدد</button><button class="warn" onclick="QatraProduction.sendAllFiltered('sms')">إرسال SMS لكل النتائج</button><button class="warn" onclick="QatraProduction.sendAllFiltered('whatsapp')">إرسال واتساب لكل النتائج</button></div>
      <div class="hint">عدد النتائج الحالية: ${fmt(invs.length)}. الإرسال الجماعي على الهاتف يمر عبر تطبيق الرسائل/واتساب حسب قيود نظام Android، وليس إرسالًا صامتًا مخفيًا.</div>
      <div class="table-wrap"><table><thead><tr><th><input type="checkbox" onchange="QatraProduction.selectMessageRows(this.checked)"></th><th>الفاتورة</th><th>المشترك</th><th>الهاتف</th><th>المتبقي</th><th>معاينة الرسالة</th></tr></thead><tbody>${invs.map(inv=>{const s=Y.subscriber(inv.subscriberId)||{}; const txt=Y.smsText(inv,'sms'); return `<tr><td><input class="msg-check" type="checkbox" value="${safe(inv.id)}"></td><td>${safe(inv.no)}</td><td>${safe(s.code)} - ${safe(s.name)}</td><td>${safe(s.phone)}</td><td>${Y.money(inv.remainingAmount||0)}</td><td><button class="mini light" onclick="QatraProduction.previewInvoiceMessage('${safe(inv.id)}')">معاينة</button></td></tr>`}).join('')||'<tr><td colspan="6">لا توجد فواتير حسب الفلترة الحالية.</td></tr>'}</tbody></table></div>
    </div>`;
  }
  function selectMessageRows(on){ $all('.msg-check').forEach(c=>c.checked=!!on); }
  function previewInvoiceMessage(id){ const inv=window.YWP.invoice(id); if(!inv)return; alert(window.YWP.smsText(inv,'sms')); }
  function selectedInvoiceIds(){ return $all('.msg-check:checked').map(x=>x.value); }
  function sendInvoiceList(ids, channel, mode){
    const Y=window.YWP; const list=ids.map(id=>Y.invoice(id)).filter(Boolean); if(!list.length){alert('لم يتم تحديد أي فاتورة.');return;}
    const missing=list.filter(inv=>!(Y.subscriber(inv.subscriberId)||{}).phone);
    if(missing.length){ alert('يوجد '+missing.length+' فاتورة بدون رقم هاتف. لن يتم إرسالها.'); }
    const ready=list.filter(inv=>(Y.subscriber(inv.subscriberId)||{}).phone);
    if(!ready.length) return;
    if(!confirm('سيتم تجهيز '+ready.length+' رسالة عبر '+(channel==='sms'?'SMS':'واتساب')+'. هل تريد المتابعة؟')) return;
    audit('BULK_MESSAGE_START',{channel, count:ready.length, mode});
    ready.forEach((inv,i)=>{
      const sub=Y.subscriber(inv.subscriberId)||{}; const text=Y.smsText(inv, channel==='whatsapp'?'whatsapp':'sms');
      logMessage(channel, inv, sub, text, mode);
      setTimeout(()=>{ channel==='whatsapp'?Y.openWhatsApp(sub.phone,text):Y.openSms(sub.phone,text); }, i*1200);
    });
  }
  function sendSelectedMessages(channel){ sendInvoiceList(selectedInvoiceIds(), channel, 'selected'); }
  function sendAllFiltered(channel){ sendInvoiceList(filteredInvoices().map(i=>i.id), channel, 'all-filtered'); }
  function wrapApp(){
    if(!window.App||!window.YWP||window.__qatraProductionWrapped) return; window.__qatraProductionWrapped=true;
    const wrap=(name, action)=>{ const old=window.App[name]; if(typeof old!=='function')return; window.App[name]=function(...args){ const before=JSON.stringify({payments:state()?.payments?.length, expenses:state()?.expenses?.length, invoices:state()?.invoices?.length}); const r=old.apply(this,args); audit(action,{args,before,after:{payments:state()?.payments?.length, expenses:state()?.expenses?.length, invoices:state()?.invoices?.length}}); setTimeout(()=>{renderSafety(); renderMessages();},200); return r; }; };
    wrap('savePayment','PAYMENT_CREATED'); wrap('saveExpense','EXPENSE_CREATED'); wrap('generateInvoices','INVOICES_GENERATED'); wrap('saveCycleReadings','READINGS_SAVED'); wrap('importBackup','IMPORT_BACKUP_REQUESTED'); wrap('mergeSyncData','SYNC_MERGED');
    const oldDP=window.App.deletePayment; if(typeof oldDP==='function') window.App.deletePayment=function(id){ if(state()?.settings?.productionMode!==false){ audit('DELETE_PAYMENT_BLOCKED',{id}); alert('وضع التشغيل الرسمي يمنع حذف سندات القبض. استخدم سند تصحيح/قيد عكسي مع سبب موثق.'); return; } return oldDP.apply(this,arguments); };
    const oldDE=window.App.deleteExpense; if(typeof oldDE==='function') window.App.deleteExpense=function(id){ if(state()?.settings?.productionMode!==false){ audit('DELETE_EXPENSE_BLOCKED',{id}); alert('وضع التشغيل الرسمي يمنع حذف المصروفات. استخدم قيد تصحيح مع سبب موثق.'); return; } return oldDE.apply(this,arguments); };
    const oldDS=window.App.deleteSubscriber; if(typeof oldDS==='function') window.App.deleteSubscriber=function(id){ if(state()?.settings?.productionMode!==false){ audit('DELETE_SUBSCRIBER_BLOCKED',{id}); alert('وضع التشغيل الرسمي يمنع حذف المشتركين. يمكن إيقاف المشترك بدل حذفه للحفاظ على السجل.'); return; } return oldDS.apply(this,arguments); };
  }
  window.QatraProduction={migrateProduction,audit,validateAccounting,renderSafety,renderMessages,selectMessageRows,previewInvoiceMessage,sendSelectedMessages,sendAllFiltered,exportAccountingValidation,exportAuditLog,exportMessageLog,forceBackup};
  document.addEventListener('DOMContentLoaded',()=>{ setTimeout(()=>{migrateProduction(); wrapApp(); renderSafety(); renderMessages(); audit('APP_OPEN_PRODUCTION_V11',{url:location.pathname});},350); });
})();
