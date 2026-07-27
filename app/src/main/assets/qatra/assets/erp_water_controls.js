(function(){
'use strict';
const C=window.QatraWaterCore,A=window.QatraWaterAdmin;if(!C||!A)return;
const {$,$$,esc,num,money,dateText,state,notice,badge,canManage,register,layout}=C;

const ACTIONS={
CYCLE_ACTIVATED:'تفعيل الدورة',CYCLE_CLOSED:'إغلاق الدورة',INVOICES_GENERATED:'إصدار الفواتير',
READING_ASSIGNED:'إسناد القراءة',READING_SUBMITTED:'إرسال القراءة',READING_APPROVED:'اعتماد القراءة',
READING_REJECTED:'رفض القراءة',INVOICE_CREATED:'إنشاء الفاتورة',INVOICE_APPROVED:'اعتماد الفاتورة',
INVOICE_POSTING_FAILED:'فشل ترحيل الفاتورة',CORRECTION_REQUESTED:'طلب تصحيح',CORRECTION_EXECUTED:'تنفيذ التصحيح',CORRECTION_REJECTED:'رفض التصحيح',READING_CORRECTED:'تصحيح القراءة',INVOICE_REVERSED:'عكس الفاتورة',PAYMENT_REVERSED:'عكس سند القبض',PAYMENT_CANCELLED:'إلغاء سند القبض'
};
function key(v){return String(v??'')}
function integrityFindings(){
 const s=state(),out=[],seenReading=new Map(),seenReceipt=new Set();
 s.invoices.filter(i=>!['CANCELLED','REVERSED'].includes(key(i.status).toUpperCase())).forEach(i=>{const k=key(i.readingId);if(!k)return;if(seenReading.has(k))out.push({level:'error',text:`القراءة ${k} مرتبطة بأكثر من فاتورة`});else seenReading.set(k,i.id)});
 s.payments.forEach(p=>{const k=key(p.receiptNo||p.no);if(k&&seenReceipt.has(k))out.push({level:'error',text:`رقم سند القبض ${k} مكرر`});if(k)seenReceipt.add(k)});
 s.invoices.forEach(i=>{const payments=s.payments.filter(p=>key(p.invoiceId||p.invoiceNo)===key(i.id||i.no)&&['SUBMITTED','APPROVED','PAID','CLOSED'].includes(key(p.status).toUpperCase())),total=payments.reduce((sum,p)=>sum+num(p.amount),0),amount=num(i.total||i.amount);if(total>amount+.005)out.push({level:'error',text:`مبالغ الفاتورة ${i.no||i.id} تتجاوز قيمتها بمقدار ${money(total-amount)}`})});
 s.collectorSettlements.forEach(t=>{const payments=s.payments.filter(p=>(t.paymentIds||[]).includes(p.id)),actual=payments.reduce((sum,p)=>sum+num(p.amount),0);if(Math.abs(actual-num(t.amount))>.005)out.push({level:'error',text:`إجمالي التوريد ${t.no||t.id} لا يطابق سنداته`})});
 s.cashboxSessions.filter(x=>key(x.status).toUpperCase()==='CLOSED').forEach(x=>{if(x.countedBalance===undefined||x.expectedBalance===undefined)out.push({level:'warning',text:`جلسة الصندوق ${x.no||x.id} مغلقة دون نتيجة جرد مكتملة`})});
 return out
}
function events(){
 const s=state(),groups=[['الدورة',s.cycles],['القراءة',s.readings],['الفاتورة',s.invoices],['سند القبض',s.payments],['التوريد',s.collectorSettlements],['جلسة الصندوق',s.cashboxSessions],['طلب التصحيح',s.correctionRequests||[]]],out=[];
 groups.forEach(([type,rows])=>rows.forEach(row=>(row.history||[]).forEach(event=>out.push({...event,type,recordNo:row.no||row.receiptNo||row.id}))));
 return out.sort((a,b)=>key(b.at).localeCompare(key(a.at))).slice(0,100)
}
function issueText(check){return check.ready?'جاهزة للإقفال':check.issues.join('، ')}
function render(){
 const s=state(),cycles=s.cycles.slice().sort((a,b)=>key(b.startDate||b.month).localeCompare(key(a.startDate||a.month))),checks=cycles.map(c=>({cycle:c,check:A.cycleReadiness(c)})),active=checks.filter(x=>key(x.cycle.status).toUpperCase()==='ACTIVE'),ready=active.filter(x=>x.check.ready),findings=integrityFindings(),history=events();
 layout(`<div class="water-kpis"><article><b>${active.length}</b><span>دورات نشطة</span></article><article><b>${ready.length}</b><span>جاهزة للإقفال</span></article><article><b>${active.length-ready.length}</b><span>تحتاج معالجة</span></article><article><b>${findings.length}</b><span>ملاحظات سلامة</span></article></div>
 <article class="erp-card"><div class="water-head"><div><h2>الرقابة وإقفال الدورات</h2><p>لا تُغلق الدورة حتى تعتمد كل القراءات، وتصدر فواتيرها، وتنجح القيود المرتبطة بها.</p></div><button class="erp-button secondary" id="refreshControls">إعادة الفحص</button></div>
 <div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>الدورة</th><th>القراءات</th><th>الفواتير</th><th>إجمالي الفواتير</th><th>نتيجة الفحص</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>
 ${checks.map(x=>`<tr><td><b>${esc(x.cycle.name||x.cycle.no)}</b><small>${esc(x.cycle.month||'')}</small></td><td>${x.check.approved}/${x.check.readings}</td><td>${x.check.invoices}</td><td>${money(x.check.total)}</td><td class="${x.check.ready?'':'danger-text'}">${esc(issueText(x.check))}</td><td>${badge(x.cycle.status)}</td><td>${key(x.cycle.status).toUpperCase()==='ACTIVE'&&x.check.ready?`<button class="erp-button warning small" data-safe-close="${esc(x.cycle.id)}">إغلاق آمن</button>`:''}</td></tr>`).join('')||'<tr><td colspan="7" class="erp-empty">لا توجد دورات</td></tr>'}
 </tbody></table></div></article>
 <div class="water-two"><article class="erp-card"><h2>فحص سلامة البيانات التشغيلية</h2><div class="water-mini-list">${findings.map(f=>`<div><span class="${f.level==='error'?'danger-text':''}"><b>${f.level==='error'?'خطأ':'تنبيه'}</b><small>${esc(f.text)}</small></span></div>`).join('')||'<div class="erp-empty">لم يكتشف الفحص تناقضات تشغيلية</div>'}</div></article>
 <article class="erp-card"><h2>آخر الحركات المسجلة</h2><div class="water-mini-list">${history.slice(0,30).map(e=>`<div><span><b>${esc(ACTIONS[e.action]||e.action)}</b><small>${esc(e.type)} — ${esc(e.recordNo)} — ${esc(e.byUsername||e.by||'النظام')}</small></span><strong>${esc(dateText(e.at))}</strong></div>`).join('')||'<div class="erp-empty">سيظهر السجل مع العمليات الجديدة</div>'}</div></article></div>`);
 $('#refreshControls').onclick=render;$$('[data-safe-close]').forEach(b=>b.onclick=()=>{try{const cycle=s.cycles.find(x=>key(x.id)===key(b.dataset.safeClose));if(cycle&&A.closeCycle(cycle)!==false)render()}catch(e){notice(e.message,'error')}})
}
register('controls','الرقابة والإقفال',canManage,render);
window.QatraWaterControls={render,integrityFindings,events};
})();