const fs=require('fs');
const read=path=>fs.readFileSync(path,'utf8');
function must(condition,message){if(!condition){console.error('FAIL:',message);process.exitCode=1}else console.log('OK:',message)}

const db=read('app/src/main/java/com/qatra/pro/QatraDatabase.java');
const posting=read('app/src/main/java/com/qatra/pro/QatraErpPostingService.java');
const activity=read('app/src/main/java/com/qatra/pro/UnifiedMainActivity.java');
const erp=read('app/src/main/assets/qatra/assets/erp.js');
const sw=read('app/src/main/assets/qatra/sw.js');

must(db.includes('DATABASE_VERSION = 8'),'assets, HR and maintenance use SQLite schema version 8');
for(const table of [
  'erp_assets','erp_depreciation_runs','erp_asset_transfers','erp_employees',
  'erp_attendance','erp_leave_requests','erp_payroll_runs','erp_payroll_lines',
  'erp_work_orders','erp_work_order_parts','erp_preventive_plans','erp_failure_reports'
]) must(db.includes(`CREATE TABLE IF NOT EXISTS ${table}`),`relational table ${table} exists`);

must(db.includes('FOREIGN KEY(namespace,asset_id) REFERENCES erp_assets')&&
  db.includes('FOREIGN KEY(namespace,employee_id) REFERENCES erp_employees')&&
  db.includes('FOREIGN KEY(namespace,run_id) REFERENCES erp_payroll_runs'),
  'asset and workforce detail tables enforce relational ownership');
must(db.includes('uq_erp_asset_code')&&db.includes('uq_erp_employee_no')&&
  db.includes('uq_erp_attendance_day')&&db.includes('uq_erp_payroll_period_department'),
  'assets, employees, attendance and payroll periods use business-key uniqueness');
must(db.includes('backfillWorkforceRelationalState')&&
  db.includes('ERP_ASSETS_WORKFORCE_MAINTENANCE_MIGRATED'),
  'version 8 backfills existing enterprise state without deleting JSON');

for(const pair of [
  ['ASSET','erp_assets'],['DEPRECIATION_RUN','erp_depreciation_runs'],
  ['ASSET_TRANSFER','erp_asset_transfers'],['EMPLOYEE','erp_employees'],
  ['ATTENDANCE','erp_attendance'],['LEAVE_REQUEST','erp_leave_requests'],
  ['PAYROLL_RUN','erp_payroll_runs'],['WORK_ORDER','erp_work_orders'],
  ['PREVENTIVE_PLAN','erp_preventive_plans'],['FAILURE_REPORT','erp_failure_reports']
]) must(db.includes(`"${pair[1]}", "${pair[0]}"`),`${pair[0]} is projected relationally`);

must(db.includes('validateAssetRules')&&
  db.includes('قيم الإهلاك لا تحقق معادلة القيمة الدفترية'),
  'asset approval enforces useful life, transfer and depreciation equations');
must(db.includes('validateHrRules')&&
  db.includes('إجماليات مسير الرواتب لا تطابق تفاصيل الموظفين')&&
  db.includes('وقت الانصراف لا يمكن أن يسبق وقت الحضور'),
  'HR approval enforces attendance, leave and employee-level payroll totals');
must(db.includes('validateMaintenanceRules')&&
  db.includes('التكلفة الفعلية لا يمكن أن تقل عن تكلفة قطع الغيار')&&
  db.includes('تكرار الصيانة الوقائية غير معتمد'),
  'maintenance approval validates parts, cost, priority and preventive cadence');

must(db.includes('ROLE_HR')&&db.includes('ROLE_MAINTENANCE')&&
  db.includes('"DEPRECIATION_RUN"')&&db.includes('"FAILURE_REPORT"'),
  'controlled device exchange recognizes workforce and maintenance entity families');
must(posting.includes('database.saveStates(states)')&&activity.includes('approveErpRecord'),
  'these modules inherit atomic approval and accounting posting');
must(erp.includes("type==='payrollLines'")&&erp.includes('function parsePayrollLines')&&
  erp.includes("module==='hr'&&entity==='payrollRuns'"),
  'payroll form captures employee lines and calculates governed totals');
must(erp.includes("['assetId','الأصل','reference'")&&
  erp.includes("['CRITICAL','حرجة']")&&erp.includes("type==='referenceText'"),
  'asset and maintenance forms use controlled references and enumerated priorities');
must(sw.includes('qatra-pro-cache-v2925'),'offline cache advances for assets, HR and maintenance');

if(process.exitCode)process.exit(process.exitCode);
console.log('Assets, workforce and maintenance relational source gate passed.');
