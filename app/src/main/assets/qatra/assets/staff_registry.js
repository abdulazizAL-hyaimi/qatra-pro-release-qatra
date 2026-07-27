/* Shared operational staff registry. Credentials and PIN values never enter JavaScript. */
(function(global){
'use strict';
const NS='admin.staff';
const ROLES={
  ADMIN:{label:'الإدارة',permissions:{ADMIN_DASHBOARD:'لوحة الإدارة',MANAGE_USERS:'إدارة المستخدمين والصلاحيات',MANAGE_SUBSCRIBERS:'إدارة المشتركين',MANAGE_READERS:'إدارة الكاشفين',MANAGE_COLLECTORS:'إدارة المحصلين',MANAGE_CASHBOX:'إدارة الصندوق',VIEW_REPORTS:'عرض التقارير',EXPORT_DATA:'تصدير البيانات'}},
  READER:{label:'الكاشف',permissions:{VIEW_ASSIGNMENTS:'عرض التكليف',CAPTURE_READINGS:'إدخال القراءات',EDIT_OWN_READINGS:'تعديل قراءاته قبل التسليم',EXPORT_READINGS:'تسليم القراءات'}},
  COLLECTOR:{label:'المحصل',permissions:{VIEW_DUES:'عرض المستحقات المكلّف بها',CREATE_RECEIPTS:'إنشاء سندات القبض',PRINT_RECEIPTS:'طباعة السندات',EXPORT_COLLECTIONS:'تسليم التحصيلات'}},
  CASHIER:{label:'الصندوق',permissions:{VIEW_CASHBOX:'عرض حركة الصندوق',DIRECT_COLLECTION:'التحصيل المباشر',RECORD_CASH_MOVEMENTS:'تسجيل حركات الصندوق',PRINT_RECEIPTS:'طباعة السندات',EXPORT_CASHBOX:'تصدير حركة الصندوق'}}
};
const clone=v=>JSON.parse(JSON.stringify(v));
const now=()=>new Date().toISOString();
const uid=()=>`USR-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
function defaults(role){return Object.keys(ROLES[role]?.permissions||{})}
function fresh(){return{version:'1.0.0',users:[],updatedAt:now()}}
function cleanCode(value){return String(value||'').trim().toUpperCase().replace(/[^A-Z]/g,'').slice(0,2)}
function cleanRole(value){const role=String(value||'').trim().toUpperCase();return ROLES[role]?role:'READER'}
function normalizeUser(raw){
  const role=cleanRole(raw?.role),allowed=new Set(Object.keys(ROLES[role].permissions));
  const permissions=Array.isArray(raw?.permissions)?raw.permissions.filter(x=>allowed.has(x)):defaults(role);
  return{id:String(raw?.id||uid()),name:String(raw?.name||'').trim(),username:String(raw?.username||'').trim().toLowerCase(),role,code:cleanCode(raw?.code),active:raw?.active!==false,permissions:[...new Set(permissions)],createdAt:raw?.createdAt||now(),updatedAt:raw?.updatedAt||now()};
}
function normalize(raw){const state=raw&&typeof raw==='object'?raw:fresh();state.version='1.0.0';state.users=Array.isArray(state.users)?state.users.map(normalizeUser):[];state.updatedAt=state.updatedAt||now();return state}
function load(){return normalize(QatraStore.load(NS,fresh))}
function save(state){const value=normalize(clone(state));value.updatedAt=now();QatraStore.save(NS,value);return value}
function all(){return load().users}
function activeByRole(role){const wanted=cleanRole(role);return all().filter(u=>u.active&&u.role===wanted)}
function find(id){return all().find(u=>String(u.id)===String(id))||null}
function generateCode(seed='',ignoreId=''){
  const used=new Set(all().filter(u=>u.id!==ignoreId).map(u=>cleanCode(u.code)).filter(Boolean));
  const letters=String(seed||'').toUpperCase().replace(/[^A-Z]/g,'');
  const candidates=[];
  if(letters.length>1){
    for(let i=1;i<letters.length;i++)candidates.push(letters[0]+letters[i]);
    candidates.push(letters.slice(0,2),letters[0]+letters[letters.length-1]);
  }
  for(const code of candidates)if(/^[A-Z]{2}$/.test(code)&&!used.has(code))return code;
  for(let a=0;a<26;a++)for(let b=0;b<26;b++){const code=String.fromCharCode(65+a)+String.fromCharCode(65+b);if(!used.has(code))return code}
  throw new Error('تم استنفاد رموز الموظفين المتاحة');
}
function validate(draft,ignoreId=''){
  const value=normalizeUser(draft),users=all();
  if(value.name.length<2)throw new Error('أدخل اسم الموظف');
  if(!/^[a-z0-9_.-]{3,32}$/.test(value.username))throw new Error('اسم المستخدم من 3 إلى 32 حرفًا إنجليزيًا أو رقمًا دون مسافات');
  if(!/^[A-Z]{2}$/.test(value.code))throw new Error('رمز الموظف يجب أن يكون حرفين إنجليزيين');
  if(!value.permissions.length)throw new Error('اختر صلاحية واحدة على الأقل');
  if(users.some(u=>u.id!==ignoreId&&u.username===value.username))throw new Error('اسم المستخدم مستخدم لموظف آخر');
  if(users.some(u=>u.id!==ignoreId&&u.code===value.code))throw new Error('رمز الموظف مستخدم لموظف آخر');
  return value;
}
global.QatraStaff={NS,ROLES,defaults,fresh,load,save,all,activeByRole,find,generateCode,validate,normalizeUser};
})(window);
