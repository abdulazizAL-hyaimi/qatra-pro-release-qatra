/* Qatra Pro 2.9.13: preflight Excel readings, preserve closed history, then hand off to a new reader cycle. */
(function(global){
'use strict';
let installed=false;
const normalize=value=>String(value||'').replace(/[\s_\-\/\\.ـ:：]+/g,'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').toLowerCase();
const aliases={
  meter:['رقم العداد','العداد','meterno','meter no'],
  current:['القراءة الحالية','قراءة حالية','الحالية','اخر قراءة','آخر قراءة','currentreading','current reading']
};
function hasAlias(headers,names){return names.some(name=>headers.some(header=>normalize(header)===normalize(name)));}
function xmlText(node){return Array.from(node?node.getElementsByTagName('t'):[]).map(item=>item.textContent||'').join('');}
function columnIndex(ref){const match=String(ref||'').match(/[A-Z]+/i);if(!match)return 0;let value=0;for(const char of match[0].toUpperCase())value=value*26+(char.charCodeAt(0)-64);return value-1;}
function parseDelimitedHeader(text){
  const first=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).find(line=>line.trim())||'';
  const delimiters=[',',';','\t'];let delimiter=',',best=-1;
  delimiters.forEach(candidate=>{let count=0,quoted=false;for(let i=0;i<first.length;i++){if(first[i]==='"')quoted=!quoted;else if(first[i]===candidate&&!quoted)count++;}if(count>best){best=count;delimiter=candidate;}});
  const cells=[];let cell='',quoted=false;
  for(let i=0;i<first.length;i++){
    const char=first[i];
    if(char==='"'){if(quoted&&first[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(char===delimiter&&!quoted){cells.push(cell.trim());cell='';}
    else cell+=char;
  }
  cells.push(cell.trim());return cells;
}
async function xlsxSignature(buffer){
  if(typeof JSZip==='undefined')throw new Error('تعذر تشغيل قارئ Excel داخل التطبيق.');
  const zip=await JSZip.loadAsync(buffer);
  const readXml=async path=>{const file=zip.file(path);if(!file)throw new Error(`ملف Excel ناقص: ${path}`);return new DOMParser().parseFromString(await file.async('text'),'application/xml');};
  let shared=[];
  if(zip.file('xl/sharedStrings.xml')){const doc=await readXml('xl/sharedStrings.xml');shared=Array.from(doc.getElementsByTagName('si')).map(xmlText);}
  const workbook=await readXml('xl/workbook.xml');
  const rels=await readXml('xl/_rels/workbook.xml.rels');
  const relationMap={};Array.from(rels.getElementsByTagName('Relationship')).forEach(relation=>relationMap[relation.getAttribute('Id')]=relation.getAttribute('Target'));
  const sheets=Array.from(workbook.getElementsByTagName('sheet'));
  if(!sheets.length)throw new Error('لا توجد ورقة عمل داخل ملف Excel.');
  const selected=sheets.find(sheet=>/قراء|reading/i.test(sheet.getAttribute('name')||''))||sheets[0];
  const sheetName=selected.getAttribute('name')||'';
  const relationId=selected.getAttribute('r:id')||selected.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
  let target=relationMap[relationId]||'worksheets/sheet1.xml';target=target.replace(/^\//,'');if(!target.startsWith('xl/'))target='xl/'+target.replace(/^\.\//,'');
  const sheet=await readXml(target);
  const rows=Array.from(sheet.getElementsByTagName('row'));
  let headers=[];
  for(const row of rows){
    const output=[];
    Array.from(row.getElementsByTagName('c')).forEach(cell=>{
      const index=columnIndex(cell.getAttribute('r')),type=cell.getAttribute('t')||'';
      let value='';
      if(type==='inlineStr')value=xmlText(cell);
      else{const raw=cell.getElementsByTagName('v')[0]?.textContent||'';value=type==='s'?(shared[Number(raw)]??''):raw;}
      output[index]=String(value??'').trim();
    });
    if(output.some(value=>String(value||'').trim())){headers=output;break;}
  }
  return{sheetName,headers};
}
async function spreadsheetSignature(file){
  const buffer=await file.arrayBuffer();
  const bytes=new Uint8Array(buffer,0,Math.min(4,buffer.byteLength));
  const zipped=bytes[0]===0x50&&bytes[1]===0x4b;
  if(zipped||/\.xlsx$/i.test(file.name||''))return xlsxSignature(buffer);
  let text='';try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch(_){text=new TextDecoder('utf-8').decode(buffer);}
  return{sheetName:'CSV',headers:parseDelimitedHeader(text)};
}
function validateReadingFile(signature){
  const headers=(signature.headers||[]).map(value=>String(value||'').trim()).filter(Boolean);
  const sheetName=String(signature.sheetName||'');
  const auditSheet=/سجل.?التدقيق|تدقيق|audit/i.test(sheetName);
  const auditColumns=hasAlias(headers,['العملية','operation'])&&hasAlias(headers,['التفاصيل','details']);
  if(auditSheet||auditColumns)throw new Error('الملف المختار هو سجل تدقيق وليس ملف قراءات. استخدم ملفًا يحتوي على عمودي «رقم العداد» و«القراءة الحالية».');
  if(!hasAlias(headers,aliases.meter)||!hasAlias(headers,aliases.current)){
    throw new Error(`هذا الملف ليس قالب قراءات صالحًا. الأعمدة الموجودة: ${headers.join(' | ')||'لا توجد عناوين'}. يجب وجود «رقم العداد» و«القراءة الحالية».`);
  }
  return true;
}
function fingerprint(cycleId){
  return (global.YWP?.state?.readings||[]).filter(row=>String(row.cycleId)===String(cycleId)).map(row=>`${row.subscriberId}:${row.prev}:${row.current}:${row.updatedAt||row.createdAt||''}`).sort().join('|');
}
function showImportError(message){
  const box=document.getElementById('readingImportResult');
  if(box)box.innerHTML=`<div class="notice danger-box">${global.YWP?.esc?YWP.esc(message):message}</div>`;
  alert(`تعذر استيراد القراءات.\n\n${message}`);
}
function injectGuide(){
  const host=document.querySelector('#cycleWork .card');
  if(!host||host.querySelector('[data-reading-import-handoff]'))return;
  const note=document.createElement('div');
  note.dataset.readingImportHandoff='1';note.className='notice success';
  note.innerHTML='<b>استيراد آخر القراءات من Excel:</b> يجوز استيراد القراءات إلى دورة مغلقة باعتبارها دورة تاريخية مرجعية. بعد الاستيراد لا توزّع الدورة المغلقة نفسها؛ افتح «إدارة الكاشف» واضغط «إنشاء الدورة التالية وتوزيعها تلقائيًا». يستخدم النظام آخر قراءة مستوردة تلقائيًا كقراءة سابقة. يجب أن يحتوي الملف على «رقم العداد» و«القراءة الحالية»؛ ملفات سجل التدقيق تُرفض قبل تغيير حالة الدورة.';
  const toolbar=host.querySelector('.cycle-actions');if(toolbar)toolbar.insertAdjacentElement('afterend',note);else host.prepend(note);
}
function install(){
  if(!global.App||!global.YWP)return setTimeout(install,200);
  if(!App.__historicalReadingImportWrappedV2913){
    const original=App.importCycleReadings;
    App.importCycleReadings=async function(event,cycleId){
      const file=event?.target?.files?.[0];if(!file)return;
      try{validateReadingFile(await spreadsheetSignature(file));}
      catch(error){if(event?.target)event.target.value='';showImportError(error?.message||'ملف القراءات غير صالح.');return;}
      const cycle=YWP.cycle(cycleId);if(!cycle)return original(event,cycleId);
      const wasClosed=String(cycle.status||'').toLowerCase()==='closed';
      if(wasClosed){
        const proceed=confirm('هذه الدورة مغلقة.\n\nسيتم استيراد الملف إليها كآخر قراءات تاريخية مرجعية فقط، ولن تُعاد الدورة المغلقة إلى الكاشفين. بعد النجاح أنشئ دورة التكليف التالية من شاشة إدارة الكاشف؛ وستنتقل القراءات تلقائيًا كقراءات سابقة.\n\nمتابعة؟');
        if(!proceed){if(event?.target)event.target.value='';return;}
      }
      const before=fingerprint(cycleId),originalStatus=cycle.status;
      if(wasClosed)cycle.status='open';
      try{await original(event,cycleId);}
      finally{if(wasClosed){cycle.status=originalStatus||'closed';YWP.save();}}
      const after=fingerprint(cycleId);
      if(after!==before){
        YWP.state.meta=YWP.state.meta||{};
        YWP.state.meta.lastHistoricalReadingImport={cycleId:String(cycleId),cycleDate:cycle.cycleDate||'',importedAt:new Date().toISOString(),wasClosed};
        YWP.save();
        setTimeout(()=>{injectGuide();alert('تم اعتماد القراءات المستوردة كآخر قراءات مرجعية.\n\nالخطوة التالية: إدارة الكاشف ← إنشاء الدورة التالية وتوزيعها تلقائيًا ← تصدير ملف كل كاشف. ستظهر آخر قراءة مستوردة في خانة القراءة السابقة.');},100);
      }
    };
    App.__historicalReadingImportWrappedV2913=true;
  }
  if(!installed){const observer=new MutationObserver(()=>setTimeout(injectGuide,0));observer.observe(document.body,{childList:true,subtree:true});installed=true;}
  injectGuide();
}
install();global.addEventListener('load',()=>setTimeout(install,50));
})(window);
