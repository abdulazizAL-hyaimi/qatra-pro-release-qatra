(function(){
'use strict';
const C=window.QatraWaterCore;if(!C)return;
const {$,$$,esc,money,dateText,state,session,has,canManage,canCollect,canCash,register,layout}=C;
let filter='ALL',query='';
function roles(){return new Set(session()?.roles||[])}
function canThermal(){const r=roles();return r.has('SYSTEM_ADMIN')||r.has('ADMIN')||r.has('COLLECTOR')}
function canOpenCenter(){return canManage()||has('VIEW_REPORTS')||canCollect()||canCash()}
function own(record){const user=session()||{};return String(record.collectorUserId||'')===String(user.userId||'')||String(record.collectorUsername||'').toLowerCase()===String(user.username||'').toLowerCase()}
function allowed(type,record){if(canManage()||has('VIEW_REPORTS'))return true;if(canCash())return type==='payment'||type==='settlement';if(canCollect())return type==='invoice'||((type==='payment'||type==='settlement')&&own(record));return false}
function visibleTypes(){const types=[];if(canManage()||has('VIEW_REPORTS')||canCollect())types.push(['invoice','الفواتير']);if(canManage()||has('VIEW_REPORTS')||canCollect()||canCash())types.push(['payment','سندات القبض'],['settlement','التوريدات']);return types}
function typeLabel(t){return t==='invoice'?'فاتورة':t==='payment'?'سند قبض':'سند توريد'}
function noOf(r){return r.no||r.receiptNo||r.settlementNo||r.id||'—'}
function amountOf(r){return Number(r.total||r.amount||r.balance||0).toLocaleString('en-US',{maximumFractionDigits:2})}
function dateOf(t,r){return t==='invoice'?r.invoiceDate:t==='payment'?r.paymentDate:r.settlementDate||r.createdAt}
function records(){const s=state(),all=[...s.invoices.map(r=>({type:'invoice',record:r})),...s.payments.map(r=>({type:'payment',record:r})),...s.collectorSettlements.map(r=>({type:'settlement',record:r}))];return all.filter(x=>allowed(x.type,x.record)&&(filter==='ALL'||x.type===filter)&&(!query||JSON.stringify(x.record).toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>String(dateOf(b.type,b.record)||'').localeCompare(String(dateOf(a.type,a.record)||''))).slice(0,300)}
function renderRows(list){return list.map(x=>{const r=x.record;return`<tr><td><span class="water-badge ${x.type}">${typeLabel(x.type)}</span></td><td><b>${esc(noOf(r))}</b></td><td>${esc(r.subscriber||r.collectorName||r.collectorUsername||'—')}</td><td>${money(amountOf(r))}</td><td>${dateText(dateOf(x.type,r))}</td><td>${esc(r.status||'—')}</td><td><div class="erp-toolbar"><button class="erp-button secondary small" data-doc-a5="${x.type}" data-doc-id="${esc(r.id||noOf(r))}">A5</button>${canThermal()&&x.type!=='settlement'?`<button class="erp-button small" data-doc-thermal="${x.type}" data-doc-id="${esc(r.id||noOf(r))}">حراري</button>`:''}</div></td></tr>`}).join('')||'<tr><td colspan="7" class="erp-empty">لا توجد مستندات مطابقة</td></tr>'}
function render(){const types=visibleTypes();if(filter!=='ALL'&&!types.some(x=>x[0]===filter))filter='ALL';const list=records();layout(`<article class="erp-card"><div class="water-head"><div><h2>مركز مستندات التشغيل</h2><p>إعادة طباعة المستندات المسموح بها لحسابك دون تعديل بياناتها.</p></div><span>${list.length} مستند</span></div><div class="erp-toolbar document-center-filter"><select id="documentType"><option value="ALL">كل المستندات</option>${types.map(x=>`<option value="${x[0]}">${esc(x[1])}</option>`).join('')}</select><input id="documentSearch" type="search" placeholder="رقم المستند أو المشترك أو المحصل" value="${esc(query)}"></div><div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>النوع</th><th>الرقم</th><th>الطرف</th><th>المبلغ</th><th>التاريخ</th><th>الحالة</th><th>الطباعة</th></tr></thead><tbody id="documentRows">${renderRows(list)}</tbody></table></div></article>`);$('#documentType').value=filter;$('#documentType').onchange=e=>{filter=e.target.value;render()};$('#documentSearch').oninput=e=>{query=e.target.value.trim();$('#documentRows').innerHTML=renderRows(records())}}
register('documents','مركز المستندات',canOpenCenter,render);
window.QatraWaterDocumentCenter={render};
})();
