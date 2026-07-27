/* Qatra Pro 2.9.13: enforce one text report header and one lower-left watermark. */
(function(global){
'use strict';
let cleaning=false,installed=false;
const normalize=value=>String(value||'').replace(/[\sـ:：\-_/]+/g,'').toLowerCase();

function watermarkHtml(){
  const settings=global.YWP?.state?.settings||{};
  if(settings.reportBrandWatermarkEnabled===false||String(settings.reportBrandWatermarkEnabled)==='false')return'';
  const opacity=['0.08','0.14','0.20'].includes(String(settings.reportBrandWatermarkOpacity))?String(settings.reportBrandWatermarkOpacity):'0.14';
  return `<div class="qatra-report-watermark" style="--qatra-watermark-opacity:${opacity}" aria-label="Qatra Pro watermark"><img src="assets/qatra-pro-mark.svg" alt=""><span><b>QATRA PRO</b><small>نظام قطرة برو لإدارة خدمات المياه</small></span></div>`;
}
function customHeaderHtml(){
  if(global.QatraReportCustomization?.headerHtml)return QatraReportCustomization.headerHtml();
  return global.YWP?.orgHeaderHtml?YWP.orgHeaderHtml(false,'report'):'';
}
function removeDuplicateTitle(root,title=''){
  const printed=String(root.querySelector('.report-print-title h1')?.textContent||title||'').trim();
  if(!printed)return;
  root.querySelectorAll('h1,h2,h3').forEach(node=>{
    if(node.closest('.report-print-title,.report-screen-head,.report-user-header'))return;
    if(normalize(node.textContent)===normalize(printed))node.remove();
  });
}
function removeLegacyIdentity(root){
  root.querySelectorAll('.org-header,.report-org-header,.v13-doc-header').forEach(node=>node.remove());
  root.querySelectorAll('.report-org-identity,.report-org-seal,.v13-head-center,.v13-head-side').forEach(node=>{
    if(!node.closest('.report-user-header'))node.remove();
  });
}
function cleanRoot(root,title='',force=false){
  if(!root||cleaning)return;
  const customHeaders=root.querySelectorAll('.report-user-header');
  const legacyHeaders=root.querySelectorAll('.org-header:not(.report-user-header),.report-org-header:not(.report-user-header),.v13-doc-header');
  const watermarks=root.querySelectorAll('.qatra-report-watermark');
  if(!force&&legacyHeaders.length===0&&customHeaders.length===1&&watermarks.length<=1&&root.dataset.singleReportIdentity==='2913')return;
  cleaning=true;
  try{
    removeLegacyIdentity(root);
    root.querySelectorAll('.report-user-header').forEach(node=>node.remove());
    const header=customHeaderHtml();
    if(header)root.insertAdjacentHTML('afterbegin',header);
    root.querySelectorAll('.qatra-print-brand,.qatra-report-watermark').forEach(node=>node.remove());
    const watermark=watermarkHtml();
    if(watermark)root.insertAdjacentHTML('beforeend',watermark);
    removeDuplicateTitle(root,title);
    root.dataset.singleReportIdentity='2913';
  }finally{cleaning=false;}
}
function cleanCurrent(force=false){cleanRoot(document.querySelector('#currentReportHtml'),global.App?._currentReportTitle||'',force);}
function sanitizePrintBody(title,body,page){
  const cleanPage=String(page||'');
  const html=String(body||'');
  const reportLike=/report-document|accounting-print-document|report-table|report-user-header|report-org-header|v13-doc-header/.test(html)||/^A4/.test(cleanPage);
  if(!reportLike)return html;
  const box=document.createElement('div');box.innerHTML=html;
  const root=box.querySelector('.report-document,.accounting-print-document')||box;
  cleanRoot(root,title,true);
  return box.innerHTML;
}
function install(){
  if(!global.YWP||!global.App)return setTimeout(install,200);
  if(!YWP.__singleReportIdentityPrintV2913){
    const previous=YWP.printWindow;
    YWP.printWindow=function(title,body,page){return previous(title,sanitizePrintBody(title,body,page),page);};
    YWP.__singleReportIdentityPrintV2913=true;
  }
  global.QatraReportIdentityCleanup={apply:()=>cleanCurrent(true),sanitizePrintBody};
  if(!installed){
    const observer=new MutationObserver(()=>setTimeout(()=>cleanCurrent(false),0));
    observer.observe(document.body,{childList:true,subtree:true});
    installed=true;
  }
  cleanCurrent(true);
}
install();global.addEventListener('load',()=>setTimeout(install,50));
})(window);
