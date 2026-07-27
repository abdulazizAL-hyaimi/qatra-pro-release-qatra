/* مياه الروضة v12.3 — حزمة التنفيذ المعتمدة
   أرشيف الدورات، التقارير الشهرية، الكشوفات، النصوص المرنة، تصميمات الطباعة، وExcel حقيقي.
*/
(function(){
  'use strict';
  const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
  const N=v=>Number(String(v??0).replace(/,/g,''))||0;
  const E=v=>YWP.esc(String(v??''));
  const ST=()=>YWP.state;
  const S=()=>ST().settings||{};
  const money=v=>YWP.money(N(v));
  const today=()=>YWP.today();

  function migrateV13(){
    const st=ST(); st.settings||={}; st.meta||={};
    Object.assign(st.meta,{version:'12.3.6-system-readings-import-save-fix'});
    const defaults={
      printHeaderRight:'',printHeaderLeft:'',statementFooter:'',statementPreparedBy:'',statementReviewedBy:'',statementApprovedBy:'',receiptAmountNote:'',
      receiptFooter:'هذا السند صادر من المشروع.'
    };
    Object.entries(defaults).forEach(([k,v])=>{if(st.settings[k]===undefined||st.settings[k]===null||st.settings[k]==='')st.settings[k]=v;});
    if(/شكر[اً]?/.test(String(st.settings.receiptFooter||''))) st.settings.receiptFooter='هذا السند صادر من المشروع.';
    st.cycleArchives ||= [];
    st.reopenLog ||= [];
    st.settings.invoiceFooter = st.settings.invoiceFooter || '';
    // لا تُستخدم كلمة "مطلوب" في النصوص الجديدة.
    ['invoiceFooter','receiptFooter','reportsFooter'].forEach(k=>{st.settings[k]=String(st.settings[k]||'').replace(/مطلوب/g,'عليكم');});
    YWP.save();
  }

  function balanceLabel(value){
    const v=N(value);
    if(v>0)return {label:'الرصيد المتبقي عليكم',amount:v,cls:'due'};
    if(v<0)return {label:'الرصيد المتبقي لكم',amount:Math.abs(v),cls:'credit'};
    return {label:'الرصيد',amount:0,cls:'zero'};
  }
  function accountBalanceAt(subId,date){
    const sub=YWP.subscriber(subId)||{};
    let b=YWP.openingNet(sub);
    ST().invoices.filter(i=>i.subscriberId===subId&&(!date||(i.date||'')<=date)).forEach(i=>b+=N(i.amount));
    ST().payments.filter(p=>p.subscriberId===subId&&(p.incomeType||'WATER')==='WATER'&&p.confirmed!==false&&(!date||(p.date||'')<=date)).forEach(p=>b-=N(p.amount));
    return b;
  }
  function defaultLogo(){return S().projectLogo||'assets/qatra-pro-mark.svg';}
  function marketingMark(){return YWP.marketingMarkHtml?YWP.marketingMarkHtml():'<div class="qatra-print-brand"><b>QATRA PRO</b><small>نظام قطرة برو لإدارة خدمات المياه</small></div>';}
  function sideText(text){return String(text||'').split(/\n/).filter(Boolean).map(x=>`<div>${E(x)}</div>`).join('');}
  function generalHeader(title=''){
    return `<div class="v13-doc-header">
      <div class="v13-head-side right">${sideText(S().printHeaderRight)}</div>
      <div class="v13-head-center"><img src="${E(defaultLogo())}" alt="الشعار"><h2>${E(S().projectName||'قطرة برو')}</h2>${title?`<h3>${E(title)}</h3>`:''}</div>
      <div class="v13-head-side left">${sideText(S().printHeaderLeft)}</div>
    </div>`;
  }
  function invoiceHeader(title='فاتورة استهلاك مياه'){
    return `<div class="v13-doc-header invoice-only-header">
      <div class="v13-head-side right">${sideText(S().printHeaderRight)}</div>
      <div class="v13-head-center"><img src="${E(defaultLogo())}" alt="الشعار"><h3>${E(title)}</h3></div>
      <div class="v13-head-side left">${sideText(S().printHeaderLeft)}</div>
    </div>`;
  }
  function paperReceiptHeader(){
    return `<div class="v13-receipt-header">
      <div class="v13-head-side right">${sideText(S().printHeaderRight)}</div>
      <div class="v13-head-center"><img src="${E(defaultLogo())}" alt="الشعار"><h2>${E(S().receiptHeaderTitle||S().projectName||'قطرة برو')}</h2><h3>${E(S().receiptTitle||'سند قبض')}</h3></div>
      <div class="v13-head-side left">${sideText(S().printHeaderLeft)}</div>
    </div>`;
  }

  function invoiceHtml(inv){
    const sub=YWP.subscriber(inv.subscriberId)||{}, cyc=YWP.cycle(inv.cycleId)||{};
    const arrears=Math.max(0,N(inv.prevBalance));
    const credit=Math.max(0,-N(inv.prevBalance));
    const signedTotal=N(inv.prevBalance)+N(inv.amount);
    const bal=balanceLabel(signedTotal);
    const previous=YWP.historicalPreviousPayments(sub);
    const qrText=window.QatraQr?.invoice?.(inv,sub)||'';
    const qr=window.QatraQr?.html?.(qrText,'امسح للتحقق من الفاتورة')||'';
    return `<div class="a5 invoice-v13">
      ${invoiceHeader(S().invoiceTitle||'فاتورة استهلاك مياه')}
      <div class="v13-doc-meta"><span><b>رقم الفاتورة:</b> ${E(inv.no)}</span><span><b>التاريخ:</b> ${E(inv.date)}</span><span><b>الدورة:</b> ${E(cyc.type?YWP.arCycle(cyc.type):'')}</span></div>
      <section><h4>بيانات المشترك</h4><div class="v13-grid3"><div><small>اسم المشترك</small><b>${E(sub.name)}</b></div><div><small>رقم العداد</small><b>${E(sub.meterNo)}</b></div><div><small>العنوان</small><b>${E(sub.area)}</b></div></div></section>
      <section><h4>تفاصيل القراءة</h4><table><thead><tr><th>القراءة السابقة</th><th>القراءة الحالية</th><th>الاستهلاك</th><th>سعر الوحدة</th></tr></thead><tbody><tr><td>${YWP.num(inv.prevReading||0)}</td><td>${YWP.num(inv.currentReading||0)}</td><td>${YWP.num(inv.consumption||0)} م³</td><td>${money(inv.tariff)}</td></tr></tbody></table></section>
      <section><h4>البيان المالي</h4><div class="v13-finance-grid"><div><small>قيمة الاستهلاك</small><b>${money(inv.amount)}</b></div><div><small>المتأخرات</small><b>${money(arrears)}</b></div><div><small>الرصيد المقدم</small><b>${money(credit)}</b></div><div class="grand"><small>إجمالي الفاتورة</small><b>${money(Math.abs(signedTotal))}</b></div></div></section>
      <div class="v13-bottom-pair"><div class="mini"><small>المدفوعات السابقة</small><b>${money(previous)}</b></div><div class="balance ${bal.cls}"><small>${bal.label}</small><b>${money(bal.amount)}</b></div></div>
      <div class="v13-words"><b>الإجمالي كتابة:</b> ${E(YWP.moneyWords(Math.abs(signedTotal)))}</div>
      ${qr}
      ${S().invoiceFooter?`<div class="v13-note">${E(S().invoiceFooter)}</div>`:''}
      ${marketingMark()}
    </div>`;
  }

  function receiptHtml(p,mode='thermal'){
    const sub=YWP.subscriber(p.subscriberId)||{};
    const qrText=window.QatraQr?.receipt?.({...p,subscriberCode:sub.code||p.subscriberCode,meterNo:sub.meterNo})||'';
    const qr=window.QatraQr?.html?.(qrText,'امسح للتحقق من السند')||'';
    if(mode!=='paper'){
      const b=accountBalanceAt(p.subscriberId,p.date), bl=balanceLabel(b);
      return `<div class="thermal receipt-thermal-v13"><div class="center"><img src="${E(defaultLogo())}" style="max-width:30mm;max-height:22mm;object-fit:contain"><b style="display:block;font-size:15px">${E(S().projectName||'قطرة برو')}</b><strong>${E(S().receiptTitle||'سند قبض')}</strong></div><div class="line"></div><table class="no-border"><tr><td>رقم السند:</td><td>${E(p.receiptNo)}</td></tr><tr><td>التاريخ:</td><td>${E(p.date)}</td></tr><tr><td>اسم المشترك:</td><td>${E(sub.name)}</td></tr><tr><td>رقم العداد:</td><td>${E(sub.meterNo)}</td></tr><tr><td>المبلغ المسدد:</td><td><b>${money(p.amount)}</b></td></tr><tr><td>طريقة الدفع:</td><td>${E(p.method)}</td></tr><tr><td>المحصل:</td><td>${E(p.collector)}</td></tr><tr><td>${bl.label}:</td><td><b>${money(bl.amount)}</b></td></tr></table>${qr}<div class="line"></div><div class="center">${E(S().receiptFooter||'هذا السند صادر من المشروع.')}</div>${marketingMark()}</div>`;
    }
    const b=accountBalanceAt(p.subscriberId,p.date), bl=balanceLabel(b);
    return `<div class="a5 receipt-v13"><div class="receipt-v13-frame">
      ${paperReceiptHeader()}
      <div class="v13-doc-meta"><span><b>رقم السند:</b> ${E(p.receiptNo)}</span><span><b>التاريخ:</b> ${E(p.date)}</span></div>
      <div class="v13-grid2"><div><small>اسم المشترك</small><b>${E(sub.name)}</b></div><div><small>رقم العداد</small><b>${E(sub.meterNo)}</b></div><div><small>طريقة الدفع</small><b>${E(p.method)}</b></div><div><small>اسم المحصل</small><b>${E(p.collector)}</b></div></div>
      <div class="receipt-amount"><small>المبلغ المسدد</small><b>${money(p.amount)}</b></div>
      ${S().receiptAmountNote?`<div class="v13-note">${E(S().receiptAmountNote)}</div>`:''}
      <div class="v13-grid2"><div><small>ملاحظات</small><b>${E(p.note||'—')}</b></div><div class="balance ${bl.cls}"><small>${bl.label}</small><b>${money(bl.amount)}</b></div></div>
      ${qr}
      <div class="v13-receipt-footer">${E(S().receiptFooter||'هذا السند صادر من المشروع.')}</div>
      <div class="v13-signatures"><span>توقيع المحصل: __________________</span><span>توقيع المستلم: __________________</span></div>
      ${marketingMark()}
    </div></div>`;
  }
  function thermalWidth(){return String(S().receiptThermalWidth||'58')==='80'?'80':'58';}
  function thermalBase(){
    const href=String(location.href||'').replace(/[^/]*$/,'');
    return href;
  }
  function thermalDocument(inner,title){
    const width=thermalWidth()==='80'?'80mm':'58mm';
    const narrow=width==='58mm';
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><base href="${E(thermalBase())}"><title>${E(title)}</title><style>
      @page{size:${width} auto;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}
      body{width:${width};max-width:${width};margin:0 auto;padding:${narrow?'2mm':'3mm'};font-family:Tahoma,Arial,sans-serif;color:#000;font-size:${narrow?'10.5px':'12px'};line-height:1.45;direction:rtl}
      .thermal-ticket{width:100%;page-break-inside:avoid;break-inside:avoid}.thermal-head{text-align:center}.thermal-head img{display:block;width:${narrow?'24mm':'30mm'};height:auto;max-height:${narrow?'20mm':'25mm'};object-fit:contain;margin:0 auto 1mm}.thermal-head b,.thermal-head strong{display:block}.thermal-head b{font-size:${narrow?'13px':'15px'}}.thermal-head strong{font-size:${narrow?'13px':'16px'};margin-top:1mm}.dash{border-top:1px dashed #000;margin:2mm 0}.thermal-table{width:100%;border-collapse:collapse}.thermal-table td{border:0;padding:${narrow?'1.1mm .4mm':'1.4mm .6mm'};vertical-align:top}.thermal-table td:first-child{width:40%;font-weight:700}.thermal-table td:last-child{text-align:left;direction:rtl;overflow-wrap:anywhere}.amount-box{border:2px solid #000;text-align:center;padding:2mm;margin:2mm 0}.amount-box small{display:block}.amount-box b{display:block;font-size:${narrow?'19px':'23px'}}.thermal-footer{text-align:center;font-size:${narrow?'9px':'10.5px'};margin-top:2mm}.balance-box{border:1px solid #000;border-radius:3px;padding:1.5mm;text-align:center;margin-top:1.5mm}.balance-box small,.balance-box b{display:block}.balance-box b{font-size:${narrow?'14px':'17px'}}.qatra-qr{text-align:center;margin:2mm auto}.qatra-qr img{width:${narrow?'25mm':'30mm'}!important;height:${narrow?'25mm':'30mm'}!important}.qatra-qr figcaption{font-size:${narrow?'8px':'9px'}}.qatra-print-brand{display:flex;align-items:center;justify-content:center;gap:1mm;margin-top:2mm;padding-top:1.5mm;border-top:1px solid #999;font-size:${narrow?'7px':'8px'}}.qatra-print-brand img{width:${narrow?'7mm':'9mm'};height:${narrow?'7mm':'9mm'};object-fit:contain}.qatra-print-brand span{display:flex;flex-direction:column}.qatra-print-brand small{font-size:${narrow?'6px':'7px'}}
    </style></head><body>${inner}</body></html>`;
  }
  function thermalReceiptDocument(p){
    const sub=YWP.subscriber(p.subscriberId)||{};
    const after=accountBalanceAt(p.subscriberId,p.date), bl=balanceLabel(after), before=after+N(p.amount);
    const beforeText=before>0?`${money(before)} عليكم`:before<0?`${money(Math.abs(before))} لكم`:'صفر';
    const qrText=window.QatraQr?.receipt?.({...p,subscriberCode:sub.code||p.subscriberCode,meterNo:sub.meterNo})||'';
    const qr=window.QatraQr?.html?.(qrText)||'';
    const inner=`<div class="thermal-ticket"><div class="thermal-head"><img src="${E(defaultLogo())}" alt="الشعار"><b>${E(S().projectName||'قطرة برو')}</b><strong>${E(S().receiptTitle||'سند قبض')}</strong></div><div class="dash"></div><table class="thermal-table"><tr><td>رقم السند</td><td>${E(p.receiptNo)}</td></tr><tr><td>التاريخ</td><td>${E(p.date)}</td></tr><tr><td>اسم المشترك</td><td>${E(sub.name)}</td></tr><tr><td>رقم العداد</td><td>${E(sub.meterNo)}</td></tr></table><div class="amount-box"><small>المبلغ المسدد</small><b>${money(p.amount)}</b></div><table class="thermal-table"><tr><td>الرصيد قبل السداد</td><td>${beforeText}</td></tr><tr><td>${E(bl.label)}</td><td><b>${money(bl.amount)}</b></td></tr><tr><td>طريقة الدفع</td><td>${E(p.method)}</td></tr><tr><td>المحصل</td><td>${E(p.collector)}</td></tr></table>${qr}<div class="dash"></div><div class="thermal-footer">${E(S().receiptFooter||'هذا السند صادر من المشروع.')}</div>${marketingMark()}</div>`;
    return thermalDocument(inner,'معاينة السند الحراري');
  }
  function thermalInvoiceDocument(inv){
    const sub=YWP.subscriber(inv.subscriberId)||{},cyc=YWP.cycle(inv.cycleId)||{};
    const arrears=Math.max(0,N(inv.prevBalance)),credit=Math.max(0,-N(inv.prevBalance)),signed=N(inv.prevBalance)+N(inv.amount),bl=balanceLabel(signed);
    const qrText=window.QatraQr?.invoice?.(inv,sub)||'';
    const qr=window.QatraQr?.html?.(qrText)||'';
    const inner=`<div class="thermal-ticket"><div class="thermal-head"><img src="${E(defaultLogo())}" alt="الشعار"><b>${E(S().projectName||'قطرة برو')}</b><strong>${E(S().invoiceTitle||'فاتورة استهلاك مياه')}</strong></div><div class="dash"></div><table class="thermal-table"><tr><td>رقم الفاتورة</td><td>${E(inv.no)}</td></tr><tr><td>التاريخ</td><td>${E(inv.date)}</td></tr><tr><td>الدورة</td><td>${E(cyc.type?YWP.arCycle(cyc.type):'')}</td></tr><tr><td>اسم المشترك</td><td>${E(sub.name)}</td></tr><tr><td>رقم العداد</td><td>${E(sub.meterNo)}</td></tr></table><div class="dash"></div><table class="thermal-table"><tr><td>القراءة السابقة</td><td>${YWP.num(inv.prevReading||0)}</td></tr><tr><td>القراءة الحالية</td><td>${YWP.num(inv.currentReading||0)}</td></tr><tr><td>الاستهلاك</td><td>${YWP.num(inv.consumption||0)} م³</td></tr><tr><td>سعر الوحدة</td><td>${money(inv.tariff)}</td></tr><tr><td>قيمة الاستهلاك</td><td>${money(inv.amount)}</td></tr><tr><td>المتأخرات</td><td>${money(arrears)}</td></tr><tr><td>الرصيد المقدم</td><td>${money(credit)}</td></tr></table><div class="amount-box"><small>${E(bl.label)}</small><b>${money(bl.amount)}</b></div>${qr}${S().invoiceFooter?`<div class="thermal-footer">${E(S().invoiceFooter)}</div>`:''}${marketingMark()}</div>`;
    return thermalDocument(inner,'معاينة الفاتورة الحرارية');
  }
  function ensureThermalModal(){
    if($('#systemThermalModal'))return;
    document.body.insertAdjacentHTML('beforeend',`<div id="systemThermalModal" class="system-thermal-modal" hidden><div class="system-thermal-backdrop" onclick="App.closeThermalPreview()"></div><div class="system-thermal-sheet" role="dialog" aria-modal="true"><div class="system-thermal-head"><h3 id="systemThermalTitle">معاينة حرارية</h3><button class="light mini" onclick="App.closeThermalPreview()">إغلاق</button></div><div class="system-thermal-preview-wrap"><iframe id="systemThermalFrame" class="system-thermal-preview-frame" title="معاينة حرارية" scrolling="no"></iframe></div><div id="systemThermalActions" class="toolbar"></div></div></div>`);
  }
  function closeThermalPreview(){const m=$('#systemThermalModal');if(m)m.hidden=true;}
  function openThermalPreview(title,html,printCall){
    ensureThermalModal();const m=$('#systemThermalModal'),frame=$('#systemThermalFrame');
    $('#systemThermalTitle').textContent=title;$('#systemThermalActions').innerHTML=`<button class="green" onclick="${printCall}">طباعة الآن</button><button class="light" onclick="App.closeThermalPreview()">إغلاق</button>`;
    m.hidden=false;frame.style.width=thermalWidth()==='58'?'64mm':'86mm';frame.style.height='120px';
    const fit=()=>{try{const d=frame.contentDocument;frame.style.height=`${Math.max(120,d?.body?.scrollHeight||0,d?.documentElement?.scrollHeight||0)+4}px`;}catch(_){}};
    frame.onload=()=>{fit();setTimeout(fit,180);setTimeout(fit,600)};frame.srcdoc=html;
  }
  function receiptPayload(p){
    const sub=YWP.subscriber(p.subscriberId)||{},after=accountBalanceAt(p.subscriberId,p.date),bl=balanceLabel(after),before=after+N(p.amount);
    return {receiptNo:p.receiptNo,date:p.date,subscriberCode:sub.code||p.subscriberCode||'',subscriberName:sub.name||'',meterNo:sub.meterNo||'',amount:N(p.amount).toLocaleString('en-US'),method:p.method||'',collectorName:p.collector||'',projectName:S().projectName||'قطرة برو',receiptTitle:S().receiptTitle||'سند قبض',projectLogo:S().projectLogo||'',balanceBeforeAmount:Math.abs(before).toLocaleString('en-US'),balanceBeforeSuffix:before<0?' لكم':before>0?' عليكم':'',balanceLabel:bl.label,balanceAmount:N(bl.amount).toLocaleString('en-US'),footer:S().receiptFooter||'هذا السند صادر من المشروع.',marketingBrand:'QATRA PRO — نظام قطرة برو',qrText:window.QatraQr?.receipt?.({...p,subscriberCode:sub.code||p.subscriberCode,meterNo:sub.meterNo})||'',thermalWidth:thermalWidth()};
  }
  function invoicePayload(inv){
    const sub=YWP.subscriber(inv.subscriberId)||{},cyc=YWP.cycle(inv.cycleId)||{},arrears=Math.max(0,N(inv.prevBalance)),credit=Math.max(0,-N(inv.prevBalance)),signed=N(inv.prevBalance)+N(inv.amount),bl=balanceLabel(signed);
    return {invoiceNo:inv.no,date:inv.date,cycleName:cyc.type?YWP.arCycle(cyc.type):'',subscriberName:sub.name||'',meterNo:sub.meterNo||'',projectName:S().projectName||'قطرة برو',invoiceTitle:S().invoiceTitle||'فاتورة استهلاك مياه',projectLogo:S().projectLogo||'',prevReading:YWP.num(inv.prevReading||0),currentReading:YWP.num(inv.currentReading||0),consumption:YWP.num(inv.consumption||0),tariff:N(inv.tariff).toLocaleString('en-US'),amount:N(inv.amount).toLocaleString('en-US'),arrears:arrears.toLocaleString('en-US'),credit:credit.toLocaleString('en-US'),balanceLabel:bl.label,balanceAmount:N(bl.amount).toLocaleString('en-US'),footer:S().invoiceFooter||'',marketingBrand:'QATRA PRO — نظام قطرة برو',qrText:window.QatraQr?.invoice?.(inv,sub)||'',thermalWidth:thermalWidth()};
  }
  function previewThermalReceipt(encoded){const id=decodeURIComponent(encoded),p=ST().payments.find(x=>x.id===id);if(p)openThermalPreview('معاينة السند الحراري',thermalReceiptDocument(p),`App.printThermalReceipt('${encodeURIComponent(id)}')`);}
  function previewThermalInvoice(encoded){const id=decodeURIComponent(encoded),inv=YWP.invoice(id);if(inv)openThermalPreview('معاينة الفاتورة الحرارية',thermalInvoiceDocument(inv),`App.printThermalInvoice('${encodeURIComponent(id)}')`);}
  function printThermalReceipt(encoded){const id=decodeURIComponent(encoded),p=ST().payments.find(x=>x.id===id);if(!p)return;if(window.AndroidBridge&&typeof AndroidBridge.printThermalReceipt==='function'){AndroidBridge.printThermalReceipt(JSON.stringify(receiptPayload(p)));return;}const w=window.open('','_blank');if(w){w.document.write(thermalReceiptDocument(p).replace('</body>','<script>window.onload=()=>window.print()<\\/script></body>'));w.document.close();}}
  function printThermalInvoice(encoded){const id=decodeURIComponent(encoded),inv=YWP.invoice(id);if(!inv)return;if(window.AndroidBridge&&typeof AndroidBridge.printThermalInvoice==='function'){AndroidBridge.printThermalInvoice(JSON.stringify(invoicePayload(inv)));return;}const w=window.open('','_blank');if(w){w.document.write(thermalInvoiceDocument(inv).replace('</body>','<script>window.onload=()=>window.print()<\\/script></body>'));w.document.close();}}

  let originalReceiptHtml=null;

  function exportXlsx(filename,title,rows){
    const safe=String(filename||'report.xlsx').replace(/\.(xls|xlsx|csv)$/i,'')+'.xlsx';
    if(window.AndroidBridge&&typeof AndroidBridge.exportXlsx==='function'){
      AndroidBridge.exportXlsx(safe,String(title||'تقرير'),JSON.stringify(rows||[]));
      return;
    }
    // نسخة المتصفح الاحتياطية: Excel XML صالح بامتداد xls.
    const xmlRows=(rows||[]).map(r=>`<Row>${r.map(c=>`<Cell><Data ss:Type="${typeof c==='number'?'Number':'String'}">${String(c??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</Data></Cell>`).join('')}</Row>`).join('');
    const xml=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${E(title||'تقرير')}"><Table>${xmlRows}</Table></Worksheet></Workbook>`;
    YWP.download(safe.replace(/\.xlsx$/i,'.xls'),xml,'application/vnd.ms-excel');
  }

  function patchExports(){
    App.exportCurrentExcel=function(){const rows=App._currentExcel||App._currentCsv;if(!rows)return alert('اعرض التقرير أولًا.');exportXlsx(App._currentExcelFilename||'report.xlsx',App._currentExcelTitle||'تقرير',rows);};
    App.downloadCurrentCSV=App.exportCurrentExcel;
    App.exportSubscribers=function(){exportXlsx('subscribers.xlsx','المشتركون',[['رقم','الاسم','رقم العداد','الهاتف','العنوان','الدورة','الحالة','القراءة الافتتاحية','المتأخرات الافتتاحية','الرصيد المقدم','المدفوعات السابقة']].concat(ST().subscribers.map(s=>[s.code,s.name,s.meterNo,s.phone,s.area,s.readingGroup==='HALF'?'نصف الشهر':'نهاية الشهر',s.status,s.openingReading||0,YWP.openingArrears(s),YWP.openingCredit(s),s.previousPayments||0])));};
    App.exportCycleReadings=function(id){const c=YWP.cycle(id)||{};exportXlsx(`readings-${c.cycleDate||today()}.xlsx`,'كشف القراءات',[['التاريخ','الدورة','اسم المشترك','رقم العداد','العنوان','القراءة السابقة','القراءة الحالية','الاستهلاك','ملاحظات']].concat(YWP.readingsForCycle(id).map(r=>{const s=YWP.subscriber(r.subscriberId)||{};return[c.cycleDate,YWP.arCycle(c.type),s.name,s.meterNo,s.area,r.prev,r.current,r.consumption,r.notes||''];})));};
    App.exportInvoices=function(){YWP.recomputeInvoiceStatuses();exportXlsx('invoice-register.xlsx','كشف الفواتير',[['رقم الفاتورة','التاريخ','اسم المشترك','رقم العداد','السابقة','الحالية','الاستهلاك','قيمة الاستهلاك','المتأخرات','المدفوعات السابقة','الرصيد المتبقي','الحالة']].concat(ST().invoices.map(i=>{const s=YWP.subscriber(i.subscriberId)||{},b=balanceLabel(N(i.prevBalance)+N(i.amount));return[i.no,i.date,s.name,s.meterNo,i.prevReading||0,i.currentReading||0,i.consumption||0,i.amount||0,Math.max(0,N(i.prevBalance)),s.previousPayments||0,b.amount,b.label];})));};
    App.exportPayments=function(){exportXlsx('collections.xlsx','كشف التحصيلات',[['رقم السند','التاريخ','اسم المشترك','رقم العداد','المبلغ','طريقة الدفع','المحصل','ملاحظات']].concat(ST().payments.map(p=>{const s=YWP.subscriber(p.subscriberId)||{};return[p.receiptNo,p.date,s.name,s.meterNo,p.amount,p.method,p.collector,p.note||''];})));};
    App.exportExpenses=function(){exportXlsx('expenses.xlsx','كشف المصروفات',[['التاريخ','النوع','البيان','المبلغ','المستلم','المرجع']].concat(ST().expenses.map(e=>[e.date,e.category,e.description,e.amount,e.payee,e.refNo])));};
  }

  function enhanceSettings(){
    const root=$('#settings .card'); if(!root||$('#v13PrintSettings'))return;
    const s=S(),box=document.createElement('div');box.id='v13PrintSettings';box.className='card soft';box.style.marginTop='10px';
    box.innerHTML=`<h3>نصوص الطباعة والتوقيعات</h3><div class="notice">اكتب النصوص التي تريدها. الحقل الفارغ لا يظهر في الطباعة.</div><div class="form-row">
      <div class="field"><label>النص يمين الشعار</label><textarea id="printHeaderRight">${E(s.printHeaderRight||'')}</textarea></div>
      <div class="field"><label>النص يسار الشعار</label><textarea id="printHeaderLeft">${E(s.printHeaderLeft||'')}</textarea></div>
      <div class="field"><label>النص أسفل كشف حساب المشترك</label><textarea id="statementFooter">${E(s.statementFooter||'')}</textarea></div>
      <div class="field"><label>النص أسفل المبلغ المسدد في سند القبض الورقي</label><textarea id="receiptAmountNote">${E(s.receiptAmountNote||'')}</textarea></div>
      <div class="field"><label>إعداد</label><input id="statementPreparedBy" value="${E(s.statementPreparedBy||'')}"></div>
      <div class="field"><label>مراجعة</label><input id="statementReviewedBy" value="${E(s.statementReviewedBy||'')}"></div>
      <div class="field"><label>اعتماد</label><input id="statementApprovedBy" value="${E(s.statementApprovedBy||'')}"></div>
    </div>`;
    root.appendChild(box);
  }
  function patchSaveSettings(){
    const old=App.saveSettings;
    App.saveSettings=function(){
      ['printHeaderRight','printHeaderLeft','statementFooter','receiptAmountNote','statementPreparedBy','statementReviewedBy','statementApprovedBy'].forEach(k=>{const el=$('#'+k);if(el)S()[k]=el.value.trim();});
      const result=old?old.apply(this,arguments):undefined;YWP.save();return result;
    };
  }

  function showReport(title,html,rows,filename='report.xlsx'){
    const out=$('#reportOutput');if(!out)return;
    App._currentExcel=rows||[];App._currentExcelTitle=title;App._currentExcelFilename=filename;
    out.innerHTML=`<div class="card report-shell"><div class="report-screen-head"><div><small>مركز التقارير</small><h2>${E(title)}</h2></div><div class="toolbar no-print"><button onclick="App.printCurrentReport('${E(title)}')">طباعة / PDF</button><button class="secondary" onclick="App.exportCurrentExcel()">تصدير Excel</button></div></div><div id="currentReportHtml" class="report-document">${generalHeader(title)}<div class="report-generated">تاريخ الإصدار: ${E(new Date().toLocaleString('ar-YE'))}</div>${html}<div class="report-end">نهاية التقرير</div></div></div>`;
  }
  function monthSelected(){return $('#reportMonth')?.value||YWP.monthKey(today());}
  function rowsToHtml(headers,rows,footer=''){
    return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${E(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${E(c)}</td>`).join('')}</tr>`).join('')}</tbody>${footer}</table></div>`;
  }

  function monthlySummaryReport(){
    const m=monthSelected(),cycles=ST().cycles.filter(c=>YWP.monthKey(c.cycleDate)===m);
    const half=cycles.filter(c=>c.type==='HALF'),monthly=cycles.filter(c=>c.type==='MONTHLY');
    const consHalf=half.reduce((a,c)=>a+YWP.readingsForCycle(c.id).reduce((x,r)=>x+N(r.consumption),0),0);
    const consMonth=monthly.reduce((a,c)=>a+YWP.readingsForCycle(c.id).reduce((x,r)=>x+N(r.consumption),0),0);
    const home=consHalf+consMonth;
    const main=monthly.reduce((a,c)=>a+Math.max(0,N(c.mainCurrent)-N(c.mainPrev)),0);
    const loss=Math.max(0,main-home),lossPct=main>0?(loss/main*100):0;
    const invHalf=ST().invoices.filter(i=>YWP.monthKey(i.date)===m&&half.some(c=>c.id===i.cycleId)).reduce((a,i)=>a+N(i.amount),0);
    const invMonthly=ST().invoices.filter(i=>YWP.monthKey(i.date)===m&&monthly.some(c=>c.id===i.cycleId)).reduce((a,i)=>a+N(i.amount),0);
    const billed=invHalf+invMonthly,collections=YWP.paymentsInMonth(m).reduce((a,p)=>a+N(p.amount),0),expenses=YWP.expensesInMonth(m).reduce((a,e)=>a+N(e.amount),0);
    const due=ST().subscribers.reduce((a,s)=>a+Math.max(0,accountBalanceAt(s.id,m+'-31')),0),credit=ST().subscribers.reduce((a,s)=>a+Math.max(0,-accountBalanceAt(s.id,m+'-31')),0);
    const cash=collections-expenses,result=billed-expenses;
    const rows=[['استهلاك نصف الشهر (م³)',consHalf],['استهلاك نهاية الشهر (م³)',consMonth],['إجمالي استهلاك المشتركين (م³)',home],['كمية المياه الداخلة للشبكة (م³)',main],['الفاقد (م³)',loss],['نسبة الفاقد',lossPct.toFixed(2)+'%'],['إيرادات فواتير نصف الشهر',invHalf],['إيرادات فواتير نهاية الشهر',invMonthly],['إجمالي إيرادات الفواتير',billed],['إجمالي التحصيل الفعلي',collections],['إجمالي المصروفات',expenses],['صافي الحركة النقدية',cash],['صافي نتيجة الشهر',result],['الأرصدة المتبقية عليكم',due],['الأرصدة المتبقية لكم',credit]];
    const html=`<div class="v13-summary-cards"><div><small>الاستهلاك</small><b>${YWP.num(home)} م³</b></div><div><small>التحصيل</small><b>${money(collections)}</b></div><div><small>المصروفات</small><b>${money(expenses)}</b></div><div><small>صافي الحركة</small><b>${money(cash)}</b></div></div>${rowsToHtml(['البيان','القيمة'],rows.map(r=>[r[0],typeof r[1]==='number'&& !r[0].includes('م³')?money(r[1]):r[1]]))}`;
    showReport(`التقرير الشهري الشامل - ${m}`,html,[['البيان','القيمة']].concat(rows),`monthly-summary-${m}.xlsx`);
  }

  function projectLedgerReport(){
    const entries=[];
    ST().invoices.forEach(i=>entries.push({date:i.date,cycle:YWP.cycle(i.cycleId)?.cycleDate||'',kind:'فاتورة',ref:i.no,billed:N(i.amount),collected:0,expense:0}));
    ST().payments.forEach(p=>entries.push({date:p.date,cycle:cycleForDate(p.date)?.cycleDate||'',kind:'سند قبض',ref:p.receiptNo,billed:0,collected:N(p.amount),expense:0}));
    ST().expenses.forEach(e=>entries.push({date:e.date,cycle:cycleForDate(e.date)?.cycleDate||'',kind:'مصروف',ref:e.refNo||'',billed:0,collected:0,expense:N(e.amount)}));
    entries.sort((a,b)=>(a.date+a.kind+a.ref).localeCompare(b.date+b.kind+b.ref));
    let cash=0;const rows=entries.map(x=>{cash+=x.collected-x.expense;return[x.date,x.cycle,x.kind,x.ref,x.billed,x.collected,x.expense,cash];});
    const html=rowsToHtml(['التاريخ','الدورة','البيان','المرجع','الإيرادات','التحصيل','المصروفات','الرصيد النقدي'],rows.map(r=>[r[0],r[1],r[2],r[3],money(r[4]),money(r[5]),money(r[6]),money(r[7])]));
    showReport('كشف الحساب التراكمي للمشروع',html,[['التاريخ','الدورة','البيان','المرجع','الإيرادات','التحصيل','المصروفات','الرصيد النقدي']].concat(rows),'project-ledger.xlsx');
  }

  function collectorReviewReport(){
    const m=monthSelected(),rows=YWP.paymentsInMonth(m).map(p=>{const s=YWP.subscriber(p.subscriberId)||{},before=accountBalanceAt(p.subscriberId,p.date)+N(p.amount),after=accountBalanceAt(p.subscriberId,p.date),bl=balanceLabel(after);return[p.date,p.receiptNo,s.meterNo,s.name,before,p.amount,p.collector||'',bl.label,bl.amount];});
    const html=rowsToHtml(['التاريخ','السند','رقم العداد','المشترك','الرصيد قبل السداد','المبلغ المحصل','المحصل','الحالة','الرصيد'],rows.map(r=>[r[0],r[1],r[2],r[3],money(r[4]),money(r[5]),r[6],r[7],money(r[8])]));
    showReport(`كشف مراجعة المحصل - ${m}`,html,[['التاريخ','السند','رقم العداد','المشترك','الرصيد قبل السداد','المبلغ المحصل','المحصل','الحالة','الرصيد']].concat(rows),`collector-review-${m}.xlsx`);
  }

  function cashboxReport(){
    const m=monthSelected(),entries=[];
    YWP.paymentsInMonth(m).forEach(p=>entries.push([p.date,p.receiptNo,'مقبوضات',N(p.amount),0,p.collector||'']));
    YWP.expensesInMonth(m).forEach(e=>entries.push([e.date,e.refNo||'','مصروفات',0,N(e.amount),e.description||'']));
    entries.sort((a,b)=>(a[0]+a[1]).localeCompare(b[0]+b[1]));let bal=0;const rows=entries.map(r=>{bal+=r[3]-r[4];return r.concat([bal]);});
    const html=rowsToHtml(['التاريخ','المرجع','البيان','المقبوضات','المصروفات','التفاصيل','الرصيد'],rows.map(r=>[r[0],r[1],r[2],money(r[3]),money(r[4]),r[5],money(r[6])]));
    showReport(`كشف حركة الصندوق - ${m}`,html,[['التاريخ','المرجع','البيان','المقبوضات','المصروفات','التفاصيل','الرصيد']].concat(rows),`cashbox-${m}.xlsx`);
  }

  function statementReport(){
    const id=$('#statementSub')?.value;if(!id)return alert('اختر مشتركًا.');const s=YWP.subscriber(id)||{};
    let bal=YWP.openingNet(s);const ledger=[['افتتاحي','الرصيد الافتتاحي','',YWP.openingArrears(s),YWP.openingCredit(s),bal]];
    const e=[];ST().invoices.filter(i=>i.subscriberId===id).forEach(i=>e.push([i.date,'فاتورة',i.no,N(i.amount),0]));ST().payments.filter(p=>p.subscriberId===id).forEach(p=>e.push([p.date,'سند قبض',p.receiptNo,0,N(p.amount)]));
    e.sort((a,b)=>(a[0]+a[1]+a[2]).localeCompare(b[0]+b[1]+b[2])).forEach(r=>{bal+=r[3]-r[4];ledger.push(r.concat([bal]));});const bl=balanceLabel(bal);
    const html=`<p><b>${E(s.name)}</b> — رقم العداد: ${E(s.meterNo)} — ${E(s.area)}</p>${rowsToHtml(['التاريخ','البيان','المرجع','مدين','دائن','الرصيد'],ledger.map(r=>[r[0],r[1],r[2],money(r[3]),money(r[4]),money(r[5])]))}<div class="v13-final-balance ${bl.cls}"><span>${bl.label}</span><b>${money(bl.amount)}</b></div>${S().statementFooter?`<div class="v13-note">${E(S().statementFooter)}</div>`:''}<div class="v13-approvals"><span>إعداد<br><b>${E(S().statementPreparedBy||'________________')}</b></span><span>مراجعة<br><b>${E(S().statementReviewedBy||'________________')}</b></span><span>اعتماد<br><b>${E(S().statementApprovedBy||'________________')}</b></span></div>`;
    showReport('كشف حساب المشترك',html,[['التاريخ','البيان','المرجع','مدين','دائن','الرصيد']].concat(ledger),`statement-${s.meterNo||s.code}.xlsx`);
  }

  function invoiceRegisterReport(){
    const m=monthSelected(); YWP.recomputeInvoiceStatuses();
    const rows=YWP.invoicesInMonth(m).map(i=>{const sub=YWP.subscriber(i.subscriberId)||{},bl=balanceLabel(N(i.prevBalance)+N(i.amount));return[i.no,i.date,sub.name,sub.meterNo,i.consumption||0,i.amount||0,Math.max(0,N(i.prevBalance)),sub.previousPayments||0,bl.label,bl.amount,YWP.invoiceStatusText(i)];});
    const html=rowsToHtml(['رقم الفاتورة','التاريخ','المشترك','رقم العداد','الاستهلاك','قيمة الاستهلاك','المتأخرات','المدفوعات السابقة','الحالة','الرصيد','حالة الفاتورة'],rows.map(r=>[r[0],r[1],r[2],r[3],r[4],money(r[5]),money(r[6]),money(r[7]),r[8],money(r[9]),r[10]]));
    showReport(`كشف الفواتير - ${m}`,html,[['رقم الفاتورة','التاريخ','المشترك','رقم العداد','الاستهلاك','قيمة الاستهلاك','المتأخرات','المدفوعات السابقة','الحالة','الرصيد','حالة الفاتورة']].concat(rows),`invoice-register-${m}.xlsx`);
  }

  function collectionReport(){
    const m=monthSelected();
    const rows=YWP.paymentsInMonth(m).map(p=>{const sub=YWP.subscriber(p.subscriberId)||{},bl=balanceLabel(accountBalanceAt(p.subscriberId,p.date));return[p.date,p.receiptNo,sub.name,sub.meterNo,p.amount,p.method,p.collector||'',bl.label,bl.amount,p.note||''];});
    const total=rows.reduce((a,r)=>a+N(r[4]),0);
    const html=rowsToHtml(['التاريخ','السند','المشترك','رقم العداد','المبلغ','الطريقة','المحصل','الحالة','الرصيد','ملاحظات'],rows.map(r=>[r[0],r[1],r[2],r[3],money(r[4]),r[5],r[6],r[7],money(r[8]),r[9]]),`<tfoot><tr><th colspan="4">الإجمالي</th><th>${money(total)}</th><th colspan="5"></th></tr></tfoot>`);
    showReport(`تقرير التحصيل - ${m}`,html,[['التاريخ','السند','المشترك','رقم العداد','المبلغ','الطريقة','المحصل','الحالة','الرصيد','ملاحظات']].concat(rows),`collection-${m}.xlsx`);
  }

  function revenueReport(){
    const m=monthSelected();
    const payments=YWP.paymentsInMonth(m).filter(p=>p.confirmed!==false&&p.cancelled!==true&&p.voided!==true&&p.method!=='مدفوعات سابقة'&&!String(p.id||'').startsWith('PAY-EXCEL-'));
    const rows=payments.map(p=>{const sub=YWP.subscriber(p.subscriberId)||{};return[p.date,p.receiptNo,sub.name,sub.meterNo,p.incomeType==='CONNECTION_FEE'?'رسوم إدخال الخدمة':'مبيعات مياه',p.amount||0,p.method||'',p.collector||''];});
    const total=rows.reduce((a,r)=>a+N(r[5]),0);
    const html=rowsToHtml(['التاريخ','السند','المشترك','رقم العداد','نوع الإيراد','المبلغ المحصل','طريقة الدفع','المحصل'],rows.map(r=>[r[0],r[1],r[2],r[3],r[4],money(r[5]),r[6],r[7]]),`<tfoot><tr><th colspan="5">إجمالي الإيرادات المحصلة</th><th>${money(total)}</th><th colspan="2"></th></tr></tfoot>`);
    showReport(`كشف الإيرادات المحصلة - ${m}`,html,[['التاريخ','السند','المشترك','رقم العداد','نوع الإيراد','المبلغ المحصل','طريقة الدفع','المحصل']].concat(rows),`collected-revenue-${m}.xlsx`);
  }

  function expenseReport(){
    const m=monthSelected();
    const rows=YWP.expensesInMonth(m).map(e=>[e.date,e.category,e.description,e.amount,e.payee,e.refNo]);
    const total=rows.reduce((a,r)=>a+N(r[3]),0);
    const html=rowsToHtml(['التاريخ','النوع','البيان','المبلغ','المستلم','المرجع'],rows.map(r=>[r[0],r[1],r[2],money(r[3]),r[4],r[5]]),`<tfoot><tr><th colspan="3">الإجمالي</th><th>${money(total)}</th><th colspan="2"></th></tr></tfoot>`);
    showReport(`كشف المصروفات - ${m}`,html,[['التاريخ','النوع','البيان','المبلغ','المستلم','المرجع']].concat(rows),`expenses-${m}.xlsx`);
  }

  function lossReport(){
    const m=monthSelected();
    const cycles=ST().cycles.filter(c=>YWP.monthKey(c.cycleDate)===m),monthly=cycles.filter(c=>c.type==='MONTHLY');
    const main=monthly.reduce((a,c)=>a+Math.max(0,N(c.mainCurrent)-N(c.mainPrev)),0);
    const home=cycles.reduce((a,c)=>a+YWP.readingsForCycle(c.id).reduce((x,r)=>x+N(r.consumption),0),0);
    const loss=main-home,pct=main?loss/main*100:0;
    const rows=[['كمية المياه الداخلة للشبكة',main],['إجمالي استهلاك المشتركين',home],['كمية الفاقد',loss],['نسبة الفاقد',pct.toFixed(2)+'%']];
    const html=rowsToHtml(['البيان','القيمة'],rows.map(r=>[r[0],typeof r[1]==='number'?YWP.num(r[1])+' م³':r[1]]));
    showReport(`تقرير الاستهلاك والفاقد - ${m}`,html,[['البيان','القيمة']].concat(rows),`loss-${m}.xlsx`);
  }

  function balancesReport(){
    const rows=ST().subscribers.map(sub=>{const b=YWP.balance(sub.id),bl=balanceLabel(b),last=YWP.lastReading(sub.id);return[sub.name,sub.meterNo,sub.area,sub.openingReading||0,last?.current||0,YWP.openingArrears(sub),YWP.openingCredit(sub),sub.previousPayments||0,bl.label,bl.amount];});
    const html=rowsToHtml(['المشترك','رقم العداد','العنوان','القراءة الافتتاحية','آخر قراءة','المتأخرات الافتتاحية','الرصيد المقدم','المدفوعات السابقة','الحالة','الرصيد'],rows.map(r=>[r[0],r[1],r[2],r[3],r[4],money(r[5]),money(r[6]),money(r[7]),r[8],money(r[9])]));
    showReport('كشف أرصدة المشتركين',html,[['المشترك','رقم العداد','العنوان','القراءة الافتتاحية','آخر قراءة','المتأخرات الافتتاحية','الرصيد المقدم','المدفوعات السابقة','الحالة','الرصيد']].concat(rows),'subscriber-balances.xlsx');
  }

  function enhanceReports(){
    const root=$('#reports .card');if(!root||$('#v13ReportBar'))return;
    const bar=document.createElement('div');bar.id='v13ReportBar';bar.className='toolbar v13-report-bar';
    bar.innerHTML='<button class="green" onclick="App.monthlySummaryReport()">التقرير الشهري الشامل</button><button onclick="App.projectLedgerReport()">كشف حساب المشروع</button><button class="secondary" onclick="App.collectorReviewReport()">كشف مراجعة المحصل</button><button class="warn" onclick="App.cashboxReport()">كشف حركة الصندوق</button>';
    root.insertBefore(bar,root.children[1]||null);
  }

  function cycleForDate(date){return ST().cycles.filter(c=>(c.cycleDate||'')<=date).sort((a,b)=>(b.cycleDate||'').localeCompare(a.cycleDate||''))[0]||null;}
  function assignCycleIds(){ST().payments.forEach(p=>{if(!p.cycleId)p.cycleId=cycleForDate(p.date)?.id||null;});ST().expenses.forEach(e=>{if(!e.cycleId)e.cycleId=cycleForDate(e.date)?.id||null;});YWP.save();}
  function silentGenerate(cycleId){
    const c=YWP.cycle(cycleId);if(!c)return;YWP.readingsForCycle(cycleId).forEach(r=>{let inv=ST().invoices.find(i=>i.cycleId===cycleId&&i.subscriberId===r.subscriberId);const first=!ST().invoices.some(i=>i.subscriberId===r.subscriberId&&i.id!==(inv&&inv.id));const prevBal=first?YWP.openingNet(YWP.subscriber(r.subscriberId)):YWP.balance(r.subscriberId,inv&&inv.id);const amount=N(r.consumption)*N(S().tariff);if(inv){Object.assign(inv,{prevReading:r.prev,currentReading:r.current,consumption:r.consumption,tariff:N(S().tariff),amount,prevBalance:prevBal,totalDue:prevBal+amount,updatedAt:new Date().toISOString()});}else{ST().invoices.push({id:YWP.uid('INV'),no:`INV-${c.cycleDate.replace(/-/g,'')}-${YWP.subscriber(r.subscriberId)?.code||'X'}`,cycleId,subscriberId:r.subscriberId,date:c.cycleDate,prevReading:r.prev,currentReading:r.current,consumption:r.consumption,tariff:N(S().tariff),amount,prevBalance:prevBal,totalDue:prevBal+amount,status:'due',createdAt:new Date().toISOString()});}});YWP.recomputeInvoiceStatuses();YWP.save();
  }
  function closeCycle(id){
    const c=YWP.cycle(id);if(!c)return;if(c.status==='closed')return alert('الدورة مغلقة مسبقًا.');const targets=YWP.activeSubscribers(c.type),ids=new Set(YWP.readingsForCycle(id).map(r=>r.subscriberId));const missing=targets.filter(s=>!ids.has(s.id));if(missing.length)return alert(`لا يمكن إغلاق الدورة. توجد ${missing.length} قراءة غير مدخلة.`);if(!confirm('سيتم إنشاء فواتير الدورة ثم قفلها وإضافتها إلى أرشيف الدورات. هل تريد المتابعة؟'))return;silentGenerate(id);c.status='closed';c.closedAt=new Date().toISOString();c.closedBy='مدير النظام';const old=ST().cycleArchives.find(a=>a.cycleId===id);const snapshot={id:old?.id||YWP.uid('ARC'),cycleId:id,closedAt:c.closedAt,cycle:JSON.parse(JSON.stringify(c)),readings:JSON.parse(JSON.stringify(YWP.readingsForCycle(id))),invoices:JSON.parse(JSON.stringify(ST().invoices.filter(i=>i.cycleId===id))),payments:JSON.parse(JSON.stringify(ST().payments.filter(p=>(p.cycleId||cycleForDate(p.date)?.id)===id))),expenses:JSON.parse(JSON.stringify(ST().expenses.filter(e=>(e.cycleId||cycleForDate(e.date)?.id)===id)))};if(old)Object.assign(old,snapshot);else ST().cycleArchives.push(snapshot);YWP.save();alert('تم إغلاق الدورة وحفظها في أرشيف الدورات.');App.switchTab('archive');
  }
  function reopenCycle(id){const c=YWP.cycle(id);if(!c||c.status!=='closed')return;const reason=prompt('أدخل سبب إعادة فتح الدورة:');if(!reason||!reason.trim())return alert('سبب إعادة الفتح إلزامي.');if(!confirm('إعادة فتح الدورة تسمح بتعديل بياناتها. متابعة؟'))return;c.status='open';c.reopenedAt=new Date().toISOString();c.reopenReason=reason.trim();ST().reopenLog.push({cycleId:id,at:c.reopenedAt,reason:reason.trim(),by:'مدير النظام'});YWP.save();renderArchive();}
  function archiveData(id){const c=YWP.cycle(id)||{};return{c,readings:YWP.readingsForCycle(id),invoices:ST().invoices.filter(i=>i.cycleId===id),payments:ST().payments.filter(p=>(p.cycleId||cycleForDate(p.date)?.id)===id),expenses:ST().expenses.filter(e=>(e.cycleId||cycleForDate(e.date)?.id)===id)};}
  function renderArchive(){
    const root=$('#archive');if(!root)return;const cycles=ST().cycles.slice().sort((a,b)=>(b.cycleDate||'').localeCompare(a.cycleDate||''));
    root.innerHTML=`<div class="card"><h2>أرشيف الدورات</h2><div class="notice">الدورات المغلقة للعرض والطباعة والتصدير. إعادة الفتح متاحة لمدير النظام مع تسجيل السبب.</div><div class="archive-list">${cycles.map(c=>`<div class="archive-item"><div><b>${E(YWP.arCycle(c.type))}</b><small>${E(c.cycleDate)} — ${c.status==='closed'?'مغلقة':'مفتوحة'}</small></div><div class="actions"><button onclick="App.viewArchiveCycle('${c.id}')">عرض</button>${c.status==='closed'?`<button class="warn" onclick="App.reopenCycle('${c.id}')">إعادة فتح</button>`:''}</div></div>`).join('')}</div><div id="archiveDetails"></div></div>`;
  }
  function viewArchiveCycle(id){
    const d=archiveData(id),cons=d.readings.reduce((a,r)=>a+N(r.consumption),0),billed=d.invoices.reduce((a,i)=>a+N(i.amount),0),col=d.payments.reduce((a,p)=>a+N(p.amount),0),exp=d.expenses.reduce((a,e)=>a+N(e.amount),0);
    const invRows=d.invoices.map(i=>{const sub=YWP.subscriber(i.subscriberId)||{},bl=balanceLabel(N(i.prevBalance)+N(i.amount));return[i.no,sub.name,sub.meterNo,i.prevReading||0,i.currentReading||0,i.consumption||0,i.amount||0,bl.label,bl.amount];});
    const readingRows=d.readings.map(r=>{const sub=YWP.subscriber(r.subscriberId)||{};return[sub.name,sub.meterNo,r.prev,r.current,r.consumption,r.notes||''];});
    const paymentRows=d.payments.map(p=>{const sub=YWP.subscriber(p.subscriberId)||{};return[p.receiptNo,p.date,sub.name,sub.meterNo,p.amount,p.method,p.collector||''];});
    const expenseRows=d.expenses.map(e=>[e.date,e.category,e.description,e.amount,e.payee,e.refNo]);
    const main=Math.max(0,N(d.c.mainCurrent)-N(d.c.mainPrev)),loss=main-cons;
    const el=$('#archiveDetails');if(!el)return;
    el.innerHTML=`<div class="card soft"><h3>${E(YWP.arCycle(d.c.type))} — ${E(d.c.cycleDate)}</h3>
      <div class="v13-summary-cards"><div><small>الاستهلاك</small><b>${YWP.num(cons)} م³</b></div><div><small>الفواتير</small><b>${money(billed)}</b></div><div><small>التحصيل</small><b>${money(col)}</b></div><div><small>المصروفات</small><b>${money(exp)}</b></div></div>
      ${d.c.type==='MONTHLY'?`<div class="v13-summary-cards"><div><small>استهلاك العداد الرئيسي</small><b>${YWP.num(main)} م³</b></div><div><small>الفاقد</small><b>${YWP.num(loss)} م³</b></div><div><small>صافي الحركة</small><b>${money(col-exp)}</b></div><div><small>صافي نتيجة الدورة</small><b>${money(billed-exp)}</b></div></div>`:''}
      <div class="toolbar"><button onclick="App.printArchiveCycle('${id}')">طباعة الملف الكامل</button><button class="secondary" onclick="App.exportArchiveCycle('${id}')">تصدير Excel</button></div>
      <details open><summary><b>الفواتير (${invRows.length})</b></summary>${rowsToHtml(['الفاتورة','المشترك','رقم العداد','السابقة','الحالية','الاستهلاك','القيمة','الحالة','الرصيد'],invRows.map(r=>[r[0],r[1],r[2],r[3],r[4],r[5],money(r[6]),r[7],money(r[8])]))}</details>
      <details><summary><b>القراءات (${readingRows.length})</b></summary>${rowsToHtml(['المشترك','رقم العداد','السابقة','الحالية','الاستهلاك','ملاحظات'],readingRows)}</details>
      <details><summary><b>سندات القبض (${paymentRows.length})</b></summary>${rowsToHtml(['السند','التاريخ','المشترك','رقم العداد','المبلغ','الطريقة','المحصل'],paymentRows.map(r=>[r[0],r[1],r[2],r[3],money(r[4]),r[5],r[6]]))}</details>
      <details><summary><b>المصروفات (${expenseRows.length})</b></summary>${rowsToHtml(['التاريخ','النوع','البيان','المبلغ','المستلم','المرجع'],expenseRows.map(r=>[r[0],r[1],r[2],money(r[3]),r[4],r[5]]))}</details>
    </div>`;
  }
  function printArchiveCycle(id){viewArchiveCycle(id);const html=$('#archiveDetails')?.innerHTML||'';YWP.printWindow('أرشيف الدورة',generalHeader('أرشيف الدورة')+html,'A4');}
  function exportArchiveCycle(id){const d=archiveData(id),rows=[['نوع السجل','التاريخ','المرجع','المشترك/البيان','رقم العداد','الاستهلاك','المبلغ']];d.invoices.forEach(i=>{const s=YWP.subscriber(i.subscriberId)||{};rows.push(['فاتورة',i.date,i.no,s.name,s.meterNo,i.consumption,i.amount]);});d.payments.forEach(p=>{const s=YWP.subscriber(p.subscriberId)||{};rows.push(['سند قبض',p.date,p.receiptNo,s.name,s.meterNo,'',p.amount]);});d.expenses.forEach(e=>rows.push(['مصروف',e.date,e.refNo||'',e.description||'', '', '',e.amount]));exportXlsx(`cycle-${d.c.cycleDate}.xlsx`,`أرشيف الدورة ${d.c.cycleDate}`,rows);}

  function addArchiveUi(){
    if(!$('#archive')){const s=document.createElement('section');s.id='archive';s.className='tab';document.querySelector('main')?.appendChild(s);}const grid=$('#more .menu-grid');if(grid&&!$('#archiveMenuBtn')){const b=document.createElement('button');b.id='archiveMenuBtn';b.innerHTML='<span>🗂️</span><b>أرشيف الدورات</b>';b.onclick=()=>App.switchTab('archive');grid.appendChild(b);}
  }

  function patchArchiveGuards(){
    const oldDeletePayment=App.deletePayment;
    App.deletePayment=function(id){
      const p=ST().payments.find(x=>x.id===id),c=p&&YWP.cycle(p.cycleId||cycleForDate(p.date)?.id);
      if(c&&c.status==='closed')return alert('لا يمكن حذف سند مرتبط بدورة مغلقة. أعد فتح الدورة أولًا من أرشيف الدورات.');
      return oldDeletePayment?oldDeletePayment.apply(this,arguments):undefined;
    };
    const oldDeleteExpense=App.deleteExpense;
    App.deleteExpense=function(id){
      const e=ST().expenses.find(x=>x.id===id),c=e&&YWP.cycle(e.cycleId||cycleForDate(e.date)?.id);
      if(c&&c.status==='closed')return alert('لا يمكن حذف مصروف مرتبط بدورة مغلقة. أعد فتح الدورة أولًا من أرشيف الدورات.');
      return oldDeleteExpense?oldDeleteExpense.apply(this,arguments):undefined;
    };
  }

  function patchPayments(){
    const old=App.savePayment;App.savePayment=function(){const before=ST().payments.length;const r=old?old.apply(this,arguments):undefined;setTimeout(()=>{if(ST().payments.length>before){const p=ST().payments[ST().payments.length-1];if(!p.cycleId)p.cycleId=cycleForDate(p.date)?.id||null;YWP.save();}},50);return r;};
  }
  function patchExpenses(){const old=App.saveExpense;App.saveExpense=function(){const before=ST().expenses.length;const r=old?old.apply(this,arguments):undefined;setTimeout(()=>{if(ST().expenses.length>before){const e=ST().expenses[ST().expenses.length-1];if(!e.cycleId)e.cycleId=cycleForDate(e.date)?.id||null;YWP.save();}},50);return r;};}

  function patchProductionExports(){
    if(!window.QatraProduction)return;
    QatraProduction.exportAccountingValidation=function(){
      const r=QatraProduction.validateAccounting();
      exportXlsx('accounting-validation.xlsx','فحص الحسابات',[['النوع','الملاحظة']].concat(r.issues||[]));
    };
    QatraProduction.exportAuditLog=function(){
      exportXlsx('audit-log.xlsx','سجل التدقيق',[['التاريخ','العملية','التفاصيل']].concat((ST().auditLog||[]).map(x=>[x.at,x.action,JSON.stringify(x.details||{})])));
    };
    QatraProduction.exportMessageLog=function(){
      exportXlsx('message-log.xlsx','سجل الرسائل',[['التاريخ','القناة','الطريقة','الفاتورة','الاسم','الهاتف','الحالة','سبب الفشل']].concat((ST().messageLog||[]).map(x=>[x.at,x.channel,x.mode,x.invoiceNo,x.subscriberName,x.phone,x.status||'pending',x.failureReason||''])));
    };
  }

  function patchNavigation(){
    const oldSwitch=App.switchTab;App.switchTab=function(id){if(id==='archive'){ $$('.tabs button').forEach(b=>b.classList.remove('active'));$$('.tab').forEach(s=>s.classList.toggle('active',s.id==='archive'));document.body.dataset.activeTab='archive';renderArchive();window.scrollTo({top:0});return;}const r=oldSwitch.apply(this,arguments);setTimeout(()=>{enhanceSettings();enhanceReports();},20);return r;};
    const oldRender=App.renderAll;App.renderAll=function(){const r=oldRender.apply(this,arguments);setTimeout(()=>{addArchiveUi();enhanceSettings();enhanceReports();ensureThermalModal();},20);return r;};
  }

  function removeForbiddenWord(){
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while((n=walker.nextNode())){if(n.nodeValue&&n.nodeValue.includes('مطلوب'))n.nodeValue=n.nodeValue.replace(/مطلوب/g,'عليكم');}
  }

  function install(){
    if(!window.YWP||!window.App)return setTimeout(install,250);
    migrateV13();assignCycleIds();originalReceiptHtml=YWP.receiptHtml.bind(YWP);YWP.invoiceHtml=invoiceHtml;YWP.receiptHtml=receiptHtml;
    patchExports();patchSaveSettings();patchPayments();patchExpenses();patchArchiveGuards();patchProductionExports();patchNavigation();
    Object.assign(App,{monthlySummaryReport,projectLedgerReport,collectorReviewReport,cashboxReport,invoiceRegisterReport,collectionReport,revenueReport,expenseReport,matchingReport:monthlySummaryReport,profitReport:monthlySummaryReport,lossReport,balancesReport,statementReport,closeCycle,reopenCycle,renderArchive,viewArchiveCycle,printArchiveCycle,exportArchiveCycle,exportXlsx,previewThermalReceipt,previewThermalInvoice,printThermalReceipt,printThermalInvoice,closeThermalPreview});
    if(window.QatraAccounting)QatraAccounting.wrapOperations();
    addArchiveUi();enhanceSettings();enhanceReports();ensureThermalModal();removeForbiddenWord();
    setInterval(removeForbiddenWord,1800);
  }
  window.addEventListener('load',()=>setTimeout(install,950));
})();
