/* Qatra Pro 2.9.12: customizable text masthead and lower-left Qatra watermark. */
(function(global){
'use strict';
let applying=false,installed=false,saveWrapped=false;
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const safeColor=value=>/^#[0-9a-f]{6}$/i.test(String(value||''))?String(value):'#0b6f9c';
const cleanOpacity=value=>['0.08','0.14','0.20'].includes(String(value))?String(value):'0.14';
const normalize=value=>String(value||'').replace(/[\sـ:：\-_/]+/g,'').toLowerCase();

function ensureDefaults(save=false){
  if(!global.YWP?.state)return{};
  const settings=YWP.state.settings||(YWP.state.settings={});
  const defaults={
    reportHeaderRightLine1:settings.reportsHeaderTitle||settings.projectName||'الجهة المصدرة',
    reportHeaderRightLine2:settings.reportsHeaderSubtitle||settings.ownerName||'',
    reportHeaderCenterLine1:'تقرير رسمي',
    reportHeaderCenterLine2:settings.projectName?`صادر عن ${settings.projectName}`:'',
    reportHeaderLeftLine1:settings.documentHeaderLine1||settings.projectAddress||'',
    reportHeaderLeftLine2:settings.documentHeaderLine2||settings.projectPhone1||'',
    reportHeaderLayout:'formal',
    reportHeaderLogoPosition:'hidden',
    reportHeaderAccentColor:'#0b6f9c',
    reportBrandWatermarkEnabled:true,
    reportBrandWatermarkOpacity:'0.14'
  };
  let changed=false;
  Object.keys(defaults).forEach(key=>{
    if(settings[key]===undefined||settings[key]===null){settings[key]=defaults[key];changed=true;}
  });
  // The operator requested removing both large report logos. Apply this once to
  // existing installations, while retaining the designer option for later use.
  if(!settings.reportLogosRemovedV2913){
    settings.reportHeaderLogoPosition='hidden';
    settings.reportLogosRemovedV2913=true;
    changed=true;
  }
  if(changed&&save)YWP.save();
  return settings;
}

function logoHtml(settings,position){
  if(settings.reportHeaderLogoPosition!==position)return'';
  return`<img class="report-user-logo" src="${esc(settings.projectLogo||'assets/qatra-pro-mark.svg')}" alt="شعار الجهة">`;
}

function headerHtml(source){
  const settings=source||ensureDefaults();
  const layout=['formal','compact','minimal'].includes(settings.reportHeaderLayout)?settings.reportHeaderLayout:'formal';
  const position=['right','center','left','hidden'].includes(settings.reportHeaderLogoPosition)?settings.reportHeaderLogoPosition:'hidden';
  const accent=safeColor(settings.reportHeaderAccentColor);
  const cell=(place,main,sub)=>`<div class="report-header-cell report-header-${place}">${position!=='hidden'?logoHtml({...settings,reportHeaderLogoPosition:position},place):''}<div>${main?`<b>${esc(main)}</b>`:''}${sub?`<small>${esc(sub)}</small>`:''}</div></div>`;
  return`<div class="org-header report-org-header report-user-header layout-${layout} logo-${position}" style="--report-accent:${accent}">${cell('right',settings.reportHeaderRightLine1,settings.reportHeaderRightLine2)}${cell('center',settings.reportHeaderCenterLine1,settings.reportHeaderCenterLine2)}${cell('left',settings.reportHeaderLeftLine1,settings.reportHeaderLeftLine2)}</div>`;
}

function watermarkHtml(settings){
  if(settings.reportBrandWatermarkEnabled===false||String(settings.reportBrandWatermarkEnabled)==='false')return'';
  return`<div class="qatra-report-watermark" style="--qatra-watermark-opacity:${cleanOpacity(settings.reportBrandWatermarkOpacity)}" aria-label="Qatra Pro watermark"><img src="assets/qatra-pro-mark.svg" alt=""><span><b>QATRA PRO</b><small>نظام قطرة برو لإدارة خدمات المياه</small></span></div>`;
}

function removeDuplicateTitle(current){
  const printed=String(current.querySelector('.report-print-title h1')?.textContent||'').trim();
  if(!printed)return;
  current.querySelectorAll('h1,h2,h3').forEach(node=>{
    if(node.closest('.report-print-title,.report-screen-head,.report-user-header'))return;
    if(normalize(node.textContent)===normalize(printed))node.remove();
  });
}

function customizeReport(current,force=false){
  if(!current||applying||(!force&&current.dataset.reportCustomVersion==='2913'&&current.querySelector('.report-user-header')))return;
  applying=true;
  try{
    const settings=ensureDefaults();
    current.querySelectorAll('.org-header,.report-org-header,.v13-doc-header').forEach(node=>node.remove());
    current.insertAdjacentHTML('afterbegin',headerHtml(settings));
    current.querySelectorAll('.qatra-print-brand,.qatra-report-watermark').forEach(node=>node.remove());
    current.insertAdjacentHTML('beforeend',watermarkHtml(settings));
    removeDuplicateTitle(current);
    current.dataset.reportCustomVersion='2913';
  }finally{applying=false;}
}

function applyCurrentReport(force=false){const current=$('#currentReportHtml');if(current)customizeReport(current,force);}
function formValue(id,fallback=''){const el=document.getElementById(id);return el?el.value:fallback;}
function formChecked(id,fallback=true){const el=document.getElementById(id);return el?el.checked:fallback;}
function formSettings(){
  const settings={...ensureDefaults()};
  settings.reportHeaderRightLine1=formValue('reportCustomRight1',settings.reportHeaderRightLine1);
  settings.reportHeaderRightLine2=formValue('reportCustomRight2',settings.reportHeaderRightLine2);
  settings.reportHeaderCenterLine1=formValue('reportCustomCenter1',settings.reportHeaderCenterLine1);
  settings.reportHeaderCenterLine2=formValue('reportCustomCenter2',settings.reportHeaderCenterLine2);
  settings.reportHeaderLeftLine1=formValue('reportCustomLeft1',settings.reportHeaderLeftLine1);
  settings.reportHeaderLeftLine2=formValue('reportCustomLeft2',settings.reportHeaderLeftLine2);
  settings.reportHeaderLayout=formValue('reportCustomLayout',settings.reportHeaderLayout);
  settings.reportHeaderLogoPosition=formValue('reportCustomLogoPosition',settings.reportHeaderLogoPosition);
  settings.reportHeaderAccentColor=safeColor(formValue('reportCustomAccent',settings.reportHeaderAccentColor));
  settings.reportBrandWatermarkEnabled=formChecked('reportCustomWatermark',settings.reportBrandWatermarkEnabled!==false);
  settings.reportBrandWatermarkOpacity=cleanOpacity(formValue('reportCustomWatermarkOpacity',settings.reportBrandWatermarkOpacity));
  return settings;
}
function preview(){const target=$('#reportHeaderPreview');if(!target)return;const settings=formSettings();target.innerHTML=`${headerHtml(settings)}<div class="report-print-title"><h1>عنوان التقرير التجريبي</h1></div>${watermarkHtml(settings)}`;}
function readFormIntoState(){if(!$('#reportHeaderSettingsCard'))return false;Object.assign(YWP.state.settings,formSettings());return true;}
function save(){if(!readFormIntoState())return;YWP.save();preview();applyCurrentReport(true);alert('تم حفظ تصميم ترويسة التقارير والعلامة المائية. سيُطبق التصميم على جميع الكشوفات والتقارير الجديدة.');}
function field(label,id,value,type='text'){return`<div class="field"><label>${esc(label)}</label><input id="${id}" type="${type}" value="${esc(value)}" oninput="QatraReportCustomization.preview()" onchange="QatraReportCustomization.preview()"></div>`;}
function selectField(label,id,value,options){return`<div class="field"><label>${esc(label)}</label><select id="${id}" onchange="QatraReportCustomization.preview()">${options.map(option=>`<option value="${esc(option[0])}" ${option[0]===value?'selected':''}>${esc(option[1])}</option>`).join('')}</select></div>`;}

function injectSettingsPanel(){
  const host=$('#settings');if(!host||!host.children.length||$('#reportHeaderSettingsCard'))return;
  const settings=ensureDefaults();
  host.insertAdjacentHTML('beforeend',`<div class="card report-header-settings-card" id="reportHeaderSettingsCard"><div class="report-header-settings-intro"><div><h2>مصمم ترويسة الكشوفات والتقارير</h2><p>صمّم ترويسة نصية من ثلاثة أقسام. الشعار مخفي افتراضيًا حتى لا يتكرر، ويمكن إظهاره لاحقًا من خيار موضع الشعار.</p></div><span>▤</span></div><div class="form-row">${field('النص الرئيسي - يمين','reportCustomRight1',settings.reportHeaderRightLine1)}${field('النص الفرعي - يمين','reportCustomRight2',settings.reportHeaderRightLine2)}${field('النص الرئيسي - وسط','reportCustomCenter1',settings.reportHeaderCenterLine1)}${field('النص الفرعي - وسط','reportCustomCenter2',settings.reportHeaderCenterLine2)}${field('النص الرئيسي - يسار','reportCustomLeft1',settings.reportHeaderLeftLine1)}${field('النص الفرعي - يسار','reportCustomLeft2',settings.reportHeaderLeftLine2)}${selectField('نمط الترويسة','reportCustomLayout',settings.reportHeaderLayout,[['formal','رسمي متوازن'],['compact','مضغوط'],['minimal','بسيط']])}${selectField('موضع شعار المشروع','reportCustomLogoPosition',settings.reportHeaderLogoPosition,[['hidden','بدون شعار'],['right','يمين'],['center','وسط'],['left','يسار']])}${field('لون الترويسة','reportCustomAccent',safeColor(settings.reportHeaderAccentColor),'color')}${selectField('شفافية العلامة المائية','reportCustomWatermarkOpacity',cleanOpacity(settings.reportBrandWatermarkOpacity),[['0.08','خفيفة جدًا'],['0.14','خفيفة'],['0.20','أوضح']])}<div class="field"><label>العلامة التجارية</label><label class="notice success" style="display:flex;align-items:center;gap:8px;min-height:47px"><input id="reportCustomWatermark" type="checkbox" ${settings.reportBrandWatermarkEnabled!==false?'checked':''} onchange="QatraReportCustomization.preview()"> إظهار QATRA PRO كعلامة مائية أسفل يسار كل صفحة</label></div></div><div class="report-header-preview-wrap"><small>معاينة فورية</small><div id="reportHeaderPreview" class="report-header-preview-document"></div></div><div class="toolbar"><button class="green" onclick="QatraReportCustomization.save()">حفظ تصميم التقارير</button><button class="light" onclick="QatraReportCustomization.restoreDefaults()">استعادة التصميم الافتراضي</button></div></div>`);
  preview();
}

function restoreDefaults(){
  const settings=YWP.state.settings||{};
  Object.assign(settings,{reportHeaderRightLine1:settings.reportsHeaderTitle||settings.projectName||'الجهة المصدرة',reportHeaderRightLine2:settings.reportsHeaderSubtitle||settings.ownerName||'',reportHeaderCenterLine1:'تقرير رسمي',reportHeaderCenterLine2:settings.projectName?`صادر عن ${settings.projectName}`:'',reportHeaderLeftLine1:settings.documentHeaderLine1||settings.projectAddress||'',reportHeaderLeftLine2:settings.documentHeaderLine2||settings.projectPhone1||'',reportHeaderLayout:'formal',reportHeaderLogoPosition:'hidden',reportHeaderAccentColor:'#0b6f9c',reportBrandWatermarkEnabled:true,reportBrandWatermarkOpacity:'0.14',reportLogosRemovedV2913:true});
  YWP.save();$('#reportHeaderSettingsCard')?.remove();injectSettingsPanel();applyCurrentReport(true);
}

const PRINT_CSS=`<style>.org-header.report-user-header{--report-accent:#0b6f9c;display:grid!important;grid-template-columns:1fr 1.25fr 1fr!important;align-items:stretch!important;gap:0!important;margin:0 0 3mm!important;padding:0!important;overflow:hidden;border:1px solid #b9d1dc!important;border-bottom:1.2mm solid var(--report-accent)!important;border-radius:2mm!important;background:#fff!important;text-align:initial!important}.report-user-header .report-header-cell{min-width:0;min-height:15mm;display:flex;align-items:center;justify-content:center;gap:2mm;padding:2mm 3mm;border-inline-start:.3mm solid #d7e3e8;text-align:center}.report-user-header .report-header-cell:first-child{border-inline-start:0}.report-user-header .report-header-cell>div{min-width:0}.report-user-header .report-header-cell b{display:block;color:#12364d;font-size:9pt;line-height:1.4}.report-user-header .report-header-cell small{display:block;margin-top:.6mm;color:#526b7c;font-size:7pt;line-height:1.4}.report-user-header .report-header-center b{color:var(--report-accent);font-size:11pt}.report-user-header .report-user-logo{width:12mm;height:12mm;flex:0 0 12mm;object-fit:contain;padding:1mm;border:.3mm solid #d5e3e9;border-radius:2mm;background:#fff}.report-user-header.layout-compact .report-header-cell{min-height:12mm;padding:1.2mm 2mm}.report-user-header.layout-compact .report-user-logo{width:9mm;height:9mm;flex-basis:9mm}.report-user-header.layout-minimal{border-inline:0!important;border-top:0!important;border-radius:0!important}.report-user-header.layout-minimal .report-header-cell{border:0!important}.report-document{position:relative!important;padding-bottom:12mm!important}.report-document>.qatra-print-brand,.report-brand-sentinel,.v13-doc-header{display:none!important}.report-document .report-print-title{margin:0 0 2.5mm!important;padding:2mm!important;border-top:.3mm solid #c5d8e0;border-bottom:.3mm solid #c5d8e0;background:#f7fafb;text-align:center}.report-document .report-print-title small{display:none!important}.report-document .report-print-title h1{margin:0!important;color:#123f58;font-size:15pt!important}.report-end{display:none!important}.qatra-report-watermark{position:fixed!important;left:4mm!important;bottom:3mm!important;z-index:999!important;display:flex!important;align-items:center!important;gap:1.2mm!important;direction:ltr!important;opacity:var(--qatra-watermark-opacity,.14)!important;pointer-events:none!important;color:#143b52!important}.qatra-report-watermark img{width:8mm!important;height:8mm!important;object-fit:contain!important}.qatra-report-watermark span{display:flex!important;flex-direction:column!important;align-items:flex-start!important;line-height:1.15!important}.qatra-report-watermark b{font-family:Georgia,"Times New Roman",serif!important;font-size:7pt!important;letter-spacing:.5pt!important}.qatra-report-watermark small{font-size:4.8pt!important;white-space:nowrap!important}</style>`;
function enhancePrintBody(body){let html=String(body||'');if(!/report-document|accounting-print-document/.test(html))return html;if(!html.includes('report-user-header'))html=headerHtml(ensureDefaults())+html;if(!html.includes('qatra-report-watermark'))html+=watermarkHtml(ensureDefaults());return`${PRINT_CSS}${html}<div class="qatra-print-brand report-brand-sentinel" aria-hidden="true"></div>`;}
function install(){
  if(!global.YWP||!global.App)return setTimeout(install,200);
  ensureDefaults(true);
  const originalOrg=YWP.orgHeaderHtml;
  if(!YWP.__qatraReportOrgPatched){YWP.orgHeaderHtml=function(compact,docType){return docType==='report'?headerHtml(ensureDefaults()):originalOrg(compact,docType);};YWP.__qatraReportOrgPatched=true;}
  const originalPrint=YWP.printWindow;
  if(!YWP.__qatraReportPrintPatched){YWP.printWindow=function(title,body,page){return originalPrint(title,enhancePrintBody(body),page);};YWP.__qatraReportPrintPatched=true;}
  if(!saveWrapped){const originalSave=App.saveSettings;App.saveSettings=function(){readFormIntoState();return originalSave.apply(this,arguments);};saveWrapped=true;}
  global.QatraReportCustomization={save,preview,restoreDefaults,apply:()=>applyCurrentReport(true),headerHtml};
  if(!installed){const observer=new MutationObserver(()=>{setTimeout(()=>{injectSettingsPanel();applyCurrentReport();},0);});observer.observe(document.body,{childList:true,subtree:true});installed=true;}
  injectSettingsPanel();applyCurrentReport(true);
}
install();global.addEventListener('load',()=>setTimeout(install,50));
})(window);
