/* Qatra Pro 2.9.12: cycle-scoped reader assignments, persistent auto distribution and approved readings. */
(()=>{
'use strict';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const numeric=value=>{const parsed=Number(String(value??'').replace(/,/g,''));return Number.isFinite(parsed)?parsed:0;};
const today=()=>new Date().toISOString().slice(0,10);
const now=()=>new Date().toISOString();
const uid=(prefix='ID')=>`${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
let selectedCycleId='';

function emptyState(){return{meta:{version:'2.0.0-secure'},settings:{projectName:'قطرة برو'},subscribers:[],cycles:[],readings:[],invoices:[],payments:[],expenses:[]};}
function loadState(){return QatraStore.load('admin',emptyState,['qatra_pro_v6_editable_cycles_from_gray_excel']);}
function freshConfig(){return{version:'1.2.0',assignments:{},assignmentsByCycle:{},savedAtByCycle:{},legacyAssignmentsMigratedToCycleId:'',issuedAssignments:[]};}
function loadConfig(){
  const source=QatraStore.load('admin.reader.config',freshConfig)||{};
  return{
    version:'1.2.0',
    assignments:source.assignments&&typeof source.assignments==='object'?source.assignments:{},
    assignmentsByCycle:source.assignmentsByCycle&&typeof source.assignmentsByCycle==='object'?source.assignmentsByCycle:{},
    savedAtByCycle:source.savedAtByCycle&&typeof source.savedAtByCycle==='object'?source.savedAtByCycle:{},
    legacyAssignmentsMigratedToCycleId:String(source.legacyAssignmentsMigratedToCycleId||''),
    issuedAssignments:Array.isArray(source.issuedAssignments)?source.issuedAssignments:[]
  };
}
function saveConfig(config){config.version='1.2.0';QatraStore.save('admin.reader.config',config);}
function cycleById(state,id){return(state.cycles||[]).find(cycle=>String(cycle.id)===String(id));}
function cycleDate(state,reading){return cycleById(state,reading.cycleId)?.cycleDate||reading.cycleDate||'';}
function baselineReading(state,subscriber,cycle){
  const rows=(state.readings||[])
    .filter(reading=>reading.subscriberId===subscriber.id&&cycleDate(state,reading)<String(cycle.cycleDate||''))
    .sort((a,b)=>cycleDate(state,b).localeCompare(cycleDate(state,a)));
  return rows[0]?numeric(rows[0].current):numeric(subscriber.openingReading);
}
function approvedReading(state,subscriber,cycle){
  return(state.readings||[]).find(reading=>String(reading.cycleId)===String(cycle.id)&&reading.subscriberId===subscriber.id)||null;
}
function eligible(state,cycle){
  return(state.subscribers||[]).filter(subscriber=>subscriber.status!=='stopped'&&(cycle.type==='HALF'?subscriber.readingGroup==='HALF':true));
}
function activeReaders(){return QatraStaff.activeByRole('READER');}
function readerOptions(readers,selected){
  return'<option value="">غير مكلّف</option>'+readers.map(reader=>`<option value="${esc(reader.id)}" ${reader.id===selected?'selected':''}>${esc(reader.code)} — ${esc(reader.name)}</option>`).join('');
}
function assignmentMap(config,cycleId,create=false){
  const key=String(cycleId||'');
  if(!key)return{};
  let map=config.assignmentsByCycle[key];
  if(!map&&create){
    map={};
    if(!config.legacyAssignmentsMigratedToCycleId&&Object.keys(config.assignments||{}).length){
      Object.assign(map,config.assignments);
      config.legacyAssignmentsMigratedToCycleId=key;
    }
    config.assignmentsByCycle[key]=map;
  }
  return map&&typeof map==='object'?map:{};
}
function markSaved(config,cycleId){config.savedAtByCycle[String(cycleId||'')]=now();}
function savedText(config,cycleId){
  const value=config.savedAtByCycle[String(cycleId||'')];
  if(!value)return'لم يُحفظ توزيع لهذه الدورة بعد';
  try{return`آخر حفظ للتوزيع: ${new Date(value).toLocaleString('ar-YE')}`;}catch(_){return`آخر حفظ للتوزيع: ${value}`;}
}
function selectCycle(encoded){selectedCycleId=decodeURIComponent(encoded);render();}
function updateAssignment(encodedSubscriberId,readerId){
  const subscriberId=decodeURIComponent(encodedSubscriberId),config=loadConfig(),map=assignmentMap(config,selectedCycleId,true);
  if(readerId)map[subscriberId]=readerId;else delete map[subscriberId];
  markSaved(config,selectedCycleId);saveConfig(config);render();
}
function cleanupCompleted(config,state,cycle){
  const map=assignmentMap(config,cycle?.id,true);
  const allowed=new Set(eligible(state,cycle).filter(subscriber=>!approvedReading(state,subscriber,cycle)).map(subscriber=>subscriber.id));
  Object.keys(map).forEach(subscriberId=>{if(!allowed.has(subscriberId))delete map[subscriberId];});
  return map;
}
function saveAssignments(renderAfter=true){
  const state=loadState(),cycle=cycleById(state,selectedCycleId),config=loadConfig();
  if(!cycle){if(renderAfter)alert('اختر دورة صحيحة أولًا.');return false;}
  const map=cleanupCompleted(config,state,cycle);
  document.querySelectorAll('[data-reader-assignment]').forEach(select=>{
    const subscriberId=select.dataset.readerAssignment;
    if(select.disabled){delete map[subscriberId];return;}
    if(select.value)map[subscriberId]=select.value;else delete map[subscriberId];
  });
  markSaved(config,cycle.id);saveConfig(config);
  if(renderAfter)render();
  return true;
}
function autoSplit(){
  const readers=activeReaders();
  if(!readers.length){alert('أضف كاشفًا نشطًا أولًا.');return;}
  const state=loadState(),cycle=cycleById(state,selectedCycleId)||(state.cycles||[])[0],config=loadConfig();
  if(!cycle){alert('أنشئ دورة قراءة أولًا.');return;}
  selectedCycleId=cycle.id;
  const map=cleanupCompleted(config,state,cycle),activeIds=new Set(readers.map(reader=>reader.id));
  Object.keys(map).forEach(subscriberId=>{if(!activeIds.has(map[subscriberId]))delete map[subscriberId];});
  const pending=eligible(state,cycle).filter(subscriber=>!approvedReading(state,subscriber,cycle));
  const counts=Object.fromEntries(readers.map(reader=>[reader.id,0]));
  pending.forEach(subscriber=>{const readerId=map[subscriber.id];if(readerId&&counts[readerId]!==undefined)counts[readerId]++;});
  let assigned=0;
  pending.forEach(subscriber=>{
    if(map[subscriber.id]&&activeIds.has(map[subscriber.id]))return;
    const reader=readers.slice().sort((a,b)=>counts[a.id]-counts[b.id]||String(a.code||'').localeCompare(String(b.code||'')))[0];
    map[subscriber.id]=reader.id;counts[reader.id]++;assigned++;
  });
  markSaved(config,cycle.id);saveConfig(config);render();
  alert(assigned?`تم توزيع ${assigned} مشترك غير مقروء وحفظ التوزيع تلقائيًا.`:'جميع غير المقروءين موزعون مسبقًا، والتوزيع محفوظ.');
}
function render(){
  const root=$('#managerReaderRoot');if(!root)return;
  const state=loadState(),config=loadConfig(),readers=activeReaders();
  const cycles=(state.cycles||[]).slice().sort((a,b)=>String(b.cycleDate||'').localeCompare(String(a.cycleDate||'')));
  if(!selectedCycleId||!cycleById(state,selectedCycleId))selectedCycleId=cycles[0]?.id||'';
  const cycle=cycleById(state,selectedCycleId),map=assignmentMap(config,selectedCycleId,false);
  const subscribers=cycle?eligible(state,cycle):[];
  const activeIds=new Set(readers.map(reader=>reader.id));
  const completed=subscribers.filter(subscriber=>approvedReading(state,subscriber,cycle)).length;
  const pending=subscribers.filter(subscriber=>!approvedReading(state,subscriber,cycle));
  const unassigned=pending.filter(subscriber=>!activeIds.has(map[subscriber.id])).length;
  const stats=readers.map(reader=>{
    const count=pending.filter(subscriber=>map[subscriber.id]===reader.id).length;
    return`<div class="card stat"><div class="label">${esc(reader.code)} — ${esc(reader.name)}</div><div class="num">${count}</div><button class="mini green" onclick="ManagerReader.exportAssignment('${encodeURIComponent(reader.id)}')">تصدير ملف التكليف</button></div>`;
  }).join('');
  const rows=subscribers.map((subscriber,index)=>{
    const base=baselineReading(state,subscriber,cycle),approved=approvedReading(state,subscriber,cycle),latest=approved?numeric(approved.current):base,complete=!!approved;
    return`<tr class="${complete?'reader-reading-complete':''}"><td>${index+1}</td><td>${esc(subscriber.code)}</td><td>${esc(subscriber.name)}</td><td>${esc(subscriber.meterNo)}</td><td>${esc(subscriber.area)}</td><td>${base}</td><td><b>${latest}</b>${complete?'<small class="locked-note">محفوظة في هذه الدورة</small>':'<small class="locked-note">بانتظار قراءة الدورة</small>'}</td><td>${complete?'<span class="badge green">مكتملة</span>':'<span class="badge warn">غير مقروء</span>'}</td><td><select data-reader-assignment="${esc(subscriber.id)}" onchange="ManagerReader.updateAssignment('${encodeURIComponent(subscriber.id)}',this.value)" ${complete?'disabled title="اكتملت قراءة هذا المشترك في الدورة الحالية"':''}>${readerOptions(readers,complete?'':map[subscriber.id])}</select></td></tr>`;
  }).join('');
  const history=config.issuedAssignments.slice(0,10).map(item=>{const reader=QatraStaff.find(item.readerId)||{};return`<tr><td>${esc(item.createdAt?.slice(0,16).replace('T',' ')||'')}</td><td>${esc(reader.code||item.readerCode)}</td><td>${esc(reader.name||'')}</td><td>${esc(item.cycleDate)}</td><td>${item.subscriberIds?.length||0}</td></tr>`;}).join('');
  root.innerHTML=`<div class="notice success"><b>آلية التكليف:</b> التوزيع محفوظ لكل دورة بشكل مستقل داخل SQLite. التوزيع التلقائي يضيف غير المقروءين فقط ويحافظ على أي توزيع يدوي سبق حفظه، ثم يبقى محفوظًا حتى تصدير ملف التكليف.</div><div class="workflow-steps"><div><b>1</b><span>اختر الدورة</span></div><div><b>2</b><span>وزّع غير المقروءين</span></div><div><b>3</b><span>احفظ أو عدّل التوزيع</span></div><div><b>4</b><span>صدّر ملف كل كاشف</span></div></div><div class="grid cards"><div class="card stat"><div class="label">الدورات</div><div class="num">${cycles.length}</div></div><div class="card stat green"><div class="label">مكتملة</div><div class="num">${completed}</div></div><div class="card stat warn"><div class="label">غير مقروءة</div><div class="num">${pending.length}</div></div><div class="card stat"><div class="label">غير موزعة</div><div class="num">${unassigned}</div></div>${stats}</div>${readers.length?'':`<div class="notice warning">أضف كاشفًا نشطًا من <a href="manager_users.html">إدارة المستخدمين والصلاحيات</a>.</div>`}<div class="card"><h2>توزيع تكليفات الكاشفين</h2>${cycles.length?`<div class="form-row"><div class="field"><label>الدورة</label><select onchange="ManagerReader.selectCycle(encodeURIComponent(this.value))">${cycles.map(item=>`<option value="${esc(item.id)}" ${item.id===selectedCycleId?'selected':''}>${esc(item.cycleDate)} — ${item.type==='HALF'?'نصف شهر':'شهري'}</option>`).join('')}</select></div></div><div class="notice ${unassigned?'warning':'success'}"><b>${savedText(config,selectedCycleId)}</b><br>${unassigned?`يوجد ${unassigned} مشترك غير مقروء لم يوزع بعد.`:'جميع غير المقروءين موزعون والتوزيع جاهز للتصدير.'}</div><div class="toolbar"><button class="green" onclick="ManagerReader.autoSplit()">توزيع تلقائي لغير المقروءين وحفظه</button><button class="secondary" onclick="ManagerReader.saveAssignments()">حفظ التوزيع الحالي</button></div><div class="table-wrap"><table><thead><tr><th>م</th><th>رقم</th><th>المشترك</th><th>العداد</th><th>الحي</th><th>أساس الدورة</th><th>آخر قراءة معتمدة</th><th>الحالة</th><th>الكاشف</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="notice warning">أنشئ دورة قراءة أولًا.</div>'}</div><div class="card"><h2>استيراد قراءات الكاشف</h2><p>يُقبل الملف فقط إذا طابق تكليفًا صادرًا وهوية كاشف مسجل والمشتركين المكلف بهم.</p><label class="file-btn">اختيار ملف القراءات المشفر<input type="file" accept=".qsync,application/octet-stream" onchange="ManagerReader.importReadings(event)"></label><div id="readerImportResult"></div></div><div class="card"><h2>آخر التكليفات الصادرة</h2><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>الرمز</th><th>الكاشف</th><th>الدورة</th><th>العدد</th></tr></thead><tbody>${history||'<tr><td colspan="5">لا توجد تكليفات محفوظة.</td></tr>'}</tbody></table></div></div>`;
}
function exportAssignment(encoded){
  if(!saveAssignments(false))return;
  const readerId=decodeURIComponent(encoded),reader=QatraStaff.find(readerId),state=loadState(),config=loadConfig(),cycle=cycleById(state,selectedCycleId),map=assignmentMap(config,selectedCycleId,false);
  if(!reader||reader.role!=='READER'||!reader.active){alert('الكاشف غير موجود أو موقوف');return;}
  if(!cycle){alert('اختر دورة صحيحة');return;}
  const rows=eligible(state,cycle).filter(subscriber=>!approvedReading(state,subscriber,cycle)).filter(subscriber=>map[subscriber.id]===reader.id).map(subscriber=>({id:subscriber.id,subscriberId:subscriber.id,code:subscriber.code,name:subscriber.name,meterNo:subscriber.meterNo,area:subscriber.area,readingGroup:subscriber.readingGroup,previousReading:baselineReading(state,subscriber,cycle)}));
  if(!rows.length){alert('لا توجد قراءات معلقة محفوظة لهذا الكاشف في الدورة المختارة. استخدم التوزيع التلقائي أولًا.');return;}
  const assignmentId=uid('RASG'),payload={meta:{type:'QATRA_READER_ASSIGNMENT',version:'3.2',id:assignmentId,assignmentId,exportedAt:now(),date:today(),readerId:reader.id,readerName:reader.name,readerUsername:reader.username,readerCode:reader.code,permissions:reader.permissions},settings:{projectName:state.settings?.projectName||'قطرة برو'},cycle:{id:cycle.id,cycleDate:cycle.cycleDate,type:cycle.type},subscribers:rows},filename=`qatra-reader-${reader.code}-${cycle.cycleDate||today()}.qsync`;
  try{QatraSync.export(filename,'READER','ASSIGN_READINGS',payload,result=>{const current=loadConfig();current.issuedAssignments.unshift({id:assignmentId,readerId:reader.id,readerCode:reader.code,cycleId:cycle.id,cycleDate:cycle.cycleDate,subscriberIds:rows.map(row=>row.subscriberId),createdAt:payload.meta.exportedAt});current.issuedAssignments=current.issuedAssignments.slice(0,100);saveConfig(current);render();alert(`تم تصدير تكليف ${reader.name} لعدد ${rows.length} مشترك غير مقروء.\nالمسار: ${result?.location||'Downloads/QatraPro/Admin'}\nاسم الدخول: ${reader.username}`);},error=>alert(error?.error||'تعذر حفظ الملف ولم يُعتمد التكليف.'));}catch(error){alert(error.message||'تعذر تصدير التكليف');}
}
function install(){
  if(typeof ManagerReader==='undefined')return;
  const originalImport=ManagerReader.importReadings;
  ManagerReader.render=render;ManagerReader.selectCycle=selectCycle;ManagerReader.updateAssignment=updateAssignment;ManagerReader.saveAssignments=saveAssignments;ManagerReader.autoSplit=autoSplit;ManagerReader.exportAssignment=exportAssignment;
  ManagerReader.importReadings=async function(event){const result=await originalImport(event);const state=loadState(),cycle=cycleById(state,selectedCycleId),config=loadConfig();if(cycle){cleanupCompleted(config,state,cycle);markSaved(config,cycle.id);saveConfig(config);}render();return result;};
  render();
}
document.addEventListener('DOMContentLoaded',install);
})();
