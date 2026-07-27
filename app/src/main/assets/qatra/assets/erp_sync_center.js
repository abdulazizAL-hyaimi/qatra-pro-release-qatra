(function(){
'use strict';
const C=window.QatraWaterCore;if(!C)return;
const {$,esc,num,notice,has,call,register,layout,dateText}=C;
const canManage=()=>has('MANAGE_SETTINGS');
const canExport=()=>has('EXPORT_DATA')||has('CAPTURE_READINGS')||has('COLLECT_PAYMENTS')||has('MANAGE_CASHBOX')||canManage();
let STATUS=null;
const labels={AWAITING_REVIEW:'بانتظار المراجعة',CONFLICT_REVIEW:'حسم التعارضات',PROCESSED:'مطبقة',REJECTED:'مرفوضة',DUPLICATE:'مكررة'};
const reasonLabels={LOCAL_PENDING_CHANGE:'يوجد تعديل محلي معلّق',STALE_REMOTE_VERSION:'الإصدار الوارد أقدم',SAME_VERSION_DIFFERENT_HASH:'نفس الإصدار بمحتوى مختلف'};
const finalStatuses=new Set(['PROCESSED','REJECTED','DUPLICATE']);
function load(){const result=call('getDeviceSyncStatus');if(!result.ok)throw new Error(result.error||'تعذر فحص مركز المزامنة');STATUS=result;return result}
function stamp(value){return value?dateText(value):'لم يُسجل'}
function compactDevice(value){const s=String(value||'');return s.length>22?`${s.slice(0,12)}…${s.slice(-8)}`:s||'—'}
function render(){
 try{
  const s=load(),packages=s.packages||[],conflicts=s.conflicts||[];
  layout(`<div class="water-hero"><div><small>Controlled Device Exchange</small><h2>مركز مزامنة الأجهزة</h2><p>تبادل يدوي مشفّر ومقيّد بالدور. الإدارة تراجع كل حزمة ثم تعيد إيصالًا مشفرًا إلى جهاز المصدر لتثبيت القبول أو الرفض دون حذف السجل.</p></div><button class="erp-button secondary" id="syncRefresh">تحديث</button></div>
  <div class="water-kpis"><article><b>${num(s.pendingPackages)}</b><span>حزم تنتظر المراجعة</span></article><article><b>${num(s.openConflicts)}</b><span>تعارضات مفتوحة</span></article><article><b>${num(s.acceptedOutcomes)}</b><span>نتائج مقبولة</span></article><article><b>${num(s.rejectedOutcomes)}</b><span>نتائج مرفوضة/محلية</span></article><article><b>${stamp(s.lastReceiptAt)}</b><span>آخر إيصال</span></article><article><b>${s.keyProvisioned?'مؤسس':'غير مؤسس'}</b><span>مفتاح المؤسسة</span></article></div>
  <div class="water-two"><article class="erp-card"><div class="water-head"><div><h2>إرسال واستقبال آمن</h2><p>الجهاز: <code dir="ltr">${esc(compactDevice(s.deviceId))}</code></p></div></div>
  <div class="water-payment-summary"><span>آخر تصدير <b>${stamp(s.lastExportAt)}</b></span><span>آخر استيراد <b>${stamp(s.lastImportAt)}</b></span><span>آخر إيصال <b>${stamp(s.lastReceiptAt)}</b></span><span>النقل <b>ملف مشفّر يدوي</b></span></div>
  <div class="erp-toolbar">${canExport()?'<button class="erp-button" id="exportDeviceSync">تصدير حركات دوري</button><button class="erp-button secondary" id="importDeviceReceipt">استيراد إيصال الإدارة</button>':''}${canManage()?'<button class="erp-button warning" id="importDeviceSync">استيراد حزمة للمراجعة</button>':''}</div>
  <div class="erp-notice warning">مزامنة Google Drive والدمج التلقائي غير مفعّلين. الحركات المقبولة تُؤكَّد فقط بعد استيراد إيصال الإدارة، والنتائج المرفوضة تُحفظ ولا تُعاد في التصدير.</div></article>
  <article class="erp-card"><h2>دورة الملف المحكومة</h2><div class="water-cash-card"><span>1. جهاز الميدان <b>يصدر الحركات</b></span><span>2. الإدارة <b>تراجع وتحسم</b></span><span>3. الإدارة <b>تصدر الإيصال</b></span><span>4. المصدر <b>يثبت النتائج</b></span></div>
  <p>الإيصال لا يغيّر البيانات التشغيلية على جهاز المصدر. يحتفظ بتاريخ الحزمة ونتيجة كل حركة، ويمنع إعادة تصدير الحركات التي حُسمت.</p></article></div>
  <article class="erp-card"><h2>حزم المراجعة</h2><div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>الحزمة</th><th>الوقت</th><th>الحالة</th><th>جاهز</th><th>تعارض</th><th>مطبق</th><th>الإيصال</th><th>الإجراء</th></tr></thead><tbody>${packageRows(packages)}</tbody></table></div></article>
  <article class="erp-card"><h2>تعارضات تحتاج قرارًا</h2><div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>النوع</th><th>معرّف السجل</th><th>السبب</th><th>الإصدار الوارد</th><th>القرار</th></tr></thead><tbody>${conflictRows(conflicts,packages)}</tbody></table></div></article>`);
  $('#syncRefresh').onclick=render;
  if($('#exportDeviceSync'))$('#exportDeviceSync').onclick=()=>nativeAction('startDeviceSyncExport');
  if($('#importDeviceReceipt'))$('#importDeviceReceipt').onclick=()=>nativeAction('startDeviceSyncReceiptImport');
  if($('#importDeviceSync'))$('#importDeviceSync').onclick=()=>nativeAction('startDeviceSyncImport');
  document.querySelectorAll('[data-package-decision]').forEach(b=>b.onclick=()=>reviewPackage(b.dataset.packageId,b.dataset.packageDecision));
  document.querySelectorAll('[data-conflict-decision]').forEach(b=>b.onclick=()=>resolveConflict(b.dataset.changeId,b.dataset.conflictDecision));
  document.querySelectorAll('[data-receipt-export]').forEach(b=>b.onclick=()=>nativeAction('startDeviceSyncReceiptExport',b.dataset.receiptExport));
 }catch(error){layout(`<div class="erp-notice error">${esc(error.message)}</div>`)}
}
function packageRows(rows){return rows.map(x=>{const review=canManage()&&x.status==='AWAITING_REVIEW'?`<div class="erp-toolbar"><button class="erp-button success small" data-package-decision="APPROVE" data-package-id="${esc(x.packageId)}">اعتماد السليم</button><button class="erp-button danger small" data-package-decision="REJECT" data-package-id="${esc(x.packageId)}">رفض</button></div>`:'';const receipt=canManage()&&finalStatuses.has(x.status)?`<button class="erp-button secondary small" data-receipt-export="${esc(x.packageId)}">${x.receiptExportedAt?'إعادة تصدير':'تصدير إيصال'}</button>`:'';return `<tr><td dir="ltr"><b>${esc(String(x.packageId||'').slice(0,18))}…</b></td><td>${dateText(x.createdAt)}</td><td><span class="water-badge ${x.status==='PROCESSED'?'approved':x.status==='REJECTED'?'rejected':'submitted'}">${esc(labels[x.status]||x.status)}</span></td><td>${num(x.ready)}</td><td>${num(x.conflicts)}</td><td>${num(x.applied)}</td><td>${stamp(x.receiptExportedAt)}</td><td>${review||receipt||'—'}</td></tr>`}).join('')||'<tr><td colspan="8" class="erp-empty">لا توجد حزم مستوردة</td></tr>'}
function conflictRows(rows,packages){const states=new Map(packages.map(x=>[x.packageId,x.status]));return rows.map(x=>`<tr><td>${esc(x.entityType)}</td><td dir="ltr">${esc(x.entityId)}</td><td>${esc(reasonLabels[x.reason]||x.reason||'تعارض')}</td><td>${num(x.entityVersion)}</td><td>${canManage()&&states.get(x.packageId)==='CONFLICT_REVIEW'?`<div class="erp-toolbar"><button class="erp-button warning small" data-conflict-decision="REMOTE" data-change-id="${esc(x.changeId)}">اعتماد الوارد</button><button class="erp-button secondary small" data-conflict-decision="LOCAL" data-change-id="${esc(x.changeId)}">الإبقاء على المحلي</button></div>`:'اعتمد مراجعة الحزمة أولًا'}</td></tr>`).join('')||'<tr><td colspan="5" class="erp-empty">لا توجد تعارضات مفتوحة</td></tr>'}
function nativeAction(name,arg){const result=arguments.length>1?call(name,arg):call(name);if(!result.ok){notice(result.error||'تعذر بدء العملية','error');return}notice(result.message||'تم بدء العملية','info')}
function reviewPackage(packageId,decision){if(typeof confirm==='function'&&!confirm(decision==='APPROVE'?'ستُطبق الحركات السليمة فقط وتبقى التعارضات معلقة. متابعة؟':'سيُرفض محتوى الحزمة دون تعديل السجلات. متابعة؟'))return;const notes=typeof prompt==='function'?(prompt('ملاحظة المراجعة (اختياري)')||''):'';const result=call('reviewDeviceSyncPackage',packageId,decision,notes);if(!result.ok){notice(result.error,'error');return}notice(result.message,'success');render()}
function resolveConflict(changeId,decision){const message=decision==='REMOTE'?'سيحل السجل الوارد محل المحلي مع حفظ أثر القرار.':'سيبقى السجل المحلي ويُرفض الوارد.';if(typeof confirm==='function'&&!confirm(`${message} متابعة؟`))return;const notes=typeof prompt==='function'?(prompt('سبب قرار التعارض (موصى به)')||''):'';const result=call('resolveDeviceSyncConflict',changeId,decision,notes);if(!result.ok){notice(result.error,'error');return}notice(result.message,'success');render()}
register('sync','مزامنة الأجهزة',()=>canExport()||has('VIEW_AUDIT'),render);
})();
