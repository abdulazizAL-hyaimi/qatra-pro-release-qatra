(function(){
'use strict';

function routeLimitedRole(event,core){
  if(core.canManage())return;
  const billing=event.target.closest('[data-module="billing"]');
  const quick=event.target.closest('[data-home-action],[data-action-index]');
  const text=(quick?.textContent||'').trim();
  let view='';
  if(billing)view='dashboard';
  else if(text.includes('قراءة'))view='readings';
  else if(text.includes('دفعة')||text.includes('سداد')||text.includes('تحصيل'))view='invoices';
  if(!view)return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  core.open(view);
}

function boot(){
  const core=window.QatraWaterCore;
  if(!core)return;
  if(core.init()){
    document.addEventListener('click',event=>routeLimitedRole(event,core),true);
    window.QatraWaterOperations={open:core.open};
  }
}

document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,0));
})();