'use strict';

const fs = require('fs');
const assert = require('assert');

const read = path => fs.readFileSync(path, 'utf8');
const mainActivity = read('app/src/main/java/com/qatra/pro/MainActivity.java');
const mobile = read('app/src/main/assets/qatra/mobile.html');
const app = read('app/src/main/assets/qatra/assets/app.js');
const reports = read('app/src/main/assets/qatra/assets/report_fix.js');
const reportUi = read('app/src/main/assets/qatra/assets/report_ui.js');
const v13 = read('app/src/main/assets/qatra/assets/v13.js');
const bridge = read('app/src/main/assets/qatra/assets/secure_bridge.js');
const design = read('app/src/main/assets/qatra/assets/design-v25.css');

const backMethod = mainActivity.slice(mainActivity.indexOf('@Override public void onBackPressed()'), mainActivity.indexOf('@Override protected void onDestroy()'));
assert.match(backMethod, /evaluateJavascript/,
  'زر Android يجب أن يمنح الواجهة فرصة معالجة الرجوع أولًا');
assert.doesNotMatch(backMethod, /if\(!START_PAGE\.equals\(currentPage\)\)\s*\{\s*webView\.evaluateJavascript/,
  'لا يجوز تجاوز معالج الواجهة في الصفحة الرئيسية');
assert.match(backMethod, /webView\.canGoBack\(\).*webView\.goBack\(\)/s,
  'صفحات الإدارة الفرعية يجب أن تستخدم سجل WebView قبل لوحة التحكم');

assert.match(mobile, /id="appBackButton"[^>]+App\.handleAndroidBack\(\)/,
  'رأس تطبيق الإدارة يجب أن يحتوي زر رجوع وظيفي');
assert.match(app, /function closeCurrentReport\(\)/,
  'يجب توفير رجوع مستقل من معاينة التقرير');
assert.ok(app.indexOf('if(closeCurrentReport()) return true;') < app.indexOf("if(active !== 'dashboard')"),
  'معاينة التقرير يجب أن تغلق قبل مغادرة تبويب التقارير');
assert.match(reportUi, /dataset\.reportBack = '1'/,
  'كل واجهات التقارير يجب أن تحصل على زر رجوع موحد');

assert.match(reports, /كشف الإيرادات المحصلة/);
assert.match(reports, /confirmedPaymentsInMonth\(month\)/,
  'كشف الإيرادات يجب أن يعتمد سندات القبض المؤكدة');
assert.match(reports, /v13-summary-cards/,
  'التقرير الشهري وكشف الإيرادات يجب أن يعرضا بطاقات ملخص');
const v13Revenue = v13.slice(v13.indexOf('function revenueReport()'), v13.indexOf('function expenseReport()'));
assert.match(v13Revenue, /YWP\.paymentsInMonth\(m\)/,
  'نسخة التقرير المبكرة يجب أن تستخدم المقبوضات');
assert.doesNotMatch(v13Revenue, /YWP\.invoicesInMonth\(m\)/,
  'يجب ألا تعرض النسخة المبكرة الفواتير باعتبارها إيرادات محصلة');

assert.match(app, /class="quick-reading-table"/,
  'جدول القراءات السريع يجب أن يستخدم تخطيطًا مخصصًا');
assert.match(app, /data-label="رقم المشترك"/,
  'صفوف القراءات يجب أن تحمل عناوين واضحة لشاشات الهاتف');
assert.match(design, /\.quick-reading-table td::before\{content:attr\(data-label\)/,
  'جدول القراءات يجب أن يتحول إلى بطاقات معنونة على الهاتف');
assert.match(reportUi, /YWP\?\.orgHeaderHtml|YWP\.orgHeaderHtml/,
  'كل تقرير يجب أن يحصل على ترويسة المؤسسة والشعار');
for (const label of ['رقم المشترك:', 'رقم العداد:', 'التاريخ:', 'السداد:']) {
  assert.ok(bridge.includes(label), `QR يجب أن يعرض الحقل العربي: ${label}`);
}
assert.doesNotMatch(bridge, /QATRA\|TYPE=/,
  'QR المطبوع يجب ألا يعرض رموز الحقول الإنجليزية القديمة');
assert.match(mainActivity, /EncodeHintType\.CHARACTER_SET[\s\S]*StandardCharsets\.UTF_8/,
  'QR العربي يجب أن يُرمز صراحة بصيغة UTF-8');
assert.match(mainActivity, /ErrorCorrectionLevel\.M/,
  'QR المطبوع يجب أن يستخدم تصحيح أخطاء مناسبًا للطباعة الحرارية');

console.log('Navigation and report source regression test passed.');
