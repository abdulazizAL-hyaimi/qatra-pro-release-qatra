/* Qatra Pro secure native boundary: SQLite, one-time legacy migration and encrypted sync. */
(function (global) {
  'use strict';

  const memory = new Map();
  const fatal = new Map();
  const saveListeners = new Map();
  const packagedApp = /^file:\/\/\/android_asset\//i.test(String(global.location?.href || ''));
  const bridge = () => global.AndroidBridge || null;
  const clone = value => JSON.parse(JSON.stringify(value));
  const parseResult = raw => {
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch (_) { return {ok:false, error:'استجابة Android غير صالحة'}; }
  };
  const call = (method, ...args) => {
    try {
      const native = bridge();
      if (!native || typeof native[method] !== 'function') return {ok:false, unavailable:true, error:'الواجهة الأصلية غير متاحة'};
      return parseResult(native[method](...args.map(v => String(v ?? ''))));
    } catch (error) {
      return {ok:false, error:error?.message || 'فشل الاتصال بالواجهة الأصلية'};
    }
  };
  const failClosed = (namespace, message) => {
    const text = message || 'تعذر الوصول إلى قاعدة بيانات SQLite';
    fatal.set(namespace, text);
    throw new Error(text);
  };

  function migrateLegacyOnce(namespace, legacyKeys) {
    // This is the sole compatibility read. After a successful SQLite transaction the old key is deleted.
    for (const legacyKey of legacyKeys || []) {
      let raw = null;
      try { raw = global.localStorage?.getItem(legacyKey); } catch (_) {}
      if (!raw) continue;
      try {
        JSON.parse(raw);
        const result = call('migrateLegacyState', namespace, legacyKey, raw);
        if (result.ok) {
          try { global.localStorage?.removeItem(legacyKey); } catch (_) {}
          return JSON.parse(raw);
        }
      } catch (_) {}
    }
    return null;
  }

  const Store = {
    load(namespace, fallbackFactory, legacyKeys=[]) {
      const fallback = typeof fallbackFactory === 'function' ? fallbackFactory() : clone(fallbackFactory || {});
      const result = call('getState', namespace);
      if (result.ok && result.found && result.payload && typeof result.payload === 'object') return result.payload;
      if (result.unavailable) {
        if (packagedApp) return failClosed(namespace, 'الواجهة الأصلية غير متاحة. أُوقف الإدخال لحماية البيانات؛ أغلق التطبيق وافتحه من جديد.');
        return clone(memory.get(namespace) || fallback);
      }
      if (!result.ok) return failClosed(namespace, result.error || 'تعذر قراءة قاعدة بيانات SQLite');
      const migrated = migrateLegacyOnce(namespace, legacyKeys);
      if (migrated) return migrated;
      const saved = call('saveState', namespace, JSON.stringify(fallback));
      if (!saved.ok) {
        if (saved.unavailable && !packagedApp) memory.set(namespace, clone(fallback));
        else return failClosed(namespace, saved.error || 'تعذر تهيئة قاعدة بيانات SQLite');
      }
      return fallback;
    },
    save(namespace, state) {
      if (fatal.has(namespace)) throw new Error(fatal.get(namespace));
      const json = JSON.stringify(state);
      const result = call('saveState', namespace, json);
      if (result.unavailable) {
        if (packagedApp) return failClosed(namespace, 'توقفت الواجهة الأصلية؛ لم تُحفظ العملية. أعد تشغيل التطبيق.');
        memory.set(namespace, clone(state)); return true;
      }
      if (!result.ok) throw new Error(result.error || 'تعذر حفظ البيانات في SQLite');
      return true;
    },
    appInfo() { return call('getAppInfo'); },
    diagnostics() { return call('diagnostics'); }
  };

  const fileToBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذرت قراءة الملف'));
    reader.onload = () => {
      const text = String(reader.result || '');
      resolve(text.includes(',') ? text.slice(text.indexOf(',') + 1) : text);
    };
    reader.readAsDataURL(file);
  });

  const backupInspectRequests = new Map();
  const backupRequestId = () => `BKP_REQ_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,12)}`;
  const onBackupInspectResult = (requestId, raw) => {
    const pending = backupInspectRequests.get(String(requestId || ''));
    if (!pending) return;
    backupInspectRequests.delete(String(requestId));
    clearTimeout(pending.timer);
    const result = parseResult(raw);
    if (result?.ok) pending.resolve(result);
    else pending.reject(new Error(result?.error || 'تعذر فك النسخة الاحتياطية'));
  };
  const inspectPortableBase64 = encoded => new Promise((resolve, reject) => {
    const requestId = backupRequestId();
    const timer = setTimeout(() => {
      backupInspectRequests.delete(requestId);
      reject(new Error('انتهت مهلة فحص النسخة الاحتياطية. أعد اختيار الملف.'));
    }, 180000);
    backupInspectRequests.set(requestId, {resolve, reject, timer});
    const queued = call('inspectPortableBackup', encoded, requestId);
    if (!queued.ok) {
      clearTimeout(timer);
      backupInspectRequests.delete(requestId);
      reject(new Error(queued.error || 'تعذر بدء فحص النسخة الاحتياطية'));
    }
  });

  const legacyCipherMessage = message => {
    const value = String(message || '');
    if (/1e000065|cipher|aead|tag mismatch|مفتاح حماية المزامنة المحلي/i.test(value)) {
      return 'هذه نسخة قديمة مرتبطة بمفتاح الجهاز الذي أُنشئت عليه. استورد ملف الربط الأصلي من شاشة الأمان أولًا، أو استخدم نسخة محمولة جديدة محمية برمز استعادة.';
    }
    return value;
  };

  const Sync = {
    export(filename, targetRole, operationType, payload, onSaved, onCancelled) {
      const result = call('exportEncryptedPackage', filename, targetRole, operationType, JSON.stringify(payload));
      if (!result.ok) throw new Error(result.error || 'تعذر إنشاء ملف المزامنة المشفر');
      if (result.packageId && (typeof onSaved === 'function' || typeof onCancelled === 'function')) {
        saveListeners.set(result.packageId, {onSaved, onCancelled});
      }
      return result;
    },
    queue(filename, targetRole, operationType, payload) {
      const result = call('queueEncryptedPackage', filename, targetRole, operationType, JSON.stringify(payload));
      if (!result.ok) throw new Error(result.error || 'تعذر تجهيز التحديث للرفع');
      return result;
    },
    async inspectFile(file) {
      if (!file) throw new Error('اختر ملف المزامنة');
      const encoded = await fileToBase64(file);
      const detected = call('getEncryptedPackageType', encoded);
      if (detected.ok && detected.portableBackup) return inspectPortableBase64(encoded);
      const result = call('inspectEncryptedPackage', encoded);
      if (!result.ok) throw new Error(legacyCipherMessage(result.error) || 'تعذر فك ملف المزامنة');
      return result;
    },
    commit(namespace, inspected, mergedState) {
      if (!inspected?.packageId) throw new Error('بيانات عملية الاستيراد ناقصة');
      const result = call('commitImportedState', namespace, inspected.packageId, JSON.stringify(mergedState));
      if (!result.ok) throw new Error(result.error || 'تعذر تثبيت عملية المزامنة');
      return result;
    },
    acceptConfirmation(inspected) {
      if (!inspected?.packageId || inspected.operationType !== 'CONFIRMATION') throw new Error('الملف ليس ملف تأكيد');
      const result = call('acceptConfirmation', inspected.packageId);
      if (!result.ok) throw new Error(result.error || 'تعذر اعتماد ملف التأكيد');
      return result;
    },
    async importPairing(file, pin) {
      if (!file) throw new Error('اختر ملف الربط');
      const result = call('importPairingFile', await fileToBase64(file), pin);
      if (!result.ok) throw new Error(result.error || 'تعذر استيراد مفتاح الربط');
      return result;
    },
    createPairing(filename, pin) {
      const result = call('createPairingFile', filename, pin);
      if (!result.ok) throw new Error(result.error || 'تعذر إنشاء ملف الربط');
      return result;
    },
    mergeById(existing, incoming, keys=['id','operationId','receiptNo','no','code']) {
      const output = Array.isArray(existing) ? existing.map(clone) : [];
      const index = new Map();
      const keyOf = item => {
        for (const key of keys) if (item?.[key] !== undefined && String(item[key]).trim()) return `${key}:${item[key]}`;
        return '';
      };
      output.forEach((item, i) => { const key = keyOf(item); if (key) index.set(key, i); });
      let added = 0, updated = 0, skipped = 0;
      for (const item of incoming || []) {
        const key = keyOf(item);
        if (!key) { skipped++; continue; }
        if (index.has(key)) {
          output[index.get(key)] = {...output[index.get(key)], ...clone(item)};
          updated++;
        } else {
          index.set(key, output.length); output.push(clone(item)); added++;
        }
      }
      return {items:output, added, updated, skipped};
    }
  };

  const Backup = {
    export(filename, operationType, primaryOverride=null) {
      const overrideJson = primaryOverride && typeof primaryOverride === 'object'
        ? JSON.stringify(primaryOverride) : '';
      const result = call('exportPortableBackup', filename, operationType, overrideJson);
      if (!result.ok) throw new Error(result.error || 'تعذر بدء إنشاء النسخة الاحتياطية');
      return result;
    },
    inspectFile(file) { return Sync.inspectFile(file); },
    isPortable(inspected) { return inspected?.portableBackup === true; },
    state(inspected, namespace) {
      if (this.isPortable(inspected)) {
        const restored = inspected?.payload?.namespaces?.[namespace];
        if (!restored || typeof restored !== 'object') throw new Error('النسخة لا تحتوي على بيانات هذا التطبيق');
        return clone(restored);
      }
      const payload = inspected?.payload;
      if (namespace === 'admin') return clone(payload || {});
      return clone(payload?.state || {});
    },
    commit(namespace, inspected, mergedState) {
      if (!this.isPortable(inspected)) return Sync.commit(namespace, inspected, mergedState);
      const result = call('commitPortableBackup', namespace, inspected.packageId);
      if (!result.ok) throw new Error(result.error || 'تعذر تثبيت النسخة الاحتياطية');
      return result;
    }
  };

  const DriveBackup = {
    open() {
      const result = call('openDriveBackupCenter');
      if (!result.ok) throw new Error(result.error || 'تعذر فتح مركز Google Drive');
      return result;
    }
  };

  const DriveSync = {
    open() {
      const result = call('openDriveSyncCenter');
      if (!result.ok) throw new Error(result.error || 'تعذر فتح مركز المزامنة');
      return result;
    }
  };

  const Qr = {
    clean(value, fallback='غير متوفر') {
      const normalized = String(value ?? '').replace(/[\u0000-\u001f\u007f|]+/g, ' ').replace(/\s+/g, ' ').trim();
      return normalized ? normalized.slice(0, 96) : fallback;
    },
    amount(value) {
      const number = Number(String(value ?? 0).replace(/,/g, ''));
      if (!Number.isFinite(number)) return '0 ر.ي';
      return `${number.toFixed(2).replace(/\.00$/, '')} ر.ي`;
    },
    dataUrl(text) {
      const value = String(text || '').trim();
      if (!value) return '';
      const result = call('createQrCode', value);
      return result.ok ? String(result.dataUrl || '') : '';
    },
    html(text, label='التحقق من الوثيقة') {
      const src = this.dataUrl(text);
      if (!src) return '';
      const safeLabel = String(label).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      return `<figure class="qatra-qr"><img src="${src}" alt="QR Code"><figcaption>${safeLabel}</figcaption></figure>`;
    },
    invoice(inv, subscriber={}) {
      const paid = Number(inv?.paidAmount || 0);
      const remaining = inv?.remainingAmount === undefined
        ? Math.max(0, Number(inv?.amount || 0) - paid)
        : Math.max(0, Number(inv.remainingAmount || 0));
      const status = remaining <= 0 || inv?.status === 'paid'
        ? 'مسددة' : (paid > 0 || inv?.status === 'partial' ? 'مسددة جزئياً' : 'غير مسددة');
      return [
        'قطرة برو - فاتورة مياه',
        `رقم الفاتورة: ${this.clean(inv?.no)}`,
        `رقم المشترك: ${this.clean(subscriber?.code || subscriber?.subscriberCode || inv?.subscriberCode || inv?.subscriberId)}`,
        `رقم العداد: ${this.clean(subscriber?.meterNo || inv?.meterNo)}`,
        `التاريخ: ${this.clean(inv?.date)}`,
        `قيمة الفاتورة: ${this.amount(inv?.amount)}`,
        `السداد: ${status}`
      ].join('\n');
    },
    receipt(receipt) {
      return [
        'قطرة برو - سند قبض',
        `رقم السند: ${this.clean(receipt?.receiptNo || receipt?.id)}`,
        `رقم المشترك: ${this.clean(receipt?.subscriberCode || receipt?.code || receipt?.subscriberId)}`,
        `رقم العداد: ${this.clean(receipt?.meterNo)}`,
        `التاريخ: ${this.clean(receipt?.date)}`,
        `السداد: ${this.amount(receipt?.amount)}`
      ].join('\n');
    }
  };

  const readPhoto = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذرت قراءة الصورة'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
  const loadPhoto = src => new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('ملف الصورة غير صالح'));
    image.src = src;
  });
  const Media = {
    async preview(input, targetId) {
      try {
        const file = input?.files?.[0]; if (!file) return;
        if (!String(file.type || '').startsWith('image/')) throw new Error('اختر ملف صورة فقط');
        if (file.size > 12 * 1024 * 1024) throw new Error('حجم الصورة أكبر من 12 MB');
        const image = await loadPhoto(await readPhoto(file));
        const scale = Math.min(1, 960 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d', {alpha:false}).drawImage(image, 0, 0, canvas.width, canvas.height);
        let compressed = canvas.toDataURL('image/jpeg', .62);
        if (compressed.length > 500000) compressed = canvas.toDataURL('image/jpeg', .45);
        if (compressed.length > 750000) throw new Error('تعذر ضغط الصورة للحجم التشغيلي؛ اختر صورة أقل دقة');
        input.dataset.photo = compressed;
        const target = document.getElementById(targetId);
        if (target) target.innerHTML = `<img src="${input.dataset.photo}" alt="معاينة الصورة"><small>تم ضغط الصورة وستُحفظ مع العملية</small>`;
      } catch(error) { input.value=''; delete input.dataset.photo; alert(error?.message || 'تعذر إرفاق الصورة'); }
    },
    value(inputOrId) {
      const input = typeof inputOrId === 'string' ? document.getElementById(inputOrId) : inputOrId;
      return String(input?.dataset?.photo || '');
    }
  };

  let incomingHandler = null;
  let incomingBusy = false;
  const incomingFile = () => {
    const result = call('getIncomingFile');
    if (!result.ok) throw new Error(result.error || 'تعذر قراءة الملف المفتوح');
    if (!result.available || !result.base64) return null;
    const binary = global.atob(result.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const filename = result.filename || 'qatra-incoming.qsync';
    const mime = result.mime || 'application/octet-stream';
    const file = new File([bytes], filename, {type:mime, lastModified:Date.now()});
    return {file, filename, mime, size:Number(result.size || bytes.length)};
  };
  const clearIncoming = () => call('clearIncomingFile');
  const fakeFileEvent = file => ({target:{files:[file], value:''}});

  const operationArabic = type => ({
    ASSIGN_READINGS:'تكليف الكاشف', ASSIGN_COLLECTIONS:'تكليف المحصل',
    CASHBOX_SETUP:'إعدادات الصندوق', READING_BATCH:'قراءات الكاشف',
    COLLECTION_BATCH:'تحصيلات المحصل', CASHBOX_BATCH:'حركات الصندوق',
    DIRECT_PAYMENT_BATCH:'التحصيلات المباشرة', ROLE_BACKUP:'نسخة احتياطية',
    FULL_BACKUP:'نسخة النظام الكاملة', CONFIRMATION:'تأكيد استلام'
  }[type] || type || 'عملية مزامنة');
  const roleArabic = role => ({ADMIN:'الإدارة',READER:'الكاشف',COLLECTOR:'المحصل',CASHIER:'الصندوق'}[role] || role || '-');
  const payloadCount = inspected => {
    const wrapper = inspected?.payload || {};
    const p = wrapper.namespaces && typeof wrapper.namespaces === 'object'
      ? (Object.keys(wrapper.namespaces).map(key => wrapper.namespaces[key])
          .find(value => value && typeof value === 'object') || {})
      : wrapper;
    for (const key of ['subscribers','readings','payments','transactions','directPayments','items']) {
      if (Array.isArray(p[key])) return p[key].length;
    }
    return Number(p?.meta?.count || 0);
  };

  function reviewIncoming(opened, inspected, confirmation=false) {
    return new Promise(resolve => {
      document.querySelector('.qatra-import-review')?.remove();
      const count = payloadCount(inspected);
      const modal = document.createElement('div');
      modal.className = 'qatra-import-review';
      modal.innerHTML = `<section class="qatra-import-card" role="dialog" aria-modal="true" aria-labelledby="qatraImportTitle">
        <div class="qatra-import-icon">⇩</div>
        <div><small>${inspected?.portableBackup?'نسخة احتياطية محمولة محمية تلقائيًا':'ملف مشفّر مفتوح في التطبيق'}</small><h2 id="qatraImportTitle">${confirmation?'اعتماد تأكيد الاستلام':'مراجعة الاستيراد'}</h2></div>
        <dl><div><dt>اسم الملف</dt><dd dir="ltr"></dd></div><div><dt>نوع البيانات</dt><dd></dd></div><div><dt>الجهة المرسلة</dt><dd></dd></div>${count?'<div><dt>عدد السجلات</dt><dd></dd></div>':''}<div><dt>حجم الملف</dt><dd></dd></div></dl>
        <p>لم تُحفظ أي بيانات بعد. راجع التفاصيل ثم اضغط الزر الأخضر.</p>
        <div class="qatra-import-actions"><button type="button" data-save>${confirmation?'حفظ التأكيد':'حفظ الاستيراد'}</button><button type="button" data-cancel>إلغاء</button></div>
      </section>`;
      const values = modal.querySelectorAll('dd');
      const texts = [opened.filename, operationArabic(inspected.operationType), roleArabic(inspected.senderRole)];
      if (count) texts.push(String(count));
      texts.push(`${Math.max(1, Math.ceil(opened.size / 1024))} KB`);
      values.forEach((node, index) => { node.textContent = texts[index] || '-'; });
      const finish = accepted => { modal.remove(); resolve(accepted); };
      modal.querySelector('[data-save]').onclick = () => finish(true);
      modal.querySelector('[data-cancel]').onclick = () => finish(false);
      document.body.appendChild(modal);
    });
  }

  async function runIncomingHandler() {
    if (incomingBusy || typeof incomingHandler !== 'function') return;
    let opened = null;
    try {
      opened = incomingFile();
      if (!opened) return;
      incomingBusy = true;
      await incomingHandler(opened);
    } catch (error) {
      alert(error?.message || 'تعذر فتح ملف قطرة برو');
    } finally {
      incomingBusy = false;
    }
  }

  const Incoming = {
    register(handlers={}) {
      incomingHandler = async opened => {
        const inspected = await Sync.inspectFile(opened.file);
        if (inspected.duplicate) {
          alert(inspected.message || 'تم استيراد هذا الملف سابقًا.');
          clearIncoming();
          return;
        }
        if (inspected.operationType === 'CONFIRMATION') {
          if (!await reviewIncoming(opened, inspected, true)) return;
          const accepted = Sync.acceptConfirmation(inspected);
          clearIncoming();
          alert(accepted.message || 'تم اعتماد ملف التأكيد.');
          return;
        }
        const handler = handlers[inspected.operationType] || handlers['*'];
        if (typeof handler !== 'function') {
          clearIncoming();
          throw new Error(`الملف «${opened.filename}» لا يخص هذه الشاشة (${inspected.operationType || 'نوع غير معروف'}).`);
        }
        if (!await reviewIncoming(opened, inspected)) return;
        await handler(fakeFileEvent(opened.file), inspected);
        clearIncoming();
      };
      setTimeout(runIncomingHandler, 80);
    },
    route(routes={}) {
      incomingHandler = async opened => {
        const inspected = await Sync.inspectFile(opened.file);
        if (inspected.duplicate) {
          alert(inspected.message || 'تم استيراد هذا الملف سابقًا.');
          clearIncoming();
          return;
        }
        if (inspected.operationType === 'CONFIRMATION') {
          if (!await reviewIncoming(opened, inspected, true)) return;
          const accepted = Sync.acceptConfirmation(inspected);
          clearIncoming();
          alert(accepted.message || 'تم اعتماد ملف التأكيد.');
          return;
        }
        const target = routes[inspected.operationType];
        if (!target) {
          clearIncoming();
          throw new Error(`لا توجد شاشة إدارية مخصصة للعملية ${inspected.operationType || '-'}.`);
        }
        if (typeof target === 'function') {
          if (!await reviewIncoming(opened, inspected)) return;
          await target(fakeFileEvent(opened.file), inspected);
          clearIncoming();
          return;
        }
        if (!await reviewIncoming(opened, inspected)) return;
        global.location.href = String(target);
      };
      setTimeout(runIncomingHandler, 80);
    },
    clear: clearIncoming
  };

  function onFileSaveResult(raw) {
    const event = parseResult(raw);
    const listener = saveListeners.get(event?.token);
    if (!listener) return;
    saveListeners.delete(event.token);
    try {
      if (event.saved) listener.onSaved?.(event);
      else listener.onCancelled?.(event);
    } catch (error) { console.error('Qatra file-save callback failed', error); }
  }

  function securityDialog() {
    const info = Store.appInfo();
    const isAdmin = info.role === 'ADMIN';
    const license = info.license || {};
    const licenseLabel = license.status === 'LICENSED'
      ? 'مفعّل دائمًا'
      : license.status === 'TRIAL_ACTIVE'
        ? `تجريبي — ${license.remainingDays || 0} يومًا`
        : 'يحتاج إلى تفعيل';
    const modal = document.createElement('div');
    modal.className = 'qatra-secure-modal';
    modal.innerHTML = `<div class="qatra-secure-sheet" dir="rtl">
      <button class="qatra-secure-close" type="button">×</button>
      <h3>أمان ومزامنة قطرة برو</h3>
      <p>الصلاحية: <b>${info.role || '-'}</b> — مفتاح المزامنة: <b>${info.syncKeyProvisioned ? 'مرتبط' : 'غير مرتبط'}</b> — الترخيص: <b>${licenseLabel}</b></p>
      ${isAdmin ? `<label>رمز ربط قوي (8 محارف على الأقل)</label><input type="password" data-pin autocomplete="new-password"><button type="button" data-create>إنشاء ملف ربط مشفر</button><label>استعادة مفتاح ربط قديم بعد إعادة التثبيت</label><input type="file" data-file accept=".qpair,application/octet-stream"><button type="button" data-import class="secondary">استيراد ملف الربط القديم</button>` : `<label>ملف الربط الصادر من الإدارة</label><input type="file" data-file accept=".qpair,application/octet-stream"><label>رمز الربط</label><input type="password" data-pin autocomplete="one-time-code"><button type="button" data-import>استيراد وربط المفتاح</button>`}
      <hr><label>ملف تأكيد استلام</label><input type="file" data-confirm accept=".qconfirm,application/octet-stream"><button type="button" data-accept-confirm class="secondary">اعتماد ملف التأكيد</button>
      <button type="button" data-diag class="secondary">فحص قاعدة البيانات</button>
      <button type="button" data-drive class="secondary">نسخ Google Drive والاستعادة السريعة</button>
      <button type="button" data-license class="secondary">الاشتراك والترخيص</button>
      <button type="button" data-pin-settings class="secondary">إعدادات الدخول والبصمة</button>
      <button type="button" data-lock class="secondary">قفل التطبيق الآن</button>
      <div data-result class="qatra-secure-result"></div>
    </div>`;
    document.body.appendChild(modal);
    const result = modal.querySelector('[data-result]');
    const show = (text, ok=true) => { result.textContent = text; result.dataset.ok = ok ? '1' : '0'; };
    modal.querySelector('.qatra-secure-close').onclick = () => modal.remove();
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    modal.querySelector('[data-diag]').onclick = () => {
      const d = Store.diagnostics(); show(d.ok ? `SQLite: ${d.integrity || '-'} — حالات ${d.states}، سجلات ${d.records}، ملفات مزامنة ${d.syncPackages}، تأكيدات ${d.confirmations}` : d.error, !!d.ok && d.integrity === 'ok');
    };
    modal.querySelector('[data-pin-settings]').onclick = () => call('openAccessSettings');
    modal.querySelector('[data-license]').onclick = () => { modal.remove(); call('openLicenseCenter'); };
    modal.querySelector('[data-drive]').onclick = () => {
      try { modal.remove(); DriveBackup.open(); }
      catch (error) { show(error.message, false); }
    };
    modal.querySelector('[data-lock]').onclick = () => { modal.remove(); call('lockApplication'); };
    modal.querySelector('[data-accept-confirm]').onclick = async () => {
      try { const inspected = await Sync.inspectFile(modal.querySelector('[data-confirm]').files?.[0]); const accepted = Sync.acceptConfirmation(inspected); show(`${accepted.message}: ${accepted.acknowledgedPackageId}`); }
      catch (error) { show(error.message, false); }
    };
    if (isAdmin) modal.querySelector('[data-create]').onclick = () => {
      try { Sync.createPairing(`qatra-pairing-${new Date().toISOString().slice(0,10)}.qpair`, modal.querySelector('[data-pin]').value); show('تم تجهيز ملف الربط. سلّمه مع الرمز عبر قناة منفصلة.'); }
      catch (error) { show(error.message, false); }
    };
    modal.querySelector('[data-import]').onclick = async () => {
      try { const file = modal.querySelector('[data-file]').files?.[0]; await Sync.importPairing(file, modal.querySelector('[data-pin]').value); show('تم ربط مفتاح المزامنة بنجاح.'); }
      catch (error) { show(error.message, false); }
    };
  }

  function installSecurityStyles() {
    if (document.querySelector('style[data-qatra-security]')) return;
    const style = document.createElement('style');
    style.dataset.qatraSecurity = '1';
    style.textContent = `.qatra-secure-modal,.qatra-import-review{position:fixed;inset:0;z-index:9999;background:#0009;display:grid;place-items:end center;padding:12px}.qatra-secure-sheet,.qatra-import-card{position:relative;width:min(520px,100%);background:#fff;border-radius:20px;padding:20px;color:#0f172a;font-family:Tahoma,Arial;box-shadow:0 20px 60px #0006}.qatra-secure-sheet h3,.qatra-import-card h2{margin:3px 0 14px}.qatra-secure-sheet label{display:block;margin:10px 0 5px}.qatra-secure-sheet input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #94a3b8;border-radius:8px}.qatra-secure-sheet button,.qatra-import-actions button{margin-top:12px;border:0;border-radius:10px;background:#0f766e;color:white;padding:12px 16px;font-weight:800}.qatra-secure-sheet button.secondary,.qatra-import-actions [data-cancel]{background:#e2e8f0;color:#334155}.qatra-secure-close{position:absolute;left:12px;top:5px!important;background:transparent!important;color:#334155!important;font-size:25px}.qatra-secure-result{margin-top:12px;padding:9px;border-radius:8px;background:#ecfeff}.qatra-secure-result[data-ok="0"]{background:#fee2e2;color:#991b1b}.qatra-import-icon{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:#ccfbf1;color:#0f766e;font-size:28px;float:right;margin-left:12px}.qatra-import-card small{color:#64748b}.qatra-import-card dl{clear:both;margin:14px 0;border:1px solid #dbe4ea;border-radius:12px;overflow:hidden}.qatra-import-card dl div{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border-bottom:1px solid #e5e7eb}.qatra-import-card dl div:last-child{border-bottom:0}.qatra-import-card dt{color:#64748b}.qatra-import-card dd{margin:0;font-weight:800;overflow-wrap:anywhere}.qatra-import-card p{background:#eff6ff;color:#1e3a8a;padding:10px;border-radius:10px}.qatra-import-actions{display:flex;gap:8px}.qatra-import-actions button{flex:1}.qatra-qr{margin:8px auto;text-align:center;break-inside:avoid}.qatra-qr img{width:30mm!important;height:30mm!important;object-fit:contain}.qatra-qr figcaption{font-size:9px;color:#475569}.qatra-photo-field{margin:10px 0;padding:10px;border:1px dashed #60a5fa;border-radius:12px;background:#eff6ff}.qatra-photo-field label{display:flex;align-items:center;justify-content:center;gap:7px;font-weight:800;color:#075985;cursor:pointer}.qatra-photo-field input{position:absolute;inline-size:1px;block-size:1px;opacity:0}.qatra-photo-preview img{display:block;max-width:100%;max-height:210px;margin:8px auto;border-radius:10px}.qatra-photo-preview small{display:block;text-align:center;color:#64748b}`;
    document.head.appendChild(style);
  }

  function installFatalOverlay() {
    if (!fatal.size || document.querySelector('.qatra-fatal-overlay')) return;
    const messages = Array.from(fatal.values()).join(' — ');
    const overlay = document.createElement('div');
    overlay.className = 'qatra-fatal-overlay';
    overlay.setAttribute('dir', 'rtl');
    overlay.innerHTML = `<div><h2>تم إيقاف الإدخال لحماية البيانات</h2><p>${String(messages).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</p><p>أغلق التطبيق وافتحه مجددًا. إذا تكرر الخطأ فلا تُدخل أي حركة وتواصل مع مسؤول النظام.</p></div>`;
    const style = document.createElement('style');
    style.textContent = '.qatra-fatal-overlay{position:fixed;inset:0;z-index:2147483647;background:#7f1d1d;color:#fff;display:grid;place-items:center;padding:24px;font-family:Tahoma,Arial}.qatra-fatal-overlay>div{max-width:560px;background:#450a0a;border:2px solid #fecaca;border-radius:18px;padding:24px;text-align:center}.qatra-fatal-overlay h2{margin-top:0}';
    document.head.appendChild(style); document.body.appendChild(overlay);
  }

  global.QatraStore = Store;
  global.QatraSync = Sync;
  global.QatraBackup = Backup;
  global.QatraDriveBackup = DriveBackup;
  global.QatraDriveSync = DriveSync;
  global.QatraQr = Qr;
  global.QatraMedia = Media;
  global.QatraNative = {onFileSaveResult, onBackupInspectResult, onIncomingFileAvailable:() => setTimeout(runIncomingHandler, 80)};
  global.QatraIncoming = Incoming;
  global.QatraSecurity = {
    open:securityDialog,
    openLicense:() => call('openLicenseCenter'),
    openAccess:() => call('openAccessSettings'),
    lock:() => call('lockApplication')
  };
  document.addEventListener('DOMContentLoaded', () => { installSecurityStyles(); installFatalOverlay(); });
})(window);
