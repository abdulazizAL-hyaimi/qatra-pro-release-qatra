/* Qatra Pro 2.9.13: create the next open assignment cycle from latest readings and distribute it in one step. */
(function(global){
'use strict';
let installed=false;
const today=()=>new Date().toISOString().slice(0,10);
const uid=(prefix='CYC')=>`${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
function emptyState(){return{meta:{version:'2.0.0-secure'},settings:{projectName:'قطرة برو'},subscribers:[],cycles:[],readings:[],invoices:[],payments:[],expenses:[]};}
function loadState(){return QatraStore.load('admin',emptyState,['qatra_pro_v6_editable_cycles_from_gray_excel']);}
function saveState(state){QatraStore.save('admin',state);}
function selectedCycleId(){return document.querySelector('#managerReaderRoot select[onchange*="selectCycle"]')?.value||'';}
function cycleById(state,id){return(state.cycles||[]).find(cycle=>String(cycle.id)===String(id));}
function addDays(date,days){const value=new Date(`${date}T00:00:00`);value.setDate(value.getDate()+days);return value.toISOString().slice(0,10);}
function cycleHasReadings(state,cycle){return!!cycle&&(state.readings||[]).some(reading=>String(reading.cycleId)===String(cycle.id));}
function latestSavedCycle(state){
  return(state.cycles||[]).filter(cycle=>cycleHasReadings(state,cycle)).sort((a,b)=>String(b.cycleDate||'').localeCompare(String(a.cycleDate||'')))[0]||null;
}
function latestSavedDate(state){return latestSavedCycle(state)?.cycleDate||'';}
function suggestedDate(state){const latest=latestSavedDate(state);if(!latest)return today();return today()>latest?today():addDays(latest,1);}
function latestMainCurrent(state,beforeDate){
  const rows=(state.cycles||[]).filter(cycle=>cycle.type==='MONTHLY'&&cycle.mainCurrent!==''&&cycle.mainCurrent!==null&&cycle.mainCurrent!==undefined&&String(cycle.cycleDate||'')<String(beforeDate||'9999-12-31')).sort((a,b)=>String(b.cycleDate||'').localeCompare(String(a.cycleDate||'')));
  return rows.length?Number(rows[0].mainCurrent||0):Number(state.settings?.mainMeterOpeningReading||0);
}
function selectedCycleState(){const state=loadState();return{state,cycle:cycleById(state,selectedCycleId())};}
function formValues(state){return{type:document.getElementById('readerNextCycleType')?.value||'MONTHLY',date:document.getElementById('readerNextCycleDate')?.value||suggestedDate(state)};}
function ensureAssignmentCycle(autoDistribute=false){
  const state=loadState(),values=formValues(state),type=values.type,date=values.date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){alert('أدخل تاريخًا صحيحًا للدورة الجديدة.');return null;}
  const latest=latestSavedDate(state);
  if(latest&&date<=latest){alert(`يجب أن يكون تاريخ دورة التكليف الجديدة بعد آخر دورة تحتوي قراءات (${latest}).`);return null;}
  let cycle=(state.cycles||[]).find(item=>item.type===type&&item.cycleDate===date);
  if(cycle){
    if(String(cycle.status||'').toLowerCase()==='closed'||cycleHasReadings(state,cycle)){alert('توجد دورة مكتملة أو مغلقة بهذا النوع والتاريخ. اختر تاريخًا لاحقًا.');return null;}
  }else{
    const source=latestSavedCycle(state);
    cycle={id:uid('CYC'),type,cycleDate:date,periodLabel:type==='HALF'?'دورة نصف الشهر - يوم 14':'دورة نهاية الشهر - يوم 28',mainPrev:type==='MONTHLY'?latestMainCurrent(state,date):'',mainCurrent:'',status:'open',createdAt:new Date().toISOString(),source:'reader-assignment-handoff',sourceCycleId:source?.id||'',sourceCycleDate:source?.cycleDate||''};
    state.cycles=state.cycles||[];state.cycles.push(cycle);saveState(state);
  }
  ManagerReader.selectCycle(encodeURIComponent(cycle.id));
  if(autoDistribute){
    setTimeout(()=>{
      ManagerReader.autoSplit();
      alert('تم إنشاء دورة التكليف التالية وتوزيع غير المقروءين. آخر قراءة معتمدة لكل مشترك أصبحت القراءة السابقة في ملف الكاشف. صدّر الآن ملف كل كاشف.');
    },120);
  }else alert('تم إنشاء أو اختيار دورة تكليف مفتوحة. آخر قراءة معتمدة أصبحت القراءة السابقة تلقائيًا.');
  return cycle;
}
function createAssignmentCycle(){return ensureAssignmentCycle(false);}
function createAndDistribute(){return ensureAssignmentCycle(true);}
function blockClosed(actionName){
  const {state,cycle}=selectedCycleState();if(!cycle)return false;
  if(String(cycle.status||'').toLowerCase()==='closed'){
    alert(`لا يمكن ${actionName} من دورة مغلقة؛ لأنها تحفظ القراءات السابقة ولا تمثل تكليفًا جديدًا. استخدم «إنشاء الدورة التالية وتوزيعها تلقائيًا».`);return true;
  }
  const eligible=(state.subscribers||[]).filter(subscriber=>subscriber.status!=='stopped'&&(cycle.type==='HALF'?subscriber.readingGroup==='HALF':true));
  const readIds=new Set((state.readings||[]).filter(reading=>String(reading.cycleId)===String(cycle.id)).map(reading=>reading.subscriberId));
  if(eligible.length&&eligible.every(subscriber=>readIds.has(subscriber.id))){
    alert(`لا يمكن ${actionName} لأن جميع مشتركي الدورة مقروءون. أنشئ الدورة التالية ليتم إرسال آخر القراءات كقراءات سابقة.`);return true;
  }
  return false;
}
function injectPanel(){
  const root=document.getElementById('managerReaderRoot');if(!root||root.querySelector('[data-reader-cycle-handoff]'))return;
  const state=loadState(),cycle=cycleById(state,selectedCycleId()),date=suggestedDate(state),closed=String(cycle?.status||'').toLowerCase()==='closed',completedCount=cycle?(state.readings||[]).filter(reading=>String(reading.cycleId)===String(cycle.id)).length:0,source=latestSavedCycle(state);
  const card=document.createElement('div');card.className='card';card.dataset.readerCycleHandoff='1';
  card.innerHTML=`<h2>تصدير آخر القراءات للكاشفين</h2><div class="notice ${closed||completedCount?'warning':'success'}"><b>${closed?'الدورة المختارة مغلقة.':completedCount?'الدورة المختارة تحتوي قراءات محفوظة.':'جاهز لإنشاء دورة التكليف التالية.'}</b><br>الدورة القديمة تبقى مرجعًا محفوظًا ولا تُرسل مرة أخرى. ينشئ النظام دورة مفتوحة بتاريخ لاحق ويضع آخر قراءة${source?` من دورة ${source.cycleDate}`:''} تلقائيًا في خانة «القراءة السابقة»، ثم يوزع المشتركين على الكاشفين.</div><div class="form-row"><div class="field"><label>نوع دورة التكليف التالية</label><select id="readerNextCycleType"><option value="HALF" ${cycle?.type==='HALF'?'selected':''}>نصف الشهر</option><option value="MONTHLY" ${cycle?.type!=='HALF'?'selected':''}>نهاية الشهر</option></select></div><div class="field"><label>تاريخ دورة التكليف التالية</label><input id="readerNextCycleDate" type="date" value="${date}"></div></div><div class="toolbar"><button class="green" onclick="QatraReaderCycleHandoff.createAndDistribute()">إنشاء الدورة التالية وتوزيعها تلقائيًا</button><button class="light" onclick="QatraReaderCycleHandoff.createAssignmentCycle()">إنشاء فقط</button></div>`;
  const target=Array.from(root.children).find(node=>node.classList?.contains('workflow-steps'));if(target)target.insertAdjacentElement('afterend',card);else root.prepend(card);
}
function install(){
  if(!global.ManagerReader||!global.QatraStore)return setTimeout(install,200);
  if(!ManagerReader.__readerCycleHandoffWrappedV2913){
    const originalAuto=ManagerReader.autoSplit,originalExport=ManagerReader.exportAssignment;
    ManagerReader.autoSplit=function(){if(blockClosed('توزيع المشتركين'))return;return originalAuto.apply(this,arguments);};
    ManagerReader.exportAssignment=function(){if(blockClosed('تصدير ملف التكليف'))return;return originalExport.apply(this,arguments);};
    ManagerReader.__readerCycleHandoffWrappedV2913=true;
  }
  global.QatraReaderCycleHandoff={createAssignmentCycle,createAndDistribute};
  if(!installed){const observer=new MutationObserver(()=>setTimeout(injectPanel,0));observer.observe(document.body,{childList:true,subtree:true});installed=true;}
  injectPanel();
}
document.addEventListener('DOMContentLoaded',install);global.addEventListener('load',()=>setTimeout(install,50));
})(window);
