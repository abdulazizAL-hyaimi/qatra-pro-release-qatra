/* إصلاح التقرير الشهري الشامل وربط الإيرادات بالمبالغ المحصلة فعلياً. */
(function(){
  'use strict';

  const $ = selector => document.querySelector(selector);
  let observerInstalled = false;
  const N = value => {
    const n = Number(String(value ?? 0).replace(/[,،\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const monthKey = value => String(value || '').slice(0, 7);
  const esc = value => window.YWP?.esc ? YWP.esc(String(value ?? '')) : String(value ?? '');
  const state = () => window.YWP?.state || {};
  const money = value => window.YWP?.money ? YWP.money(N(value)) : N(value).toLocaleString('en-US');
  const num = value => window.YWP?.num ? YWP.num(N(value)) : N(value).toLocaleString('en-US');

  function normalizedCycleType(cycle){
    const raw = `${cycle?.type || ''} ${cycle?.periodLabel || ''}`.toUpperCase();
    return raw.includes('HALF') || raw.includes('نصف') ? 'HALF' : 'MONTHLY';
  }

  function cycleReadings(cycle){
    const id = String(cycle?.id || '');
    return (state().readings || []).filter(reading => String(reading?.cycleId || '') === id);
  }

  function cycleInvoices(cycle){
    const id = String(cycle?.id || '');
    return (state().invoices || []).filter(invoice => String(invoice?.cycleId || '') === id && !isCancelled(invoice));
  }

  function isCancelled(item){
    const status = String(item?.status || '').toLowerCase();
    return item?.voided === true || item?.cancelled === true || status === 'cancelled' || status === 'void';
  }

  function confirmedPaymentsInMonth(month){
    return (state().payments || []).filter(payment => {
      if(monthKey(payment?.date) !== month || payment?.confirmed === false || isCancelled(payment)) return false;
      if(payment?.method === 'مدفوعات سابقة' || String(payment?.id || '').startsWith('PAY-EXCEL-')) return false;
      return true;
    });
  }

  function activeInvoicesInMonth(month){
    return (state().invoices || []).filter(invoice => monthKey(invoice?.date) === month && !isCancelled(invoice));
  }

  function activeExpensesInMonth(month){
    return (state().expenses || []).filter(expense => monthKey(expense?.date) === month && !isCancelled(expense));
  }

  function cycleConsumption(cycle){
    const readings = cycleReadings(cycle);
    if(readings.length) return readings.reduce((sum, row) => sum + N(row?.consumption), 0);
    return cycleInvoices(cycle).reduce((sum, invoice) => sum + N(invoice?.consumption), 0);
  }

  function cycleForInvoice(invoice, cycles){
    const direct = cycles.find(cycle => String(cycle?.id || '') === String(invoice?.cycleId || ''));
    if(direct) return direct;
    const sameDate = cycles.find(cycle => String(cycle?.cycleDate || '') === String(invoice?.date || ''));
    if(sameDate) return sameDate;
    return cycles
      .filter(cycle => String(cycle?.cycleDate || '') <= String(invoice?.date || ''))
      .sort((a,b) => String(b?.cycleDate || '').localeCompare(String(a?.cycleDate || '')))[0] || null;
  }

  function operationalMonths(){
    const months = new Set();
    (state().cycles || []).forEach(cycle => {
      const month = monthKey(cycle?.cycleDate);
      const hasReading = cycleReadings(cycle).length > 0;
      const hasInvoice = cycleInvoices(cycle).length > 0;
      const hasMainReading = cycle?.mainCurrent !== '' && cycle?.mainCurrent !== null && cycle?.mainCurrent !== undefined;
      if(month && (hasReading || hasInvoice || hasMainReading)) months.add(month);
    });
    (state().invoices || []).forEach(row => { const month = monthKey(row?.date); if(month && !isCancelled(row)) months.add(month); });
    (state().payments || []).forEach(row => { const month = monthKey(row?.date); if(month && row?.confirmed !== false && !isCancelled(row)) months.add(month); });
    (state().expenses || []).forEach(row => { const month = monthKey(row?.date); if(month && !isCancelled(row)) months.add(month); });
    return Array.from(months).sort().reverse();
  }

  function monthHasOperationalData(month){
    if(!month) return false;
    const cycles = (state().cycles || []).filter(cycle => monthKey(cycle?.cycleDate) === month);
    return cycles.some(cycle => cycleReadings(cycle).length || cycleInvoices(cycle).length || (cycle?.mainCurrent !== '' && cycle?.mainCurrent !== null && cycle?.mainCurrent !== undefined))
      || activeInvoicesInMonth(month).length > 0
      || confirmedPaymentsInMonth(month).length > 0
      || activeExpensesInMonth(month).length > 0;
  }

  function prepareReportMonth(){
    const select = $('#reportMonth');
    if(!select) return '';

    if(!select.dataset.qatraMonthFix){
      select.dataset.qatraMonthFix = '1';
      select.addEventListener('change', () => { select.dataset.userSelected = '1'; });
    }

    const preferred = operationalMonths()[0] || '';
    if(preferred && !Array.from(select.options).some(option => option.value === preferred)){
      const option = document.createElement('option');
      option.value = preferred;
      option.textContent = preferred;
      select.prepend(option);
    }

    if(preferred && !select.dataset.userSelected && !monthHasOperationalData(select.value)){
      select.value = preferred;
    }
    return select.value || preferred || monthKey(new Date().toISOString());
  }

  function accountBalanceAt(subscriberId, endDate){
    const subscriber = window.YWP?.subscriber ? YWP.subscriber(subscriberId) || {} : {};
    let balance = window.YWP?.openingNet ? YWP.openingNet(subscriber) : N(subscriber?.openingArrears) - N(subscriber?.openingCredit);
    (state().invoices || [])
      .filter(invoice => invoice?.subscriberId === subscriberId && !isCancelled(invoice) && String(invoice?.date || '') <= endDate)
      .forEach(invoice => { balance += N(invoice?.amount); });
    (state().payments || [])
      .filter(payment => payment?.subscriberId === subscriberId && payment?.confirmed !== false && !isCancelled(payment) && (payment?.incomeType || 'WATER') === 'WATER' && String(payment?.date || '') <= endDate)
      .forEach(payment => { balance -= N(payment?.amount); });
    return balance;
  }

  function incomeTypeText(value){
    return ({WATER:'مبيعات مياه', CONNECTION_FEE:'رسوم إدخال الخدمة', OTHER:'إيراد آخر'}[String(value || 'WATER').toUpperCase()] || String(value || 'مبيعات مياه'));
  }

  function paymentSourceText(payment){
    if(payment?.source === 'cashbox_direct') return 'الصندوق — تحويل مباشر';
    if(payment?.source === 'collector' || payment?.source === 'collector-app') return 'تطبيق المحصل';
    return payment?.source === 'system' ? 'الإدارة' : (payment?.source || 'الإدارة');
  }

  function reportShell(title, documentHtml){
    return `<div class="card report-shell"><div class="report-screen-head no-print"><div class="report-screen-title"><span class="report-screen-icon">▤</span><div><small>مركز التقارير</small><h2>${esc(title)}</h2><p>معاينة جاهزة للطباعة والتصدير</p></div></div><div class="toolbar report-actions"><button class="light report-back-button" data-report-back="1" onclick="App.closeCurrentReport()"><span>➜</span> رجوع للتقارير</button><button onclick="App.printCurrentReport('${esc(title)}')">طباعة / PDF</button><button class="secondary" onclick="App.exportCurrentExcel ? App.exportCurrentExcel() : App.downloadCurrentCSV('${esc(App._currentExcelFilename || 'report.xlsx')}')">تصدير Excel</button></div></div><div id="currentReportHtml" class="report-document">${documentHtml}<div class="report-end"><span>نهاية التقرير</span><small>نسخة نظامية مولّدة آليًا</small></div></div></div>`;
  }

  function renderReport(title, rows, filename, notices, metrics){
    const output = $('#reportOutput');
    if(!output) return;
    const header = window.YWP?.orgHeaderHtml ? YWP.orgHeaderHtml(false, 'report') : '';
    const noticeHtml = (notices || []).map(item => `<div class="notice ${item.type || ''}">${esc(item.text)}</div>`).join('');
    const metricHtml = (metrics || []).length ? `<div class="v13-summary-cards">${metrics.map(item => `<div><small>${esc(item[0])}</small><b>${item[2] === 'volume' ? `${num(item[1])} م³` : item[2] === 'count' ? num(item[1]) : money(item[1])}</b></div>`).join('')}</div>` : '';
    const tableRows = rows.map(row => `<tr><td>${esc(row[0])}</td><td>${row[2] === 'text' ? esc(row[1]) : row[2] === 'count' ? num(row[1]) : row[2] === 'volume' ? `${num(row[1])} م³` : money(row[1])}</td></tr>`).join('');
    const exportRows = [['البيان','القيمة']].concat(rows.map(row => [row[0], row[1]]));

    App._currentExcel = exportRows;
    App._currentCsv = exportRows;
    App._currentExcelTitle = title;
    App._currentExcelFilename = filename;

    const documentHtml = `${header}<h3>${esc(title)}</h3><div class="report-generated"><span>تاريخ الإصدار</span><b>${esc(new Date().toLocaleString('ar-YE'))}</b></div>${noticeHtml}${metricHtml}<div class="table-wrap report-table-viewport"><table class="report-table"><thead><tr><th>البيان</th><th>القيمة</th></tr></thead><tbody>${tableRows}</tbody></table></div>`;
    output.innerHTML = reportShell(title, documentHtml);
    output.closest?.('.report-center-card')?.classList.add('report-preview-open');
  }

  function monthlySummaryReport(){
    const month = prepareReportMonth();
    const cycles = (state().cycles || []).filter(cycle => monthKey(cycle?.cycleDate) === month);
    const halfCycles = cycles.filter(cycle => normalizedCycleType(cycle) === 'HALF');
    const monthlyCycles = cycles.filter(cycle => normalizedCycleType(cycle) === 'MONTHLY');

    const halfConsumption = halfCycles.reduce((sum, cycle) => sum + cycleConsumption(cycle), 0);
    const monthlyConsumption = monthlyCycles.reduce((sum, cycle) => sum + cycleConsumption(cycle), 0);
    const totalConsumption = halfConsumption + monthlyConsumption;
    const networkInput = monthlyCycles.reduce((sum, cycle) => sum + Math.max(0, N(cycle?.mainCurrent) - N(cycle?.mainPrev)), 0);
    const loss = networkInput - totalConsumption;
    const lossPercent = networkInput > 0 ? (loss / networkInput) * 100 : 0;

    const invoices = activeInvoicesInMonth(month);
    let halfInvoices = 0;
    let monthlyInvoices = 0;
    let unclassifiedInvoices = 0;
    invoices.forEach(invoice => {
      const cycle = cycleForInvoice(invoice, cycles);
      if(!cycle) unclassifiedInvoices += N(invoice?.amount);
      else if(normalizedCycleType(cycle) === 'HALF') halfInvoices += N(invoice?.amount);
      else monthlyInvoices += N(invoice?.amount);
    });

    const billed = invoices.reduce((sum, invoice) => sum + N(invoice?.amount), 0);
    const collections = confirmedPaymentsInMonth(month).reduce((sum, payment) => sum + N(payment?.amount), 0);
    const expenses = activeExpensesInMonth(month).reduce((sum, expense) => sum + N(expense?.amount), 0);
    const operatingSurplus = collections - expenses;

    const endDate = `${month}-31`;
    const receivables = (state().subscribers || []).reduce((sum, subscriber) => sum + Math.max(0, accountBalanceAt(subscriber?.id, endDate)), 0);
    const advances = (state().subscribers || []).reduce((sum, subscriber) => sum + Math.max(0, -accountBalanceAt(subscriber?.id, endDate)), 0);

    const savedReadings = cycles.flatMap(cycle => cycleReadings(cycle));
    const unbilledReadings = savedReadings.filter(reading => !invoices.some(invoice => String(invoice?.cycleId || '') === String(reading?.cycleId || '') && invoice?.subscriberId === reading?.subscriberId));
    const unbilledEstimatedValue = unbilledReadings.reduce((sum, reading) => sum + N(reading?.consumption) * N(state().settings?.tariff), 0);

    const notices = [];
    if(!monthHasOperationalData(month)) notices.push({type:'warning', text:`لا توجد بيانات تشغيلية محفوظة في شهر ${month}. اختر شهر الدورة من القائمة.`});
    if(unbilledReadings.length) notices.push({type:'warning', text:`يوجد ${unbilledReadings.length} قراءة محفوظة لم تُنشأ لها فواتير بعد. الاستهلاك ظاهر في التقرير، أما قيمة الفواتير فلن تعتمد حتى الضغط على «إنشاء/تحديث فواتير الدورة».`});
    if(networkInput === 0 && monthlyConsumption > 0) notices.push({type:'warning', text:'تم العثور على قراءات المشتركين، لكن قراءة العداد الرئيسي لدورة نهاية الشهر غير مكتملة؛ لذلك لا يمكن حساب الفاقد بدقة.'});

    const rows = [
      ['عدد القراءات المحفوظة', savedReadings.length, 'count'],
      ['استهلاك نصف الشهر', halfConsumption, 'volume'],
      ['استهلاك نهاية الشهر', monthlyConsumption, 'volume'],
      ['إجمالي استهلاك المشتركين', totalConsumption, 'volume'],
      ['كمية المياه الداخلة للشبكة', networkInput, 'volume'],
      ['الفاقد أو الزيادة غير المفسرة', loss, 'volume'],
      ['نسبة الفاقد', `${lossPercent.toFixed(2)}%`, 'text'],
      ['إجمالي فواتير نصف الشهر', halfInvoices, 'money'],
      ['إجمالي فواتير نهاية الشهر', monthlyInvoices, 'money']
    ];
    if(unclassifiedInvoices) rows.push(['فواتير غير مرتبطة بدورة', unclassifiedInvoices, 'money']);
    rows.push(
      ['إجمالي الفواتير الصادرة', billed, 'money'],
      ['الإيرادات المحصلة فعلياً', collections, 'money'],
      ['إجمالي المصروفات', expenses, 'money'],
      ['فائض أو عجز التشغيل النقدي', operatingSurplus, 'money'],
      ['الذمم المالية لدى المشتركين', receivables, 'money'],
      ['الأرصدة المقدمة للمشتركين', advances, 'money'],
      ['القراءات المحفوظة غير المفوترة', unbilledReadings.length, 'count']
    );
    if(unbilledReadings.length) rows.push(['القيمة التقديرية للقراءات غير المفوترة', unbilledEstimatedValue, 'money']);

    renderReport(`التقرير الشهري الشامل - ${month}`, rows, `monthly-summary-${month}.xlsx`, notices, [
      ['إجمالي الاستهلاك', totalConsumption, 'volume'],
      ['الإيرادات المحصلة', collections, 'money'],
      ['المصروفات', expenses, 'money'],
      ['صافي النقدية', operatingSurplus, 'money']
    ]);
  }

  function revenueReport(){
    const month = prepareReportMonth();
    const payments = confirmedPaymentsInMonth(month).slice().sort((a,b) => `${a?.date || ''}${a?.receiptNo || ''}`.localeCompare(`${b?.date || ''}${b?.receiptNo || ''}`));
    const total = payments.reduce((sum, payment) => sum + N(payment?.amount), 0);
    const collectors = new Set(payments.map(payment => String(payment?.collector || paymentSourceText(payment))).filter(Boolean));
    const average = payments.length ? total / payments.length : 0;
    const output = $('#reportOutput');
    if(!output) return;
    const header = window.YWP?.orgHeaderHtml ? YWP.orgHeaderHtml(false, 'report') : '';
    const body = payments.map(payment => {
      const subscriber = window.YWP?.subscriber ? YWP.subscriber(payment?.subscriberId) || {} : {};
      return `<tr><td>${esc(payment?.date)}</td><td>${esc(payment?.receiptNo)}</td><td>${esc(subscriber?.name)}</td><td>${esc(subscriber?.meterNo)}</td><td>${esc(incomeTypeText(payment?.incomeType))}</td><td>${money(payment?.amount)}</td><td>${esc(payment?.method)}</td><td>${esc(payment?.collector || '—')}</td><td>${esc(paymentSourceText(payment))}</td></tr>`;
    }).join('') || '<tr><td colspan="9">لا توجد مبالغ محصلة ومؤكدة في هذا الشهر.</td></tr>';
    const rows = [['التاريخ','السند','المشترك','رقم العداد','نوع الإيراد','المبلغ المحصل','طريقة الدفع','المحصل','المصدر']].concat(payments.map(payment => {
      const subscriber = window.YWP?.subscriber ? YWP.subscriber(payment?.subscriberId) || {} : {};
      return [payment?.date || '', payment?.receiptNo || '', subscriber?.name || '', subscriber?.meterNo || '', incomeTypeText(payment?.incomeType), N(payment?.amount), payment?.method || '', payment?.collector || '', paymentSourceText(payment)];
    }));
    App._currentExcel = rows;
    App._currentCsv = rows;
    App._currentExcelTitle = `كشف الإيرادات المحصلة - ${month}`;
    App._currentExcelFilename = `collected-revenue-${month}.xlsx`;
    const title = `كشف الإيرادات المحصلة - ${month}`;
    const documentHtml = `${header}<h3>${esc(title)}</h3><div class="report-generated"><span>تاريخ الإصدار</span><b>${esc(new Date().toLocaleString('ar-YE'))}</b></div><div class="notice success">يعرض هذا الكشف سندات القبض المحصلة والمؤكدة فعلياً فقط، ولا يعد قيمة الفواتير الصادرة إيرادًا محصلًا.</div><div class="v13-summary-cards"><div><small>إجمالي المحصل</small><b>${money(total)}</b></div><div><small>عدد السندات</small><b>${num(payments.length)}</b></div><div><small>عدد المحصلين/المصادر</small><b>${num(collectors.size)}</b></div><div><small>متوسط السند</small><b>${money(average)}</b></div></div><div class="table-wrap report-table-viewport"><table class="report-table"><thead><tr><th>التاريخ</th><th>السند</th><th>المشترك</th><th>رقم العداد</th><th>نوع الإيراد</th><th>المبلغ المحصل</th><th>طريقة الدفع</th><th>المحصل</th><th>المصدر</th></tr></thead><tbody>${body}</tbody><tfoot><tr><th colspan="5">إجمالي الإيرادات المحصلة</th><th>${money(total)}</th><th colspan="3"></th></tr></tfoot></table></div>`;
    output.innerHTML = reportShell(title, documentHtml);
    output.closest?.('.report-center-card')?.classList.add('report-preview-open');
  }

  function install(){
    if(!window.YWP || !window.App){
      setTimeout(install, 250);
      return;
    }
    App.monthlySummaryReport = monthlySummaryReport;
    App.matchingReport = monthlySummaryReport;
    App.profitReport = monthlySummaryReport;
    App.revenueReport = revenueReport;

    const reports = $('#reports');
    if(reports && !observerInstalled){
      const observer = new MutationObserver(() => prepareReportMonth());
      observer.observe(reports, {childList:true, subtree:true});
      observerInstalled = true;
    }
    setTimeout(prepareReportMonth, 50);
  }

  install();
  window.addEventListener('load', () => [50, 600, 1025, 1400].forEach(delay => setTimeout(install, delay)));
})();
