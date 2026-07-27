/* مياه الروضة v11 - تطبيق واحد بثلاث واجهات
   تحسينات الحسابات، القراءة المتسلسلة، الفاتورة الرسمية، Excel، إغلاق الدورة، والإيرادات النقدية.
*/
(function(){
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const Y = () => window.YWP;
  const S = () => window.YWP?.state;
  const n = v => window.YWP?.toNumber(v) || 0;
  const esc = v => window.YWP?.esc(v) || String(v ?? '');
  const today = () => new Date().toISOString().slice(0,10);
  let seqIndex = 0;
  let messageQueue = [];

  function migrate(){
    const st=S(); if(!st) return;
    st.meta ||= {}; st.meta.version='11.0.0-one-app'; st.meta.appName='مياه الروضة';
    st.settings ||= {};
    st.settings.currency='ريال يمني'; st.settings.currencyShort='ر.ي'; st.settings.currencyFull='ريال يمني';
    st.settings.invoiceSmsTemplate ||= 'الأخ/ {name}، فاتورة المياه رقم {invoiceNo} لدورة {cycleName}. الاستهلاك {consumption} م³، استهلاك الدورة {amount} {currencyShort}، المتأخرات {arrears} {currencyShort}، إجمالي المستحق {totalDue} {currencyShort}. {project}';
    st.settings.invoiceWhatsappTemplate ||= 'فاتورة استهلاك مياه\nالمشترك: {name}\nرقم العداد: {meterNo}\nرقم الفاتورة: {invoiceNo}\nالدورة: {cycleName}\nق. سابقة: {prevReading}\nق. حالية: {currentReading}\nالفارق: {consumption} م³\nاستهلاك الدورة: {amount} {currencyShort}\nالمتأخرات: {arrears} {currencyShort}\nالرصيد المقدم: {openingCredit} {currencyShort}\nإجمالي المستحق: {totalDue} {currencyShort}';
    // إزالة الحالة والمدفوعات السابقة من القوالب الافتراضية إذا كانت ما تزال من النسخة القديمة.
    if(String(st.settings.invoiceSmsTemplate).includes('المدفوعات السابقة') || String(st.settings.invoiceSmsTemplate).includes('حالة الفاتورة')){
      st.settings.invoiceSmsTemplate='الأخ/ {name}، فاتورة المياه رقم {invoiceNo} لدورة {cycleName}. الاستهلاك {consumption} م³، استهلاك الدورة {amount} {currencyShort}، المتأخرات {arrears} {currencyShort}، إجمالي المستحق {totalDue} {currencyShort}. {project}';
    }
    if(String(st.settings.invoiceWhatsappTemplate).includes('المدفوعات السابقة') || String(st.settings.invoiceWhatsappTemplate).includes('حالة الفاتورة')){
      st.settings.invoiceWhatsappTemplate='فاتورة استهلاك مياه\nالمشترك: {name}\nرقم العداد: {meterNo}\nرقم الفاتورة: {invoiceNo}\nالدورة: {cycleName}\nق. سابقة: {prevReading}\nق. حالية: {currentReading}\nالفارق: {consumption} م³\nاستهلاك الدورة: {amount} {currencyShort}\nالمتأخرات: {arrears} {currencyShort}\nالرصيد المقدم: {openingCredit} {currencyShort}\nإجمالي المستحق: {totalDue} {currencyShort}';
    }
    st.meterChanges ||= [];
    st.cycleArchives ||= [];
    st.cashboxDirectPayments ||= [];
    st.payments ||= [];
    st.payments.forEach(p=>{
      if(!p.incomeType) p.incomeType='WATER';
      if(!p.source) p.source='system';
      if(p.confirmed===undefined) p.confirmed=true;
    });
    st.cycles ||= [];
    st.cycles.forEach(c=>{ if(!c.status) c.status='open'; });
    Y().save();
  }

  function xmlEscape(v){ return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
  function excelXml(title, rows){
    const clean = Array.isArray(rows) ? rows : [];
    const widths = [];
    clean.forEach(r=>r.forEach((c,i)=>widths[i]=Math.min(45,Math.max(widths[i]||10,String(c??'').length+2))));
    const cols=widths.map(w=>`<Column ss:AutoFitWidth="0" ss:Width="${Math.max(60,w*7)}"/>`).join('');
    const body=clean.map((r,ri)=>`<Row>${r.map(c=>{
      const numVal=typeof c==='number' && Number.isFinite(c);
      return `<Cell${ri===0?' ss:StyleID="Header"':''}><Data ss:Type="${numVal?'Number':'String'}">${xmlEscape(c)}</Data></Cell>`;
    }).join('')}</Row>`).join('');
    return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center" ss:Horizontal="Right"/><Font ss:FontName="Tahoma" ss:Size="10"/></Style><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style></Styles>
<Worksheet ss:Name="${xmlEscape(String(title||'تقرير').slice(0,31))}"><Table>${cols}${body}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet></Workbook>`;
  }
  function exportExcel(filename,title,rows){
    const safe=String(filename||'report.xls').replace(/\.xlsx?$/i,'')+'.xls';
    Y().download(safe, '\uFEFF'+excelXml(title,rows), 'application/vnd.ms-excel');
  }
  Y().exportExcel=exportExcel;

  function incomeTypeText(t){ return t==='CONNECTION_FEE'?'رسوم إدخال الخدمة':'مبيعات المياه'; }
  function confirmedRevenuePayments(month){
    return S().payments.filter(p=>p.confirmed!==false && ['WATER','CONNECTION_FEE'].includes(p.incomeType||'WATER') && (!month || Y().monthKey(p.date)===month));
  }
  function revenueTotals(month){
    const list=confirmedRevenuePayments(month);
    const water=list.filter(p=>(p.incomeType||'WATER')==='WATER').reduce((a,p)=>a+n(p.amount),0);
    const connection=list.filter(p=>p.incomeType==='CONNECTION_FEE').reduce((a,p)=>a+n(p.amount),0);
    return {water,connection,total:water+connection};
  }

  function invoiceHtml(inv){
    const st=S(), sub=Y().subscriber(inv.subscriberId)||{}, cyc=Y().cycle(inv.cycleId)||{};
    const arrears=Math.max(0,n(inv.prevBalance));
    const credit=Math.max(0,-n(inv.prevBalance));
    const consumptionAmount=Math.max(0,n(inv.amount));
    const total=Math.max(0,consumptionAmount+arrears-credit);
    const logo=st.settings.projectLogo?`<img class="bw-logo" src="${st.settings.projectLogo}" alt="الشعار">`:`<img class="bw-logo" src="assets/icon-512.png" alt="الشعار">`;
    return `<style>@page{size:A5 landscape;margin:5mm}.invoice-landscape{width:210mm;min-height:148mm;background:#fff;color:#000;padding:7mm;margin:auto;font-family:Tahoma,Arial,sans-serif;font-size:10.5pt;box-sizing:border-box}.invoice-head-bw{text-align:center;border-bottom:1.5px solid #000;padding-bottom:4mm}.bw-logo{width:20mm;height:20mm;object-fit:contain;filter:grayscale(100%)}.invoice-head-bw h2{margin:1mm 0;font-size:15pt;color:#000}.invoice-head-bw div{font-weight:700}.invoice-head-bw small{display:block;margin-top:1mm}.invoice-title-row{display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr;border:1px solid #000;border-top:0}.invoice-title-row>*{padding:2.2mm;border-left:1px solid #000;text-align:center}.invoice-title-row>*:last-child{border-left:0}.invoice-title-row b{font-size:13pt}.invoice-bw-table{width:100%;border-collapse:collapse;min-width:0;margin-top:3mm;color:#000}.invoice-bw-table th,.invoice-bw-table td{border:1px solid #000;padding:2.5mm;text-align:center;background:#fff;color:#000}.invoice-bw-table.info th{width:11%}.invoice-bw-table.info td{text-align:right}.invoice-bw-table.values td{font-size:12pt}.invoice-bw-table.footer-values th{width:18%}.invoice-bw-table.footer-values td{text-align:right}.invoice-bw-table.footer-values td:last-child{font-weight:700}</style><div class="invoice-landscape">
      <header class="invoice-head-bw">
        ${logo}
        <h2>${esc(st.settings.invoiceHeaderTitle||st.settings.projectName||'قطرة برو')}</h2>
        <div>${esc(st.settings.invoiceHeaderSubtitle||'للمياه النقية')}</div>
        <small>${esc(st.settings.documentHeaderLine1||st.settings.projectAddress||'')} ${st.settings.projectPhone1?' | '+esc(st.settings.projectPhone1):''} ${st.settings.projectAccountNo?' | رقم الحساب: '+esc(st.settings.projectAccountNo):''}</small>
      </header>
      <div class="invoice-title-row"><b>${esc(st.settings.invoiceTitle||'فاتورة استهلاك مياه')}</b><span>رقم الفاتورة: ${esc(inv.no)}</span><span>التاريخ: ${esc(inv.date)}</span><span>الدورة: ${esc(Y().arCycle(cyc.type))}</span></div>
      <table class="invoice-bw-table info"><tr><th>اسم المشترك</th><td>${esc(sub.name)}</td><th>رقم العداد</th><td>${esc(sub.meterNo)}</td><th>العنوان</th><td>${esc(sub.area)}</td></tr></table>
      <table class="invoice-bw-table values"><thead><tr><th>ق. سابقة</th><th>ق. حالية</th><th>الفارق</th><th>سعر الوحدة</th><th>استهلاك الدورة</th><th>المتأخرات</th><th>إجمالي المبلغ المستحق</th></tr></thead><tbody><tr><td>${Y().num(inv.prevReading||0)}</td><td>${Y().num(inv.currentReading||0)}</td><td>${Y().num(inv.consumption||0)}</td><td>${Y().money(inv.tariff||st.settings.tariff)}</td><td>${Y().money(consumptionAmount)}</td><td>${Y().money(arrears)}</td><td><b>${Y().money(total)}</b></td></tr></tbody></table>
      <table class="invoice-bw-table footer-values"><tr><th>الرصيد المقدم</th><td>${Y().money(credit)}</td><th>إجمالي المبلغ المستحق كتابة</th><td colspan="3">${esc(Y().moneyWords(total))}</td></tr></table>
    </div>`;
  }
  Y().invoiceHtml=invoiceHtml;

  function syncInvoiceFromReading(reading){
    const st=S(); const inv=st.invoices.find(i=>i.cycleId===reading.cycleId&&i.subscriberId===reading.subscriberId); if(!inv)return;
    inv.prevReading=reading.prev; inv.currentReading=reading.current; inv.consumption=reading.consumption;
    inv.tariff=n(st.settings.tariff); inv.amount=n(reading.consumption)*inv.tariff;
    inv.prevBalance=Y().balance(reading.subscriberId,inv.id); inv.totalDue=Math.max(0,n(inv.prevBalance)+n(inv.amount)); inv.updatedAt=new Date().toISOString();
  }

  function saveCycleReadings(cycleId){
    const st=S(),c=Y().cycle(cycleId);if(!c)return;
    if(c.status==='closed'){alert('هذه الدورة مغلقة ولا يمكن تعديل قراءاتها. استخدم إجراء تصحيح موثق.');return;}
    const later=st.cycles.find(x=>x.id!==cycleId&&x.cycleDate>c.cycleDate&&Y().readingsForCycle(x.id).length>0);
    if(later){alert(`لا يمكن إدخال أو تعديل قراءات بتاريخ ${c.cycleDate} لأن دورة أحدث من النوع نفسه تحتوي قراءات بتاريخ ${later.cycleDate}.`);return;}
    const errors=[],valid=[];let nextMainCurrent=c.mainCurrent;
    if(c.type==='MONTHLY'){
      const mp=n(c.mainPrev),mcRaw=$('#mainCurrent')?.value,mc=Number(mcRaw);
      if(mcRaw!==''&&!Number.isFinite(mc))errors.push('قراءة العداد الرئيسي الحالية يجب أن تكون رقمًا صالحًا.');
      else if(mcRaw!==''&&mc<mp)errors.push('قراءة العداد الرئيسي الحالية أقل من السابقة، لذلك لم تُحفظ قراءة العداد الرئيسي الحالية.');
      else nextMainCurrent=mcRaw===''?'':mc;
    }
    $$('#readingTable tbody tr').forEach(tr=>{
      const subId=tr.dataset.sub,existing=st.readings.find(x=>x.cycleId===cycleId&&x.subscriberId===subId),last=Y().lastReading(subId,c.cycleDate),prev=n(existing?.prev??last?.current??Y().subscriber(subId)?.openingReading??0),raw=tr.querySelector('.current')?.value;
      if(raw==='')return;
      const current=Number(raw),special=(st.meterChanges||[]).find(m=>m.cycleId===cycleId&&m.subscriberId===subId);
      if(!Number.isFinite(current)){tr.classList.add('reading-error');errors.push(`${(Y().subscriber(subId)||{}).name}: القراءة الحالية يجب أن تكون رقمًا صالحًا.`);return;}
      if(current<prev&&!special){tr.classList.add('reading-error');errors.push(`${(Y().subscriber(subId)||{}).name}: القراءة الحالية ${current} أقل من السابقة ${prev}.`);return;}
      tr.classList.remove('reading-error');
      valid.push({tr,subId,prev,current,consumption:special?n(special.consumption):current-prev,special});
    });
    if(errors.length){alert('لم تُحفظ القراءات لأن بعض القيم غير صالحة:\n- '+errors.slice(0,15).join('\n- ')+'\n\nصحح جميع الصفوف المظللة ثم أعد الحفظ.');return;}
    const mainChanged=c.type==='MONTHLY'&&String(nextMainCurrent)!==String(c.mainCurrent);
    if(valid.length||mainChanged)Y().rememberLocalBackup('before-readings-save');
    if(c.type==='MONTHLY')c.mainCurrent=nextMainCurrent;
    valid.forEach(item=>{
      let r=st.readings.find(x=>x.cycleId===cycleId&&x.subscriberId===item.subId);
      const obj={id:r?.id||Y().uid('READ'),cycleId,subscriberId:item.subId,prev:item.prev,current:item.current,consumption:item.consumption,notes:item.tr.querySelector('.notes')?.value||'',meterChangeId:item.special?.id||'',createdAt:r?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),source:'manual'};
      if(r)Object.assign(r,obj);else{r=obj;st.readings.push(r);}syncInvoiceFromReading(r);
    });
    Y().recomputeInvoiceStatuses();Y().save();
    alert(`تم حفظ ${valid.length} قراءة بنجاح، مع إنشاء نسخة حماية تلقائية.`);
    App.switchTab('readings');
  }

  function recordMeterChange(subId,cycleId){
    const st=S(), sub=Y().subscriber(subId)||{}, c=Y().cycle(cycleId); if(!c||c.status==='closed')return alert('لا يمكن تغيير العداد في دورة مغلقة.');
    const row=document.querySelector(`#readingTable tr[data-sub="${subId}"]`); if(!row)return;
    const prev=n(row.querySelector('.prev').value);
    const oldFinal=n(prompt('أدخل آخر قراءة للعداد القديم:',prev)); if(oldFinal<prev)return alert('آخر قراءة للعداد القديم لا يمكن أن تكون أقل من القراءة السابقة.');
    const newMeter=prompt('أدخل رقم العداد الجديد:',sub.meterNo||''); if(!newMeter)return;
    const newStart=n(prompt('أدخل قراءة بداية العداد الجديد:','0'));
    const newCurrent=n(prompt('أدخل القراءة الحالية للعداد الجديد:',String(newStart)));
    if(newCurrent<newStart)return alert('القراءة الحالية للعداد الجديد أقل من قراءة البداية.');
    const reason=prompt('سبب تغيير العداد:','استبدال عداد')||'استبدال عداد';
    const consumption=(oldFinal-prev)+(newCurrent-newStart);
    const change={id:Y().uid('MCH'),cycleId,subscriberId:subId,oldMeterNo:sub.meterNo||'',oldPrev:prev,oldFinal,newMeterNo:newMeter,newStart,newCurrent,consumption,reason,date:c.cycleDate,createdAt:new Date().toISOString()};
    st.meterChanges=st.meterChanges.filter(m=>!(m.cycleId===cycleId&&m.subscriberId===subId)); st.meterChanges.push(change);
    sub.meterNo=newMeter; sub.updatedAt=new Date().toISOString();
    row.querySelector('.current').value=newCurrent; row.querySelector('.cons').textContent=Y().num(consumption); row.querySelector('.notes').value=`تغيير عداد: ${change.oldMeterNo} ← ${newMeter}. ${reason}`;
    Y().save(); alert('تم تسجيل تغيير العداد. اضغط حفظ القراءات لإتمام العملية.');
  }

  function generateInvoices(cycleId){
    const st=S(),c=Y().cycle(cycleId); if(!c)return;
    if(c.status==='closed')return alert('الدورة مغلقة ولا يمكن إنشاء أو تعديل فواتيرها.');
    const reads=Y().readingsForCycle(cycleId); if(!reads.length)return alert('لا توجد قراءات محفوظة لهذه الدورة.');
    let created=0,updated=0;
    reads.forEach(r=>{
      let inv=st.invoices.find(i=>i.cycleId===cycleId&&i.subscriberId===r.subscriberId);
      if(inv){syncInvoiceFromReading(r);updated++;return;}
      const prevBal=Y().balance(r.subscriberId),amount=n(r.consumption)*n(st.settings.tariff);
      inv={id:Y().uid('INV'),no:`INV-${c.cycleDate.replace(/-/g,'')}-${Y().subscriber(r.subscriberId)?.code||created+1}`,cycleId,subscriberId:r.subscriberId,date:c.cycleDate,prevReading:r.prev,currentReading:r.current,prevBalance:prevBal,consumption:r.consumption,tariff:n(st.settings.tariff),amount,totalDue:Math.max(0,prevBal+amount),status:'due',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
      st.invoices.push(inv);created++;
    });
    Y().recomputeInvoiceStatuses();Y().save();alert(`تم إنشاء ${created} فاتورة وتحديث ${updated} فاتورة.`);App.switchTab('invoices');
  }

  function closeCycle(cycleId){
    const st=S(),c=Y().cycle(cycleId); if(!c)return; if(c.status==='closed')return alert('الدورة مغلقة مسبقًا.');
    const targets=Y().activeSubscribers(c.type), reads=Y().readingsForCycle(cycleId); const ids=new Set(reads.map(r=>r.subscriberId));
    const missing=targets.filter(s=>!ids.has(s.id)); if(missing.length)return alert(`لا يمكن إغلاق الدورة. توجد ${missing.length} قراءة غير مدخلة.`);
    if(!confirm('سيتم إنشاء/تحديث فواتير الدورة ثم قفل القراءات والفواتير وأرشفة الدورة. هل تريد المتابعة؟'))return;
    generateInvoicesSilent(cycleId);
    c.status='closed';c.closedAt=new Date().toISOString();c.closedBy='النظام';
    st.cycleArchives.push({id:Y().uid('ARC'),cycleId,closedAt:c.closedAt,cycle:JSON.parse(JSON.stringify(c)),readings:JSON.parse(JSON.stringify(reads)),invoices:JSON.parse(JSON.stringify(st.invoices.filter(i=>i.cycleId===cycleId)))});
    Y().save(); Y().exportBackupFile('cycle-closed-'+c.cycleDate); alert('تم إغلاق الدورة وأرشفتها وإنشاء نسخة احتياطية.');App.switchTab('readings');
  }
  function generateInvoicesSilent(cycleId){
    const st=S(),c=Y().cycle(cycleId); Y().readingsForCycle(cycleId).forEach(r=>{let inv=st.invoices.find(i=>i.cycleId===cycleId&&i.subscriberId===r.subscriberId);if(inv){syncInvoiceFromReading(r);return;}const prevBal=Y().balance(r.subscriberId),amount=n(r.consumption)*n(st.settings.tariff);st.invoices.push({id:Y().uid('INV'),no:`INV-${c.cycleDate.replace(/-/g,'')}-${Y().subscriber(r.subscriberId)?.code||'X'}`,cycleId,subscriberId:r.subscriberId,date:c.cycleDate,prevReading:r.prev,currentReading:r.current,prevBalance:prevBal,consumption:r.consumption,tariff:n(st.settings.tariff),amount,totalDue:Math.max(0,prevBal+amount),status:'due',createdAt:new Date().toISOString()});});Y().recomputeInvoiceStatuses();Y().save();
  }

  function savePayment(){
    const st=S(),subId=$('#paySub')?.value,amount=n($('#payAmount')?.value); if(!subId||amount<=0)return alert('حدد المشترك والمبلغ.');
    const incomeType=$('#payIncomeType')?.value||'WATER';
    if(incomeType==='CONNECTION_FEE'&&st.payments.some(p=>p.subscriberId===subId&&p.incomeType==='CONNECTION_FEE'&&p.confirmed!==false))return alert('رسوم إدخال الخدمة مسجلة ومدفوعة مسبقًا لهذا المشترك، ولا يجوز تكرارها.');
    const p={id:Y().uid('PAY'),receiptNo:`RCPT-${today().replace(/-/g,'')}-${String(st.payments.length+1).padStart(4,'0')}`,subscriberId:subId,invoiceId:null,date:$('#payDate')?.value||today(),amount,method:$('#payMethod')?.value||'نقداً',collector:$('#payCollector')?.value||'النظام',note:$('#payNote')?.value||'',incomeType,source:'system',confirmed:true,createdAt:new Date().toISOString()};
    st.payments.push(p);Y().recomputeInvoiceStatuses();Y().save();Y().printWindow(p.receiptNo,Y().receiptHtml(p,'paper'),'A5');App.switchTab('payments');
  }

  function reportMonth(){return $('#reportMonth')?.value||Y().monthKey(today());}
  function reportTable(title,headers,rows,summary=''){
    return `${Y().orgHeaderHtml()}<h3>${esc(title)}</h3><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>${summary?`<tfoot>${summary}</tfoot>`:''}</table>`;
  }
  function displayReport(title,headers,rows,filename,summary=''){
    const holder=$('#currentReportHtml'); if(!holder)return;
    holder.innerHTML=reportTable(title,headers,rows,summary); App._currentExcel=[headers].concat(rows);App._currentExcelTitle=title;App._currentExcelFilename=filename;
  }
  function invoiceRegisterReport(){
    Y().recomputeInvoiceStatuses();const m=reportMonth();const rows=Y().invoicesInMonth(m).map(i=>{const s=Y().subscriber(i.subscriberId)||{};return [i.no,i.date,s.name,s.meterNo,Y().num(i.consumption),Y().money(i.amount),Y().money(Math.max(0,n(i.prevBalance))),Y().money(Math.max(0,-n(i.prevBalance))),Y().money(i.paidAmount||0),Y().money(i.remainingAmount||0),Y().invoiceStatusText(i)];});
    displayReport(`كشف الفواتير - ${m}`,['رقم الفاتورة','التاريخ','المشترك','رقم العداد','الاستهلاك','استهلاك الدورة','المتأخرات','الرصيد المقدم','المسدد','المتبقي','الحالة'],rows,'invoice-register.xls');
  }
  function revenueReport(){
    const m=reportMonth();const list=confirmedRevenuePayments(m);const rows=list.map(p=>{const s=Y().subscriber(p.subscriberId)||{};return [p.date,p.receiptNo,s.name,s.meterNo,incomeTypeText(p.incomeType),p.method,p.source==='cashbox_direct'?'الصندوق - تحويل مباشر':(p.collector||p.source),Y().money(p.amount)];});
    const t=revenueTotals(m);rows.push(['','','','','إجمالي مبيعات المياه','','',Y().money(t.water)]);rows.push(['','','','','إجمالي رسوم إدخال الخدمة','','',Y().money(t.connection)]);rows.push(['','','','','إجمالي الإيرادات المحصلة','','',Y().money(t.total)]);
    displayReport(`الإيرادات المحصلة فعليًا - ${m}`,['التاريخ','السند','المشترك','رقم العداد','نوع الإيراد','طريقة الدفع','المصدر','المبلغ'],rows,'cash-revenue.xls');
  }
  function profitReport(){
    const m=reportMonth(),rev=revenueTotals(m),exp=Y().expensesInMonth(m).reduce((a,e)=>a+n(e.amount),0),due=S().subscribers.reduce((a,s)=>a+Math.max(0,Y().balance(s.id)),0),net=rev.total-exp;
    const rows=[['مبيعات المياه المحصلة',Y().money(rev.water)],['رسوم إدخال الخدمة المحصلة',Y().money(rev.connection)],['إجمالي الإيرادات المحصلة',Y().money(rev.total)],['إجمالي المصروفات المدفوعة',Y().money(exp)],['صافي الفائض النقدي',Y().money(net)],['المبالغ غير المحصلة (متأخرات)',Y().money(due)]];
    displayReport(`تقرير الإيرادات والمصروفات وصافي الفائض - ${m}`,['البند','المبلغ'],rows,'profit-surplus.xls');
  }
  function exportCurrentExcel(){const rows=App._currentExcel||App._currentCsv;if(!rows)return alert('اعرض التقرير أولًا.');exportExcel(App._currentExcelFilename||'report.xls',App._currentExcelTitle||'تقرير',rows);}

  function exportSubscribers(){const rows=[['رقم','الاسم','رقم العداد','الهاتف','العنوان','الدورة','الحالة','القراءة الافتتاحية','المتأخرات الافتتاحية','الرصيد المقدم']].concat(S().subscribers.map(s=>[s.code,s.name,s.meterNo,s.phone,s.area,s.readingGroup==='HALF'?'نصف الشهر':'نهاية الشهر',s.status,s.openingReading||0,s.openingArrears||0,s.openingCredit||0]));exportExcel('subscribers.xls','المشتركون',rows);}
  function exportCycleReadings(cycleId){const c=Y().cycle(cycleId);const rows=[['التاريخ','الدورة','الاسم','رقم العداد','العنوان','السابقة','الحالية','الفارق','ملاحظات']].concat(Y().readingsForCycle(cycleId).map(r=>{const s=Y().subscriber(r.subscriberId)||{};return[c.cycleDate,Y().arCycle(c.type),s.name,s.meterNo,s.area,r.prev,r.current,r.consumption,r.notes||''];}));exportExcel(`readings-${c?.cycleDate||today()}.xls`,'كشف القراءات',rows);}
  function exportInvoices(){Y().recomputeInvoiceStatuses();const rows=[['رقم الفاتورة','التاريخ','الاسم','رقم العداد','السابقة','الحالية','الفارق','سعر الوحدة','استهلاك الدورة','المتأخرات','الرصيد المقدم','إجمالي المستحق','المسدد','المتبقي','الحالة']].concat(S().invoices.map(i=>{const s=Y().subscriber(i.subscriberId)||{};return[i.no,i.date,s.name,s.meterNo,i.prevReading||0,i.currentReading||0,i.consumption||0,i.tariff||0,i.amount||0,Math.max(0,n(i.prevBalance)),Math.max(0,-n(i.prevBalance)),Math.max(0,n(i.amount)+n(i.prevBalance)),i.paidAmount||0,i.remainingAmount||0,Y().invoiceStatusText(i)];}));exportExcel('invoice-register.xls','كشف الفواتير',rows);}
  function exportPayments(){const rows=[['رقم السند','التاريخ','الاسم','رقم العداد','نوع الإيراد','المبلغ','الطريقة','المصدر','ملاحظة']].concat(S().payments.map(p=>{const s=Y().subscriber(p.subscriberId)||{};return[p.receiptNo,p.date,s.name,s.meterNo,incomeTypeText(p.incomeType),p.amount,p.method,p.source==='cashbox_direct'?'الصندوق':(p.collector||p.source),p.note||''];}));exportExcel('collections.xls','كشف التحصيلات',rows);}
  function exportExpenses(){const rows=[['التاريخ','النوع','البيان','المبلغ','المستلم','المرجع']].concat(S().expenses.map(e=>[e.date,e.category,e.description,e.amount,e.payee,e.refNo]));exportExcel('expenses.xls','كشف المصروفات',rows);}

  function enhanceReadingUi(){
    const work=$('#cycleWork'),table=$('#readingTable'); if(!work||!table||work.dataset.v11==='1')return; work.dataset.v11='1';
    const c=Y().cycle($('#selectedCycle')?.value); if(!c)return;
    $$('#readingTable .prev').forEach(x=>{x.readOnly=true;x.classList.add('readonly');});
    $$('#readingTable tbody tr').forEach(tr=>{const subId=tr.dataset.sub;const td=document.createElement('td');td.dataset.label='حالة العداد';td.innerHTML=`<button class="mini warn" onclick="App.recordMeterChange('${subId}','${c.id}')">تغيير عداد</button>`;tr.appendChild(td);});
    const th=document.createElement('th');th.textContent='حالة خاصة';table.querySelector('thead tr').appendChild(th);
    const card=work.querySelector('.card'); if(!card)return;
    const closed=c.status==='closed';
    const panel=document.createElement('div');panel.className='reading-flow-panel';panel.innerHTML=`
      <div class="reading-flow-head"><div><b>إدخال متسلسل وسريع</b><small>احفظ وانتقل للمشترك التالي</small></div><span class="badge ${closed?'red':'green'}">${closed?'الدورة مغلقة':'الدورة مفتوحة'}</span></div>
      <div class="form-row"><div class="field"><label>بحث بالاسم أو رقم العداد</label><input id="readingSearch" placeholder="اكتب للبحث..."></div><div class="field"><label>التقدم</label><div id="readingProgress" class="progress-text"></div></div></div>
      <div id="sequentialReadingCard"></div>
      <div class="toolbar"><button type="button" class="light" onclick="App.seqPrev()">السابق</button><button type="button" class="green" onclick="App.seqSaveNext()" ${closed?'disabled':''}>حفظ والتالي</button><button type="button" class="light" onclick="App.seqNext()">التالي</button><button type="button" class="warn" onclick="App.closeCycle('${c.id}')" ${closed?'disabled':''}>إغلاق الدورة</button></div>`;
    card.insertBefore(panel,card.children[1]||null);
    const wrap=table.closest('.table-wrap'); if(wrap){const details=document.createElement('details');details.className='reading-table-details';details.open=true;details.innerHTML=`<summary><span>جدول القراءات السريع</span><small>${table.tBodies[0]?.rows.length||0} مشترك — اضغط للطي أو الفتح</small></summary>`;wrap.parentNode.insertBefore(details,wrap);details.appendChild(wrap);}
    $('#readingSearch')?.addEventListener('input',()=>{seqIndex=0;renderSequential();});
    renderSequential();
  }
  function readingRows(){const q=($('#readingSearch')?.value||'').trim().toLowerCase();return $$('#readingTable tbody tr').filter(tr=>!q||tr.innerText.toLowerCase().includes(q));}
  function renderSequential(){const rows=readingRows();if(!rows.length){$('#sequentialReadingCard').innerHTML='<div class="notice">لا توجد نتائج.</div>';return;}seqIndex=Math.max(0,Math.min(seqIndex,rows.length-1));const tr=rows[seqIndex],sub=Y().subscriber(tr.dataset.sub)||{},prev=tr.querySelector('.prev').value,cur=tr.querySelector('.current').value,cons=tr.querySelector('.cons').textContent;$('#readingProgress').textContent=`${seqIndex+1} من ${rows.length}`;$('#sequentialReadingCard').innerHTML=`<div class="sequential-card"><div class="seq-name">${esc(sub.name)}</div><div class="seq-meta">رقم المشترك: ${esc(sub.code||'-')} · رقم العداد: ${esc(sub.meterNo||'-')} · ${esc(sub.area||'-')}</div><div class="seq-values"><div><small>القراءة السابقة</small><b>${esc(prev)}</b></div><div><label>القراءة الحالية</label><input id="seqCurrent" class="big-input" type="number" min="${esc(prev)}" step="any" value="${esc(cur)}" inputmode="decimal"><small id="seqReadingError" class="reading-validation-message">لا يمكن أن تقل عن ${esc(prev)}</small></div><div><small>الفارق</small><b id="seqConsumption">${esc(cons)}</b></div></div><div class="field"><label>ملاحظة</label><input id="seqNotes" value="${esc(tr.querySelector('.notes').value)}"></div><button class="mini warn" onclick="App.recordMeterChange('${sub.id}','${$('#selectedCycle').value}')">تغيير عداد</button></div>`;$('#seqCurrent')?.addEventListener('input',e=>{const raw=e.target.value,v=Number(raw),p=n(prev),invalid=raw!==''&&(!Number.isFinite(v)||v<p);e.target.classList.toggle('reading-input-invalid',invalid);e.target.setAttribute('aria-invalid',invalid?'true':'false');$('#seqReadingError')?.classList.toggle('visible',invalid);$('#seqConsumption').textContent=raw===''?'0':invalid?'خطأ':Y().num(v-p);});}
  function seqPrev(){seqIndex--;renderSequential();}
  function seqNext(){seqIndex++;renderSequential();}
  function seqSaveNext(){const rows=readingRows();if(!rows.length)return;const tr=rows[seqIndex],prev=n(tr.querySelector('.prev').value),raw=$('#seqCurrent').value,current=Number(raw);if(raw===''||!Number.isFinite(current)||current<prev)return alert('لا يمكن حفظ قراءة فارغة أو أقل من السابقة. استخدم زر تغيير عداد إذا تم استبدال العداد.');tr.querySelector('.current').value=current;tr.querySelector('.current').dispatchEvent(new Event('input',{bubbles:true}));tr.querySelector('.notes').value=$('#seqNotes').value;tr.querySelector('.cons').textContent=Y().num(current-prev);App.saveCycleReadings($('#selectedCycle').value);seqIndex++;setTimeout(renderSequential,150);}

  function enhancePaymentsUi(){const sel=$('#payMethod');if(!sel||$('#payIncomeType'))return;const field=document.createElement('div');field.className='field';field.innerHTML='<label>نوع الإيراد</label><select id="payIncomeType"><option value="WATER">مبيعات المياه</option><option value="CONNECTION_FEE">رسوم إدخال الخدمة - مرة واحدة</option></select>';sel.closest('.field')?.after(field);}
  function enhanceReportsUi(){const root=$('#reports');if(!root||root.querySelector('.v11-report-buttons'))return;const card=root.querySelector('.card');if(!card)return;const bar=document.createElement('div');bar.className='toolbar v11-report-buttons';bar.innerHTML='<button onclick="App.invoiceRegisterReport()">كشف الفواتير</button><button class="green" onclick="App.revenueReport()">الإيرادات المحصلة</button><button class="warn" onclick="App.profitReport()">الأرباح / صافي الفائض</button><button class="secondary" onclick="App.exportCurrentExcel()">تصدير التقرير Excel</button>';card.insertBefore(bar,card.children[1]||null);}
  function enhanceDashboard(){const root=$('#dashboard');if(!root)return;const labels=$$('#dashboard .stat .label');const rev=revenueTotals(Y().monthKey(today()));labels.forEach(l=>{if(l.textContent.includes('إيراد فواتير الشهر')){l.textContent='الإيرادات المحصلة هذا الشهر';l.parentElement.querySelector('.num').textContent=Y().money(rev.total);}});if(!root.querySelector('.v11-sync-card')){const div=document.createElement('div');div.className='card v11-sync-card';div.innerHTML='<h2>المزامنة والواجهات</h2><div class="quick-role-links"><a class="file-btn" href="manager_collectors.html">إدارة المحصل</a><a class="file-btn" href="manager_cashbox.html">إدارة الصندوق</a></div><p class="hint">بعد استيراد تحويلات الصندوق المباشرة، صدّر مستحقات محدثة للمحصل حتى تظهر له الأرصدة الجديدة.</p>';root.appendChild(div);}}

  function enhanceExportLabels(){
    $$('button').forEach(b=>{if(b.textContent.includes('CSV'))b.textContent=b.textContent.replace('CSV','Excel');});
  }

  function enhanceInvoices(){const root=$('#invoices');if(!root)return;root.querySelectorAll('button').forEach(b=>{if(b.textContent.includes('A5')&&!b.textContent.includes('A5 أفقي'))b.textContent=b.textContent.replace('A5','A5 أفقي');});}

  function prepareMessageQueue(channel,ids){const list=ids.map(id=>Y().invoice(id)).filter(Boolean).filter(i=>(Y().subscriber(i.subscriberId)||{}).phone);if(!list.length)return alert('لا توجد فواتير محددة بأرقام هاتف صالحة.');messageQueue=list.map(i=>({id:i.id,channel}));alert(`تم تجهيز ${messageQueue.length} رسالة. سيفتح الإرسال رسالة واحدة في كل مرة. بعد العودة للتطبيق اضغط «إرسال الرسالة التالية».`);sendNextMessage();}
  function sendNextMessage(){if(!messageQueue.length)return alert('انتهت قائمة الرسائل.');const item=messageQueue.shift(),inv=Y().invoice(item.id),sub=Y().subscriber(inv.subscriberId)||{},text=Y().smsText(inv,item.channel==='whatsapp'?'whatsapp':'sms');if(item.channel==='whatsapp')Y().openWhatsApp(sub.phone,text);else Y().openSms(sub.phone,text);}
  function patchMessaging(){
    if(!window.QatraProduction||window.__v11Messaging)return;
    window.__v11Messaging=true;
    if(window.QatraBulkMessages){
      QatraProduction.renderMessages=QatraBulkMessages.render;
    }else{
      QatraProduction.sendSelectedMessages=function(channel){prepareMessageQueue(channel,$$('.msg-check:checked').map(x=>x.value));};
      QatraProduction.sendAllFiltered=function(channel){prepareMessageQueue(channel,$$('.msg-check').map(x=>x.value));};
      const old=QatraProduction.renderMessages;
      QatraProduction.renderMessages=function(){old();const t=$('#messages .toolbar');if(t&&!$('#sendNextMessage')){const b=document.createElement('button');b.id='sendNextMessage';b.className='light';b.textContent='إرسال الرسالة التالية';b.onclick=sendNextMessage;t.appendChild(b);}};
    }
    QatraProduction.exportAccountingValidation=function(){const r=QatraProduction.validateAccounting();exportExcel('accounting-validation.xls','فحص الحسابات',[['النوع','الملاحظة']].concat(r.issues));};
    QatraProduction.exportAuditLog=function(){exportExcel('audit-log.xls','سجل التدقيق',[['التاريخ','العملية','التفاصيل']].concat((S().auditLog||[]).map(x=>[x.at,x.action,JSON.stringify(x.details||{})])));};
    QatraProduction.exportMessageLog=function(){exportExcel('message-log.xls','سجل الرسائل',[['التاريخ','القناة','الطريقة','الفاتورة','الاسم','الهاتف','الحالة','سبب الفشل']].concat((S().messageLog||[]).map(x=>[x.at,x.channel,x.mode,x.invoiceNo,x.subscriberName,x.phone,x.status||'pending',x.failureReason||''])));};
  }

  function patchPublicApi(){
    Object.assign(App,{saveCycleReadings,generateInvoices,recordMeterChange,closeCycle,seqPrev,seqNext,seqSaveNext,invoiceRegisterReport,revenueReport,profitReport,matchingReport:profitReport,exportCurrentExcel,exportSubscribers,exportCycleReadings,exportInvoices,exportPayments,exportExpenses,savePayment});
    App.printInvoice=id=>{const inv=Y().invoice(id);if(inv)Y().printWindow(inv.no,Y().invoiceHtml(inv),'A5L');};
    App.printCycleInvoices=cycleId=>{const invs=S().invoices.filter(i=>i.cycleId===cycleId);if(!invs.length)return alert('لا توجد فواتير لهذه الدورة.');Y().printWindow('فواتير الدورة',invs.map(Y().invoiceHtml).join('<div style="page-break-after:always"></div>'),'A5L');};
    App.downloadCurrentCSV=()=>exportCurrentExcel();
  }

  let enhancementQueued=false;
  function runEnhancements(){
    enhanceReadingUi();
    enhancePaymentsUi();
    enhanceReportsUi();
    enhanceDashboard();
    enhanceInvoices();
    enhanceExportLabels();
  }
  function scheduleEnhancements(){
    if(enhancementQueued)return;
    enhancementQueued=true;
    requestAnimationFrame(()=>{
      enhancementQueued=false;
      runEnhancements();
    });
  }
  function bindEnhancementsToNavigation(){
    // لا نستخدم MutationObserver هنا لأنه كان يعيد تشغيل التحسينات بعد كل تعديل DOM
    // ويُنشئ حلقة لا نهائية تجعل جميع الأزرار تبدو متوقفة.
    $$('.tabs button').forEach(btn=>{
      if(btn.dataset.v12EnhanceBound==='1')return;
      btn.dataset.v12EnhanceBound='1';
      btn.addEventListener('click',()=>setTimeout(scheduleEnhancements,0));
    });

    const oldSwitch=App.switchTab;
    if(typeof oldSwitch==='function'&&!App.__v12SwitchWrapped){
      App.__v12SwitchWrapped=true;
      App.switchTab=function(id){
        const result=oldSwitch.call(this,id);
        setTimeout(scheduleEnhancements,0);
        return result;
      };
    }

    const oldRenderAll=App.renderAll;
    if(typeof oldRenderAll==='function'&&!App.__v12RenderWrapped){
      App.__v12RenderWrapped=true;
      App.renderAll=function(){
        const result=oldRenderAll.apply(this,arguments);
        setTimeout(scheduleEnhancements,0);
        return result;
      };
    }
  }

  document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{
    migrate();
    patchPublicApi();
    patchMessaging();
    bindEnhancementsToNavigation();
    runEnhancements();
  },500));
})();
