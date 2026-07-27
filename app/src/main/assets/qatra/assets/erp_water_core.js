(function(){
'use strict';

const NS='erp.billing';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>{const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:0};
const money=v=>num(v).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2});
const iso=()=>new Date().toISOString();
const today=()=>new Date().toISOString().slice(0,10);
const uid=p=>`${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const STATUS={DRAFT:'مسودة',ACTIVE:'نشطة',ASSIGNED:'مسندة',SUBMITTED:'بانتظار المراجعة',APPROVED:'معتمد',REJECTED:'مرفوض',PARTIAL:'سداد جزئي',PAID:'مسددة',OPEN:'مفتوح',CLOSED:'مغلق',ARCHIVED:'مؤرشف',CANCELLED:'ملغي',REVERSED:'معكوس',EXECUTED:'منفذ',CORRECTED:'مصحح'};
const views=new Map();
let APP=null,SESSION=null,STATE=null,current='dashboard';

function call(name,...args){try{if(!window.AndroidBridge||typeof AndroidBridge[name]!=='function')throw new Error('الوظيفة غير متاحة');const raw=AndroidBridge[name](...args);return typeof raw==='string'?JSON.parse(raw):raw}catch(e){return{ok:false,error:e.message||String(e)}}}
function has(p){return !!SESSION?.permissions?.includes(p)}
function canManage(){return has('MANAGE_BILLING')}
function canRead(){return canManage()||has('CAPTURE_READINGS')}
function canCollect(){return canManage()||has('COLLECT_PAYMENTS')}
function canCash(){return canManage()||has('MANAGE_CASHBOX')}
function ensure(){const r=call('getState',NS);if(!r.ok)throw new Error(r.error||'تعذر تحميل بيانات التشغيل');STATE=r.found&&r.payload?r.payload:{};for(const k of ['subscribers','meters','cycles','readings','invoices','payments','collectorSettlements','cashboxSessions','cashboxTransactions','correctionRequests'])if(!Array.isArray(STATE[k]))STATE[k]=[];if(!STATE.operationSettings)STATE.operationSettings={pricePerUnit:0,fixedFee:0,dueDays:15};return STATE}
function save(message='تم الحفظ'){const r=call('saveState',NS,JSON.stringify(STATE));if(!r.ok)throw new Error(r.error||'تعذر حفظ بيانات التشغيل');notice(message,'success');return r}
function notice(message,type='info'){const root=$('#erpNotices');if(!root)return;const id='water-'+Date.now();root.insertAdjacentHTML('beforeend',`<div id="${id}" class="erp-notice ${type}"><span>${esc(message)}</span><button data-water-dismiss="${id}">×</button></div>`);setTimeout(()=>document.getElementById(id)?.remove(),5000)}
function modal(title,html){$('#erpModalTitle').textContent=title;$('#erpModalBody').innerHTML=html;$('.erp-modal-card')?.classList.add('wide');$('#erpModal').hidden=false}
function closeModal(){$('#erpModal').hidden=true;$('#erpModalBody').innerHTML=''}
function badge(s){const k=String(s||'DRAFT').toUpperCase();return`<span class="water-badge ${k.toLowerCase()}">${esc(STATUS[k]||s||'مسودة')}</span>`}
function dateText(v){if(!v)return'—';try{return new Date(v).toLocaleDateString('ar-YE')}catch(e){return String(v)}}
function state(){return STATE}
function session(){return SESSION}
function subscriberId(s){return String(s?.id||s?.accountNo||s?.code||s?.subscriberId||'')}
function subscriberName(id){const s=STATE.subscribers.find(x=>String(x.id||x.accountNo||x.code)===String(id));return s?.name||s?.subscriberName||s?.accountNo||String(id||'—')}
function meterNoFor(s){return String(s?.meterNo||s?.meterNumber||STATE.meters.find(m=>String(m.subscriberId||m.subscriber||'')===subscriberId(s))?.meterNo||'')}
function paymentApplied(p){return ['APPROVED','PAID','CLOSED'].includes(String(p.status||'').toUpperCase())}
function paymentReserved(p){return String(p.status||'').toUpperCase()==='SUBMITTED'}
function invoiceAmount(i){return num(i?.total||i?.amount)}
function approvedPaid(i){const linked=STATE.payments.filter(p=>String(p.invoiceId||p.invoiceNo)===String(i.id||i.no)&&paymentApplied(p)).reduce((s,p)=>s+num(p.amount),0);return Math.max(num(i.paidAmount),linked)}
function reservedPaid(i){return STATE.payments.filter(p=>String(p.invoiceId||p.invoiceNo)===String(i.id||i.no)&&paymentReserved(p)).reduce((s,p)=>s+num(p.amount),0)}
function invoiceBalance(i){if(['CANCELLED','REVERSED'].includes(String(i?.status||'').toUpperCase()))return 0;return Math.max(0,invoiceAmount(i)-approvedPaid(i))}
function collectibleBalance(i){if(['CANCELLED','REVERSED'].includes(String(i?.status||'').toUpperCase()))return 0;return Math.max(0,invoiceAmount(i)-approvedPaid(i)-reservedPaid(i))}
function nextNo(prefix,list){const stamp=today().replace(/-/g,'');let n=list.length+1,candidate='';do{candidate=`${prefix}-${stamp}-${String(n++).padStart(5,'0')}`}while(list.some(x=>String(x.no||x.receiptNo)===candidate));return candidate}
function latestApprovedReading(meterNo,excludeCycle){return STATE.readings.filter(r=>String(r.meterNo)===String(meterNo)&&String(r.status).toUpperCase()==='APPROVED'&&String(r.cycleId||r.cycle)!==String(excludeCycle||'')).sort((a,b)=>String(b.readingDate||b.updatedAt||'').localeCompare(String(a.readingDate||a.updatedAt||'')))[0]}
function isAssignedToMe(r){return canManage()||String(r.readerUserId||'')===String(SESSION.userId)||String(r.readerUsername||'').toLowerCase()===String(SESSION.username||'').toLowerCase()}
function addHistory(record,action,details={}){if(!record||typeof record!=='object')return null;if(!Array.isArray(record.history))record.history=[];const event={id:uid('EVT'),action:String(action||'UPDATED'),at:iso(),by:SESSION?.userId||'',byUsername:SESSION?.username||'',details:details&&typeof details==='object'?details:{note:String(details||'')}};record.history.push(event);if(record.history.length>100)record.history.splice(0,record.history.length-100);return event}
function cycleFor(value){const id=value&&typeof value==='object'?(value.cycleId||value.cycle||value.id||value.no):value;return STATE.cycles.find(c=>String(c.id||c.no)===String(id||''))}
function assertCycleOpen(value){const cycle=cycleFor(value);if(cycle&&['CLOSED','ARCHIVED'].includes(String(cycle.status||'').toUpperCase()))throw new Error('الدورة مغلقة ولا يمكن تعديل عملياتها');return cycle}
function register(name,label,allowed,render){views.set(name,{name,label,allowed,render})}
function availableViews(){return [...views.values()].filter(v=>!v.allowed||v.allowed())}
function setShell(){document.querySelectorAll('.erp-nav-button').forEach(b=>b.classList.toggle('active',!!b.dataset.waterOperations));$('#erpPageTitle').textContent='التشغيل المائي';$('#erpPageSubtitle').textContent='دورة القراءة والفوترة والتحصيل والصندوق';$('#erpSidebar')?.classList.remove('open')}
function layout(body){const list=availableViews();$('#erpContent').innerHTML=`<section class="water-shell"><div class="water-tabs"><button data-water-view="dashboard" class="${current==='dashboard'?'active':''}">لوحة التشغيل</button>${list.map(v=>`<button data-water-view="${v.name}" class="${current===v.name?'active':''}">${esc(v.label)}</button>`).join('')}</div><div id="waterBody">${body}</div></section>`;$$('[data-water-view]').forEach(b=>b.onclick=()=>open(b.dataset.waterView))}
function dashboard(){const assigned=STATE.readings.filter(r=>isAssignedToMe(r)&&['DRAFT','ASSIGNED','REJECTED'].includes(String(r.status||'').toUpperCase())).length;const review=STATE.readings.filter(r=>String(r.status).toUpperCase()==='SUBMITTED').length;const outstanding=STATE.invoices.reduce((s,i)=>s+invoiceBalance(i),0);const waiting=canCash()?STATE.collectorSettlements.filter(x=>String(x.status).toUpperCase()==='SUBMITTED').reduce((s,x)=>s+num(x.amount),0):STATE.payments.filter(x=>String(x.status).toUpperCase()==='SUBMITTED').reduce((s,x)=>s+num(x.amount),0);const flow=availableViews();layout(`<div class="water-hero"><div><small>Qatra Water Operations</small><h2>من القراءة إلى الصندوق في مسار واحد</h2><p>تظهر الإجراءات وفق الصلاحيات، وتبقى البيانات المحمية خارج نطاق الدور.</p></div><button class="erp-button secondary" id="waterRefresh">تحديث</button></div><div class="water-kpis"><article><b>${assigned}</b><span>قراءات تحتاج إدخالًا</span></article><article><b>${review}</b><span>قراءات بانتظار المراجعة</span></article><article><b>${money(outstanding)}</b><span>رصيد فواتير قائم</span></article><article><b>${money(waiting)}</b><span>${canCash()?'توريدات بانتظار الصندوق':'تحصيل بانتظار التوريد'}</span></article></div><div class="water-flow">${flow.map((v,i)=>`<button data-water-go="${v.name}"><span>${i+1}</span><b>${esc(v.label)}</b><small>فتح دورة العمل</small></button>`).join('')}</div>`);$('#waterRefresh').onclick=()=>open('dashboard');$$('[data-water-go]').forEach(b=>b.onclick=()=>open(b.dataset.waterGo))}
function open(view='dashboard'){try{ensure();current=view;setShell();if(view==='dashboard'){dashboard();return}const def=views.get(view);if(!def||def.allowed&&!def.allowed()){dashboard();return}def.render()}catch(e){layout(`<div class="erp-notice error">${esc(e.message)}</div>`)}}
function installNav(){if(!canRead()&&!canCollect()&&!canCash())return;const nav=$('#erpNav');if(!nav||nav.querySelector('[data-water-operations]'))return;const b=document.createElement('button');b.className='erp-nav-button';b.dataset.waterOperations='1';b.innerHTML='<span class="icon">◉</span><span>التشغيل المائي</span>';b.onclick=()=>open('dashboard');const billing=nav.querySelector('[data-module="billing"]');if(billing)billing.insertAdjacentElement('afterend',b);else nav.appendChild(b)}
function init(){APP=call('getAppInfo');if(!APP.ok)return false;SESSION=APP.session;installNav();new MutationObserver(installNav).observe(document.body,{childList:true,subtree:true});document.addEventListener('click',e=>{const id=e.target.closest('[data-water-dismiss]')?.dataset.waterDismiss;if(id)document.getElementById(id)?.remove()});return true}

window.QatraWaterCore={$, $$, esc, num, money, iso, today, uid, STATUS, call, has, canManage, canRead, canCollect, canCash, ensure, save, notice, modal, closeModal, badge, dateText, state, session, subscriberId, subscriberName, meterNoFor, paymentApplied, paymentReserved, invoiceAmount, approvedPaid, reservedPaid, invoiceBalance, collectibleBalance, nextNo, latestApprovedReading, isAssignedToMe, addHistory, cycleFor, assertCycleOpen, register, layout, open, init};
})();