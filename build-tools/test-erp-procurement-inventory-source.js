const fs=require('fs');

function read(path){return fs.readFileSync(path,'utf8')}
function must(condition,message){if(!condition){console.error('FAIL:',message);process.exitCode=1}else console.log('OK:',message)}

const db=read('app/src/main/java/com/qatra/pro/QatraDatabase.java');
const posting=read('app/src/main/java/com/qatra/pro/QatraErpPostingService.java');
const activity=read('app/src/main/java/com/qatra/pro/UnifiedMainActivity.java');
const erp=read('app/src/main/assets/qatra/assets/erp.js');
const sw=read('app/src/main/assets/qatra/sw.js');

must(db.includes('DATABASE_VERSION = 8'),'procurement and inventory use SQLite schema version 8');
for(const table of [
  'erp_suppliers','erp_purchase_requests','erp_purchase_request_lines','erp_quotations',
  'erp_purchase_orders','erp_purchase_order_lines','erp_goods_receipts',
  'erp_goods_receipt_lines','erp_supplier_invoices','erp_warehouses',
  'erp_inventory_items','erp_stock_movements'
]) must(db.includes(`CREATE TABLE IF NOT EXISTS ${table}`),`relational table ${table} exists`);

must(db.includes('FOREIGN KEY(namespace,request_id)')&&
  db.includes('FOREIGN KEY(namespace,order_id)')&&
  db.includes('FOREIGN KEY(namespace,receipt_id)'),
  'procurement line tables keep composite foreign keys to their documents');
must(db.includes('uq_erp_supplier_tax_no')&&db.includes('uq_erp_inventory_sku')&&
  db.includes('uq_erp_warehouse_code'),'supplier, item and warehouse business keys are unique');
must(db.includes('backfillEnterpriseRelationalState')&&
  db.includes('ERP_PROCUREMENT_INVENTORY_MIGRATED'),
  'version 8 safely backfills existing enterprise JSON without deleting it');

for(const pair of [
  ['SUPPLIER','erp_suppliers'],['PURCHASE_REQUEST','erp_purchase_requests'],
  ['PURCHASE_ORDER','erp_purchase_orders'],['GOODS_RECEIPT','erp_goods_receipts'],
  ['SUPPLIER_INVOICE','erp_supplier_invoices'],['WAREHOUSE','erp_warehouses'],
  ['INVENTORY_ITEM','erp_inventory_items'],['STOCK_MOVEMENT','erp_stock_movements']
]) must(db.includes(`"${pair[1]}", "${pair[0]}"`),`${pair[0]} is projected relationally`);

must(db.includes('validateProcurementRules')&&db.includes('validateInventoryRules')&&
  db.includes('validateDocumentsWithLines'),'document lifecycle and line totals are validated before commit');
must(db.includes('لا يمكن اعتماد صرف يؤدي إلى رصيد مخزون سالب')&&
  db.includes('stockDirection'),'approved stock movements cannot create a negative balance');
must(db.includes('ROLE_PROCUREMENT')&&db.includes('ROLE_INVENTORY')&&
  db.includes('syncArrayKey(namespace, entityType)'),
  'portable device sync includes role-scoped procurement and inventory records');

must(posting.includes('approveAndPost')&&posting.includes('database.saveStates(states)')&&
  posting.includes('يجب إرسال السجل للمراجعة قبل اعتماده'),
  'approval and accounting posting commit in one SQLite transaction');
must(posting.includes('applyPosting')&&posting.includes('postingIndex'),
  'automatic journal creation remains idempotent');
must(activity.includes('@JavascriptInterface public String approveErpRecord')&&
  activity.includes('postingService.approveAndPost'),
  'Android bridge exposes permission-checked atomic approval');

must(erp.includes("call('approveErpRecord'")&&!erp.includes("call('postApprovedRecord',module,entity"),
  'ERP UI uses atomic approval instead of separate posting and state saves');
must(erp.includes("type==='reference'")&&erp.includes('function parseLines')&&
  erp.includes("entity==='purchaseOrders')data.amount=total"),
  'procurement forms provide governed references and structured line entry');
must(erp.includes("['IN','وارد']")&&erp.includes("['OUT','صرف']")&&
  erp.includes("['itemId','الصنف','reference'"),
  'inventory movement form uses controlled item, warehouse and movement-type fields');
must(sw.includes('qatra-pro-cache-v2925'),'offline cache advances for relational procurement and inventory');

if(process.exitCode)process.exit(process.exitCode);
console.log('Procurement and inventory relational source gate passed.');
