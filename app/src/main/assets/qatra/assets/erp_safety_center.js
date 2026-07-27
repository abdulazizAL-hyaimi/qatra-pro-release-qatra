(function(){
'use strict';
const C=window.QatraWaterCore;if(!C)return;
const {$,$$,esc,num,money,iso,today,uid,notice,modal,closeModal,dateText,state,session,has,call,register,layout}=C;
const canManage=()=>has('MANAGE_SETTINGS');
let CORE=null,RECOVERY=null;

function load(){
 const core=call('getState','erp.core');if(!core.ok)throw new Error(core.error||'تعذر تحميل سجل القبول');
 CORE=core.found&&core.payload?core.payload:{};
 if(!Array.isArray(CORE.trialChecks))CORE.trialChecks=[];
 const recovery=call('getRecoveryStatus');if(!recovery.ok)throw new Error(recovery.error||'تعذر فحص قاعدة البيانات');
 RECOVERY=recovery;return CORE;
}
function saveCore(message){
 const result=call('saveState','erp.core',JSON.stringify(CORE));if(!result.ok)throw new Error(result.error||'تعذر حفظ سجل القبول');
 notice(message,'success');
}
function activeChecks(){
 const byDate=new Map();
 CORE.trialChecks.slice().sort((a,b)=>String(a.recordedAt||'').localeCompare(String(b.recordedAt||''))).forEach(x=>{if(String(x.status).toUpperCase()!=='SUPERSEDED')byDate.set(x.date,x)});
 return [...byDate.values()].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
function systemTotals(date){
 const billing=state();
 const invoices=billing.invoices.filter(x=>String(x.invoiceDate||x.date||'').slice(0,10)===date&&!['CANCELLED','REVERSED','REJECTED'].includes(String(x.status||'').toUpperCase()));
 const payments=billing.payments.filter(x=>String(x.paymentDate||x.date||x.createdAt||'').slice(0,10)===date&&['APPROVED','PAID','CLOSED'].includes(String(x.status||'').toUpperCase()));
 return{invoiceCount:invoices.length,invoiceTotal:invoices.reduce((sum,x)=>sum+num(x.total||x.amount),0),paymentCount:payments.length,paymentTotal:payments.reduce((sum,x)=>sum+num(x.amount),0)};
}
function readiness(checks){
 const matched=checks.filter(x=>String(x.result).toUpperCase()==='MATCHED').length;
 const variances=checks.filter(x=>String(x.result).toUpperCase()==='VARIANCE').length;
 return{matched,variances,days:checks.length,ready:checks.length>=30&&variances===0};
}
function stamp(value){return value?dateText(value):'لم يُسجل'}
function render(){
 try{
  load();const checks=activeChecks(),ready=readiness(checks),integrity=String(RECOVERY.integrity||'unknown').toLowerCase();
  layout(`<div class="water-hero"><div><small>Recovery & Trial Acceptance</small><h2>مركز التعافي والقبول التجريبي</h2><p>نسخ مشفّر واستعادة بلقطة رجوع، مع مطابقة يومية لمدة 30 يومًا قبل اعتماد التشغيل الحقيقي.</p></div><button class="erp-button secondary" id="safetyRefresh">تحديث الفحص</button></div>
  <div class="water-kpis"><article><b class="${integrity==='ok'?'':'danger-text'}">${esc(RECOVERY.integrity||'—')}</b><span>سلامة SQLite</span></article><article><b>${ready.days}/30</b><span>أيام المطابقة المسجلة</span></article><article><b>${ready.variances}</b><span>أيام بفروقات</span></article><article><b>${ready.ready?'جاهز مبدئيًا':'غير جاهز'}</b><span>قرار القبول التجريبي</span></article></div>
  <div class="water-two"><article class="erp-card"><div class="water-head"><div><h2>النسخ والتعافي</h2><p>النسخة تشمل نطاقات ERP التشغيلية والمحاسبية. الحسابات وكلمات المرور تبقى مستقلة.</p></div></div>
  <div class="water-payment-summary"><span>آخر نسخة محفوظة <b>${stamp(RECOVERY.lastBackupAt)}</b></span><span>آخر استعادة <b>${stamp(RECOVERY.lastRestoreAt)}</b></span><span>لقطات الرجوع <b>${num(RECOVERY.recoverySnapshots)}</b></span></div>
  <div class="erp-toolbar">${canManage()?'<button class="erp-button" id="createErpBackup">إنشاء نسخة مشفرة</button><button class="erp-button warning" id="restoreErpBackup">استعادة نسخة</button>':''}${canManage()&&RECOVERY.rollbackAvailable?'<button class="erp-button danger" id="rollbackErpRestore">تراجع عن آخر استعادة</button>':''}</div>
  <div class="erp-notice warning">لا تغني النسخة الاحتياطية عن تجربة الشهر الموازي، ولا تجعل النسخة الحالية جاهزة للإنتاج قبل نجاح APK والاختبار الميداني.</div></article>
  <article class="erp-card"><div class="water-head"><div><h2>المطابقة اليومية</h2><p>قارن الفواتير والتحصيل في النظام بالسجل اليدوي لليوم نفسه.</p></div>${canManage()?'<button class="erp-button" id="newTrialCheck">تسجيل مطابقة</button>':''}</div>
  <div class="water-cash-card"><span>أيام متطابقة <b>${ready.matched}</b></span><span>أيام بفروقات <b>${ready.variances}</b></span><span>المتبقي للحد الأدنى <b>${Math.max(0,30-ready.days)}</b></span></div></article></div>
  <article class="erp-card"><h2>سجل القبول الموازي</h2><div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>التاريخ</th><th>الفواتير: نظام/يدوي</th><th>التحصيل: نظام/يدوي</th><th>الفروقات</th><th>النتيجة</th><th>المسجل</th></tr></thead><tbody>${rows(checks)}</tbody></table></div></article>`);
  $('#safetyRefresh').onclick=render;
  if($('#createErpBackup'))$('#createErpBackup').onclick=()=>nativeAction('startEncryptedBackup');
  if($('#restoreErpBackup'))$('#restoreErpBackup').onclick=()=>{if(typeof confirm==='function'&&!confirm('سيتم فحص الملف أولًا وستظهر نافذة تأكيد أخرى قبل الاستعادة. هل تريد المتابعة؟'))return;nativeAction('startEncryptedRestore')};
  if($('#rollbackErpRestore'))$('#rollbackErpRestore').onclick=rollback;
  if($('#newTrialCheck'))$('#newTrialCheck').onclick=showTrialForm;
 }catch(error){layout(`<div class="erp-notice error">${esc(error.message)}</div>`)}
}
function rows(checks){
 return checks.slice(0,60).map(x=>`<tr><td><b>${esc(x.date)}</b><small>${dateText(x.recordedAt)}</small></td><td>${x.system.invoiceCount} / ${x.manual.invoiceCount}<small>${money(x.system.invoiceTotal)} / ${money(x.manual.invoiceTotal)}</small></td><td>${x.system.paymentCount} / ${x.manual.paymentCount}<small>${money(x.system.paymentTotal)} / ${money(x.manual.paymentTotal)}</small></td><td><span>فواتير: ${money(x.differences.invoiceTotal)}</span><small>تحصيل: ${money(x.differences.paymentTotal)}</small></td><td><span class="water-badge ${x.result==='MATCHED'?'approved':'rejected'}">${x.result==='MATCHED'?'متطابق':'يوجد فرق'}</span></td><td dir="ltr">${esc(x.recordedByUsername||x.recordedBy||'—')}</td></tr>`).join('')||'<tr><td colspan="6" class="erp-empty">لم تُسجل مطابقة يومية بعد</td></tr>';
}
function nativeAction(name){
 const result=call(name);if(!result.ok){notice(result.error||'تعذر بدء العملية','error');return}notice(result.message||'تم بدء العملية','info');
}
function rollback(){
 if(typeof confirm==='function'&&!confirm('هل تريد التراجع إلى الحالة التي كانت قبل آخر استعادة؟'))return;
 const result=call('rollbackLastRestore');if(!result.ok){notice(result.error||'تعذر التراجع','error');return}
 notice(result.message||'تم التراجع','success');setTimeout(render,500);
}
function showTrialForm(){
 const date=today(),system=systemTotals(date);
 modal('تسجيل المطابقة اليومية',`<div class="water-payment-summary"><span>فواتير النظام <b>${system.invoiceCount} / ${money(system.invoiceTotal)}</b></span><span>تحصيل النظام <b>${system.paymentCount} / ${money(system.paymentTotal)}</b></span></div>
 <div class="erp-form-grid"><div class="erp-field"><label>تاريخ المطابقة</label><input id="trialDate" type="date" value="${date}"></div><div class="erp-field"><label>عدد الفواتير في السجل اليدوي</label><input id="manualInvoiceCount" type="number" min="0" step="1" value="${system.invoiceCount}"></div><div class="erp-field"><label>إجمالي الفواتير اليدوي</label><input id="manualInvoiceTotal" type="number" min="0" step="0.01" value="${system.invoiceTotal}"></div><div class="erp-field"><label>عدد سندات التحصيل اليدوية</label><input id="manualPaymentCount" type="number" min="0" step="1" value="${system.paymentCount}"></div><div class="erp-field"><label>إجمالي التحصيل اليدوي</label><input id="manualPaymentTotal" type="number" min="0" step="0.01" value="${system.paymentTotal}"></div><div class="erp-field full"><label>ملاحظات ومرجع السجل اليدوي</label><textarea id="trialNotes" rows="3"></textarea></div></div>
 <div class="erp-toolbar water-modal-actions"><button class="erp-button" id="saveTrialCheck">حفظ نتيجة المطابقة</button></div>`);
 $('#trialDate').onchange=()=>{const totals=systemTotals($('#trialDate').value);notice(`النظام في هذا التاريخ: ${totals.invoiceCount} فاتورة و${totals.paymentCount} سند`,'info')};
 $('#saveTrialCheck').onclick=saveTrialCheck;
}
function saveTrialCheck(){
 try{
  const date=$('#trialDate').value;if(!date)throw new Error('تاريخ المطابقة مطلوب');
  const system=systemTotals(date),manual={invoiceCount:Math.max(0,Math.floor(num($('#manualInvoiceCount').value))),invoiceTotal:Math.max(0,num($('#manualInvoiceTotal').value)),paymentCount:Math.max(0,Math.floor(num($('#manualPaymentCount').value))),paymentTotal:Math.max(0,num($('#manualPaymentTotal').value))};
  const differences={invoiceCount:system.invoiceCount-manual.invoiceCount,invoiceTotal:system.invoiceTotal-manual.invoiceTotal,paymentCount:system.paymentCount-manual.paymentCount,paymentTotal:system.paymentTotal-manual.paymentTotal};
  const matched=differences.invoiceCount===0&&differences.paymentCount===0&&Math.abs(differences.invoiceTotal)<=.005&&Math.abs(differences.paymentTotal)<=.005;
  CORE.trialChecks.filter(x=>x.date===date&&String(x.status).toUpperCase()!=='SUPERSEDED').forEach(x=>{x.status='SUPERSEDED';x.supersededAt=iso();x.supersededBy=session().userId});
  CORE.trialChecks.push({id:uid('TRIAL'),date,system,manual,differences,result:matched?'MATCHED':'VARIANCE',status:'ACTIVE',notes:$('#trialNotes').value.trim(),recordedAt:iso(),recordedBy:session().userId,recordedByUsername:session().username});
  saveCore(matched?'تم حفظ المطابقة اليومية دون فروقات':'تم حفظ المطابقة مع فروقات تحتاج معالجة');closeModal();render();
 }catch(error){notice(error.message,'error')}
}
register('safety','التعافي والقبول',()=>has('MANAGE_SETTINGS')||has('VIEW_AUDIT'),render);
})();