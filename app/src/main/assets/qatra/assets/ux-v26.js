/* Qatra Pro UX 2.6 — progressive enhancement only; business data stays untouched. */
(function(global){
'use strict';
let enhancing=false,observerInstalled=false,feedbackBound=false;
const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
const text=value=>String(value||'').trim();
const number=value=>{const parsed=Number(String(value??'').replace(/[,،\s]/g,''));return Number.isFinite(parsed)?parsed:0;};
const role=()=>document.body.classList.contains('role-reader')||document.body.classList.contains('reader-body')?'reader':document.body.classList.contains('role-collector')||document.body.classList.contains('collector-app-body')?'collector':document.body.classList.contains('role-cashier')||document.body.classList.contains('cashier-app-body')?'cashier':document.body.classList.contains('role-manager-body')?'manager':'admin';
const pageMap={
  admin:{dashboard:['الرئيسية','ملخص التشغيل وأهم الإجراءات','⌂'],readings:['القراءات','إنشاء الدورات وإدارة قراءات العدادات','◷'],invoices:['الفواتير','المراجعة والطباعة ومتابعة الأرصدة','▤'],payments:['التحصيل','تسجيل السداد ومراجعة حركة المشترك','▣'],more:['المزيد','التقارير والإعدادات وإدارة الفريق','⠿'],subscribers:['المشتركون','إدارة بيانات المشتركين والعدادات','👥'],reports:['التقارير والكشوفات','عرض وطباعة وتصدير التقارير','▤'],settings:['الإعدادات','ضبط المشروع والطباعة والتشغيل','⚙'],expenses:['المصروفات','تسجيل ومراجعة المصروفات','▾'],accounting:['المحاسبة العامة','القيود والقوائم المالية','≡'],messages:['الرسائل','إرسال الرسائل ومراجعة نتائجها','✉'],safety:['التدقيق','سجل العمليات والحماية','✓']},
  reader:{home:['الرئيسية','ملخص التكليف ونسبة الإنجاز','⌂'],readings:['القراءات','إدخال القراءة الحالية بسهولة','◷'],sync:['التسليم والمزامنة','استلام التكليف وتسليم القراءات','↥'],more:['المزيد','الإعدادات والأمان والنسخ الاحتياطي','⠿']},
  collector:{home:['الرئيسية','ملخص التحصيل والتكليف الحالي','⌂'],dues:['المستحقات','بحث سريع وتحصيل مباشر','◉'],receipts:['السندات','مراجعة السندات المحفوظة','▥'],sync:['التسليم','تسليم الحركات واستلام التحديثات','↥'],more:['المزيد','الإعدادات والأمان والنسخ الاحتياطي','⠿']},
  cashier:{home:['الرئيسية','ملخص حركة الصندوق اليومية','⌂'],transactions:['الحركات','مراجعة المقبوضات والمصروفات','⇄'],direct:['تحصيل مباشر','تسجيل حركة مالية مباشرة','＋'],sync:['التسليم','استلام وتسليم حركة الصندوق','↥'],more:['المزيد','الإعدادات والأمان والنسخ الاحتياطي','⠿']}
};

function currentTab(){
  const activeSection=$('main .tab.active,main .reader-tab.active,main .collector-tab.active,main .cashier-tab.active');
  if(activeSection?.id)return activeSection.id;
  const active=$('.compact-tabs button.active[data-tab]');
  return active?.dataset.tab||'home';
}
function contextDetails(tab){
  const map=pageMap[role()]||pageMap.admin;
  return map[tab]||[text($(`#${tab} h1,#${tab} h2`)?.textContent)||'قطرة برو','واجهة تشغيل مبسطة','•'];
}
function ensureContextBar(){
  if(role()==='manager')return;
  const main=$('main');if(!main)return;
  let bar=$('.qatra-context-bar',main);
  if(!bar){
    bar=document.createElement('section');bar.className='qatra-context-bar no-print';bar.dataset.qatraContext='1';
    bar.innerHTML='<div class="qatra-context-main"><span class="qatra-context-icon"></span><div class="qatra-context-copy"><small>QATRA PRO</small><h1></h1><p></p></div></div><span class="qatra-context-status">جاهز للعمل</span>';
    main.prepend(bar);
  }
  updateContextBar();
}
function updateContextBar(){
  const tab=currentTab(),details=contextDetails(tab),bar=$('.qatra-context-bar');
  document.body.dataset.activeTab=tab;
  if(!bar)return;
  $('.qatra-context-icon',bar).textContent=details[2];
  $('.qatra-context-copy h1',bar).textContent=details[0];
  $('.qatra-context-copy p',bar).textContent=details[1];
}
function markPrimary(buttons){
  buttons.forEach(button=>button.classList.remove('qatra-primary-action'));
  const preferred=buttons.find(button=>/حفظ|بدء|إنشاء|توزيع|استيراد|تصدير القراءات الجديدة|تسجيل|متابعة|اعتماد/.test(text(button.textContent))&&!/حذف|إلغاء|رجوع|إغلاق/.test(text(button.textContent)))||buttons.find(button=>button.classList.contains('green'))||buttons.find(button=>!button.classList.contains('light')&&!button.classList.contains('red'));
  preferred?.classList.add('qatra-primary-action');
}
function enhanceToolbars(root=document){
  $$('.toolbar,.actions,.invoice-card-actions,.reader-sheet .toolbar,.collector-modal-sheet .toolbar,.cashier-modal-sheet .toolbar',root).forEach(toolbar=>{
    toolbar.classList.add('qatra-action-toolbar');
    const buttons=$$('button,.file-btn,a',toolbar).filter(node=>!node.hidden);
    if(buttons.length)markPrimary(buttons);
    if(toolbar.closest('.reader-sheet,.collector-modal-sheet,.cashier-modal-sheet,.system-thermal-sheet,.qatra-secure-sheet'))toolbar.classList.add('qatra-sticky-actions');
  });
  $$('.reader-sheet,.collector-modal-sheet,.cashier-modal-sheet',root).forEach(sheet=>{
    const directButtons=$$(':scope > button,:scope > .file-btn',sheet);
    if(directButtons.length){
      let dock=$(':scope > .qatra-generated-action-dock',sheet);
      if(!dock){dock=document.createElement('div');dock.className='qatra-generated-action-dock qatra-action-toolbar qatra-sticky-actions';sheet.appendChild(dock);}
      directButtons.forEach(button=>dock.appendChild(button));markPrimary(directButtons);
    }
  });
}
function headerLabels(table){
  const row=table.querySelector('thead tr:last-child')||table.querySelector('tr:first-child');
  return row?Array.from(row.children).map(cell=>text(cell.textContent)):[];
}
function decorateTable(table){
  if(table.dataset.qatraUxTable==='1'||table.closest('.report-document,.accounting-print-document,.thermal,.a5'))return;
  const labels=headerLabels(table),rows=$$('tbody tr',table);
  if(labels.length<4||!rows.length)return;
  rows.forEach(row=>Array.from(row.children).forEach((cell,index)=>{if(!cell.dataset.label)cell.dataset.label=labels[index]||`حقل ${index+1}`;}));
  table.classList.add('qatra-mobile-cards');table.dataset.qatraUxTable='1';
}
function enhanceTables(root=document){$$('table',root).forEach(decorateTable);}
function fieldContainer(input){return input.closest('.field')||input.parentElement;}
function removeError(input){const field=fieldContainer(input);field?.classList.remove('qatra-field-invalid');field?.querySelector(':scope > .qatra-field-error')?.remove();}
function showError(input,message){
  const field=fieldContainer(input);if(!field)return;
  field.classList.add('qatra-field-invalid');let error=field.querySelector(':scope > .qatra-field-error');
  if(!error){error=document.createElement('small');error.className='qatra-field-error';field.appendChild(error);}error.textContent=message;
}
function validateInput(input){
  if(input.disabled||input.readOnly||input.type==='hidden')return true;
  const value=text(input.value);
  if(input.required&&!value){showError(input,'هذا الحقل مطلوب.');return false;}
  if(input.type==='number'&&value){const current=Number(value),min=input.min!==''?Number(input.min):null,max=input.max!==''?Number(input.max):null;if(Number.isFinite(min)&&current<min){showError(input,`يجب ألا تقل القيمة عن ${min}.`);return false;}if(Number.isFinite(max)&&current>max){showError(input,`يجب ألا تزيد القيمة على ${max}.`);return false;}}
  removeError(input);return true;
}
function enhanceFields(root=document){
  $$('input,select,textarea',root).forEach(input=>{
    if(input.dataset.qatraUxField==='1')return;input.dataset.qatraUxField='1';
    if(input.required){const label=fieldContainer(input)?.querySelector('label');if(label&&!label.querySelector('.qatra-required-mark'))label.insertAdjacentHTML('beforeend','<span class="qatra-required-mark">*</span>');}
    input.addEventListener('blur',()=>validateInput(input));input.addEventListener('input',()=>{if(fieldContainer(input)?.classList.contains('qatra-field-invalid'))validateInput(input);});
  });
}
function liveConsumptionForModal(){
  const input=$('#currentReading');if(!input)return;
  const field=fieldContainer(input);if(!field||field.querySelector('.qatra-live-consumption'))return;
  const box=document.createElement('div');box.className='qatra-live-consumption';box.innerHTML='<span>الاستهلاك المتوقع</span><b>0 م³</b>';field.appendChild(box);
  const update=()=>{const previous=number(input.min),current=text(input.value)===''?previous:number(input.value),consumption=Math.max(0,current-previous);box.querySelector('b').textContent=`${consumption.toLocaleString('en-US',{maximumFractionDigits:2})} م³`;box.classList.toggle('invalid',current<previous);};
  input.addEventListener('input',update);update();
}
function liveConsumptionForAdmin(root=document){
  $$('.reading-current-field .current[data-prev]',root).forEach(input=>{
    if(input.dataset.qatraUxConsumption==='1')return;input.dataset.qatraUxConsumption='1';
    input.addEventListener('input',()=>{const row=input.closest('tr'),previous=number(input.dataset.prev),current=text(input.value)===''?previous:number(input.value),consumption=Math.max(0,current-previous),cell=row?.querySelector('.cons');if(cell)cell.textContent=consumption.toLocaleString('en-US',{maximumFractionDigits:2});validateInput(input);});
  });
}
function addProgressSummary(){
  if(role()!=='reader')return;
  const hero=$('.reader-hero');if(!hero||hero.querySelector('.qatra-progress-summary'))return;
  const values=$$('.reader-stat b').map(node=>number(node.textContent));
  if(values.length<3)return;
  const total=values[0],done=values[1],percent=total?Math.round(done/total*100):0;
  hero.insertAdjacentHTML('beforeend',`<div class="qatra-progress-summary"><div class="qatra-progress-summary-head"><span>نسبة إنجاز التكليف</span><b>${percent}%</b></div><div class="qatra-progress-summary-track"><span style="width:${Math.min(100,Math.max(0,percent))}%"></span></div></div>`);
}
function enhanceEmptyStates(root=document){
  $$('.card,.reader-import,.sync-card',root).forEach(node=>{
    if(node.children.length>1)return;
    const value=text(node.textContent);
    if(/^لا توجد|^لا يوجد|^لا توجد نتائج/.test(value))node.classList.add('qatra-empty-state');
  });
}
function ensureToastRegion(){
  if($('#qatraToastRegion'))return;const region=document.createElement('div');region.id='qatraToastRegion';region.className='qatra-toast-region no-print';region.setAttribute('aria-live','polite');document.body.appendChild(region);
}
function toast(message,duration=2600){
  ensureToastRegion();const node=document.createElement('div');node.className='qatra-toast';node.textContent=message;$('#qatraToastRegion').appendChild(node);setTimeout(()=>node.remove(),duration);
}
function bindNavigation(){
  $$('.compact-tabs button[data-tab]').forEach(button=>{
    if(button.dataset.qatraUxNav==='1')return;button.dataset.qatraUxNav='1';
    button.addEventListener('click',()=>setTimeout(()=>{updateContextBar();window.scrollTo({top:0,behavior:'smooth'});},0));
  });
}
function bindSaveFeedback(){
  if(feedbackBound)return;feedbackBound=true;
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.dataset.qatraUxFeedback==='1')return;
    const label=text(button.textContent);
    if(/حفظ القراءة|حفظ التوزيع|حفظ الإعدادات|حفظ تصميم/.test(label)){button.dataset.qatraUxFeedback='1';setTimeout(()=>{toast('تم تنفيذ الإجراء. راجع الرسالة الظاهرة للتأكد من النتيجة.');delete button.dataset.qatraUxFeedback;},350);}
  },true);
}
function enhance(root=document){
  if(enhancing)return;enhancing=true;
  try{ensureContextBar();bindNavigation();enhanceToolbars(root);enhanceTables(root);enhanceFields(root);liveConsumptionForModal();liveConsumptionForAdmin(root);addProgressSummary();enhanceEmptyStates(root);}
  finally{enhancing=false;}
}
function install(){
  ensureToastRegion();enhance();bindSaveFeedback();
  if(!observerInstalled){const observer=new MutationObserver(records=>{const roots=[];records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1)roots.push(node);}));setTimeout(()=>{if(roots.length)roots.forEach(root=>enhance(root));else enhance();updateContextBar();},0);});observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});observerInstalled=true;}
  global.QatraUX={enhance,toast,validateInput};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
global.addEventListener('load',()=>setTimeout(install,60));
})(window);
