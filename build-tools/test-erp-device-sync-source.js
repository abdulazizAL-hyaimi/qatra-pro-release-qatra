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
const html=read('app/src/main/assets/qatra/erp.html');
const sw=read('app/src/main/assets/qatra/sw.js');
const workflow=read('.github/workflows/build-unified-erp.yml');
const applyWorkflow=read('.github/workflows/apply-unified-erp-shell.yml');

must(db.includes('DATABASE_VERSION = 8'),'controlled device sync and receipt ledger require SQLite schema version 8');
must(db.includes('CREATE TABLE IF NOT EXISTS erp_device_sync_inbox'),'device sync inbox table is missing');
must(db.includes('CREATE TABLE IF NOT EXISTS erp_device_sync_received_packages'),'received package ledger is missing');
must(db.includes('CREATE TABLE IF NOT EXISTS erp_device_sync_export_items'),'export item ledger is missing');
must(db.includes('UNIQUE(source_device_id,source_operation_id)'),'source operations are not idempotent');
must(db.includes('prepareDeviceSyncPayload')&&db.includes('stageDeviceSyncPackage'),'changeset export or staging is missing');
must(db.includes('reviewDeviceSyncPackage')&&db.includes('resolveDeviceSyncConflict'),'administrative review or conflict resolution is missing');
must(db.includes('AWAITING_REVIEW')&&db.includes('CONFLICT_REVIEW'),'package review states are incomplete');
must(db.includes('LOCAL_PENDING_CHANGE')&&db.includes('STALE_REMOTE_VERSION'),'conflict detection is incomplete');
must(db.includes('DEVICE_SYNC_CHANGE_APPLIED')&&db.includes('DEVICE_SYNC_CONFLICT_RESOLVED'),'sync audit trail is incomplete');
must(db.includes('ROLE_READER')&&db.includes('"METER_READING"'),'reader export is not constrained to reading data');
must(db.includes('ROLE_COLLECTOR')&&db.includes('ROLE_CASHIER'),'collector/cashier role scoping is missing');
must(db.includes('meta.put("cloudTransportEnabled", false)')&&db.includes('meta.optBoolean("cloudTransportEnabled", true)'),'cloud transport must remain disabled and fail closed');

must(crypto.includes('"UNIFIED".equals(senderRole)')&&crypto.includes('"DEVICE_CHANGESET".equals(operationType)'),'authenticated unified-device route is missing');
must(crypto.includes('"DEVICE_RECEIPT".equals(operationType)'),'authenticated receipt route is missing');
must(crypto.includes('AES/GCM/NoPadding')&&crypto.includes('payloadHash'),'sync packages are not authenticated and hashed');
must(crypto.includes('return getOrCreateSyncKey()'),'portable backup does not establish the institution sync key');

must(activity.includes('Intent.ACTION_CREATE_DOCUMENT')&&activity.includes('Intent.ACTION_OPEN_DOCUMENT'),'Android document exchange flow is missing');
must(activity.includes('ERP_SYNC_MIME')&&activity.includes('MAX_BACKUP_BYTES = 30_000_000'),'sync MIME or input-size limit is missing');
must(activity.includes('crypto.encryptSync(')&&activity.includes('crypto.decryptSync(bytes, "UNIFIED")'),'native encrypted sync flow is incomplete');
must(activity.includes('database.stageDeviceSyncPackage')&&activity.includes('database.reviewDeviceSyncPackage'),'native staging/review bridges are missing');
must(activity.includes('recordDeviceChangesetExport')&&activity.includes('startDeviceSyncReceiptImport'),'source export tracking or receipt import bridge is missing');
must(activity.includes('P_MANAGE_SETTINGS')&&activity.includes('sameActiveSyncExportActor'),'sync permissions or active-actor validation is missing');
must(activity.includes('لن تتغير البيانات التشغيلية الآن')||activity.includes('لا تتغير البيانات التشغيلية الآن'),'pre-import review boundary is not disclosed');

must(ui.includes("register('sync','مزامنة الأجهزة'"),'device sync center is not registered');
must(ui.includes('مزامنة Google Drive والدمج التلقائي غير مفعّلين'),'cloud/automatic merge safety warning is missing');
must(ui.includes('APPROVE')&&ui.includes('REMOTE')&&ui.includes('LOCAL'),'package and conflict decisions are not wired');
must(html.includes('erp_sync_center.js'),'device sync center is not loaded');
must(sw.includes('qatra-pro-cache-v2925')&&sw.includes('erp_sync_center.js'),'offline cache was not advanced for device sync');
must(workflow.includes('test-erp-device-sync-source.js'),'unified build is missing the device-sync gate');
must(applyWorkflow.includes('test-erp-device-sync-source.js'),'generated-source workflow is missing the device-sync gate');

console.log('ERP controlled device sync source checks passed.');
