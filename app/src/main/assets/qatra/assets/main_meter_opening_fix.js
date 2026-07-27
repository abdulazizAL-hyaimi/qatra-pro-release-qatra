/* Qatra Pro 2.9.11: opening reading for the main project meter without data reset. */
(()=>{
'use strict';

function numeric(value){
  const parsed=Number(String(value??'').replace(/[,،\s]/g,''));
  return Number.isFinite(parsed)&&parsed>=0?parsed:0;
}

function ensureSetting(){
  if(!window.YWP?.state?.settings)return;
  const settings=YWP.state.settings;
  if(settings.mainMeterOpeningReading===undefined||settings.mainMeterOpeningReading===null||settings.mainMeterOpeningReading===''){
    settings.mainMeterOpeningReading=0;
    YWP.save();
  }
}

function openingReading(){
  return numeric(YWP?.state?.settings?.mainMeterOpeningReading);
}

function monthlyCyclesBefore(beforeDate){
  return (YWP?.state?.cycles||[])
    .filter(c=>c?.type==='MONTHLY'&&c.mainCurrent!==null&&c.mainCurrent!==undefined&&c.mainCurrent!=='')
    .filter(c=>!beforeDate||String(c.cycleDate||'')<String(beforeDate))
    .sort((a,b)=>String(b.cycleDate||'').localeCompare(String(a.cycleDate||'')));
}

function patchedLastMainCurrent(beforeDate=null){
  const rows=monthlyCyclesBefore(beforeDate);
  return rows.length?numeric(rows[0].mainCurrent):openingReading();
}

function applyOpeningToFirstMonthlyCycle(){
  const cycles=(YWP?.state?.cycles||[])
    .filter(c=>c?.type==='MONTHLY')
    .sort((a,b)=>String(a.cycleDate||'').localeCompare(String(b.cycleDate||'')));
  if(!cycles.length)return false;
  const first=cycles[0];
  const old=first.mainPrev;
  const mayReplace=old===undefined||old===null||old===''||numeric(old)===0;
  if(!mayReplace)return false;
  const next=openingReading();
  if(numeric(old)===next&&old!=='')return false;
  first.mainPrev=next;
  return true;
}

function injectSettingField(){
  const root=document.getElementById('settings');
  if(!root||document.getElementById('mainMeterOpeningReading'))return;
  const sizeInput=document.getElementById('mainMeterSize');
  const anchor=sizeInput?.closest('.field');
  if(!anchor)return;
  const wrapper=document.createElement('div');
  wrapper.className='field';
  wrapper.innerHTML=`<label>القراءة الافتتاحية للعداد الرئيسي</label><input id="mainMeterOpeningReading" type="number" min="0" step="any" inputmode="decimal" value="${openingReading()}"><small class="field-note">تستخدم كقراءة سابقة لأول دورة نهاية شهر، ولا تحذف أو تغيّر قراءات المشتركين.</small>`;
  anchor.insertAdjacentElement('afterend',wrapper);
}

function install(){
  if(!window.YWP||!window.App)return;
  ensureSetting();
  YWP.lastMainCurrent=patchedLastMainCurrent;
  if(applyOpeningToFirstMonthlyCycle())YWP.save();

  const originalSwitch=App.switchTab;
  App.switchTab=function(id){
    const result=originalSwitch(id);
    if(id==='settings')setTimeout(injectSettingField,0);
    return result;
  };

  const originalSave=App.saveSettings;
  App.saveSettings=function(){
    const input=document.getElementById('mainMeterOpeningReading');
    if(input){
      const raw=String(input.value??'').trim();
      const value=Number(raw);
      if(raw===''||!Number.isFinite(value)||value<0){
        alert('أدخل قراءة افتتاحية صحيحة للعداد الرئيسي، صفر أو أكبر.');
        input.focus();
        return;
      }
      YWP.state.settings.mainMeterOpeningReading=value;
      applyOpeningToFirstMonthlyCycle();
    }
    const result=originalSave();
    setTimeout(injectSettingField,0);
    return result;
  };

  setTimeout(injectSettingField,0);
}

document.addEventListener('DOMContentLoaded',install);
})();
