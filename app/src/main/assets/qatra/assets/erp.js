(function(){
'use strict';

const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const now=()=>new Date().toISOString();
const uid=p=>`${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const clone=v=>JSON.parse(JSON.stringify(v));
let APP=null,SESSION=null,CURRENT='dashboard',CURRENT_ENTITY='',CACHE=new Map(),SEARCH='';

const STATUS_LABELS={DRAFT:'مسودة',SUBMITTED:'بانتظار الاعتماد',APPROVED:'معتمد',REJECTED:'مرفوض',ARCHIVED:'مؤرشف',ACTIVE:'نشط',CLOSED:'مغلق'};
const ROLE_LABELS={SYSTEM_ADMIN:'مدير النظام',ADMIN:'الإدارة',ACCOUNTANT:'المحاسبة',READER:'الكاشف',COLLECTOR:'المحصل',CASHIER:'الصندوق',PROCUREMENT:'المشتريات',INVENTORY:'المخزون',HR:'الموارد البشرية',MAINTENANCE:'الصيانة',AUDITOR:'المراجعة'};
const PERMISSION_LABELS={MANAGE_USERS:'إدارة المستخدمين',MANAGE_SECURITY:'إعادة كلمات المرور والأمان',VIEW_DASHBOARD:'عرض لوحة التحكم',MANAGE_BILLING:'إدارة المشتركين والفوترة',CAPTURE_READINGS:'إدخال القراءات',COLLECT_PAYMENTS:'تحصيل المدفوعات',MANAGE_CASHBOX:'إدارة الصندوق',MANAGE_ACCOUNTING:'إدارة المحاسبة',APPROVE_ACCOUNTING:'اعتماد القيود',MANAGE_PROCUREMENT:'إدارة المشتريات',APPROVE_PROCUREMENT:'اعتماد المشتريات',MANAGE_INVENTORY:'إدارة المخزون',APPROVE_INVENTORY:'اعتماد حركات المخزون',MANAGE_ASSETS:'إدارة الأصول',MANAGE_HR:'إدارة الموارد البشرية',APPROVE_PAYROLL:'اعتماد الرواتب',MANAGE_MAINTENANCE:'إدارة الصيانة',APPROVE_MAINTENANCE:'اعتماد الصيانة',VIEW_REPORTS:'عرض التقارير',EXPORT_DATA:'تصدير البيانات',VIEW_AUDIT:'عرض سجل التدقيق',MANAGE_SETTINGS:'إدارة إعدادات المؤسسة'};

const ENTITIES={
  core:{namespace:'erp.core',permission:'MANAGE_SETTINGS',title:'الإعداد المؤسسي',items:{
    branches:{title:'الفروع والمشاريع',prefix:'BR',fields:[['name','اسم الفرع','text'],['code','الرمز','text'],['location','الموقع','text'],['manager','المدير','text']]},
    costCenters:{title:'مراكز التكلفة',prefix:'CC',fields:[['name','اسم المركز','text'],['code','الرمز','text'],['branch','الفرع','text'],['budget','الموازنة','number']]},
    fiscalYears:{title:'السنوات المالية',prefix:'FY',fields:[['name','السنة المالية','text'],['startDate','تاريخ البداية','date'],['endDate','تاريخ النهاية','date'],['closed','مغلقة','checkbox']]},
    approvalRules:{title:'مصفوفة الاعتمادات',prefix:'APR',fields:[['name','اسم القاعدة','text'],['module','الوحدة','text'],['minimumAmount','من مبلغ','number'],['maximumAmount','إلى مبلغ','number'],['requiredRole','الدور المعتمد','text']]}
  }},
  billing:{namespace:'erp.billing',permission:'MANAGE_BILLING',title:'المشتركين والفوترة',items:{
    subscribers:{title:'المشتركون',prefix:'SUB',fields:[['name','اسم المشترك','text'],['accountNo','رقم الحساب','text'],['phone','الهاتف','tel'],['address','العنوان','text'],['meterNo','رقم العداد','text']]},
    meters:{title:'العدادات',prefix:'MTR',fields:[['meterNo','رقم العداد','text'],['subscriber','المشترك','text'],['installDate','تاريخ التركيب','date'],['statusText','الحالة الفنية','text']]},
    readings:{title:'القراءات',prefix:'RDG',fields:[['meterNo','رقم العداد','text'],['cycle','الدورة','text'],['previous','السابقة','number'],['current','الحالية','number'],['reader','الكاشف','text']]},
    invoices:{title:'الفواتير',prefix:'INV',fields:[['subscriber','المشترك','text'],['cycle','الدورة','text'],['amount','المبلغ','number'],['dueDate','تاريخ الاستحقاق','date'],['notes','ملاحظات','textarea']]},
    payments:{title:'المدفوعات',prefix:'PAY',fields:[['subscriber','المشترك','text'],['invoiceNo','رقم الفاتورة','text'],['amount','المبلغ','number'],['paymentDate','تاريخ السداد','date'],['method','وسيلة السداد','text']]}
  }},
  accounting:{namespace:'erp.accounting',permission:'MANAGE_ACCOUNTING',title:'المحاسبة والمالية',items:{
    accounts:{title:'دليل الحسابات',prefix:'ACC',fields:[['code','رقم الحساب','text'],['name','اسم الحساب','text'],['type','النوع','text'],['parent','الحساب الأب','text']]},
    journals:{title:'القيود اليومية',prefix:'JV',fields:[['date','التاريخ','date'],['description','البيان','text'],['debitAccount','الحساب المدين','text'],['creditAccount','الحساب الدائن','text'],['amount','المبلغ','number']]},
    periods:{title:'الفترات المحاسبية',prefix:'PER',fields:[['name','اسم الفترة','text'],['startDate','البداية','date'],['endDate','النهاية','date'],['closed','مغلقة','checkbox']]},
    reconciliations:{title:'المطابقات البنكية',prefix:'REC',fields:[['bank','البنك','text'],['statementDate','تاريخ الكشف','date'],['bookBalance','رصيد الدفاتر','number'],['bankBalance','رصيد البنك','number']]}
  }},
  procurement:{namespace:'erp.procurement',permission:'MANAGE_PROCUREMENT',title:'المشتريات والموردون',items:{
    suppliers:{title:'الموردون',prefix:'SUP',fields:[['name','اسم المورد','text'],['taxNo','الرقم الضريبي','text'],['phone','الهاتف','tel'],['email','البريد','email'],['address','العنوان','text']]},
    purchaseRequests:{title:'طلبات الشراء',prefix:'PR',fields:[['requester','طالب الشراء','text'],['department','الإدارة','text'],['neededBy','التاريخ المطلوب','date'],['estimatedAmount','القيمة التقديرية','number'],['description','الوصف','textarea'],['lines','بنود الطلب: الوصف | الكمية | الوحدة | سعر الوحدة','lines']]},
    quotations:{title:'عروض الأسعار',prefix:'RFQ',fields:[['requestId','طلب الشراء','reference',{module:'procurement',entity:'purchaseRequests'}],['supplierId','المورد','reference',{module:'procurement',entity:'suppliers'}],['amount','القيمة','number'],['validUntil','صالح حتى','date'],['notes','ملاحظات','textarea']]},
    purchaseOrders:{title:'أوامر الشراء',prefix:'PO',fields:[['supplierId','المورد','reference',{module:'procurement',entity:'suppliers'}],['requestId','طلب الشراء','reference',{module:'procurement',entity:'purchaseRequests'}],['orderDate','التاريخ','date'],['deliveryDate','موعد التسليم','date'],['amount','الإجمالي','number'],['lines','بنود الأمر: الوصف | الكمية | الوحدة | سعر الوحدة','lines']]},
    goodsReceipts:{title:'استلام المشتريات',prefix:'GRN',fields:[['purchaseOrderId','أمر الشراء','reference',{module:'procurement',entity:'purchaseOrders'}],['warehouseId','المستودع','referenceText',{module:'inventory',entity:'warehouses'}],['receiptDate','تاريخ الاستلام','date'],['receivedBy','المستلم','text'],['notes','ملاحظات','textarea'],['lines','البنود المستلمة: الوصف | الكمية | الوحدة | سعر الوحدة','lines']]},
    supplierInvoices:{title:'فواتير الموردين',prefix:'SINV',fields:[['supplierId','المورد','reference',{module:'procurement',entity:'suppliers'}],['purchaseOrderId','أمر الشراء','reference',{module:'procurement',entity:'purchaseOrders'}],['invoiceDate','تاريخ الفاتورة','date'],['amount','المبلغ','number'],['dueDate','الاستحقاق','date']]}
  }},
  inventory:{namespace:'erp.inventory',permission:'MANAGE_INVENTORY',title:'المخزون والمستودعات',items:{
    warehouses:{title:'المستودعات',prefix:'WH',fields:[['name','اسم المستودع','text'],['code','الرمز','text'],['location','الموقع','text'],['keeper','أمين المستودع','text']]},
    items:{title:'الأصناف',prefix:'ITM',fields:[['name','اسم الصنف','text'],['sku','كود الصنف','text'],['unit','الوحدة','text'],['minimum','الحد الأدنى','number'],['averageCost','متوسط التكلفة','number']]},
    movements:{title:'حركات المخزون',prefix:'MOV',fields:[['itemId','الصنف','reference',{module:'inventory',entity:'items'}],['warehouseId','المستودع','reference',{module:'inventory',entity:'warehouses'}],['movementType','نوع الحركة','select',[['IN','وارد'],['OUT','صرف'],['OPENING','رصيد افتتاحي'],['ADJUSTMENT_IN','تسوية إضافة'],['ADJUSTMENT_OUT','تسوية خصم'],['TRANSFER_IN','تحويل وارد'],['TRANSFER_OUT','تحويل صادر']]],['quantity','الكمية','number'],['unitCost','تكلفة الوحدة','number'],['movementDate','التاريخ','date'],['reference','المرجع','text']]},
    stocktakes:{title:'الجرد والتسويات',prefix:'STK',fields:[['warehouseId','المستودع','reference',{module:'inventory',entity:'warehouses'}],['stocktakeDate','تاريخ الجرد','date'],['committee','لجنة الجرد','text'],['differenceValue','قيمة الفروقات','number']]}
  }},
  assets:{namespace:'erp.assets',permission:'MANAGE_ASSETS',title:'الأصول والعهد',items:{
    assets:{title:'سجل الأصول',prefix:'AST',fields:[['name','اسم الأصل','text'],['assetCode','كود الأصل','text'],['category','التصنيف','text'],['location','الموقع','text'],['custodian','العهدة لدى','text'],['purchaseDate','تاريخ الشراء','date'],['cost','التكلفة','number'],['residualValue','القيمة التخريدية','number'],['usefulLife','العمر الإنتاجي/سنة','number']]},
    depreciationRuns:{title:'الإهلاك',prefix:'DEP',fields:[['period','الفترة','text'],['assetId','الأصل','reference',{module:'assets',entity:'assets'}],['openingValue','القيمة الافتتاحية','number'],['depreciation','الإهلاك','number'],['closingValue','القيمة الدفترية','number']]},
    transfers:{title:'نقل وتسليم الأصول',prefix:'ATR',fields:[['assetId','الأصل','reference',{module:'assets',entity:'assets'}],['fromLocation','من','text'],['toLocation','إلى','text'],['custodian','المستلم','text'],['transferDate','التاريخ','date']]}
  }},
  hr:{namespace:'erp.hr',permission:'MANAGE_HR',title:'الموارد البشرية والرواتب',items:{
    employees:{title:'الموظفون',prefix:'EMP',fields:[['name','اسم الموظف','text'],['employeeNo','الرقم الوظيفي','text'],['department','الإدارة','text'],['jobTitle','المسمى','text'],['hireDate','تاريخ التعيين','date'],['basicSalary','الراتب الأساسي','number']]},
    attendance:{title:'الحضور والانصراف',prefix:'ATT',fields:[['employeeId','الموظف','reference',{module:'hr',entity:'employees'}],['date','التاريخ','date'],['checkIn','الحضور','time'],['checkOut','الانصراف','time'],['statusText','حالة الدوام','select',[['PRESENT','حاضر'],['ABSENT','غائب'],['LEAVE','إجازة'],['REMOTE','عمل ميداني']]]]},
    leaveRequests:{title:'الإجازات',prefix:'LEV',fields:[['employeeId','الموظف','reference',{module:'hr',entity:'employees'}],['leaveType','نوع الإجازة','select',[['ANNUAL','سنوية'],['SICK','مرضية'],['EMERGENCY','طارئة'],['UNPAID','دون راتب']]],['startDate','من','date'],['endDate','إلى','date'],['reason','السبب','textarea']]},
    payrollRuns:{title:'مسيرات الرواتب',prefix:'PAYR',fields:[['period','الفترة','text'],['department','الإدارة','text'],['gross','الإجمالي','number'],['deductions','الاستقطاعات','number'],['net','الصافي','number'],['lines','تفاصيل الموظفين: المعرّف | الأساسي | البدلات | الاستقطاعات','payrollLines',{module:'hr',entity:'employees'}]]}
  }},
  maintenance:{namespace:'erp.maintenance',permission:'MANAGE_MAINTENANCE',title:'الصيانة وأوامر العمل',items:{
    workOrders:{title:'أوامر العمل',prefix:'WO',fields:[['title','عنوان العمل','text'],['asset','الأصل/الموقع','referenceText',{module:'assets',entity:'assets'}],['priority','الأولوية','select',[['LOW','منخفضة'],['MEDIUM','متوسطة'],['HIGH','عالية'],['CRITICAL','حرجة']]],['assignedTo','الفني/الفريق','text'],['estimatedCost','التكلفة التقديرية','number'],['actualCost','التكلفة الفعلية','number'],['description','الوصف','textarea'],['lines','قطع الغيار: الوصف | الكمية | الوحدة | سعر الوحدة','lines']]},
    preventivePlans:{title:'الصيانة الوقائية',prefix:'PM',fields:[['asset','الأصل','referenceText',{module:'assets',entity:'assets'}],['frequency','التكرار','select',[['WEEKLY','أسبوعي'],['MONTHLY','شهري'],['QUARTERLY','ربع سنوي'],['SEMI_ANNUAL','نصف سنوي'],['ANNUAL','سنوي']]],['nextDate','الموعد القادم','date'],['responsible','المسؤول','text'],['checklist','قائمة الفحص','textarea']]},
    failures:{title:'بلاغات الأعطال',prefix:'FLT',fields:[['location','الموقع','text'],['reportedBy','المبلغ','text'],['reportedAt','وقت البلاغ','datetime-local'],['severity','الخطورة','select',[['LOW','منخفضة'],['MEDIUM','متوسطة'],['HIGH','عالية'],['CRITICAL','حرجة']]],['description','تفاصيل العطل','textarea']]}
  }},
  documents:{namespace:'erp.documents',permission:'MANAGE_SETTINGS',title:'العقود والوثائق',items:{
    contracts:{title:'العقود',prefix:'CON',fields:[['title','اسم العقد','text'],['party','الطرف الآخر','text'],['startDate','البداية','date'],['endDate','النهاية','date'],['value','القيمة','number']]},
    documents:{title:'الوثائق المؤسسية',prefix:'DOC',fields:[['title','عنوان الوثيقة','text'],['category','التصنيف','text'],['referenceNo','المرجع','text'],['issueDate','التاريخ','date'],['notes','ملاحظات','textarea']]}
  }}
};

const MODULES=[
  ['dashboard','لوحة التحكم','مؤشرات الأداء والتنبيهات','⌂','VIEW_DASHBOARD'],
  ['core','الإعداد المؤسسي','الفروع ومراكز التكلفة والاعتمادات','⚙','MANAGE_SETTINGS'],
  ['billing','المشتركون والفوترة','العدادات والقراءات والفواتير والتحصيل','◫',['MANAGE_BILLING','CAPTURE_READINGS','COLLECT_PAYMENTS','MANAGE_CASHBOX']],
  ['accounting','المحاسبة والمالية','الدليل والقيود والفترات والمطابقة','▤','MANAGE_ACCOUNTING'],
  ['procurement','المشتريات والموردون','الطلب والعروض والأمر والاستلام والفاتورة','▣','MANAGE_PROCUREMENT'],
  ['inventory','المخزون والمستودعات','الأصناف والحركات والجرد','▦','MANAGE_INVENTORY'],
  ['assets','الأصول والعهد','الأصول والإهلاك والنقل','◆','MANAGE_ASSETS'],
  ['hr','الموارد البشرية','الموظفون والحضور والإجازات والرواتب','♙','MANAGE_HR'],
  ['maintenance','الصيانة والتشغيل','البلاغات والأوامر والخطط الوقائية','⚒','MANAGE_MAINTENANCE'],
  ['documents','العقود والوثائق','السجلات والوثائق المؤسسية','▧','MANAGE_SETTINGS'],
  ['users','المستخدمون والصلاحيات','الحسابات والأدوار وكلمات المرور','♜','MANAGE_USERS'],
  ['audit','المراجعة والتدقيق','سجل الهوية والعمليات الحساسة','✓','VIEW_AUDIT']
];

function call(name,...args){
  try{
    if(!window.AndroidBridge||typeof AndroidBridge[name]!=='function')throw new Error('الجسر الأصلي غير متاح');
    const raw=AndroidBridge[name](...args);return typeof raw==='string'?JSON.parse(raw):raw;
  }catch(e){return{ok:false,error:e.message||String(e)}}
}
function has(permission){return !!SESSION?.permissions?.includes(permission)}
function visibleModule(m){return (Array.isArray(m[4])?m[4].some(has):has(m[4]))||m[0]==='dashboard'}
function notice(message,type='info'){const id='n'+Date.now();$('#erpNotices').insertAdjacentHTML('beforeend',`<div id="${id}" class="erp-notice ${type}">${esc(message)}</div>`);setTimeout(()=>document.getElementById(id)?.remove(),4200)}
function statusBadge(status){const s=String(status||'DRAFT').toUpperCase();return`<span class="erp-badge ${s.toLowerCase()}">${esc(STATUS_LABELS[s]||s)}</span>`}
function formatDate(v){if(!v)return'—';try{return new Date(v).toLocaleString('ar')}catch(e){return esc(v)}}

function defaultsFor(module){const def=ENTITIES[module],out={version:'1.0.0',updatedAt:now()};Object.keys(def.items).forEach(k=>out[k]=[]);return out}
function loadModule(module){
  if(CACHE.has(module))return CACHE.get(module);
  const def=ENTITIES[module],fallback=defaultsFor(module),res=call('getState',def.namespace);
  const state=res.ok&&res.found&&res.payload?res.payload:fallback;
  Object.keys(def.items).forEach(k=>{if(!Array.isArray(state[k]))state[k]=[]});CACHE.set(module,state);return state;
}
function saveModule(module,state){const def=ENTITIES[module],res=call('saveState',def.namespace,JSON.stringify(state));if(!res.ok)throw new Error(res.error||'تعذر الحفظ');CACHE.set(module,state);return state}

function init(){
  APP=call('getAppInfo');
  if(!APP.ok){$('#erpContent').innerHTML=`<div class="erp-notice error">${esc(APP.error||'تعذر فتح النظام')}</div>`;return}
  SESSION=APP.session;
  $('#erpUserName').textContent=SESSION.fullName||SESSION.username;
  $('#erpUserRoles').textContent=(SESSION.roles||[]).map(r=>ROLE_LABELS[r]||r).join('، ');
  renderNav();bindShell();openModule('dashboard');
}
function bindShell(){
  $('#erpMenuButton').onclick=()=>$('#erpSidebar').classList.toggle('open');
  document.addEventListener('click',e=>{
    const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;
    if(action==='logout')call('logout');
    if(action==='change-password')showChangePassword();
    if(action==='close-modal')closeModal();
  });
}
function renderNav(){
  $('#erpNav').innerHTML=MODULES.filter(visibleModule).map(m=>`<button class="erp-nav-button" data-module="${m[0]}"><span class="icon">${m[3]}</span><span>${esc(m[1])}</span></button>`).join('');
  $('#erpNav').onclick=e=>{const b=e.target.closest('[data-module]');if(b)openModule(b.dataset.module)};
}
function setTitle(module){const m=MODULES.find(x=>x[0]===module)||MODULES[0];$('#erpPageTitle').textContent=m[1];$('#erpPageSubtitle').textContent=m[2];document.querySelectorAll('[data-module]').forEach(b=>b.classList.toggle('active',b.dataset.module===module));$('#erpSidebar').classList.remove('open')}
function openModule(module){CURRENT=module;CURRENT_ENTITY='';SEARCH='';setTitle(module);if(module==='dashboard')renderDashboard();else if(module==='users')renderUsers();else if(module==='audit')renderAudit();else renderModuleHome(module)}

function allStats(){
  const stats={};Object.keys(ENTITIES).forEach(m=>{if(has(ENTITIES[m].permission)||m==='billing'){try{const st=loadModule(m);stats[m]=Object.values(ENTITIES[m].items).reduce((sum,_,i)=>sum+(st[Object.keys(ENTITIES[m].items)[i]]?.length||0),0)}catch(e){stats[m]=0}}});return stats
}
function renderDashboard(){
  const stats=allStats(),pending=[];
  Object.keys(ENTITIES).forEach(m=>{if(!CACHE.has(m))return;const st=CACHE.get(m);Object.keys(ENTITIES[m].items).forEach(k=>(st[k]||[]).filter(r=>r.status==='SUBMITTED').forEach(r=>pending.push({...r,module:m,entity:k}))) });
  const cards=[['المشتريات',stats.procurement||0],['المخزون',stats.inventory||0],['الأصول',stats.assets||0],['الموظفون والرواتب',stats.hr||0]];
  $('#erpContent').innerHTML=`<div class="erp-grid">${cards.map(c=>`<article class="erp-card span-3 erp-stat"><div class="value">${c[1]}</div><div class="label">${esc(c[0])}</div></article>`).join('')}
  <article class="erp-card span-8"><h2>الوحدات المتاحة لك</h2><div class="erp-module-cards">${MODULES.filter(m=>visibleModule(m)&&!['dashboard','users','audit'].includes(m[0])).map(m=>`<button class="erp-module-card" data-open="${m[0]}"><b>${m[3]} ${esc(m[1])}</b><small>${esc(m[2])}</small></button>`).join('')}</div></article>
  <article class="erp-card span-4"><h2>طلبات بانتظار الاعتماد</h2>${pending.length?`<div class="erp-kpi-list">${pending.slice(0,8).map(r=>`<div class="erp-kpi-row"><span>${esc(r.no||r.id)}</span>${statusBadge(r.status)}</div>`).join('')}</div>`:'<div class="erp-empty">لا توجد طلبات معلقة</div>'}</article>
  <article class="erp-card"><h2>سياسة التحكم</h2><p>الصلاحيات تطبق داخل Android وSQLite، وليست مجرد إخفاء أزرار. السجلات المعتمدة لا تُحذف؛ يتم عكسها أو أرشفتها مع حفظ الأثر.</p><div class="erp-progress"><span style="width:72%"></span></div><small>اكتمال نواة ERP الموحدة: الهوية، الصلاحيات، الوحدات، دورة الاعتماد الأساسية.</small></article></div>`;
  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openModule(b.dataset.open));
}
function entityVisible(module,key){if(module!=='billing'||has('MANAGE_BILLING'))return true;if(key==='readings')return has('CAPTURE_READINGS');if(key==='payments')return has('COLLECT_PAYMENTS')||has('MANAGE_CASHBOX');return false}
function renderModuleHome(module){
  const def=ENTITIES[module];if(!def){openModule('dashboard');return}const state=loadModule(module);
  $('#erpContent').innerHTML=`<div class="erp-grid"><article class="erp-card"><h2>${esc(def.title)}</h2><div class="erp-module-cards">${Object.entries(def.items).filter(([key])=>entityVisible(module,key)).map(([key,e])=>`<button class="erp-module-card" data-entity="${key}"><b>${esc(e.title)}</b><small>${(state[key]||[]).length} سجل</small></button>`).join('')}</div></article></div>`;
  document.querySelectorAll('[data-entity]').forEach(b=>b.onclick=()=>renderEntity(module,b.dataset.entity));
}
function renderEntity(module,entity){
  CURRENT=module;CURRENT_ENTITY=entity;const def=ENTITIES[module],e=def.items[entity],state=loadModule(module),rows=(state[entity]||[]).filter(r=>!SEARCH||JSON.stringify(r).toLowerCase().includes(SEARCH.toLowerCase()));
  setTitle(module);$('#erpPageSubtitle').textContent=e.title;
  const headers=['الرقم',...e.fields.slice(0,4).map(f=>f[1]),'الحالة','الإجراءات'];
  $('#erpContent').innerHTML=`<article class="erp-card"><div class="erp-toolbar"><button class="erp-button" id="addRecord">إضافة سجل</button><button class="erp-button secondary" id="backModule">رجوع للوحدة</button><input class="erp-search" id="entitySearch" placeholder="بحث…" value="${esc(SEARCH)}"></div><div class="erp-table-wrap"><table class="erp-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>recordRow(module,entity,e,r)).join(''):`<tr><td colspan="${headers.length}" class="erp-empty">لا توجد سجلات</td></tr>`}</tbody></table></div></article>`;
  $('#addRecord').onclick=()=>showRecordForm(module,entity,null);$('#backModule').onclick=()=>renderModuleHome(module);$('#entitySearch').oninput=e2=>{SEARCH=e2.target.value;renderEntity(module,entity)};
  document.querySelectorAll('[data-record-action]').forEach(b=>b.onclick=()=>recordAction(module,entity,b.dataset.id,b.dataset.recordAction));
}
function recordRow(module,entity,e,r){const values=e.fields.slice(0,4).map(f=>`<td>${f[2]==='checkbox'?(r[f[0]]?'نعم':'لا'):esc(r[f[0]]||'—')}</td>`).join('');return`<tr><td><b>${esc(r.no||r.id)}</b><small style="display:block;color:#627d98">${formatDate(r.updatedAt)}</small></td>${values}<td>${statusBadge(r.status)}</td><td><div class="erp-toolbar"><button class="erp-button secondary small" data-record-action="edit" data-id="${esc(r.id)}">تعديل</button>${r.status==='DRAFT'?`<button class="erp-button warning small" data-record-action="submit" data-id="${esc(r.id)}">إرسال</button><button class="erp-button danger small" data-record-action="delete" data-id="${esc(r.id)}">حذف</button>`:''}${r.status==='SUBMITTED'?`<button class="erp-button success small" data-record-action="approve" data-id="${esc(r.id)}">اعتماد</button><button class="erp-button danger small" data-record-action="reject" data-id="${esc(r.id)}">رفض</button>`:''}${r.status==='APPROVED'?`<button class="erp-button secondary small" data-record-action="archive" data-id="${esc(r.id)}">أرشفة</button>`:''}</div></td></tr>`}
function showRecordForm(module,entity,record){
  const e=ENTITIES[module].items[entity],r=record||{};
  openModal(record?`تعديل ${e.title}`:`إضافة إلى ${e.title}`,`<div class="erp-form-grid">${e.fields.map(f=>fieldHtml(f,r[f[0]])).join('')}</div><div class="erp-toolbar" style="margin-top:16px"><button class="erp-button success" id="saveRecord">حفظ</button><button class="erp-button secondary" data-action="close-modal">إلغاء</button></div>`);
  $('#saveRecord').onclick=()=>{try{
    const state=JSON.parse(JSON.stringify(loadModule(module))),rows=state[entity],existing=record&&rows.find(x=>x.id===record.id),data={};
    e.fields.forEach(f=>{const el=document.getElementById('f_'+f[0]);data[f[0]]=f[2]==='checkbox'?el.checked:f[2]==='lines'?parseLines(el.value):f[2]==='payrollLines'?parsePayrollLines(el.value):el.value});
    normalizeRecordData(module,entity,data);
    if(existing){
      if(existing.status!=='DRAFT'&&existing.status!=='REJECTED')throw new Error('لا يمكن تعديل سجل معتمد أو مرسل؛ استخدم الإلغاء أو الأرشفة');
      Object.assign(existing,data,{updatedAt:now(),updatedBy:SESSION.userId})
    }else rows.push({...data,id:uid(e.prefix),no:`${e.prefix}-${String(rows.length+1).padStart(5,'0')}`,status:'DRAFT',createdAt:now(),createdBy:SESSION.userId,updatedAt:now(),updatedBy:SESSION.userId});
    saveModule(module,state);closeModal();renderEntity(module,entity);notice('تم حفظ السجل','success')
  }catch(err){notice(err.message,'error')}}
}
function fieldHtml(f,value){
  const[id,label,type,options]=f;
  if(type==='textarea')return`<div class="erp-field full"><label>${esc(label)}</label><textarea id="f_${id}" rows="3">${esc(value||'')}</textarea></div>`;
  if(type==='lines')return`<div class="erp-field full"><label>${esc(label)}</label><textarea id="f_${id}" rows="6" placeholder="مثال: أنبوب 2 بوصة | 10 | قطعة | 2500">${esc(linesToText(value))}</textarea><small>سطر مستقل لكل بند، وتُحسب القيمة تلقائيًا من الكمية × سعر الوحدة.</small></div>`;
  if(type==='payrollLines'){
    let employees=[];try{employees=loadModule(options.module)[options.entity]||[]}catch(e){}
    const guide=employees.map(r=>`${r.id}: ${r.name||r.employeeNo||r.id}`).join('، ');
    return`<div class="erp-field full"><label>${esc(label)}</label><textarea id="f_${id}" rows="7" placeholder="EMP-ID | 100000 | 15000 | 5000">${esc(payrollLinesToText(value))}</textarea><small>الموظفون المتاحون: ${esc(guide||'أضف الموظفين أولًا')}</small></div>`
  }
  if(type==='checkbox')return`<label class="erp-check"><input id="f_${id}" type="checkbox" ${value?'checked':''}> ${esc(label)}</label>`;
  if(type==='select')return`<div class="erp-field"><label>${esc(label)}</label><select id="f_${id}"><option value="">اختر…</option>${(options||[]).map(o=>`<option value="${esc(o[0])}" ${String(value||'')===String(o[0])?'selected':''}>${esc(o[1])}</option>`).join('')}</select></div>`;
  if(type==='reference'){
    let rows=[];try{rows=loadModule(options.module)[options.entity]||[]}catch(e){}
    const known=rows.some(r=>String(r.id)===String(value||'')),legacy=value&&!known?`<option value="${esc(value)}" selected>${esc(value)} (قيمة سابقة)</option>`:'';
    return`<div class="erp-field"><label>${esc(label)}</label><select id="f_${id}"><option value="">اختر…</option>${legacy}${rows.filter(r=>!['ARCHIVED','REJECTED'].includes(r.status)).map(r=>`<option value="${esc(r.id)}" ${String(value||'')===String(r.id)?'selected':''}>${esc(r.no||r.code||r.sku||r.name||r.id)}</option>`).join('')}</select></div>`
  }
  if(type==='referenceText'){
    let rows=[];try{rows=loadModule(options.module)[options.entity]||[]}catch(e){}
    const listId=`list_${id}`;
    return`<div class="erp-field"><label>${esc(label)}</label><input id="f_${id}" list="${listId}" value="${esc(value||'')}"><datalist id="${listId}">${rows.map(r=>`<option value="${esc(r.id)}">${esc(r.no||r.code||r.assetCode||r.name||r.id)}</option>`).join('')}</datalist></div>`
  }
  return`<div class="erp-field"><label>${esc(label)}</label><input id="f_${id}" type="${type}" value="${esc(value||'')}"></div>`
}
function linesToText(lines){return Array.isArray(lines)?lines.map(l=>[l.description||l.item||l.itemId||'',l.quantity||'',l.unit||'',l.unitCost??''].join(' | ')).join('\n'):''}
function parseLines(text){
  return String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map((line,index)=>{
    const parts=line.split('|').map(x=>x.trim());
    if(parts.length<4)throw new Error(`البند ${index+1}: استخدم الصيغة الوصف | الكمية | الوحدة | سعر الوحدة`);
    const quantity=Number(parts[1].replace(/,/g,'')),unitCost=Number(parts[3].replace(/,/g,''));
    if(!parts[0]||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unitCost)||unitCost<0)throw new Error(`البند ${index+1}: تحقق من الوصف والكمية والسعر`);
    return{description:parts[0],quantity,unit:parts[2],unitCost,lineTotal:quantity*unitCost}
  })
}
function payrollLinesToText(lines){return Array.isArray(lines)?lines.map(l=>[l.employeeId||'',l.basicSalary??'',l.allowances??'',l.deductions??''].join(' | ')).join('\n'):''}
function parsePayrollLines(text){
  return String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map((line,index)=>{
    const parts=line.split('|').map(x=>x.trim());
    if(parts.length<4||!parts[0])throw new Error(`سطر الراتب ${index+1}: استخدم المعرّف | الأساسي | البدلات | الاستقطاعات`);
    const basicSalary=Number(parts[1].replace(/,/g,'')),allowances=Number(parts[2].replace(/,/g,'')),deductions=Number(parts[3].replace(/,/g,''));
    if(![basicSalary,allowances,deductions].every(Number.isFinite)||Math.min(basicSalary,allowances,deductions)<0||deductions>basicSalary+allowances)throw new Error(`سطر الراتب ${index+1}: تحقق من المبالغ والاستقطاع`);
    return{employeeId:parts[0],basicSalary,allowances,deductions,net:basicSalary+allowances-deductions}
  })
}
function normalizeRecordData(module,entity,data){
  if(Array.isArray(data.lines)){
    const total=data.lines.reduce((sum,line)=>sum+Number(line.lineTotal||0),0);
    if(entity==='purchaseRequests')data.estimatedAmount=total;
    if(entity==='purchaseOrders')data.amount=total;
    if(module==='maintenance'&&entity==='workOrders')data.actualCost=Math.max(Number(data.actualCost||0),total)
  }
  if(module==='inventory'&&entity==='movements')data.totalCost=Number(data.quantity||0)*Number(data.unitCost||0);
  if(module==='assets'&&entity==='depreciationRuns')data.closingValue=Math.max(0,Number(data.openingValue||0)-Number(data.depreciation||0));
  if(module==='hr'&&entity==='payrollRuns'&&Array.isArray(data.lines)){
    data.gross=data.lines.reduce((sum,line)=>sum+line.basicSalary+line.allowances,0);
    data.deductions=data.lines.reduce((sum,line)=>sum+line.deductions,0);
    data.net=data.lines.reduce((sum,line)=>sum+line.net,0)
  }
}
function recordAction(module,entity,id,action){
  try{
    const state=JSON.parse(JSON.stringify(loadModule(module))),rows=state[entity],r=rows.find(x=>x.id===id);
    if(!r)throw new Error('السجل غير موجود');
    if(action==='edit'){showRecordForm(module,entity,r);return}
    if(action==='delete'){
      if(r.status!=='DRAFT')throw new Error('الحذف مسموح للمسودة فقط');
      if(!confirm('حذف المسودة نهائيًا؟'))return;
      state[entity]=rows.filter(x=>x.id!==id)
    }
    if(action==='submit'){
      if(r.status!=='DRAFT'&&r.status!=='REJECTED')throw new Error('لا يمكن الإرسال من الحالة الحالية');
      r.status='SUBMITTED'
    }
    if(action==='approve'){
      requireApproval(module);
      if(r.status!=='SUBMITTED')throw new Error('يجب إرسال السجل للمراجعة قبل اعتماده');
      r.status='APPROVED';r.approvedAt=now();r.approvedBy=SESSION.userId;r.updatedAt=now();r.updatedBy=SESSION.userId;
      const posting=call('approveErpRecord',module,entity,JSON.stringify(r),JSON.stringify(state));
      if(!posting.ok)throw new Error(posting.error||'تعذر اعتماد السجل والقيد المحاسبي');
      CACHE.set(module,state);renderEntity(module,entity);
      notice(posting.posted?(posting.message||'تم الاعتماد وإنشاء القيد المحاسبي'):'تم الاعتماد ضمن معاملة آمنة','success');
      return
    }
    if(action==='reject'){requireApproval(module);r.status='REJECTED';r.rejectedAt=now();r.rejectedBy=SESSION.userId}
    if(action==='archive'){
      if(r.status!=='APPROVED')throw new Error('تُؤرشف السجلات المعتمدة فقط');
      r.status='ARCHIVED';r.archivedAt=now();r.archivedBy=SESSION.userId
    }
    r.updatedAt=now();r.updatedBy=SESSION.userId;
    saveModule(module,state);renderEntity(module,entity);notice('تم تحديث حالة السجل','success')
  }catch(e){notice(e.message,'error')}
}
function requireApproval(module){const map={procurement:'APPROVE_PROCUREMENT',inventory:'APPROVE_INVENTORY',accounting:'APPROVE_ACCOUNTING',hr:'APPROVE_PAYROLL',maintenance:'APPROVE_MAINTENANCE'};const p=map[module];if(p&&!has(p))throw new Error('لا تملك صلاحية الاعتماد لهذه الوحدة')}

function renderUsers(){
  const res=call('listUsers',false);if(!res.ok){$('#erpContent').innerHTML=`<div class="erp-notice error">${esc(res.error)}</div>`;return}const rows=res.users||[];
  $('#erpContent').innerHTML=`<article class="erp-card"><div class="erp-toolbar"><button class="erp-button" id="addUser">إضافة مستخدم</button><button class="erp-button secondary" id="showArchived">عرض المؤرشف</button></div><div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>المستخدم</th><th>اسم الدخول</th><th>الأدوار</th><th>الحالة</th><th>آخر دخول</th><th>الإجراءات</th></tr></thead><tbody>${rows.map(userRow).join('')||'<tr><td colspan="6" class="erp-empty">لا يوجد مستخدمون</td></tr>'}</tbody></table></div></article>`;
  $('#addUser').onclick=()=>showUserForm(null,res.roles||[]);$('#showArchived').onclick=()=>renderArchivedUsers(res.roles||[]);document.querySelectorAll('[data-user-action]').forEach(b=>b.onclick=()=>userAction(b.dataset.id,b.dataset.userAction,res.roles||[]));
}
function userRow(u){return`<tr><td><b>${esc(u.fullName)}</b></td><td dir="ltr">@${esc(u.username)}</td><td>${(u.roles||[]).map(r=>`<span class="erp-badge">${esc(ROLE_LABELS[r]||r)}</span>`).join(' ')}</td><td>${u.active?'<span class="erp-badge approved">نشط</span>':'<span class="erp-badge rejected">موقوف</span>'}${u.mustChangePassword?' <span class="erp-badge submitted">تغيير كلمة المرور مطلوب</span>':''}</td><td>${u.lastLoginAt?formatDate(u.lastLoginAt):'لم يدخل'}</td><td><div class="erp-toolbar"><button class="erp-button secondary small" data-user-action="edit" data-id="${esc(u.id)}">تعديل</button><button class="erp-button warning small" data-user-action="reset" data-id="${esc(u.id)}">إعادة كلمة المرور</button><button class="erp-button ${u.active?'danger':'success'} small" data-user-action="toggle" data-id="${esc(u.id)}">${u.active?'إيقاف':'تفعيل'}</button><button class="erp-button danger small" data-user-action="delete" data-id="${esc(u.id)}">حذف/أرشفة</button></div></td></tr>`}
function permissionOverrideEditor(user,roles){const current=new Map((user?.permissionOverrides||[]).map(x=>[x.permission,x.granted?'allow':'deny'])),permissions=[...new Set((roles||[]).flatMap(r=>r.permissions||[]))].sort();return`<div class="erp-permission-grid">${permissions.map(p=>`<div class="erp-field"><label>${esc(PERMISSION_LABELS[p]||p)}</label><select name="uPermission" data-permission="${esc(p)}"><option value="inherit" ${!current.has(p)?'selected':''}>حسب الدور</option><option value="allow" ${current.get(p)==='allow'?'selected':''}>سماح إضافي</option><option value="deny" ${current.get(p)==='deny'?'selected':''}>منع لهذا المستخدم</option></select></div>`).join('')}</div>`}
function readPermissionOverrides(){return[...document.querySelectorAll('select[name="uPermission"]')].filter(x=>x.value!=='inherit').map(x=>({permission:x.dataset.permission,granted:x.value==='allow'}))}
function showUserForm(user,roles){const selected=new Set(user?.roles||[]);openModal(user?'تعديل المستخدم':'إضافة مستخدم',`<div class="erp-form-grid"><div class="erp-field"><label>الاسم الكامل</label><input id="uName" value="${esc(user?.fullName||'')}"></div><div class="erp-field"><label>اسم المستخدم</label><input id="uUsername" dir="ltr" ${user?'disabled':''} value="${esc(user?.username||'')}"></div>${user?'':'<div class="erp-field full"><label>كلمة مرور مؤقتة</label><input id="uPassword" type="password" placeholder="8 محارف على الأقل وتتضمن حرفًا ورقمًا"></div>'}</div><h3>الأدوار</h3><div class="erp-permission-grid">${roles.map(r=>`<label class="erp-check"><input type="checkbox" name="uRole" value="${esc(r.code)}" ${selected.has(r.code)?'checked':''}> ${esc(r.label||ROLE_LABELS[r.code]||r.code)}</label>`).join('')}</div><h3>استثناءات الصلاحيات</h3><p>اتركها «حسب الدور» عادةً. السماح أو المنع هنا يتغلب على صلاحيات الدور لهذا المستخدم فقط.</p>${permissionOverrideEditor(user,roles)}<div class="erp-toolbar" style="margin-top:16px"><button class="erp-button success" id="saveUser">حفظ</button><button class="erp-button secondary" data-action="close-modal">إلغاء</button></div>`);$('#saveUser').onclick=()=>{const payload={id:user?.id,fullName:$('#uName').value,username:$('#uUsername').value,temporaryPassword:$('#uPassword')?.value||'',roles:[...document.querySelectorAll('input[name="uRole"]:checked')].map(x=>x.value),permissionOverrides:readPermissionOverrides()};const res=user?call('updateUser',JSON.stringify(payload)):call('createUser',JSON.stringify(payload));if(!res.ok){notice(res.error,'error');return}closeModal();renderUsers();notice(res.message||'تم حفظ المستخدم','success')}}
function userAction(id,action,roles){const res=call('listUsers',true),u=res.ok?(res.users||[]).find(x=>x.id===id):null;if(!u){notice('المستخدم غير موجود','error');return}if(action==='edit'){showUserForm(u,roles);return}if(action==='reset'){openModal('إعادة تعيين كلمة المرور',`<div class="erp-field"><label>كلمة المرور المؤقتة الجديدة</label><input id="tempPassword" type="password"></div><p>سيُجبر المستخدم على تغييرها عند أول دخول.</p><button class="erp-button warning" id="doReset">إعادة التعيين</button>`);$('#doReset').onclick=()=>{const x=call('resetUserPassword',id,$('#tempPassword').value);if(!x.ok){notice(x.error,'error');return}closeModal();renderUsers();notice(x.message,'success')};return}if(action==='toggle'){const x=call('setUserActive',id,!u.active);if(!x.ok)notice(x.error,'error');else{renderUsers();notice(x.message,'success')}return}if(action==='delete'){if(!confirm('سيُحذف الحساب إن لم يُستخدم، وإلا سيُؤرشف مع حفظ السجل. متابعة؟'))return;const x=call('deleteUser',id);if(!x.ok)notice(x.error,'error');else{renderUsers();notice(x.message,'success')}}}
function renderArchivedUsers(roles){const res=call('listUsers',true);if(!res.ok){notice(res.error,'error');return}const rows=(res.users||[]).filter(u=>u.archivedAt);openModal('المستخدمون المؤرشفون',rows.length?`<div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>الاسم</th><th>اسم الدخول</th><th>تاريخ الأرشفة</th></tr></thead><tbody>${rows.map(u=>`<tr><td>${esc(u.fullName)}</td><td dir="ltr">${esc(u.username)}</td><td>${formatDate(u.archivedAt)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="erp-empty">لا توجد حسابات مؤرشفة</div>')}
function showChangePassword(){openModal('تغيير كلمة المرور',`<div class="erp-form-grid"><div class="erp-field full"><label>كلمة المرور الحالية</label><input id="oldPass" type="password"></div><div class="erp-field"><label>الجديدة</label><input id="newPass" type="password"></div><div class="erp-field"><label>التأكيد</label><input id="confirmPass" type="password"></div></div><button class="erp-button success" id="changePass" style="margin-top:14px">تغيير كلمة المرور</button>`);$('#changePass').onclick=()=>{if($('#newPass').value!==$('#confirmPass').value){notice('كلمتا المرور غير متطابقتين','error');return}const r=call('changeOwnPassword',$('#oldPass').value,$('#newPass').value);if(!r.ok)notice(r.error,'error');else{closeModal();notice(r.message,'success')}}}
function renderAudit(){const res=call('getIdentityAudit',300);if(!res.ok){$('#erpContent').innerHTML=`<div class="erp-notice error">${esc(res.error)}</div>`;return}$('#erpContent').innerHTML=`<article class="erp-card"><h2>سجل الهوية والأمان</h2><div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>الوقت</th><th>العملية</th><th>المنفذ</th><th>المستخدم المستهدف</th><th>التفاصيل</th></tr></thead><tbody>${(res.rows||[]).map(r=>`<tr><td>${formatDate(r.createdAt)}</td><td>${esc(r.action)}</td><td>${esc(r.actorUserId||'—')}</td><td>${esc(r.targetUserId||'—')}</td><td>${esc(r.details||'')}</td></tr>`).join('')||'<tr><td colspan="5" class="erp-empty">لا توجد أحداث</td></tr>'}</tbody></table></div></article>`}

function openModal(title,html){$('#erpModalTitle').textContent=title;$('#erpModalBody').innerHTML=html;$('#erpModal').hidden=false}
function closeModal(){$('#erpModal').hidden=true;$('#erpModalBody').innerHTML=''}

document.addEventListener('DOMContentLoaded',init);
})();