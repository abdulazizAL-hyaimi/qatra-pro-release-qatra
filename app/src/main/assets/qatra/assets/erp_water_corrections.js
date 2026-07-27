(function(){
'use strict';
const C=window.QatraWaterCore;if(!C)return;
const {$,$$,esc,num,money,iso,uid,save,notice,modal,closeModal,badge,dateText,state,session,nextNo,addHistory,canManage,has,ensure,call,register,layout}=C;
const canReview=()=>has('APPROVE_ACCOUNTING');
const terminal=status=>['CANCELLED','REVERSED','REJECTED'].includes(String(status||'').toUpperCase());

function targetRows(){
 const s=state(),rows=[];
 s.readings.filter(r=>String(r.status||'').toUpperCase()==='APPROVED'&&!s.invoices.some(i=>String(i.readingId||'')===String(r.id)&&!terminal(i.status))).forEach(r=>rows.push({
  type:'READING_CORRECTION',id:r.id,no:r.no||r.id,label:`قراءة ${r.no||r.id} — ${r.subscriberName||r.meterNo||''}`,current:num(r.current),previous:num(r.previous)
 }));
 s.invoices.filter(i=>!terminal(i.status)).forEach(i=>rows.push({
  type:'INVOICE_REVERSAL',id:i.id,no:i.no||i.id,label:`فاتورة ${i.no||i.id} — ${i.subscriber||i.subscriberName||''} — ${money(i.total||i.amount)}`
 }));
 s.payments.filter(p=>['SUBMITTED','APPROVED','PAID','CLOSED'].includes(String(p.status||'').toUpperCase())).forEach(p=>rows.push({
  type:'PAYMENT_REVERSAL',id:p.id,no:p.no||p.receiptNo||p.id,label:`سند قبض ${p.no||p.receiptNo||p.id} — ${money(p.amount)}`
 }));
 return rows;
}
function typeLabel(type){return{READING_CORRECTION:'تصحيح قراءة',INVOICE_REVERSAL:'عكس فاتورة',PAYMENT_REVERSAL:'إلغاء/عكس سند قبض'}[type]||type}
function targetLabel(request){
 const row=targetRows().find(x=>String(x.id)===String(request.targetId));
 return request.targetLabel||row?.label||request.targetNo||request.targetId||'—';
}
function statusText(status){return{SUBMITTED:'بانتظار محاسب مستقل',EXECUTED:'نُفّذ',REJECTED:'مرفوض'}[String(status||'').toUpperCase()]||status}

function render(){
 const s=state(),requests=s.correctionRequests.slice().sort((a,b)=>String(b.requestedAt||'').localeCompare(String(a.requestedAt||'')));
 const pending=requests.filter(r=>String(r.status).toUpperCase()==='SUBMITTED');
 const executed=requests.filter(r=>String(r.status).toUpperCase()==='EXECUTED');
 const rejected=requests.filter(r=>String(r.status).toUpperCase()==='REJECTED');
 layout(`<div class="water-hero"><div><small>Governed Corrections</small><h2>التصحيحات والإلغاءات المنضبطة</h2><p>لا يُحذف المستند الأصلي. ينشئ مدير الفوترة الطلب وينفذه محاسب مستقل بقيد عكسي عند الحاجة.</p></div>${canManage()?'<button class="erp-button" id="newCorrection">طلب تصحيح</button>':''}</div>
 <div class="water-kpis"><article><b>${pending.length}</b><span>بانتظار المراجعة</span></article><article><b>${executed.length}</b><span>منفذة</span></article><article><b>${rejected.length}</b><span>مرفوضة</span></article><article><b>${requests.length}</b><span>إجمالي الطلبات</span></article></div>
 <article class="erp-card"><div class="water-head"><div><h2>سجل الطلبات</h2><p>يبقى السبب والطالب والمراجع والقيد العكسي مرتبطين بالمستند.</p></div></div>
 <div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>الطلب</th><th>النوع والمستند</th><th>السبب</th><th>الطالب</th><th>الحالة</th><th>المراجعة</th></tr></thead><tbody id="correctionRows">${rows(requests)}</tbody></table></div></article>`);
 if($('#newCorrection'))$('#newCorrection').onclick=showRequest;
 bindActions();
}
function rows(requests){
 return requests.map(r=>{const own=String(r.requestedBy)===String(session().userId),pending=String(r.status).toUpperCase()==='SUBMITTED';return`<tr>
 <td><b>${esc(r.no||r.id)}</b><small>${dateText(r.requestedAt)}</small></td>
 <td><b>${esc(typeLabel(r.targetType))}</b><small>${esc(targetLabel(r))}</small>${r.reversalJournalId?`<small dir="ltr">${esc(r.reversalJournalId)}</small>`:''}</td>
 <td><span title="${esc(r.reason)}">${esc(String(r.reason||'').slice(0,90))}</span>${r.reviewNotes?`<small>ملاحظة المراجع: ${esc(r.reviewNotes)}</small>`:''}</td>
 <td><b dir="ltr">${esc(r.requestedByUsername||r.requestedBy||'—')}</b><small>${r.reviewedByUsername?`راجع: ${esc(r.reviewedByUsername)}`:''}</small></td>
 <td>${badge(r.status)}<small>${esc(statusText(r.status))}</small></td>
 <td><div class="erp-toolbar">${canReview()&&pending&&!own?`<button class="erp-button success small" data-correction-action="approve" data-id="${esc(r.id)}">اعتماد وتنفيذ</button><button class="erp-button danger small" data-correction-action="reject" data-id="${esc(r.id)}">رفض</button>`:pending&&own&&canReview()?'<small>يلزم مراجع آخر</small>':'—'}</div></td>
 </tr>`}).join('')||'<tr><td colspan="6" class="erp-empty">لا توجد طلبات تصحيح</td></tr>';
}
function bindActions(){
 $$('[data-correction-action]').forEach(button=>button.onclick=()=>review(button.dataset.id,button.dataset.correctionAction));
}
function showRequest(){
 try{
  const targets=targetRows();if(!targets.length)throw new Error('لا توجد مستندات مؤهلة للتصحيح حاليًا');
  modal('إنشاء طلب تصحيح',`<div class="erp-notice warning">لا يؤدي هذا الطلب إلى حذف المستند. يتطلب مراجعًا محاسبيًا مختلفًا عن مقدم الطلب.</div>
  <div class="erp-form-grid"><div class="erp-field full"><label>المستند المستهدف</label><select id="correctionTarget">${targets.map((x,i)=>`<option value="${esc(x.type)}|${esc(x.id)}" ${i===0?'selected':''}>${esc(x.label)}</option>`).join('')}</select></div>
  <div class="erp-field" id="replacementField"><label>القراءة الحالية البديلة</label><input id="replacementCurrent" type="number" min="0" step="0.01"></div>
  <div class="erp-field full"><label>سبب التصحيح التفصيلي</label><textarea id="correctionReason" rows="4" minlength="8" placeholder="اشرح سبب الخطأ والمستند المرجعي…"></textarea></div></div>
  <div class="erp-toolbar water-modal-actions"><button class="erp-button" id="submitCorrection">إرسال للمراجعة المحاسبية</button></div>`);
  const sync=()=>{const [type,id]=$('#correctionTarget').value.split('|'),row=targets.find(x=>x.type===type&&String(x.id)===id),reading=type==='READING_CORRECTION';$('#replacementField').hidden=!reading;if(reading)$('#replacementCurrent').value=row?.current??''};
  $('#correctionTarget').onchange=sync;sync();
  $('#submitCorrection').onclick=()=>{try{
   const [type,id]=$('#correctionTarget').value.split('|'),target=targets.find(x=>x.type===type&&String(x.id)===id);if(!target)throw new Error('المستند المستهدف غير صالح');
   const reason=$('#correctionReason').value.trim();if(reason.length<8)throw new Error('سبب التصحيح يجب ألا يقل عن 8 أحرف');
   if(state().correctionRequests.some(r=>String(r.targetId)===String(id)&&String(r.status).toUpperCase()==='SUBMITTED'))throw new Error('يوجد طلب تصحيح معلق لهذا المستند');
   const request={id:uid('COR'),no:nextNo('COR',state().correctionRequests),targetType:type,targetId:id,targetNo:target.no,targetLabel:target.label,reason,status:'SUBMITTED',requestedAt:iso(),requestedBy:session().userId,requestedByUsername:session().username};
   if(type==='READING_CORRECTION'){const replacement=num($('#replacementCurrent').value);if(replacement<target.previous)throw new Error('القراءة البديلة لا يمكن أن تقل عن السابقة');request.replacementCurrent=replacement}
   addHistory(request,'CORRECTION_REQUESTED',{targetType:type,targetId:id,reason});
   state().correctionRequests.push(request);save('تم إرسال طلب التصحيح إلى مراجع محاسبي مستقل');closeModal();render();
  }catch(error){notice(error.message,'error')}};
 }catch(error){notice(error.message,'error')}
}
function review(id,action){
 const request=state().correctionRequests.find(r=>String(r.id)===String(id));if(!request)return;
 if(action==='approve'){
  if(typeof confirm==='function'&&!confirm(`تنفيذ ${typeLabel(request.targetType)} للمستند ${request.targetNo||request.targetId}؟ سيُحفظ المستند الأصلي ويُنشأ قيد عكسي عند الحاجة.`))return;
  executeDecision(request,'APPROVE','');
  return;
 }
 modal('رفض طلب التصحيح',`<div class="erp-field"><label>سبب الرفض</label><textarea id="correctionReviewNotes" rows="4" minlength="5"></textarea></div><div class="erp-toolbar water-modal-actions"><button class="erp-button danger" id="confirmCorrectionReject">تأكيد الرفض</button></div>`);
 $('#confirmCorrectionReject').onclick=()=>{const notes=$('#correctionReviewNotes').value.trim();if(notes.length<5){notice('سبب الرفض يجب ألا يقل عن 5 أحرف','error');return}executeDecision(request,'REJECT',notes)};
}
function executeDecision(request,decision,notes){
 try{
  const result=call('decideBillingCorrection',request.id,decision,notes);
  if(!result.ok)throw new Error(result.error||'تعذر تنفيذ قرار التصحيح');
  closeModal();ensure();notice(result.message||'تم حفظ قرار المراجعة','success');render();
 }catch(error){notice(error.message,'error')}
}
register('corrections','التصحيحات والإلغاءات',()=>canManage()||canReview(),render);
})();