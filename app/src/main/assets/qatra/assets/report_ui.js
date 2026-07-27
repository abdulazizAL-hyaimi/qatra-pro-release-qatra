/* Unified report presentation and print controller for Qatra Pro. */
(function (global) {
  'use strict';

  const $ = selector => document.querySelector(selector);
  let enhancing = false;
  let installed = false;

  function text(value) {
    return String(value || '').trim();
  }

  function reportTitle(current) {
    const shell = current?.closest('.report-shell, .card');
    const directTitle = Array.from(shell?.children || []).find(node => node.tagName === 'H2');
    return text(shell?.querySelector('.report-screen-head h2')?.textContent || directTitle?.textContent)
      || text(current?.querySelector('h3, h2')?.textContent)
      || 'تقرير قطرة برو';
  }

  function columnCount(current) {
    return Array.from(current?.querySelectorAll('table') || []).reduce((max, table) => {
      const count = table.querySelectorAll('thead tr:first-child th').length
        || table.querySelectorAll('tr:first-child th, tr:first-child td').length;
      return Math.max(max, count);
    }, 0);
  }

  function ensureScreenHeader(shell, current, title) {
    let header = Array.from(shell.children).find(node => node.classList?.contains('report-screen-head'));
    if (!header) {
      const oldTitle = Array.from(shell.children).find(node => node.tagName === 'H2');
      const oldToolbar = Array.from(shell.children).find(node => node.classList?.contains('toolbar'));
      header = document.createElement('div');
      header.className = 'report-screen-head no-print';
      header.innerHTML = `<div class="report-screen-title"><span class="report-screen-icon">▤</span><div><small>مركز التقارير</small><h2></h2><p>معاينة جاهزة للطباعة والتصدير</p></div></div><div class="toolbar report-actions"></div>`;
      shell.insertBefore(header, current);
      oldTitle?.remove();
      const actions = header.querySelector('.report-actions');
      if (oldToolbar) {
        Array.from(oldToolbar.children).forEach(node => actions.appendChild(node));
        oldToolbar.remove();
      }
    }
    let intro = Array.from(header.children).find(node => node.tagName === 'DIV' && !node.classList.contains('toolbar'));
    if (intro && !intro.classList.contains('report-screen-title')) {
      const titleGroup = document.createElement('div');
      titleGroup.className = 'report-screen-title';
      titleGroup.innerHTML = '<span class="report-screen-icon">▤</span><div></div>';
      const copy = titleGroup.lastElementChild;
      while (intro.firstChild) copy.appendChild(intro.firstChild);
      if (!copy.querySelector('p')) copy.insertAdjacentHTML('beforeend', '<p>معاينة جاهزة للطباعة والتصدير</p>');
      intro.replaceWith(titleGroup);
      intro = titleGroup;
    }
    const titleNode = header.querySelector('h2');
    if (titleNode) titleNode.textContent = title;
    const actions = header.querySelector('.toolbar');
    actions?.classList.add('report-actions');
    if (actions && !actions.querySelector('[data-report-back]')) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'light report-back-button';
      back.dataset.reportBack = '1';
      back.innerHTML = '<span>➜</span> رجوع للتقارير';
      back.onclick = () => global.App?.closeCurrentReport?.();
      actions.prepend(back);
    }
    if (actions && !actions.querySelector('[data-report-focus]')) {
      const focus = document.createElement('button');
      focus.type = 'button';
      focus.className = 'light report-focus-button';
      focus.dataset.reportFocus = '1';
      focus.innerHTML = '<span>⛶</span> عرض مكبّر';
      focus.onclick = toggleFocus;
      actions.prepend(focus);
    }
    actions?.querySelectorAll('button').forEach(button => {
      const label = text(button.textContent);
      if (/طباعة|PDF/.test(label) && !button.querySelector('.report-action-icon')) {
        button.insertAdjacentHTML('afterbegin', '<span class="report-action-icon">⌁</span>');
      } else if (/Excel|تصدير/.test(label) && !button.querySelector('.report-action-icon')) {
        button.insertAdjacentHTML('afterbegin', '<span class="report-action-icon">⇩</span>');
      }
    });
  }

  function dedupeOrgHeaders(current) {
    // A report must contain one organization header and therefore one selected
    // project logo. Older report producers and the enhancement observer could
    // both prepend the header, leaving two identical logos in the preview.
    const existingHeaders = Array.from(current.querySelectorAll('.org-header'));
    existingHeaders.slice(1).forEach(node => node.remove());
    return existingHeaders.length ? 1 : 0;
  }

  function ensureDocumentMeta(current, title) {
    dedupeOrgHeaders(current);
    if (!current.querySelector('.org-header') && global.YWP?.orgHeaderHtml) {
      current.insertAdjacentHTML('afterbegin', global.YWP.orgHeaderHtml(false, 'report'));
    }
    if (!current.querySelector('.report-print-title')) {
      const heading = document.createElement('div');
      heading.className = 'report-print-title';
      heading.innerHTML = '<small>تقرير رسمي</small><h1></h1>';
      heading.querySelector('h1').textContent = title;
      const org = current.querySelector('.org-header');
      if (org) org.insertAdjacentElement('afterend', heading);
      else current.prepend(heading);
    }
    let meta = current.querySelector('.report-generated');
    if (!meta) {
      meta = document.createElement('div');
      meta.className = 'report-generated';
      meta.innerHTML = `<span>تاريخ الإصدار</span><b>${new Date().toLocaleString('ar-YE')}</b>`;
      current.querySelector('.report-print-title')?.insertAdjacentElement('afterend', meta);
    } else if (!meta.querySelector('b')) {
      const value = text(meta.textContent).replace(/^تاريخ الإصدار\s*[:：]?\s*/, '') || new Date().toLocaleString('ar-YE');
      meta.innerHTML = '<span>تاريخ الإصدار</span><b></b>';
      meta.querySelector('b').textContent = value;
    }
    let end = current.querySelector('.report-end');
    if (!end) {
      end = document.createElement('div');
      end.className = 'report-end';
      end.innerHTML = '<span>نهاية التقرير</span><small>نسخة نظامية مولّدة آليًا</small>';
      current.appendChild(end);
    } else if (!end.querySelector('small')) {
      end.innerHTML = '<span>نهاية التقرير</span><small>نسخة نظامية مولّدة آليًا</small>';
    }
  }

  function enhanceTables(current) {
    current.querySelectorAll('.table-wrap').forEach(wrap => wrap.classList.add('report-table-viewport'));
    current.querySelectorAll('table').forEach(table => {
      table.classList.add('report-table');
      const bodyRows = table.querySelectorAll('tbody tr');
      if (!bodyRows.length) table.classList.add('report-table-empty');
      table.querySelectorAll('td.money').forEach(cell => cell.setAttribute('dir', 'ltr'));
    });
  }

  function enhanceCurrent() {
    if (enhancing) return;
    const current = $('#currentReportHtml');
    if (!current || current.dataset.reportUi === 'ready') return;
    enhancing = true;
    try {
      const shell = current.closest('.card') || current.parentElement;
      if (!shell) return;
      const title = reportTitle(current);
      const columns = columnCount(current);
      shell.classList.add('report-shell');
      current.closest('.report-center-card')?.classList.add('report-preview-open');
      current.classList.add('report-document');
      current.classList.toggle('report-wide', columns > 7);
      current.dataset.reportColumns = String(columns);
      current.dataset.reportUi = 'ready';
      if (global.App) {
        App._currentReportPage = columns > 7 ? 'A4L' : 'A4';
        App._currentReportTitle = title;
      }
      ensureScreenHeader(shell, current, title);
      ensureDocumentMeta(current, title);
      enhanceTables(current);
      shell.scrollIntoView({behavior:'smooth', block:'start'});
    } finally {
      enhancing = false;
    }
  }

  function toggleFocus() {
    const shell = $('#currentReportHtml')?.closest('.report-shell');
    if (!shell) return;
    const active = shell.classList.toggle('report-focus-mode');
    document.body.classList.toggle('report-focus-open', active);
    const button = shell.querySelector('[data-report-focus]');
    if (button) button.innerHTML = active ? '<span>×</span> إغلاق العرض' : '<span>⛶</span> عرض مكبّر';
  }

  function printCurrent(title) {
    const current = $('#currentReportHtml');
    if (!current || !global.YWP?.printWindow) return;
    enhanceCurrent();
    const page = global.App?._currentReportPage || (columnCount(current) > 7 ? 'A4L' : 'A4');
    const cleanTitle = text(title) || global.App?._currentReportTitle || reportTitle(current);
    YWP.printWindow(cleanTitle, current.outerHTML, page);
  }

  function install() {
    if (!global.App || !global.YWP) return setTimeout(install, 250);
    App.printCurrentReport = printCurrent;
    global.QatraReportUI = {enhance:enhanceCurrent, printCurrent, toggleFocus, columnCount, __test:{dedupeOrgHeaders}};
    if (!installed) {
      const observer = new MutationObserver(() => setTimeout(enhanceCurrent, 0));
      observer.observe(document.body, {childList:true, subtree:true});
      installed = true;
    }
    enhanceCurrent();
  }

  install();
  global.addEventListener('load', () => setTimeout(install, 50));
})(window);
