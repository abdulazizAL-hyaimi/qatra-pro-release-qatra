#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const must=(condition,message)=>{if(!condition)throw new Error(message)};

const db=read('app/src/main/java/com/qatra/pro/QatraDatabase.java');
const crypto=read('app/src/main/java/com/qatra/pro/QatraCrypto.java');
const activity=read('app/src/main/java/com/qatra/pro/UnifiedMainActivity.java');
const ui=read('app/src/main/assets/qatra/assets/erp_sync_center.js');
const sw=read('app/src/main/assets/qatra/sw.js');
const workflow=read('.github/workflows/build-unified-erp.yml');
const applyWorkflow=read('.github/workflows/apply-unified-erp-shell.yml');

must(db.includes('DATABASE_VERSION = 8'),'device receipts require SQLite schema version 8');
for(const table of [
 'erp_device_sync_received_packages',
 'erp_device_sync_received_items',
 'erp_device_sync_exports',
 'erp_device_sync_export_items',
 'erp_device_sync_receipts'
]){
 must(db.includes(`CREATE TABLE IF NOT EXISTS ${table}`),`receipt ledger table ${table} is missing`);
}
must(db.includes('recordDeviceChangesetExport')&&db.includes('prepareDeviceReceiptPayload'),'export binding or receipt preparation is missing');
must(db.includes('recordDeviceReceiptExport')&&db.includes('applyDeviceReceipt'),'receipt export or import transaction is missing');
must(db.includes('originalOperationId')&&db.includes('originalPayloadHash'),'receipt is not bound to the original encrypted package');
must(db.includes('exportItemCount(db, originalPackageId)')&&db.includes('exportedItemDisposition('),'receipt does not cover and verify exact exported items');
must(db.includes("disposition IN('APPLIED','DUPLICATE')")&&db.includes("disposition IN('KEPT_LOCAL','REJECTED')"),'accepted and rejected receipt outcomes are not reported separately');
must(db.includes('acknowledged.put("status", "ACKNOWLEDGED")'),'accepted source operations are not acknowledged');
must(db.includes('priorReceivedDisposition(')&&db.includes('"PENDING".equals(priorDisposition)'),'repeated operations can bypass an unfinished review');
must(db.includes('? "DUPLICATE" : priorDisposition'),'repeated rejected outcomes are not carried forward safely');
must(db.includes('operation_id NOT IN (')&&db.includes('WHERE disposition IS NOT NULL'),'resolved source operations are not excluded from later exports');
const receiptApply=db.slice(db.indexOf('public synchronized JSONObject applyDeviceReceipt'),db.indexOf('private static void insertReceivedItem'));
must(!receiptApply.includes('DELETE FROM')&&!receiptApply.includes('db.delete('),'device receipt application must preserve source operation history');
must(db.includes('receipt_exported_at')&&db.includes('lastReceiptAt'),'receipt export and latest receipt timestamps are missing');
must(db.includes('meta.put("cloudTransportEnabled", false)')&&db.includes('meta.optBoolean("cloudTransportEnabled", true)'),'receipt transport must remain manual and fail closed');

must(crypto.includes('"DEVICE_CHANGESET".equals(operationType)')&&crypto.includes('"DEVICE_RECEIPT".equals(operationType)'),'authenticated unified receipt route is missing');
must(crypto.includes('AES/GCM/NoPadding')&&crypto.includes('cipher.updateAAD(headerBytes)'),'receipt files are not authenticated with the existing sync envelope');

must(activity.includes('database.recordDeviceChangesetExport'),'saved changesets are not bound to their exact source operations');
must(activity.includes('database.recordDeviceReceiptExport'),'saved receipts are not audited');
must(activity.includes('database.applyDeviceReceipt'),'receipt import is not applied transactionally');
must(activity.includes('startDeviceSyncReceiptExport')&&activity.includes('startDeviceSyncReceiptImport'),'receipt JavaScript bridges are missing');
must(activity.includes('"DEVICE_RECEIPT".equals(expectedType)'),'changeset and receipt imports are not type-separated');
must(activity.includes('لن يستبدل الإيصال بيانات تشغيلية'),'receipt confirmation does not disclose the non-operational boundary');
must(activity.includes('Intent.ACTION_CREATE_DOCUMENT')&&activity.includes('Intent.ACTION_OPEN_DOCUMENT'),'receipt exchange must use Android document providers');

must(ui.includes('استيراد إيصال الإدارة')&&ui.includes('تصدير إيصال'),'receipt actions are missing from the sync center');
must(ui.includes('acceptedOutcomes')&&ui.includes('rejectedOutcomes')&&ui.includes('lastReceiptAt'),'receipt outcomes are not visible in the sync center');
must(ui.includes('data-receipt-export')&&ui.includes('startDeviceSyncReceiptExport'),'per-package receipt export is not wired');
must(ui.includes('مزامنة Google Drive والدمج التلقائي غير مفعّلين'),'cloud and automatic merge must remain disabled');
must(sw.includes('qatra-pro-cache-v2925')&&sw.includes('erp_sync_center.js'),'offline cache was not advanced for receipt UI');
must(workflow.includes('test-erp-device-receipts-source.js'),'unified build is missing the receipt gate');
must(applyWorkflow.includes('test-erp-device-receipts-source.js'),'generated-source workflow is missing the receipt gate');

console.log('ERP encrypted device receipt source checks passed.');
