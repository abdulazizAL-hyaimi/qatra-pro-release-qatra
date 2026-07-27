#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const must=(condition,message)=>{if(!condition)throw new Error(message)};

const db=read('app/src/main/java/com/qatra/pro/QatraDatabase.java');
const crypto=read('app/src/main/java/com/qatra/pro/QatraCrypto.java');
const policy=read('app/src/main/java/com/qatra/pro/QatraNamespacePolicy.java');
const activity=read('app/src/main/java/com/qatra/pro/UnifiedMainActivity.java');
const safety=read('app/src/main/assets/qatra/assets/erp_safety_center.js');
const html=read('app/src/main/assets/qatra/erp.html');
const sw=read('app/src/main/assets/qatra/sw.js');
const workflow=read('.github/workflows/build-unified-erp.yml');
const applyWorkflow=read('.github/workflows/apply-unified-erp-shell.yml');

must(db.includes('DATABASE_VERSION = 8'),'SQLite recovery, controlled sync and receipt migrations must use schema version 8');
must(db.includes('CREATE TABLE IF NOT EXISTS erp_recovery_snapshots'),'recovery snapshot table is missing');
must(db.includes('captureRecoverySnapshotInTransaction(db, role, "BEFORE_PORTABLE_RESTORE")'),'restore does not capture a rollback snapshot first');
must(db.includes('"role=? AND status=\'AVAILABLE\'"'),'older rollback snapshots are not superseded');
must(db.includes('rollbackLastPortableRestore'),'native rollback transaction is missing');
must(db.includes('"RECOVERY_ROLLBACK"')&&db.includes('"PORTABLE_RESTORE_ROLLED_BACK"'),'rollback persistence or audit is missing');
must(db.includes('recordPortableBackupExport')&&db.includes('"PORTABLE_BACKUP_EXPORTED"'),'successful backup export is not audited');
must(db.includes('"trialChecks"'),'trial checks are not indexed in SQLite');

must(crypto.includes('"ADMIN", "READER", "COLLECTOR", "CASHIER", "UNIFIED"'),'encrypted backup does not recognize the unified role');
must(crypto.includes('("ADMIN".equals(role) || "UNIFIED".equals(role))'),'unified full-backup route is missing');
must(crypto.includes('DEVICE_CHANGESET')&&crypto.includes('مزامنة ERP متعددة الأجهزة غير معتمدة في هذه المرحلة'),'only the governed unified device route may be opened');
must(policy.includes('portable.put(UNIFIED')&&policy.includes('ERP_MIGRATION'),'unified portable scope is incomplete');

must(activity.includes('requirePermission(QatraUnifiedUserStore.P_MANAGE_SETTINGS)'),'recovery mutation permission is missing');
must(activity.includes('Intent.ACTION_CREATE_DOCUMENT')&&activity.includes('Intent.ACTION_OPEN_DOCUMENT'),'Android document picker backup flow is missing');
must(activity.includes('MAX_BACKUP_BYTES = 30_000_000'),'restore input size limit is missing');
must(activity.includes('crypto.encryptPortableBackup(')&&activity.includes('crypto.decryptPortableBackup(bytes, "UNIFIED")'),'authenticated backup encryption flow is missing');
must(activity.includes('database.restorePortableBackup("UNIFIED"')&&activity.includes('database.rollbackLastPortableRestore("UNIFIED"'),'restore and rollback bridges are incomplete');
must(activity.includes('الحسابات وكلمات المرور لا تتغير'),'identity-store boundary is not disclosed before restore');

must(safety.includes("register('safety','التعافي والقبول'"),'recovery and acceptance screen is not registered');
must(safety.includes('CORE.trialChecks'),'parallel trial ledger is missing');
must(safety.includes('checks.length>=30&&variances===0'),'30-day zero-variance readiness rule is missing');
must(safety.includes('systemTotals(date)')&&safety.includes('manualInvoiceTotal'),'system/manual reconciliation is incomplete');
must(safety.includes("call('startEncryptedBackup'")||safety.includes("nativeAction('startEncryptedBackup')"),'backup action is not connected');
must(safety.includes("call('rollbackLastRestore'")||safety.includes("call('rollbackLastRestore')"),'rollback action is not connected');
must(html.includes('erp_safety_center.js'),'safety center is not loaded by ERP');
must(sw.includes('qatra-pro-cache-v2925')&&sw.includes('erp_safety_center.js'),'offline cache is not updated for the safety center');
must(workflow.includes('test-erp-recovery-trial-source.js'),'unified build is missing the recovery gate');
must(applyWorkflow.includes('test-erp-recovery-trial-source.js'),'generated-source workflow is missing the recovery gate');

console.log('ERP recovery and 30-day trial source checks passed.');
