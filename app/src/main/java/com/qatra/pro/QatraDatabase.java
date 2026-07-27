package com.qatra.pro;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Native persistence boundary for every WebView role.
 *
 * The UI keeps its existing JSON domain model, while this class stores the canonical state in
 * SQLite and maintains a searchable record index. Synchronization metadata is committed in the
 * same transaction as imported state so a power loss cannot apply the same package twice.
 */
public final class QatraDatabase extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "qatra-pro-secure.db";
    private static final int DATABASE_VERSION = 8;
    private static final Set<String> INDEXED_ARRAYS = new HashSet<>(Arrays.asList(
            "subscribers", "cycles", "readings", "invoices", "payments", "expenses",
            "transactions", "directPayments", "cashboxTransactions", "cashboxDirectPayments",
            "receipts", "exports", "audit", "confirmations", "correctionRequests", "trialChecks", "users",
            "suppliers", "purchaseRequests", "purchaseOrders", "goodsReceipts",
            "supplierInvoices", "inventoryItems", "warehouses", "stockMovements",
            "assets", "employees", "attendance", "leaves", "payrollRuns",
            "workOrders", "budgets", "approvals", "documents"
    ));

    public QatraDatabase(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
        setWriteAheadLoggingEnabled(true);
    }

    @Override
    public void onConfigure(SQLiteDatabase db) {
        super.onConfigure(db);
        db.setForeignKeyConstraintsEnabled(true);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE app_state (" +
                "namespace TEXT PRIMARY KEY NOT NULL," +
                "payload_json TEXT NOT NULL," +
                "updated_at INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE records (" +
                "namespace TEXT NOT NULL," +
                "entity_type TEXT NOT NULL," +
                "entity_id TEXT NOT NULL," +
                "payload_json TEXT NOT NULL," +
                "updated_at INTEGER NOT NULL," +
                "sync_status TEXT NOT NULL DEFAULT 'LOCAL'," +
                "PRIMARY KEY(namespace, entity_type, entity_id))");
        db.execSQL("CREATE INDEX idx_records_type ON records(namespace, entity_type, updated_at)");
        db.execSQL("CREATE TABLE sync_packages (" +
                "package_id TEXT PRIMARY KEY NOT NULL," +
                "operation_id TEXT NOT NULL UNIQUE," +
                "direction TEXT NOT NULL," +
                "sender_role TEXT NOT NULL," +
                "target_role TEXT NOT NULL," +
                "operation_type TEXT NOT NULL," +
                "payload_hash TEXT NOT NULL," +
                "status TEXT NOT NULL," +
                "created_at INTEGER NOT NULL," +
                "processed_at INTEGER)");
        db.execSQL("CREATE INDEX idx_sync_status ON sync_packages(direction, status, created_at)");
        db.execSQL("CREATE TABLE confirmations (" +
                "confirmation_id TEXT PRIMARY KEY NOT NULL," +
                "package_id TEXT NOT NULL UNIQUE," +
                "operation_id TEXT NOT NULL," +
                "payload_hash TEXT NOT NULL," +
                "created_at INTEGER NOT NULL," +
                "FOREIGN KEY(package_id) REFERENCES sync_packages(package_id) ON DELETE CASCADE)");
        db.execSQL("CREATE TABLE migration_log (" +
                "namespace TEXT PRIMARY KEY NOT NULL," +
                "legacy_key TEXT NOT NULL," +
                "payload_hash TEXT NOT NULL," +
                "migrated_at INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE audit_log (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "event_type TEXT NOT NULL," +
                "details TEXT NOT NULL," +
                "created_at INTEGER NOT NULL)");
        createRelationalSchema(db);
        createEnterpriseRelationalSchema(db);
        createWorkforceRelationalSchema(db);
        createBusinessRuleSchema(db);
        createRecoverySchema(db);
        createDeviceSyncSchema(db);
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) {
            try {
                createRelationalSchema(db);
                backfillRelationalState(db);
                audit(db, "RELATIONAL_SCHEMA_MIGRATED", "v" + oldVersion + "->v2");
            } catch (Exception e) {
                throw new IllegalStateException("تعذر ترحيل قاعدة البيانات العلائقية", e);
            }
        }
        if (oldVersion < 3) {
            try {
                ensureColumn(db, "qatra_meter_readings", "meter_changed",
                        "INTEGER NOT NULL DEFAULT 0");
                db.execSQL("UPDATE qatra_meter_readings SET meter_changed=1 " +
                        "WHERE payload_json LIKE '%\"meterChangeId\"%'");
                createBusinessRuleSchema(db);
                audit(db, "BUSINESS_RULES_MIGRATED", "v" + oldVersion + "->v3");
            } catch (Exception e) {
                throw new IllegalStateException(
                        "تعذر تطبيق قيود التفرد والقراءات على قاعدة البيانات", e);
            }
        }
        if (oldVersion < 4) {
            try {
                createRecoverySchema(db);
                audit(db, "RECOVERY_SCHEMA_MIGRATED", "v" + oldVersion + "->v4");
            } catch (Exception e) {
                throw new IllegalStateException("تعذر إنشاء سجل التعافي", e);
            }
        }
        if (oldVersion < 5) {
            try {
                createDeviceSyncSchema(db);
                audit(db, "DEVICE_SYNC_SCHEMA_MIGRATED", "v" + oldVersion + "->v5");
            } catch (Exception e) {
                throw new IllegalStateException("تعذر إنشاء صندوق المزامنة المحكومة", e);
            }
        }
        if (oldVersion < 6) {
            try {
                createDeviceSyncSchema(db);
                audit(db, "DEVICE_RECEIPT_SCHEMA_MIGRATED", "v" + oldVersion + "->v6");
            } catch (Exception e) {
                throw new IllegalStateException("تعذر إنشاء سجل إيصالات المزامنة", e);
            }
        }
        if (oldVersion < 7) {
            try {
                createEnterpriseRelationalSchema(db);
                backfillEnterpriseRelationalState(db);
                audit(db, "ERP_PROCUREMENT_INVENTORY_MIGRATED",
                        "v" + oldVersion + "->v7");
            } catch (Exception e) {
                throw new IllegalStateException(
                        "تعذر ترحيل المشتريات والمخزون إلى المخطط العلائقي", e);
            }
        }
        if (oldVersion < 8) {
            try {
                createWorkforceRelationalSchema(db);
                backfillWorkforceRelationalState(db);
                audit(db, "ERP_ASSETS_WORKFORCE_MAINTENANCE_MIGRATED",
                        "v" + oldVersion + "->v8");
            } catch (Exception e) {
                throw new IllegalStateException(
                        "تعذر ترحيل الأصول والموارد البشرية والصيانة", e);
            }
        }
    }

    public synchronized String getState(String namespace) {
        validateNamespace(namespace);
        try (Cursor c = getReadableDatabase().query(
                "app_state", new String[]{"payload_json"}, "namespace=?",
                new String[]{namespace}, null, null, null, "1")) {
            return c.moveToFirst() ? c.getString(0) : null;
        }
    }

    public synchronized void saveState(String namespace, String payloadJson) throws Exception {
        validateState(namespace, payloadJson);
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            saveStateInTransaction(db, namespace, payloadJson, "LOCAL");
            audit(db, "STATE_SAVED", namespace);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /**
     * Saves related namespaces in one SQLite transaction. This is used by governed
     * corrections so operational state and its accounting reversal cannot diverge.
     */
    public synchronized void saveStates(Map<String, String> states) throws Exception {
        if (states == null || states.isEmpty()) {
            throw new IllegalArgumentException("لا توجد حالات مترابطة للحفظ");
        }
        for (Map.Entry<String, String> entry : states.entrySet()) {
            validateState(entry.getKey(), entry.getValue());
        }
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (Map.Entry<String, String> entry : states.entrySet()) {
                saveStateInTransaction(db, entry.getKey(), entry.getValue(), "LOCAL_ATOMIC");
                audit(db, "STATE_SAVED_ATOMIC", entry.getKey());
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /** Builds a complete role-scoped snapshot for a password-protected portable backup. */
    public synchronized JSONObject exportPortableBackup(String role, String primaryOverrideJson) throws Exception {
        String primary = primaryNamespaceForRole(role);
        java.util.List<String> portableNamespaces = portableNamespacesForRole(role);
        JSONObject namespaces = new JSONObject();
        for (String namespace : portableNamespaces) {
            String payload = namespace.equals(primary) && primaryOverrideJson != null
                    && !primaryOverrideJson.trim().isEmpty()
                    ? primaryOverrideJson : getState(namespace);
            if (payload == null || payload.trim().isEmpty()) continue;
            validateState(namespace, payload);
            namespaces.put(namespace, new JSONObject(payload));
        }
        if (!namespaces.has(primary)) {
            throw new SecurityException("لا توجد بيانات تشغيل محفوظة لإنشاء النسخة الاحتياطية");
        }
        JSONObject meta = new JSONObject();
        meta.put("type", "QATRA_PORTABLE_DATABASE_BACKUP");
        meta.put("version", 2);
        meta.put("role", role);
        meta.put("exportedAt", System.currentTimeMillis());
        meta.put("namespaceCount", namespaces.length());
        JSONObject payload = new JSONObject();
        payload.put("meta", meta);
        payload.put("namespaces", namespaces);
        payload.put("relationalSync", exportRelationalSyncState(portableNamespaces));
        return payload;
    }

    /** Restores all allowed namespaces together so interruption cannot leave a partial backup. */
    public synchronized void restorePortableBackup(String role, String payloadJson) throws Exception {
        JSONObject payload = new JSONObject(payloadJson == null ? "{}" : payloadJson);
        JSONObject meta = payload.optJSONObject("meta");
        JSONObject namespaces = payload.optJSONObject("namespaces");
        if (meta == null || namespaces == null
                || !"QATRA_PORTABLE_DATABASE_BACKUP".equals(meta.optString("type"))
                || meta.optInt("version") != 2 || !role.equals(meta.optString("role"))) {
            throw new SecurityException("محتوى النسخة الاحتياطية لا يطابق هذا التطبيق");
        }
        String primary = primaryNamespaceForRole(role);
        Set<String> allowed = new HashSet<>(portableNamespacesForRole(role));
        JSONArray names = namespaces.names();
        if (names == null || !namespaces.has(primary)) {
            throw new SecurityException("النسخة الاحتياطية لا تحتوي على بيانات التشغيل الأساسية");
        }
        for (int i = 0; i < names.length(); i++) {
            String namespace = names.optString(i, "");
            if (!allowed.contains(namespace) || namespaces.optJSONObject(namespace) == null) {
                throw new SecurityException("تحتوي النسخة على نطاق بيانات غير مسموح");
            }
        }

        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            captureRecoverySnapshotInTransaction(db, role, "BEFORE_PORTABLE_RESTORE");
            JSONObject relationalSync = payload.optJSONObject("relationalSync");
            if (relationalSync != null) restoreRelationalSyncState(db, relationalSync, allowed);
            for (String namespace : portableNamespacesForRole(role)) {
                JSONObject incoming = namespaces.optJSONObject(namespace);
                if (incoming == null) continue;
                JSONObject protectedState = preserveOperationalStart(db, namespace, incoming);
                validateState(namespace, protectedState.toString());
                saveStateInTransaction(db, namespace, protectedState.toString(), "BACKUP_RESTORED");
            }
            audit(db, "PORTABLE_BACKUP_RESTORED", role + ":" + meta.optLong("exportedAt", 0L));
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    public synchronized boolean migrateLegacyState(String namespace, String legacyKey, String payloadJson) throws Exception {
        validateState(namespace, payloadJson);
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            if (hasState(db, namespace) || hasMigration(db, namespace)) {
                db.setTransactionSuccessful();
                return false;
            }
            saveStateInTransaction(db, namespace, payloadJson, "MIGRATED");
            ContentValues values = new ContentValues();
            values.put("namespace", namespace);
            values.put("legacy_key", legacyKey == null ? "" : legacyKey);
            values.put("payload_hash", sha256(payloadJson));
            values.put("migrated_at", System.currentTimeMillis());
            db.insertOrThrow("migration_log", null, values);
            audit(db, "LEGACY_MIGRATED", namespace);
            db.setTransactionSuccessful();
            return true;
        } finally {
            db.endTransaction();
        }
    }

    public synchronized boolean isProcessed(String packageId, String operationId) {
        SQLiteDatabase db = getReadableDatabase();
        try (Cursor c = db.rawQuery(
                "SELECT 1 FROM sync_packages WHERE (package_id=? OR operation_id=?) AND status='PROCESSED' LIMIT 1",
                new String[]{safe(packageId), safe(operationId)})) {
            return c.moveToFirst();
        }
    }

    public synchronized void recordIncomingPending(
            String packageId, String operationId, String senderRole, String targetRole,
            String operationType, String payloadHash) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues values = syncValues(packageId, operationId, "IN", senderRole, targetRole,
                operationType, payloadHash, "PENDING");
        db.insertWithOnConflict("sync_packages", null, values, SQLiteDatabase.CONFLICT_IGNORE);
    }

    public synchronized void recordOutgoing(
            String packageId, String operationId, String senderRole, String targetRole,
            String operationType, String payloadHash) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues values = syncValues(packageId, operationId, "OUT", senderRole, targetRole,
                operationType, payloadHash, "EXPORTED");
        db.insertWithOnConflict("sync_packages", null, values, SQLiteDatabase.CONFLICT_IGNORE);
        audit(db, "SYNC_EXPORTED", packageId + ":" + operationType);
    }

    /** Returns a stable confirmation id, or null when the package was already committed. */
    public synchronized String commitImportedState(
            String namespace, String packageId, String operationId, String senderRole,
            String targetRole, String operationType, String payloadHash, String mergedStateJson) throws Exception {
        validateState(namespace, mergedStateJson);
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            if (isProcessedInTransaction(db, packageId, operationId)) {
                db.setTransactionSuccessful();
                return null;
            }

            ContentValues pending = syncValues(packageId, operationId, "IN", senderRole, targetRole,
                    operationType, payloadHash, "PENDING");
            db.insertWithOnConflict("sync_packages", null, pending, SQLiteDatabase.CONFLICT_IGNORE);

            saveStateInTransaction(db, namespace, mergedStateJson, "IMPORTED");
            ContentValues processed = new ContentValues();
            processed.put("status", "PROCESSED");
            processed.put("processed_at", System.currentTimeMillis());
            int updated = db.update("sync_packages", processed,
                    "package_id=? AND operation_id=? AND payload_hash=?",
                    new String[]{packageId, operationId, payloadHash});
            if (updated != 1) throw new IllegalStateException("تعذر تثبيت عملية المزامنة");

            String confirmationId = "CONF-" + UUID.randomUUID();
            ContentValues confirmation = new ContentValues();
            confirmation.put("confirmation_id", confirmationId);
            confirmation.put("package_id", packageId);
            confirmation.put("operation_id", operationId);
            confirmation.put("payload_hash", payloadHash);
            confirmation.put("created_at", System.currentTimeMillis());
            db.insertOrThrow("confirmations", null, confirmation);
            audit(db, "SYNC_COMMITTED", packageId + ":" + operationType);
            db.setTransactionSuccessful();
            return confirmationId;
        } finally {
            db.endTransaction();
        }
    }

    /** Commits a received confirmation and acknowledges the matching outgoing package. */
    public synchronized boolean commitConfirmationReceipt(
            String confirmationPackageId, String confirmationOperationId, String senderRole,
            String targetRole, String payloadHash, String originalPackageId,
            String originalOperationId, String originalPayloadHash) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            if (isProcessedInTransaction(db, confirmationPackageId, confirmationOperationId)) {
                db.setTransactionSuccessful();
                return false;
            }
            ContentValues incoming = syncValues(confirmationPackageId, confirmationOperationId,
                    "IN", senderRole, targetRole, "CONFIRMATION", payloadHash, "PROCESSED");
            incoming.put("processed_at", System.currentTimeMillis());
            long inserted = db.insertWithOnConflict(
                    "sync_packages", null, incoming, SQLiteDatabase.CONFLICT_IGNORE);
            if (inserted == -1L) {
                ContentValues processed = new ContentValues();
                processed.put("status", "PROCESSED");
                processed.put("processed_at", System.currentTimeMillis());
                int confirmationUpdated = db.update("sync_packages", processed,
                        "package_id=? AND operation_id=? AND payload_hash=? AND direction='IN'",
                        new String[]{confirmationPackageId, confirmationOperationId, payloadHash});
                if (confirmationUpdated != 1) {
                    throw new SecurityException("تعارض في هوية ملف التأكيد؛ لم تُعدّل أي بيانات");
                }
            }

            ContentValues acknowledged = new ContentValues();
            acknowledged.put("status", "ACKNOWLEDGED");
            acknowledged.put("processed_at", System.currentTimeMillis());
            int updated = db.update("sync_packages", acknowledged,
                    "package_id=? AND operation_id=? AND payload_hash=? AND direction='OUT'",
                    new String[]{originalPackageId, originalOperationId, originalPayloadHash});
            if (updated != 1) throw new SecurityException("لا توجد عملية صادرة مطابقة لملف التأكيد");
            audit(db, "SYNC_ACKNOWLEDGED", originalPackageId);
            db.setTransactionSuccessful();
            return true;
        } finally {
            db.endTransaction();
        }
    }

    public synchronized JSONObject diagnostics() throws Exception {
        SQLiteDatabase db = getReadableDatabase();
        JSONObject out = new JSONObject();
        out.put("states", count(db, "app_state"));
        out.put("records", count(db, "records"));
        out.put("syncPackages", count(db, "sync_packages"));
        out.put("confirmations", count(db, "confirmations"));
        out.put("migrations", count(db, "migration_log"));
        out.put("subscribers", count(db, "qatra_subscribers"));
        out.put("cycles", count(db, "qatra_billing_cycles"));
        out.put("readings", count(db, "qatra_meter_readings"));
        out.put("invoices", count(db, "qatra_invoices"));
        out.put("payments", count(db, "qatra_payments"));
        out.put("expenses", count(db, "qatra_expenses"));
        out.put("suppliers", count(db, "erp_suppliers"));
        out.put("purchaseRequests", count(db, "erp_purchase_requests"));
        out.put("purchaseOrders", count(db, "erp_purchase_orders"));
        out.put("goodsReceipts", count(db, "erp_goods_receipts"));
        out.put("supplierInvoices", count(db, "erp_supplier_invoices"));
        out.put("warehouses", count(db, "erp_warehouses"));
        out.put("inventoryItems", count(db, "erp_inventory_items"));
        out.put("stockMovements", count(db, "erp_stock_movements"));
        out.put("assets", count(db, "erp_assets"));
        out.put("depreciationRuns", count(db, "erp_depreciation_runs"));
        out.put("employees", count(db, "erp_employees"));
        out.put("attendance", count(db, "erp_attendance"));
        out.put("payrollRuns", count(db, "erp_payroll_runs"));
        out.put("workOrders", count(db, "erp_work_orders"));
        out.put("preventivePlans", count(db, "erp_preventive_plans"));
        out.put("accountingChangesPending", countWhere(
                db, "qatra_sync_outbox", "status IN('PENDING','FAILED')"));
        out.put("recoverySnapshots", count(db, "erp_recovery_snapshots"));
        out.put("deviceSyncInbox", count(db, "erp_device_sync_inbox"));
        out.put("deviceSyncConflicts", countWhere(
                db, "erp_device_sync_inbox", "status='CONFLICT'"));
        out.put("deviceSyncExports", count(db, "erp_device_sync_exports"));
        out.put("deviceSyncReceipts", count(db, "erp_device_sync_receipts"));
        out.put("databaseVersion", db.getVersion());
        try (Cursor c = db.rawQuery("PRAGMA quick_check(1)", null)) {
            out.put("integrity", c.moveToFirst() ? c.getString(0) : "unknown");
        }
        return out;
    }

    public synchronized void recordPortableBackupExport(String role, String packageId) {
        SQLiteDatabase db = getWritableDatabase();
        createRecoverySchema(db);
        audit(db, "PORTABLE_BACKUP_EXPORTED", safe(role) + ":" + safe(packageId));
    }

    public synchronized JSONObject recoveryStatus(String role) throws Exception {
        QatraNamespacePolicy.portableNamespacesForRole(role);
        SQLiteDatabase db = getWritableDatabase();
        createRecoverySchema(db);
        JSONObject out = diagnostics();
        out.put("role", role);
        out.put("lastBackupAt", latestAuditAt(db, "PORTABLE_BACKUP_EXPORTED"));
        out.put("lastRestoreAt", latestAuditAt(db, "PORTABLE_BACKUP_RESTORED"));
        try (Cursor c = db.rawQuery(
                "SELECT snapshot_id,created_at,status FROM erp_recovery_snapshots " +
                        "WHERE role=? ORDER BY created_at DESC LIMIT 1",
                new String[]{role})) {
            if (c.moveToFirst()) {
                out.put("lastSnapshotId", c.getString(0));
                out.put("lastSnapshotAt", c.getLong(1));
                out.put("lastSnapshotStatus", c.getString(2));
                out.put("rollbackAvailable", "AVAILABLE".equals(c.getString(2)));
            } else {
                out.put("rollbackAvailable", false);
            }
        }
        return out;
    }

    public synchronized JSONObject rollbackLastPortableRestore(String role, String actorUserId)
            throws Exception {
        java.util.List<String> portable = portableNamespacesForRole(role);
        SQLiteDatabase db = getWritableDatabase();
        createRecoverySchema(db);
        String snapshotId;
        String payloadJson;
        try (Cursor c = db.rawQuery(
                "SELECT snapshot_id,payload_json FROM erp_recovery_snapshots " +
                        "WHERE role=? AND status='AVAILABLE' ORDER BY created_at DESC LIMIT 1",
                new String[]{role})) {
            if (!c.moveToFirst()) {
                throw new IllegalStateException("لا توجد لقطة استعادة متاحة للتراجع");
            }
            snapshotId = c.getString(0);
            payloadJson = c.getString(1);
        }
        JSONObject snapshot = new JSONObject(payloadJson);
        JSONObject namespaces = snapshot.getJSONObject("namespaces");
        Set<String> allowed = new HashSet<>(portable);
        db.beginTransaction();
        try {
            JSONObject relationalSync = snapshot.optJSONObject("relationalSync");
            if (relationalSync != null) restoreRelationalSyncState(db, relationalSync, allowed);
            for (String namespace : portable) {
                JSONObject previous = namespaces.optJSONObject(namespace);
                if (previous == null) previous = new JSONObject();
                validateState(namespace, previous.toString());
                saveStateInTransaction(db, namespace, previous.toString(), "RECOVERY_ROLLBACK");
            }
            ContentValues values = new ContentValues();
            values.put("status", "ROLLED_BACK");
            values.put("rolled_back_at", System.currentTimeMillis());
            values.put("rolled_back_by", safe(actorUserId));
            db.update("erp_recovery_snapshots", values, "snapshot_id=?",
                    new String[]{snapshotId});
            audit(db, "PORTABLE_RESTORE_ROLLED_BACK", role + ":" + snapshotId);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("snapshotId", snapshotId);
        out.put("message", "تم التراجع إلى الحالة السابقة للاستعادة");
        return out;
    }


    /**
     * Builds a role-scoped, row-level device exchange payload from the durable outbox.
     * It does not acknowledge or delete source operations; repeated exports stay idempotent.
     */
    public synchronized JSONObject prepareDeviceSyncPayload(
            String sourceDeviceId, String actorUserId, Set<String> actorRoles,
            int requestedLimit) throws Exception {
        validateDeviceId(sourceDeviceId);
        if (actorRoles == null || actorRoles.isEmpty()) {
            throw new SecurityException("لا يوجد دور تشغيلي يسمح بإنشاء حزمة المزامنة");
        }
        int limit = Math.max(1, Math.min(requestedLimit, 500));
        JSONArray changes = new JSONArray();
        try (Cursor cursor = getReadableDatabase().rawQuery(
                "SELECT operation_id,namespace,entity_type,entity_id,action,payload_json," +
                        "payload_hash,entity_version,source,created_at FROM qatra_sync_outbox " +
                        "WHERE status IN('PENDING','FAILED') AND operation_id NOT IN (" +
                        "SELECT source_operation_id FROM erp_device_sync_export_items " +
                        "WHERE disposition IS NOT NULL) ORDER BY local_sequence LIMIT ?",
                new String[]{String.valueOf(limit)})) {
            while (cursor.moveToNext()) {
                String entityType = cursor.getString(2);
                if (!isSyncEntityAllowed(actorRoles, entityType)) continue;
                JSONObject row = new JSONObject();
                row.put("operationId", cursor.getString(0));
                row.put("namespace", cursor.getString(1));
                row.put("entityType", entityType);
                row.put("entityId", cursor.getString(3));
                row.put("action", cursor.getString(4));
                row.put("payload", new JSONObject(cursor.getString(5)));
                row.put("payloadHash", cursor.getString(6));
                row.put("entityVersion", cursor.getLong(7));
                row.put("source", cursor.getString(8));
                row.put("createdAt", cursor.getLong(9));
                changes.put(row);
            }
        }
        JSONObject meta = new JSONObject();
        meta.put("type", "QATRA_ERP_DEVICE_CHANGESET");
        meta.put("version", 1);
        meta.put("sourceDeviceId", sourceDeviceId);
        meta.put("actorUserId", safe(actorUserId));
        meta.put("sourceRoles", new JSONArray(actorRoles));
        meta.put("createdAt", System.currentTimeMillis());
        meta.put("changeCount", changes.length());
        meta.put("transport", "MANUAL_ENCRYPTED_FILE");
        meta.put("cloudTransportEnabled", false);
        JSONObject result = new JSONObject();
        result.put("meta", meta);
        result.put("changes", changes);
        return result;
    }

    /**
     * Stages an authenticated changeset. No operational state changes here: every package must
     * be reviewed by an administrator, and conflicting rows need a separate explicit decision.
     */
    public synchronized JSONObject stageDeviceSyncPackage(
            String packageId, String operationId, String payloadHash, String payloadJson,
            String targetDeviceId, String actorUserId) throws Exception {
        validateDeviceId(targetDeviceId);
        JSONObject payload = new JSONObject(payloadJson == null ? "{}" : payloadJson);
        JSONObject meta = payload.optJSONObject("meta");
        JSONArray changes = payload.optJSONArray("changes");
        if (meta == null || changes == null
                || !"QATRA_ERP_DEVICE_CHANGESET".equals(meta.optString("type"))
                || meta.optInt("version", 0) != 1
                || changes.length() > 500
                || changes.length() != meta.optInt("changeCount", -1)
                || meta.optBoolean("cloudTransportEnabled", true)) {
            throw new SecurityException("بنية حزمة مزامنة ERP غير معتمدة");
        }
        String sourceDeviceId = meta.optString("sourceDeviceId", "");
        validateDeviceId(sourceDeviceId);
        if (sourceDeviceId.equals(targetDeviceId)) {
            throw new SecurityException("لا يمكن استيراد حزمة صادرة من الجهاز نفسه");
        }
        Set<String> sourceRoles = syncRoles(meta.optJSONArray("sourceRoles"));
        if (sourceRoles.isEmpty()) throw new SecurityException("نطاق أدوار الحزمة مفقود");
        if (!payloadHash.equals(sha256(payloadJson))) {
            throw new SecurityException("بصمة حزمة المزامنة لا تطابق محتواها");
        }

        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        int ready = 0;
        int conflicts = 0;
        int duplicates = 0;
        try {
            if (knownSyncPackage(db, packageId, operationId)) {
                JSONObject duplicate = new JSONObject();
                duplicate.put("ok", true);
                duplicate.put("duplicate", true);
                duplicate.put("packageId", packageId);
                db.setTransactionSuccessful();
                return duplicate;
            }
            ContentValues incoming = syncValues(packageId, operationId, "IN",
                    "UNIFIED", "UNIFIED", "DEVICE_CHANGESET", payloadHash, "PENDING");
            db.insertOrThrow("sync_packages", null, incoming);
            ContentValues receivedPackage = new ContentValues();
            receivedPackage.put("package_id", packageId);
            receivedPackage.put("source_device_id", sourceDeviceId);
            receivedPackage.put("target_device_id", targetDeviceId);
            receivedPackage.put("imported_by", safe(actorUserId));
            receivedPackage.put("created_at", System.currentTimeMillis());
            db.insertOrThrow("erp_device_sync_received_packages", null, receivedPackage);

            for (int i = 0; i < changes.length(); i++) {
                JSONObject row = changes.optJSONObject(i);
                if (row == null) throw new SecurityException("حركة مزامنة غير صالحة");
                String sourceOperationId = row.optString("operationId", "");
                try { UUID.fromString(sourceOperationId); }
                catch (Exception invalid) {
                    throw new SecurityException("معرّف حركة المصدر غير صالح");
                }
                String namespace = row.optString("namespace", "");
                String entityType = row.optString("entityType", "").trim().toUpperCase(Locale.ROOT);
                String entityId = row.optString("entityId", "").trim();
                String action = row.optString("action", "");
                String hash = row.optString("payloadHash", "");
                long version = row.optLong("entityVersion", 0L);
                JSONObject entityPayload = row.optJSONObject("payload");
                validateNamespace(namespace);
                QatraNamespacePolicy.requireNamespace("UNIFIED", namespace);
                if (!isSyncEntityAllowed(sourceRoles, entityType)) {
                    throw new SecurityException("نوع السجل خارج نطاق أدوار المصدر: " + entityType);
                }
                if (entityId.isEmpty() || entityId.length() > 240 || version <= 0L
                        || (!"UPSERT".equals(action) && !"DELETE".equals(action))
                        || entityPayload == null || !hash.matches("[0-9a-fA-F]{64}")
                        || !hash.equals(sha256(entityPayload.toString()))) {
                    throw new SecurityException("هوية أو بصمة حركة المزامنة غير صالحة");
                }
                String priorDisposition = priorReceivedDisposition(
                        db, sourceDeviceId, sourceOperationId);
                if (!priorDisposition.isEmpty()) {
                    if ("PENDING".equals(priorDisposition)) {
                        throw new SecurityException(
                                "الحركة نفسها ما تزال قيد المراجعة في حزمة أخرى");
                    }
                    String repeatedDisposition =
                            ("APPLIED".equals(priorDisposition)
                                    || "DUPLICATE".equals(priorDisposition))
                                    ? "DUPLICATE" : priorDisposition;
                    duplicates++;
                    insertReceivedItem(db, packageId, sourceOperationId, entityType,
                            entityId, hash, repeatedDisposition, null);
                    continue;
                }

                VersionState current = versionState(db, namespace, entityType, entityId);
                boolean localPending = hasLocalPendingChange(db, namespace, entityType, entityId);
                String status;
                String reason = "";
                String disposition = null;
                if (current != null && hash.equals(current.payloadHash)
                        && version <= current.version) {
                    status = "DUPLICATE";
                    disposition = "DUPLICATE";
                    duplicates++;
                } else if ((current == null || version > current.version) && !localPending) {
                    status = "READY";
                    ready++;
                } else {
                    status = "CONFLICT";
                    conflicts++;
                    if (localPending) reason = "LOCAL_PENDING_CHANGE";
                    else if (current != null && version < current.version) reason = "STALE_REMOTE_VERSION";
                    else reason = "SAME_VERSION_DIFFERENT_HASH";
                }

                String changeId = "SYNC-" + UUID.randomUUID();
                ContentValues staged = new ContentValues();
                staged.put("change_id", changeId);
                staged.put("package_id", packageId);
                staged.put("source_device_id", sourceDeviceId);
                staged.put("source_operation_id", sourceOperationId);
                staged.put("source_roles_json", new JSONArray(sourceRoles).toString());
                staged.put("namespace", namespace);
                staged.put("entity_type", entityType);
                staged.put("entity_id", entityId);
                staged.put("action", action);
                staged.put("payload_json", entityPayload.toString());
                staged.put("payload_hash", hash);
                staged.put("entity_version", version);
                staged.put("status", status);
                staged.put("conflict_reason", reason);
                staged.put("created_at", System.currentTimeMillis());
                db.insertOrThrow("erp_device_sync_inbox", null, staged);
                insertReceivedItem(db, packageId, sourceOperationId, entityType,
                        entityId, hash, disposition, changeId);
            }

            String packageStatus = ready == 0 && conflicts == 0 ? "DUPLICATE" : "AWAITING_REVIEW";
            ContentValues packageValues = new ContentValues();
            packageValues.put("status", packageStatus);
            if ("DUPLICATE".equals(packageStatus)) {
                packageValues.put("processed_at", System.currentTimeMillis());
            }
            db.update("sync_packages", packageValues, "package_id=?", new String[]{packageId});
            audit(db, "DEVICE_SYNC_STAGED", packageId + ":ready=" + ready
                    + ":conflicts=" + conflicts + ":duplicates=" + duplicates
                    + ":actor=" + safe(actorUserId));
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("duplicate", ready == 0 && conflicts == 0);
        out.put("packageId", packageId);
        out.put("ready", ready);
        out.put("conflicts", conflicts);
        out.put("duplicates", duplicates);
        out.put("message", conflicts > 0
                ? "تمت إضافة الحزمة للمراجعة وبها تعارضات تحتاج قرارًا"
                : "تمت إضافة الحزمة للمراجعة الإدارية");
        return out;
    }

    public synchronized JSONObject deviceSyncStatus() throws Exception {
        SQLiteDatabase db = getReadableDatabase();
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("transport", "MANUAL_ENCRYPTED_FILE");
        out.put("cloudTransportEnabled", false);
        out.put("pendingPackages", countWhere(db, "sync_packages",
                "direction='IN' AND operation_type='DEVICE_CHANGESET' AND status='AWAITING_REVIEW'"));
        out.put("conflictPackages", countWhere(db, "sync_packages",
                "direction='IN' AND operation_type='DEVICE_CHANGESET' AND status='CONFLICT_REVIEW'"));
        out.put("openConflicts", countWhere(db, "erp_device_sync_inbox", "status='CONFLICT'"));
        out.put("readyChanges", countWhere(db, "erp_device_sync_inbox", "status='READY'"));
        out.put("lastExportAt", latestSyncAt(db, "OUT"));
        out.put("lastImportAt", latestSyncAt(db, "IN"));
        out.put("lastReceiptAt", latestDeviceReceiptAt(db));
        out.put("acceptedOutcomes", countWhere(db, "erp_device_sync_export_items",
                "disposition IN('APPLIED','DUPLICATE')"));
        out.put("rejectedOutcomes", countWhere(db, "erp_device_sync_export_items",
                "disposition IN('KEPT_LOCAL','REJECTED')"));

        JSONArray packages = new JSONArray();
        try (Cursor cursor = db.rawQuery(
                "SELECT package_id,status,created_at,processed_at FROM sync_packages " +
                        "WHERE direction='IN' AND operation_type='DEVICE_CHANGESET' " +
                        "ORDER BY created_at DESC LIMIT 30", null)) {
            while (cursor.moveToNext()) {
                JSONObject row = new JSONObject();
                row.put("packageId", cursor.getString(0));
                row.put("status", cursor.getString(1));
                row.put("createdAt", cursor.getLong(2));
                row.put("processedAt", cursor.isNull(3) ? JSONObject.NULL : cursor.getLong(3));
                row.put("ready", inboxCount(db, cursor.getString(0), "READY"));
                row.put("conflicts", inboxCount(db, cursor.getString(0), "CONFLICT"));
                row.put("applied", inboxCount(db, cursor.getString(0), "APPLIED"));
                row.put("receiptExportedAt", receivedReceiptExportedAt(db, cursor.getString(0)));
                packages.put(row);
            }
        }
        out.put("packages", packages);

        JSONArray conflictRows = new JSONArray();
        try (Cursor cursor = db.rawQuery(
                "SELECT change_id,package_id,entity_type,entity_id,entity_version," +
                        "conflict_reason,created_at FROM erp_device_sync_inbox " +
                        "WHERE status='CONFLICT' ORDER BY created_at LIMIT 100", null)) {
            while (cursor.moveToNext()) {
                JSONObject row = new JSONObject();
                row.put("changeId", cursor.getString(0));
                row.put("packageId", cursor.getString(1));
                row.put("entityType", cursor.getString(2));
                row.put("entityId", cursor.getString(3));
                row.put("entityVersion", cursor.getLong(4));
                row.put("reason", cursor.getString(5));
                row.put("createdAt", cursor.getLong(6));
                conflictRows.put(row);
            }
        }
        out.put("conflicts", conflictRows);
        return out;
    }

    public synchronized JSONObject reviewDeviceSyncPackage(
            String packageId, String decision, String notes, String actorUserId) throws Exception {
        String normalized = decision == null ? "" : decision.trim().toUpperCase(Locale.ROOT);
        if (!"APPROVE".equals(normalized) && !"REJECT".equals(normalized)) {
            throw new IllegalArgumentException("قرار الحزمة يجب أن يكون APPROVE أو REJECT");
        }
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        int applied = 0;
        int conflicts;
        try {
            String packageStatus = syncPackageStatus(db, packageId);
            if (!"AWAITING_REVIEW".equals(packageStatus)) {
                throw new SecurityException("الحزمة ليست في حالة انتظار المراجعة");
            }
            if ("REJECT".equals(normalized)) {
                ContentValues rejected = reviewValues("REJECTED", actorUserId, notes);
                db.update("erp_device_sync_inbox", rejected,
                        "package_id=? AND status IN('READY','CONFLICT')",
                        new String[]{packageId});
                setAllPendingReceivedDispositions(db, packageId, "REJECTED");
                setSyncPackageStatus(db, packageId, "REJECTED", true);
                audit(db, "DEVICE_SYNC_PACKAGE_REJECTED",
                        packageId + ":actor=" + safe(actorUserId));
                conflicts = 0;
            } else {
                try (Cursor cursor = db.rawQuery(
                        "SELECT change_id,namespace,entity_type,entity_id,action,payload_json," +
                                "payload_hash,entity_version FROM erp_device_sync_inbox " +
                                "WHERE package_id=? AND status='READY' ORDER BY created_at",
                        new String[]{packageId})) {
                    while (cursor.moveToNext()) {
                        applyIncomingEntity(db, cursor.getString(1), cursor.getString(2),
                                cursor.getString(3), cursor.getString(4), cursor.getString(5),
                                cursor.getString(6), cursor.getLong(7), actorUserId);
                        ContentValues accepted = reviewValues("APPLIED", actorUserId, notes);
                        db.update("erp_device_sync_inbox", accepted, "change_id=?",
                                new String[]{cursor.getString(0)});
                        setReceivedDispositionForChange(
                                db, packageId, cursor.getString(0), "APPLIED");
                        applied++;
                    }
                }
                conflicts = inboxCount(db, packageId, "CONFLICT");
                setSyncPackageStatus(db, packageId,
                        conflicts > 0 ? "CONFLICT_REVIEW" : "PROCESSED", conflicts == 0);
                audit(db, "DEVICE_SYNC_PACKAGE_APPROVED",
                        packageId + ":applied=" + applied + ":conflicts=" + conflicts
                                + ":actor=" + safe(actorUserId));
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("packageId", packageId);
        out.put("applied", applied);
        out.put("conflicts", conflicts);
        out.put("message", "REJECT".equals(normalized)
                ? "تم رفض الحزمة مع حفظ أثر المراجعة"
                : conflicts > 0 ? "طُبقت السجلات السليمة وبقيت التعارضات للمراجعة"
                : "تم اعتماد الحزمة وتطبيقها");
        return out;
    }

    public synchronized JSONObject resolveDeviceSyncConflict(
            String changeId, String decision, String notes, String actorUserId) throws Exception {
        String normalized = decision == null ? "" : decision.trim().toUpperCase(Locale.ROOT);
        if (!"REMOTE".equals(normalized) && !"LOCAL".equals(normalized)) {
            throw new IllegalArgumentException("قرار التعارض يجب أن يكون REMOTE أو LOCAL");
        }
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            String packageId;
            try (Cursor cursor = db.rawQuery(
                    "SELECT package_id,namespace,entity_type,entity_id,action,payload_json," +
                            "payload_hash,entity_version,status FROM erp_device_sync_inbox " +
                            "WHERE change_id=? LIMIT 1", new String[]{safe(changeId)})) {
                if (!cursor.moveToFirst() || !"CONFLICT".equals(cursor.getString(8))) {
                    throw new SecurityException("التعارض غير موجود أو سبق حسمه");
                }
                packageId = cursor.getString(0);
                if (!"CONFLICT_REVIEW".equals(syncPackageStatus(db, packageId))) {
                    throw new SecurityException("اعتمد مراجعة الحزمة أولًا قبل حسم التعارض");
                }
                if ("REMOTE".equals(normalized)) {
                    applyIncomingEntity(db, cursor.getString(1), cursor.getString(2),
                            cursor.getString(3), cursor.getString(4), cursor.getString(5),
                            cursor.getString(6), cursor.getLong(7), actorUserId);
                }
            }
            ContentValues reviewed = reviewValues(
                    "REMOTE".equals(normalized) ? "APPLIED" : "KEPT_LOCAL",
                    actorUserId, notes);
            db.update("erp_device_sync_inbox", reviewed, "change_id=?", new String[]{changeId});
            setReceivedDispositionForChange(db, packageId, changeId,
                    "REMOTE".equals(normalized) ? "APPLIED" : "KEPT_LOCAL");
            int remaining = inboxCount(db, packageId, "CONFLICT");
            if (remaining == 0) setSyncPackageStatus(db, packageId, "PROCESSED", true);
            audit(db, "DEVICE_SYNC_CONFLICT_RESOLVED",
                    changeId + ":" + normalized + ":actor=" + safe(actorUserId));
            db.setTransactionSuccessful();
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("packageId", packageId);
            out.put("remainingConflicts", remaining);
            out.put("message", "REMOTE".equals(normalized)
                    ? "تم اعتماد السجل الوارد مع حفظ القرار"
                    : "تم الإبقاء على السجل المحلي مع حفظ القرار");
            return out;
        } finally {
            db.endTransaction();
        }
    }


    /** Records the exact operations sealed inside a successfully saved changeset. */
    public synchronized void recordDeviceChangesetExport(
            String packageId, String operationId, String payloadHash, String payloadJson,
            String actorUserId) throws Exception {
        JSONObject payload = new JSONObject(payloadJson == null ? "{}" : payloadJson);
        JSONObject meta = payload.optJSONObject("meta");
        JSONArray changes = payload.optJSONArray("changes");
        if (meta == null || changes == null
                || !"QATRA_ERP_DEVICE_CHANGESET".equals(meta.optString("type"))
                || meta.optInt("version", 0) != 1
                || !payloadHash.equals(sha256(payloadJson))
                || changes.length() != meta.optInt("changeCount", -1)) {
            throw new SecurityException("تعذر توثيق محتوى حزمة المزامنة الصادرة");
        }
        String sourceDeviceId = meta.optString("sourceDeviceId", "");
        validateDeviceId(sourceDeviceId);
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues sync = syncValues(packageId, operationId, "OUT",
                    "UNIFIED", "UNIFIED", "DEVICE_CHANGESET", payloadHash, "EXPORTED");
            db.insertOrThrow("sync_packages", null, sync);
            ContentValues exported = new ContentValues();
            exported.put("package_id", packageId);
            exported.put("operation_id", operationId);
            exported.put("payload_hash", payloadHash);
            exported.put("source_device_id", sourceDeviceId);
            exported.put("exported_by", safe(actorUserId));
            exported.put("status", "EXPORTED");
            exported.put("created_at", System.currentTimeMillis());
            db.insertOrThrow("erp_device_sync_exports", null, exported);
            for (int i = 0; i < changes.length(); i++) {
                JSONObject row = changes.optJSONObject(i);
                if (row == null) throw new SecurityException("حركة صادرة غير صالحة");
                String sourceOperationId = row.optString("operationId", "");
                try { UUID.fromString(sourceOperationId); }
                catch (Exception invalid) {
                    throw new SecurityException("معرّف الحركة الصادرة غير صالح");
                }
                String itemHash = row.optString("payloadHash", "");
                if (!itemHash.matches("[0-9a-fA-F]{64}")) {
                    throw new SecurityException("بصمة الحركة الصادرة غير صالحة");
                }
                ContentValues item = new ContentValues();
                item.put("package_id", packageId);
                item.put("source_operation_id", sourceOperationId);
                item.put("entity_type", row.optString("entityType", ""));
                item.put("entity_id", row.optString("entityId", ""));
                item.put("item_hash", itemHash);
                db.insertOrThrow("erp_device_sync_export_items", null, item);
            }
            audit(db, "DEVICE_CHANGESET_EXPORTED",
                    packageId + ":items=" + changes.length() + ":actor=" + safe(actorUserId));
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /** Builds a complete receipt only after every imported item has a final disposition. */
    public synchronized JSONObject prepareDeviceReceiptPayload(
            String originalPackageId, String sourceDeviceId, String actorUserId) throws Exception {
        validateDeviceId(sourceDeviceId);
        SQLiteDatabase db = getReadableDatabase();
        String originalOperationId;
        String originalPayloadHash;
        String packageStatus;
        String targetDeviceId;
        try (Cursor cursor = db.rawQuery(
                "SELECT s.operation_id,s.payload_hash,s.status,r.source_device_id " +
                        "FROM sync_packages s JOIN erp_device_sync_received_packages r " +
                        "ON r.package_id=s.package_id WHERE s.package_id=? AND s.direction='IN' " +
                        "AND s.operation_type='DEVICE_CHANGESET' LIMIT 1",
                new String[]{safe(originalPackageId)})) {
            if (!cursor.moveToFirst()) {
                throw new SecurityException("حزمة المزامنة الأصلية غير موجودة");
            }
            originalOperationId = cursor.getString(0);
            originalPayloadHash = cursor.getString(1);
            packageStatus = cursor.getString(2);
            targetDeviceId = cursor.getString(3);
        }
        if (!Arrays.asList("PROCESSED", "REJECTED", "DUPLICATE").contains(packageStatus)) {
            throw new SecurityException("لا يمكن إصدار الإيصال قبل اكتمال مراجعة الحزمة");
        }
        JSONArray decisions = new JSONArray();
        try (Cursor cursor = db.rawQuery(
                "SELECT source_operation_id,entity_type,entity_id,item_hash,disposition " +
                        "FROM erp_device_sync_received_items WHERE package_id=? " +
                        "ORDER BY source_operation_id", new String[]{originalPackageId})) {
            while (cursor.moveToNext()) {
                if (cursor.isNull(4)) {
                    throw new SecurityException("توجد حركة لم يُحسم قرارها بعد");
                }
                JSONObject row = new JSONObject();
                row.put("operationId", cursor.getString(0));
                row.put("entityType", cursor.getString(1));
                row.put("entityId", cursor.getString(2));
                row.put("itemHash", cursor.getString(3));
                row.put("disposition", cursor.getString(4));
                decisions.put(row);
            }
        }
        if (decisions.length() == 0 || decisions.length() > 500) {
            throw new SecurityException("لا توجد قرارات صالحة لإصدار الإيصال");
        }
        JSONObject meta = new JSONObject();
        meta.put("type", "QATRA_ERP_DEVICE_RECEIPT");
        meta.put("version", 1);
        meta.put("sourceDeviceId", sourceDeviceId);
        meta.put("targetDeviceId", targetDeviceId);
        meta.put("originalPackageId", originalPackageId);
        meta.put("originalOperationId", originalOperationId);
        meta.put("originalPayloadHash", originalPayloadHash);
        meta.put("reviewedBy", safe(actorUserId));
        meta.put("createdAt", System.currentTimeMillis());
        meta.put("decisionCount", decisions.length());
        meta.put("transport", "MANUAL_ENCRYPTED_FILE");
        meta.put("cloudTransportEnabled", false);
        JSONObject out = new JSONObject();
        out.put("meta", meta);
        out.put("decisions", decisions);
        return out;
    }

    public synchronized void recordDeviceReceiptExport(
            String receiptPackageId, String receiptOperationId, String receiptPayloadHash,
            String payloadJson, String actorUserId) throws Exception {
        JSONObject payload = new JSONObject(payloadJson == null ? "{}" : payloadJson);
        JSONObject meta = payload.optJSONObject("meta");
        JSONArray decisions = payload.optJSONArray("decisions");
        if (meta == null || decisions == null
                || !"QATRA_ERP_DEVICE_RECEIPT".equals(meta.optString("type"))
                || meta.optInt("version", 0) != 1
                || !receiptPayloadHash.equals(sha256(payloadJson))
                || decisions.length() != meta.optInt("decisionCount", -1)) {
            throw new SecurityException("تعذر توثيق إيصال المزامنة الصادر");
        }
        String originalPackageId = meta.optString("originalPackageId", "");
        String sourceDeviceId = meta.optString("sourceDeviceId", "");
        String targetDeviceId = meta.optString("targetDeviceId", "");
        validateDeviceId(sourceDeviceId);
        validateDeviceId(targetDeviceId);
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            String status = syncPackageStatus(db, originalPackageId);
            if (!Arrays.asList("PROCESSED", "REJECTED", "DUPLICATE").contains(status)) {
                throw new SecurityException("حالة الحزمة الأصلية لا تسمح بإصدار إيصال");
            }
            ContentValues sync = syncValues(receiptPackageId, receiptOperationId, "OUT",
                    "UNIFIED", "UNIFIED", "DEVICE_RECEIPT", receiptPayloadHash, "EXPORTED");
            db.insertOrThrow("sync_packages", null, sync);
            ContentValues receipt = deviceReceiptValues(receiptPackageId, receiptOperationId,
                    "OUT", originalPackageId, sourceDeviceId, targetDeviceId,
                    receiptPayloadHash, "EXPORTED");
            db.insertOrThrow("erp_device_sync_receipts", null, receipt);
            ContentValues marked = new ContentValues();
            marked.put("receipt_exported_at", System.currentTimeMillis());
            db.update("erp_device_sync_received_packages", marked,
                    "package_id=?", new String[]{originalPackageId});
            audit(db, "DEVICE_RECEIPT_EXPORTED",
                    receiptPackageId + ":original=" + originalPackageId
                            + ":actor=" + safe(actorUserId));
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /** Applies a receipt against the exact operations recorded for the original export. */
    public synchronized JSONObject applyDeviceReceipt(
            String receiptPackageId, String receiptOperationId, String receiptPayloadHash,
            String payloadJson, String currentDeviceId, String actorUserId) throws Exception {
        validateDeviceId(currentDeviceId);
        JSONObject payload = new JSONObject(payloadJson == null ? "{}" : payloadJson);
        JSONObject meta = payload.optJSONObject("meta");
        JSONArray decisions = payload.optJSONArray("decisions");
        if (meta == null || decisions == null
                || !"QATRA_ERP_DEVICE_RECEIPT".equals(meta.optString("type"))
                || meta.optInt("version", 0) != 1
                || decisions.length() == 0 || decisions.length() > 500
                || decisions.length() != meta.optInt("decisionCount", -1)
                || meta.optBoolean("cloudTransportEnabled", true)
                || !receiptPayloadHash.equals(sha256(payloadJson))) {
            throw new SecurityException("بنية إيصال المزامنة أو بصمته غير صالحة");
        }
        String sourceDeviceId = meta.optString("sourceDeviceId", "");
        String targetDeviceId = meta.optString("targetDeviceId", "");
        String originalPackageId = meta.optString("originalPackageId", "");
        String originalOperationId = meta.optString("originalOperationId", "");
        String originalPayloadHash = meta.optString("originalPayloadHash", "");
        validateDeviceId(sourceDeviceId);
        validateDeviceId(targetDeviceId);
        if (!currentDeviceId.equals(targetDeviceId) || currentDeviceId.equals(sourceDeviceId)) {
            throw new SecurityException("إيصال المزامنة ليس مخصصًا لهذا الجهاز");
        }

        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            if (knownSyncPackage(db, receiptPackageId, receiptOperationId)) {
                JSONObject duplicate = new JSONObject();
                duplicate.put("ok", true);
                duplicate.put("duplicate", true);
                duplicate.put("message", "سبق استيراد إيصال المزامنة");
                db.setTransactionSuccessful();
                return duplicate;
            }
            try (Cursor cursor = db.rawQuery(
                    "SELECT 1 FROM erp_device_sync_exports WHERE package_id=? " +
                            "AND operation_id=? AND payload_hash=? AND source_device_id=? LIMIT 1",
                    new String[]{originalPackageId, originalOperationId,
                            originalPayloadHash, currentDeviceId})) {
                if (!cursor.moveToFirst()) {
                    throw new SecurityException("الإيصال لا يطابق حزمة صادرة من هذا الجهاز");
                }
            }
            int expected = exportItemCount(db, originalPackageId);
            if (expected != decisions.length()) {
                throw new SecurityException("الإيصال لا يغطي جميع حركات الحزمة الأصلية");
            }

            Set<String> seen = new HashSet<>();
            int accepted = 0;
            int rejected = 0;
            for (int i = 0; i < decisions.length(); i++) {
                JSONObject row = decisions.optJSONObject(i);
                if (row == null) throw new SecurityException("قرار إيصال غير صالح");
                String operationId = row.optString("operationId", "");
                String itemHash = row.optString("itemHash", "");
                String disposition = row.optString("disposition", "")
                        .trim().toUpperCase(Locale.ROOT);
                try { UUID.fromString(operationId); }
                catch (Exception invalid) {
                    throw new SecurityException("معرّف حركة الإيصال غير صالح");
                }
                if (!seen.add(operationId)
                        || !Arrays.asList("APPLIED", "DUPLICATE",
                        "KEPT_LOCAL", "REJECTED").contains(disposition)) {
                    throw new SecurityException("قرار مكرر أو غير معتمد في الإيصال");
                }
                String currentDisposition = exportedItemDisposition(
                        db, originalPackageId, operationId, itemHash);
                if (currentDisposition != null && !currentDisposition.equals(disposition)) {
                    throw new SecurityException("يتعارض الإيصال مع قرار محفوظ سابقًا");
                }
                ContentValues outcome = new ContentValues();
                outcome.put("disposition", disposition);
                outcome.put("resolved_at", System.currentTimeMillis());
                outcome.put("receipt_package_id", receiptPackageId);
                db.update("erp_device_sync_export_items", outcome,
                        "package_id=? AND source_operation_id=? AND item_hash=?",
                        new String[]{originalPackageId, operationId, itemHash});
                if ("APPLIED".equals(disposition) || "DUPLICATE".equals(disposition)) {
                    ContentValues acknowledged = new ContentValues();
                    acknowledged.put("status", "ACKNOWLEDGED");
                    acknowledged.put("acknowledged_at", System.currentTimeMillis());
                    db.update("qatra_sync_outbox", acknowledged,
                            "operation_id=? AND status IN('PENDING','FAILED')",
                            new String[]{operationId});
                    accepted++;
                } else {
                    rejected++;
                }
            }

            ContentValues incoming = syncValues(receiptPackageId, receiptOperationId,
                    "IN", "UNIFIED", "UNIFIED", "DEVICE_RECEIPT",
                    receiptPayloadHash, "PROCESSED");
            incoming.put("processed_at", System.currentTimeMillis());
            db.insertOrThrow("sync_packages", null, incoming);
            ContentValues receipt = deviceReceiptValues(receiptPackageId, receiptOperationId,
                    "IN", originalPackageId, sourceDeviceId, targetDeviceId,
                    receiptPayloadHash, "PROCESSED");
            receipt.put("processed_at", System.currentTimeMillis());
            db.insertOrThrow("erp_device_sync_receipts", null, receipt);

            String resultStatus = rejected == 0 ? "ACKNOWLEDGED" : "REVIEWED_WITH_REJECTIONS";
            ContentValues resolved = new ContentValues();
            resolved.put("status", resultStatus);
            resolved.put("resolved_at", System.currentTimeMillis());
            db.update("erp_device_sync_exports", resolved,
                    "package_id=?", new String[]{originalPackageId});
            ContentValues syncResolved = new ContentValues();
            syncResolved.put("status", resultStatus);
            syncResolved.put("processed_at", System.currentTimeMillis());
            db.update("sync_packages", syncResolved,
                    "package_id=? AND direction='OUT'",
                    new String[]{originalPackageId});
            audit(db, "DEVICE_RECEIPT_APPLIED",
                    receiptPackageId + ":accepted=" + accepted + ":rejected=" + rejected
                            + ":actor=" + safe(actorUserId));
            db.setTransactionSuccessful();

            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("accepted", accepted);
            out.put("rejected", rejected);
            out.put("originalPackageId", originalPackageId);
            out.put("message", rejected == 0
                    ? "تم تأكيد جميع حركات الحزمة"
                    : "تم تسجيل نتيجة الإدارة، وبعض الحركات تحتاج تعديلًا محليًا جديدًا");
            return out;
        } finally {
            db.endTransaction();
        }
    }

    private static void insertReceivedItem(
            SQLiteDatabase db, String packageId, String operationId,
            String entityType, String entityId, String itemHash,
            String disposition, String inboxChangeId) {
        ContentValues item = new ContentValues();
        item.put("package_id", packageId);
        item.put("source_operation_id", operationId);
        item.put("entity_type", entityType);
        item.put("entity_id", entityId);
        item.put("item_hash", itemHash);
        if (disposition == null) item.putNull("disposition"); else item.put("disposition", disposition);
        if (inboxChangeId == null) item.putNull("inbox_change_id");
        else item.put("inbox_change_id", inboxChangeId);
        db.insertOrThrow("erp_device_sync_received_items", null, item);
    }

    private static void setReceivedDispositionForChange(
            SQLiteDatabase db, String packageId, String changeId, String disposition) {
        ContentValues values = new ContentValues();
        values.put("disposition", disposition);
        int updated = db.update("erp_device_sync_received_items", values,
                "package_id=? AND inbox_change_id=? AND disposition IS NULL",
                new String[]{packageId, changeId});
        if (updated != 1) throw new IllegalStateException("تعذر تثبيت قرار حركة المزامنة");
    }

    private static void setAllPendingReceivedDispositions(
            SQLiteDatabase db, String packageId, String disposition) {
        ContentValues values = new ContentValues();
        values.put("disposition", disposition);
        db.update("erp_device_sync_received_items", values,
                "package_id=? AND disposition IS NULL", new String[]{packageId});
    }

    private static int exportItemCount(SQLiteDatabase db, String packageId) {
        try (Cursor cursor = db.rawQuery(
                "SELECT COUNT(*) FROM erp_device_sync_export_items WHERE package_id=?",
                new String[]{packageId})) {
            return cursor.moveToFirst() ? cursor.getInt(0) : 0;
        }
    }

    private static String exportedItemDisposition(
            SQLiteDatabase db, String packageId, String operationId, String itemHash) {
        try (Cursor cursor = db.rawQuery(
                "SELECT disposition FROM erp_device_sync_export_items " +
                        "WHERE package_id=? AND source_operation_id=? AND item_hash=? LIMIT 1",
                new String[]{packageId, operationId, itemHash})) {
            if (!cursor.moveToFirst()) {
                throw new SecurityException("قرار الإيصال لا يطابق حركة في الحزمة الأصلية");
            }
            return cursor.isNull(0) ? null : cursor.getString(0);
        }
    }

    private static ContentValues deviceReceiptValues(
            String packageId, String operationId, String direction,
            String originalPackageId, String sourceDeviceId, String targetDeviceId,
            String payloadHash, String status) {
        ContentValues values = new ContentValues();
        values.put("receipt_package_id", packageId);
        values.put("operation_id", operationId);
        values.put("direction", direction);
        values.put("original_package_id", originalPackageId);
        values.put("source_device_id", sourceDeviceId);
        values.put("target_device_id", targetDeviceId);
        values.put("payload_hash", payloadHash);
        values.put("status", status);
        values.put("created_at", System.currentTimeMillis());
        return values;
    }

    private static long receivedReceiptExportedAt(SQLiteDatabase db, String packageId) {
        try (Cursor cursor = db.rawQuery(
                "SELECT receipt_exported_at FROM erp_device_sync_received_packages " +
                        "WHERE package_id=? LIMIT 1", new String[]{packageId})) {
            return cursor.moveToFirst() && !cursor.isNull(0) ? cursor.getLong(0) : 0L;
        }
    }

    private static long latestDeviceReceiptAt(SQLiteDatabase db) {
        try (Cursor cursor = db.rawQuery(
                "SELECT MAX(COALESCE(processed_at,created_at)) " +
                        "FROM erp_device_sync_receipts", null)) {
            return cursor.moveToFirst() && !cursor.isNull(0) ? cursor.getLong(0) : 0L;
        }
    }

    private static void createDeviceSyncSchema(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_device_sync_inbox (" +
                "change_id TEXT PRIMARY KEY NOT NULL," +
                "package_id TEXT NOT NULL,source_device_id TEXT NOT NULL," +
                "source_operation_id TEXT NOT NULL,source_roles_json TEXT NOT NULL," +
                "namespace TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "action TEXT NOT NULL CHECK(action IN('UPSERT','DELETE'))," +
                "payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL," +
                "entity_version INTEGER NOT NULL,status TEXT NOT NULL " +
                "CHECK(status IN('READY','CONFLICT','DUPLICATE','APPLIED'," +
                "'KEPT_LOCAL','REJECTED'))," +
                "conflict_reason TEXT NOT NULL DEFAULT '',review_notes TEXT NOT NULL DEFAULT ''," +
                "reviewed_by TEXT,reviewed_at INTEGER,created_at INTEGER NOT NULL," +
                "UNIQUE(source_device_id,source_operation_id)," +
                "FOREIGN KEY(package_id) REFERENCES sync_packages(package_id) ON DELETE CASCADE)");
        db.execSQL("CREATE INDEX IF NOT EXISTS ix_erp_device_sync_review " +
                "ON erp_device_sync_inbox(status,created_at)");
        db.execSQL("CREATE INDEX IF NOT EXISTS ix_erp_device_sync_package " +
                "ON erp_device_sync_inbox(package_id,status)");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_device_sync_received_packages (" +
                "package_id TEXT PRIMARY KEY NOT NULL,source_device_id TEXT NOT NULL," +
                "target_device_id TEXT NOT NULL,imported_by TEXT NOT NULL," +
                "receipt_exported_at INTEGER,created_at INTEGER NOT NULL," +
                "FOREIGN KEY(package_id) REFERENCES sync_packages(package_id) ON DELETE CASCADE)");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_device_sync_received_items (" +
                "package_id TEXT NOT NULL,source_operation_id TEXT NOT NULL," +
                "entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,item_hash TEXT NOT NULL," +
                "disposition TEXT CHECK(disposition IS NULL OR disposition IN(" +
                "'APPLIED','DUPLICATE','KEPT_LOCAL','REJECTED'))," +
                "inbox_change_id TEXT,PRIMARY KEY(package_id,source_operation_id)," +
                "FOREIGN KEY(package_id) REFERENCES erp_device_sync_received_packages(package_id) " +
                "ON DELETE CASCADE)");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_device_sync_exports (" +
                "package_id TEXT PRIMARY KEY NOT NULL,operation_id TEXT NOT NULL UNIQUE," +
                "payload_hash TEXT NOT NULL,source_device_id TEXT NOT NULL," +
                "exported_by TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL," +
                "resolved_at INTEGER,FOREIGN KEY(package_id) REFERENCES sync_packages(package_id) " +
                "ON DELETE CASCADE)");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_device_sync_export_items (" +
                "package_id TEXT NOT NULL,source_operation_id TEXT NOT NULL," +
                "entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,item_hash TEXT NOT NULL," +
                "disposition TEXT CHECK(disposition IS NULL OR disposition IN(" +
                "'APPLIED','DUPLICATE','KEPT_LOCAL','REJECTED'))," +
                "resolved_at INTEGER,receipt_package_id TEXT," +
                "PRIMARY KEY(package_id,source_operation_id)," +
                "FOREIGN KEY(package_id) REFERENCES erp_device_sync_exports(package_id) " +
                "ON DELETE CASCADE)");
        db.execSQL("CREATE INDEX IF NOT EXISTS ix_erp_device_export_outcome " +
                "ON erp_device_sync_export_items(disposition,source_operation_id)");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_device_sync_receipts (" +
                "receipt_package_id TEXT PRIMARY KEY NOT NULL,operation_id TEXT NOT NULL UNIQUE," +
                "direction TEXT NOT NULL,original_package_id TEXT NOT NULL," +
                "source_device_id TEXT NOT NULL,target_device_id TEXT NOT NULL," +
                "payload_hash TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL," +
                "processed_at INTEGER)");
        db.execSQL("CREATE INDEX IF NOT EXISTS ix_erp_device_receipt_original " +
                "ON erp_device_sync_receipts(original_package_id,direction,created_at)");
    }

    private static Set<String> syncRoles(JSONArray roles) {
        Set<String> out = new HashSet<>();
        if (roles == null || roles.length() > 12) return out;
        for (int i = 0; i < roles.length(); i++) {
            String role = roles.optString(i, "").trim().toUpperCase(Locale.ROOT);
            if (role.matches("[A-Z_]{2,40}")) out.add(role);
        }
        return out;
    }

    private static boolean isSyncEntityAllowed(Set<String> roles, String entityType) {
        String type = entityType == null ? "" : entityType.trim().toUpperCase(Locale.ROOT);
        Set<String> base = new HashSet<>(Arrays.asList(
                "SUBSCRIBER", "BILLING_CYCLE", "METER_READING", "INVOICE",
                "PAYMENT", "EXPENSE", "CASHBOX_TRANSACTION", "DIRECT_PAYMENT",
                "SUPPLIER", "PURCHASE_REQUEST", "QUOTATION", "PURCHASE_ORDER",
                "GOODS_RECEIPT", "SUPPLIER_INVOICE", "WAREHOUSE",
                "INVENTORY_ITEM", "STOCK_MOVEMENT", "ASSET", "DEPRECIATION_RUN",
                "ASSET_TRANSFER", "EMPLOYEE", "ATTENDANCE", "LEAVE_REQUEST",
                "PAYROLL_RUN", "WORK_ORDER", "PREVENTIVE_PLAN", "FAILURE_REPORT"));
        if (!base.contains(type)) return false;
        if (roles.contains(QatraUnifiedUserStore.ROLE_SYSTEM_ADMIN)
                || roles.contains(QatraUnifiedUserStore.ROLE_ADMIN)) return true;
        if (roles.contains(QatraUnifiedUserStore.ROLE_ACCOUNTANT)
                && Arrays.asList("INVOICE", "PAYMENT", "EXPENSE",
                "CASHBOX_TRANSACTION", "DIRECT_PAYMENT").contains(type)) return true;
        if (roles.contains(QatraUnifiedUserStore.ROLE_READER)
                && "METER_READING".equals(type)) return true;
        if (roles.contains(QatraUnifiedUserStore.ROLE_COLLECTOR)
                && Arrays.asList("PAYMENT", "DIRECT_PAYMENT").contains(type)) return true;
        if (roles.contains(QatraUnifiedUserStore.ROLE_PROCUREMENT)
                && Arrays.asList("SUPPLIER", "PURCHASE_REQUEST", "QUOTATION",
                "PURCHASE_ORDER", "GOODS_RECEIPT", "SUPPLIER_INVOICE").contains(type)) {
            return true;
        }
        if (roles.contains(QatraUnifiedUserStore.ROLE_INVENTORY)
                && Arrays.asList("WAREHOUSE", "INVENTORY_ITEM",
                "STOCK_MOVEMENT").contains(type)) return true;
        if (roles.contains(QatraUnifiedUserStore.ROLE_HR)
                && Arrays.asList("EMPLOYEE", "ATTENDANCE",
                "LEAVE_REQUEST", "PAYROLL_RUN").contains(type)) return true;
        if (roles.contains(QatraUnifiedUserStore.ROLE_MAINTENANCE)
                && Arrays.asList("WORK_ORDER", "PREVENTIVE_PLAN",
                "FAILURE_REPORT").contains(type)) return true;
        return roles.contains(QatraUnifiedUserStore.ROLE_CASHIER)
                && Arrays.asList("PAYMENT", "CASHBOX_TRANSACTION",
                "DIRECT_PAYMENT").contains(type);
    }

    private void applyIncomingEntity(
            SQLiteDatabase db, String namespace, String entityType, String entityId,
            String action, String payloadJson, String payloadHash, long incomingVersion,
            String actorUserId) throws Exception {
        String currentJson = stateInTransaction(db, namespace);
        JSONObject root = currentJson == null || currentJson.trim().isEmpty()
                ? new JSONObject() : new JSONObject(currentJson);
        String arrayKey = syncArrayKey(namespace, entityType);
        JSONArray rows = root.optJSONArray(arrayKey);
        if (rows == null) rows = new JSONArray();
        int found = -1;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row != null && entityId.equals(syncEntityId(row, entityType))) {
                found = i;
                break;
            }
        }
        if ("DELETE".equals(action)) {
            if (found >= 0) rows.remove(found);
        } else {
            JSONObject incoming = new JSONObject(payloadJson);
            if (!payloadHash.equals(sha256(incoming.toString()))) {
                throw new SecurityException("بصمة السجل الوارد تغيرت أثناء المراجعة");
            }
            if (found >= 0) rows.put(found, incoming); else rows.put(incoming);
        }
        root.put(arrayKey, rows);
        saveStateInTransaction(db, namespace, root.toString(), "DEVICE_SYNC_IMPORTED");
        db.delete("qatra_sync_outbox",
                "namespace=? AND entity_type=? AND entity_id=? AND source='DEVICE_SYNC_IMPORTED'",
                new String[]{namespace, entityType, entityId});
        VersionState after = versionState(db, namespace, entityType, entityId);
        long resolvedVersion = Math.max(incomingVersion, after == null ? 1L : after.version);
        saveVersionState(db, namespace, entityType, entityId, resolvedVersion,
                payloadHash, "DELETE".equals(action), System.currentTimeMillis());
        audit(db, "DEVICE_SYNC_CHANGE_APPLIED",
                entityType + ":" + entityId + ":actor=" + safe(actorUserId));
    }

    private static String syncArrayKey(String namespace, String entityType) {
        if ("SUBSCRIBER".equals(entityType)) return "subscribers";
        if ("BILLING_CYCLE".equals(entityType)) return "cycles";
        if ("METER_READING".equals(entityType)) return "readings";
        if ("INVOICE".equals(entityType)) return "invoices";
        if ("PAYMENT".equals(entityType)) return "payments";
        if ("EXPENSE".equals(entityType)) return "expenses";
        if ("CASHBOX_TRANSACTION".equals(entityType)) return "cashboxTransactions";
        if ("DIRECT_PAYMENT".equals(entityType)) return "directPayments";
        if ("SUPPLIER".equals(entityType)) return "suppliers";
        if ("PURCHASE_REQUEST".equals(entityType)) return "purchaseRequests";
        if ("QUOTATION".equals(entityType)) return "quotations";
        if ("PURCHASE_ORDER".equals(entityType)) return "purchaseOrders";
        if ("GOODS_RECEIPT".equals(entityType)) return "goodsReceipts";
        if ("SUPPLIER_INVOICE".equals(entityType)) return "supplierInvoices";
        if ("WAREHOUSE".equals(entityType)) return "warehouses";
        if ("INVENTORY_ITEM".equals(entityType)) {
            return "enterprise.core".equals(namespace) ? "inventoryItems" : "items";
        }
        if ("STOCK_MOVEMENT".equals(entityType)) {
            return "enterprise.core".equals(namespace) ? "stockMovements" : "movements";
        }
        if ("ASSET".equals(entityType)) return "assets";
        if ("DEPRECIATION_RUN".equals(entityType)) return "depreciationRuns";
        if ("ASSET_TRANSFER".equals(entityType)) return "transfers";
        if ("EMPLOYEE".equals(entityType)) return "employees";
        if ("ATTENDANCE".equals(entityType)) return "attendance";
        if ("LEAVE_REQUEST".equals(entityType)) {
            return "enterprise.core".equals(namespace) ? "leaves" : "leaveRequests";
        }
        if ("PAYROLL_RUN".equals(entityType)) return "payrollRuns";
        if ("WORK_ORDER".equals(entityType)) return "workOrders";
        if ("PREVENTIVE_PLAN".equals(entityType)) return "preventivePlans";
        if ("FAILURE_REPORT".equals(entityType)) return "failures";
        throw new SecurityException("نوع السجل غير قابل للدمج في هذه المرحلة");
    }

    private static String syncEntityId(JSONObject row, String entityType) throws Exception {
        if ("SUBSCRIBER".equals(entityType)) return stableEntityId(
                row, entityType, "id", "subscriberId", "code", "subscriberCode", "meterNo");
        if ("BILLING_CYCLE".equals(entityType)) return stableEntityId(row, entityType, "id");
        if ("METER_READING".equals(entityType)) return stableEntityId(row, entityType, "id");
        if ("INVOICE".equals(entityType)) return stableEntityId(row, entityType, "id", "no");
        if ("PAYMENT".equals(entityType)) return stableEntityId(row, entityType, "id", "receiptNo");
        if ("EXPENSE".equals(entityType)) return stableEntityId(row, entityType, "id", "refNo");
        if ("CASHBOX_TRANSACTION".equals(entityType)) return stableEntityId(
                row, entityType, "id", "receiptNo");
        if ("DIRECT_PAYMENT".equals(entityType)) return stableEntityId(
                row, entityType, "id", "receiptNo");
        if ("SUPPLIER".equals(entityType)) return stableEntityId(
                row, entityType, "id", "supplierId", "supplierNo", "no", "code", "taxNo");
        if ("PURCHASE_REQUEST".equals(entityType)) return stableEntityId(
                row, entityType, "id", "requestId", "requestNo", "no");
        if ("QUOTATION".equals(entityType)) return stableEntityId(
                row, entityType, "id", "quotationId", "quotationNo", "no");
        if ("PURCHASE_ORDER".equals(entityType)) return stableEntityId(
                row, entityType, "id", "orderId", "orderNo", "no");
        if ("GOODS_RECEIPT".equals(entityType)) return stableEntityId(
                row, entityType, "id", "receiptId", "receiptNo", "no");
        if ("SUPPLIER_INVOICE".equals(entityType)) return stableEntityId(
                row, entityType, "id", "invoiceId", "invoiceNo", "no");
        if ("WAREHOUSE".equals(entityType)) return stableEntityId(
                row, entityType, "id", "warehouseId", "code", "warehouseCode");
        if ("INVENTORY_ITEM".equals(entityType)) return stableEntityId(
                row, entityType, "id", "itemId", "sku", "code");
        if ("STOCK_MOVEMENT".equals(entityType)) return stableEntityId(
                row, entityType, "id", "movementId", "movementNo", "no");
        if ("ASSET".equals(entityType)) return stableEntityId(
                row, entityType, "id", "assetId", "assetCode", "code", "no");
        if ("DEPRECIATION_RUN".equals(entityType)) return stableEntityId(
                row, entityType, "id", "runId", "no");
        if ("ASSET_TRANSFER".equals(entityType)) return stableEntityId(
                row, entityType, "id", "transferId", "no");
        if ("EMPLOYEE".equals(entityType)) return stableEntityId(
                row, entityType, "id", "employeeId", "employeeNo", "code", "no");
        if ("ATTENDANCE".equals(entityType)) return stableEntityId(
                row, entityType, "id", "attendanceId", "no");
        if ("LEAVE_REQUEST".equals(entityType)) return stableEntityId(
                row, entityType, "id", "leaveId", "no");
        if ("PAYROLL_RUN".equals(entityType)) return stableEntityId(
                row, entityType, "id", "runId", "no");
        if ("WORK_ORDER".equals(entityType)) return stableEntityId(
                row, entityType, "id", "workOrderId", "no");
        if ("PREVENTIVE_PLAN".equals(entityType)) return stableEntityId(
                row, entityType, "id", "planId", "no");
        if ("FAILURE_REPORT".equals(entityType)) return stableEntityId(
                row, entityType, "id", "failureId", "no");
        throw new SecurityException("نوع السجل غير مدعوم");
    }

    private static boolean knownSyncPackage(
            SQLiteDatabase db, String packageId, String operationId) {
        try (Cursor cursor = db.rawQuery(
                "SELECT 1 FROM sync_packages WHERE package_id=? OR operation_id=? LIMIT 1",
                new String[]{safe(packageId), safe(operationId)})) {
            return cursor.moveToFirst();
        }
    }

    private static String priorReceivedDisposition(
            SQLiteDatabase db, String sourceDeviceId, String sourceOperationId) {
        try (Cursor cursor = db.rawQuery(
                "SELECT i.disposition FROM erp_device_sync_received_items i " +
                        "JOIN erp_device_sync_received_packages p ON p.package_id=i.package_id " +
                        "WHERE p.source_device_id=? AND i.source_operation_id=? " +
                        "ORDER BY p.created_at DESC LIMIT 1",
                new String[]{sourceDeviceId, sourceOperationId})) {
            if (!cursor.moveToFirst()) return "";
            return cursor.isNull(0) ? "PENDING" : cursor.getString(0);
        }
    }

    private static boolean hasLocalPendingChange(
            SQLiteDatabase db, String namespace, String entityType, String entityId) {
        try (Cursor cursor = db.rawQuery(
                "SELECT 1 FROM qatra_sync_outbox WHERE namespace=? AND entity_type=? " +
                        "AND entity_id=? AND status IN('PENDING','FAILED') LIMIT 1",
                new String[]{namespace, entityType, entityId})) {
            return cursor.moveToFirst();
        }
    }

    private static int inboxCount(SQLiteDatabase db, String packageId, String status) {
        try (Cursor cursor = db.rawQuery(
                "SELECT COUNT(*) FROM erp_device_sync_inbox WHERE package_id=? AND status=?",
                new String[]{packageId, status})) {
            return cursor.moveToFirst() ? cursor.getInt(0) : 0;
        }
    }

    private static long latestSyncAt(SQLiteDatabase db, String direction) {
        try (Cursor cursor = db.rawQuery(
                "SELECT MAX(COALESCE(processed_at,created_at)) FROM sync_packages " +
                        "WHERE direction=? AND operation_type='DEVICE_CHANGESET'",
                new String[]{direction})) {
            return cursor.moveToFirst() && !cursor.isNull(0) ? cursor.getLong(0) : 0L;
        }
    }

    private static String syncPackageStatus(SQLiteDatabase db, String packageId) {
        try (Cursor cursor = db.rawQuery(
                "SELECT status FROM sync_packages WHERE package_id=? AND direction='IN' " +
                        "AND operation_type='DEVICE_CHANGESET' LIMIT 1",
                new String[]{safe(packageId)})) {
            if (!cursor.moveToFirst()) throw new SecurityException("حزمة المزامنة غير موجودة");
            return cursor.getString(0);
        }
    }

    private static void setSyncPackageStatus(
            SQLiteDatabase db, String packageId, String status, boolean processed) {
        ContentValues values = new ContentValues();
        values.put("status", status);
        if (processed) values.put("processed_at", System.currentTimeMillis());
        if (db.update("sync_packages", values, "package_id=?",
                new String[]{safe(packageId)}) != 1) {
            throw new IllegalStateException("تعذر تحديث حالة حزمة المزامنة");
        }
    }

    private static ContentValues reviewValues(
            String status, String actorUserId, String notes) {
        ContentValues values = new ContentValues();
        values.put("status", status);
        values.put("reviewed_by", safe(actorUserId));
        values.put("reviewed_at", System.currentTimeMillis());
        values.put("review_notes", notes == null ? "" : notes.trim());
        return values;
    }

    private static void validateDeviceId(String deviceId) {
        if (deviceId == null || !deviceId.matches("DEV-[0-9a-fA-F-]{36}")) {
            throw new SecurityException("معرّف جهاز المزامنة غير صالح");
        }
    }

    private void saveStateInTransaction(
            SQLiteDatabase db, String namespace, String payloadJson, String syncStatus) throws Exception {
        JSONObject root = new JSONObject(payloadJson);
        long now = System.currentTimeMillis();
        ContentValues state = new ContentValues();
        state.put("namespace", namespace);
        state.put("payload_json", root.toString());
        state.put("updated_at", now);
        db.insertWithOnConflict("app_state", null, state, SQLiteDatabase.CONFLICT_REPLACE);

        db.delete("records", "namespace=?", new String[]{namespace});
        JSONArray names = root.names();
        if (names != null) {
            for (int i = 0; i < names.length(); i++) {
                String entityType = names.optString(i, "");
                if (!INDEXED_ARRAYS.contains(entityType)) continue;
                JSONArray rows = root.optJSONArray(entityType);
                if (rows == null) continue;
                for (int j = 0; j < rows.length(); j++) {
                    JSONObject row = rows.optJSONObject(j);
                    if (row == null) continue;
                    String entityId = chooseId(row, entityType, j);
                    ContentValues record = new ContentValues();
                    record.put("namespace", namespace);
                    record.put("entity_type", entityType);
                    record.put("entity_id", entityId);
                    record.put("payload_json", row.toString());
                    record.put("updated_at", now);
                    record.put("sync_status", syncStatus);
                    db.insertWithOnConflict("records", null, record, SQLiteDatabase.CONFLICT_REPLACE);
                }
            }
        }
        projectRelationalState(db, namespace, root, syncStatus, now);
    }

    /**
     * Row-level changes prepared for the future accounting-system connector. The caller sends
     * them in local_sequence order and acknowledges only operation ids accepted by the server.
     */
    public synchronized JSONArray pendingAccountingChanges(int requestedLimit) throws Exception {
        int limit = Math.max(1, Math.min(requestedLimit, 500));
        JSONArray rows = new JSONArray();
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT local_sequence,operation_id,namespace,entity_type,entity_id,action," +
                        "payload_json,payload_hash,entity_version,source,created_at FROM qatra_sync_outbox " +
                        "WHERE status IN('PENDING','FAILED') ORDER BY local_sequence LIMIT ?",
                new String[]{String.valueOf(limit)})) {
            while (c.moveToNext()) {
                JSONObject row = new JSONObject();
                row.put("localSequence", c.getLong(0));
                row.put("operationId", c.getString(1));
                row.put("namespace", c.getString(2));
                row.put("entityType", c.getString(3));
                row.put("entityId", c.getString(4));
                row.put("action", c.getString(5));
                row.put("payload", new JSONObject(c.getString(6)));
                row.put("payloadHash", c.getString(7));
                row.put("entityVersion", c.getLong(8));
                row.put("source", c.getString(9));
                row.put("createdAt", c.getLong(10));
                rows.put(row);
            }
        }
        return rows;
    }

    public synchronized int acknowledgeAccountingChanges(JSONArray operationIds) {
        if (operationIds == null || operationIds.length() == 0) return 0;
        SQLiteDatabase db = getWritableDatabase();
        int acknowledged = 0;
        db.beginTransaction();
        try {
            for (int i = 0; i < operationIds.length(); i++) {
                String id = operationIds.optString(i, "").trim();
                if (id.isEmpty()) continue;
                ContentValues values = new ContentValues();
                values.put("status", "ACKNOWLEDGED");
                values.put("acknowledged_at", System.currentTimeMillis());
                acknowledged += db.update("qatra_sync_outbox", values,
                        "operation_id=? AND status IN('PENDING','FAILED')", new String[]{id});
            }
            db.execSQL("DELETE FROM qatra_sync_outbox WHERE status='ACKNOWLEDGED' AND local_sequence NOT IN " +
                    "(SELECT local_sequence FROM qatra_sync_outbox WHERE status='ACKNOWLEDGED' " +
                    "ORDER BY local_sequence DESC LIMIT 5000)");
            audit(db, "ACCOUNTING_CHANGES_ACKNOWLEDGED", String.valueOf(acknowledged));
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        return acknowledged;
    }

    private JSONObject exportRelationalSyncState(java.util.List<String> namespaces) throws Exception {
        SQLiteDatabase db = getReadableDatabase();
        JSONObject result = new JSONObject();
        result.put("version", 1);
        JSONArray versions = new JSONArray();
        JSONArray outbox = new JSONArray();
        for (String namespace : namespaces) {
            try (Cursor c = db.rawQuery(
                    "SELECT entity_type,entity_id,entity_version,payload_hash,is_deleted,updated_at " +
                            "FROM qatra_entity_versions WHERE namespace=?",
                    new String[]{namespace})) {
                while (c.moveToNext()) {
                    JSONObject row = new JSONObject();
                    row.put("namespace", namespace);
                    row.put("entityType", c.getString(0));
                    row.put("entityId", c.getString(1));
                    row.put("entityVersion", c.getLong(2));
                    row.put("payloadHash", c.getString(3));
                    row.put("deleted", c.getInt(4) != 0);
                    row.put("updatedAt", c.getLong(5));
                    versions.put(row);
                }
            }
            try (Cursor c = db.rawQuery(
                    "SELECT operation_id,entity_type,entity_id,action,payload_json,payload_hash," +
                            "entity_version,source,created_at FROM qatra_sync_outbox " +
                            "WHERE namespace=? AND status IN('PENDING','FAILED') ORDER BY local_sequence",
                    new String[]{namespace})) {
                while (c.moveToNext()) {
                    JSONObject row = new JSONObject();
                    row.put("operationId", c.getString(0));
                    row.put("namespace", namespace);
                    row.put("entityType", c.getString(1));
                    row.put("entityId", c.getString(2));
                    row.put("action", c.getString(3));
                    row.put("payload", new JSONObject(c.getString(4)));
                    row.put("payloadHash", c.getString(5));
                    row.put("entityVersion", c.getLong(6));
                    row.put("source", c.getString(7));
                    row.put("createdAt", c.getLong(8));
                    outbox.put(row);
                }
            }
        }
        result.put("entityVersions", versions);
        result.put("pendingChanges", outbox);
        return result;
    }

    private static void restoreRelationalSyncState(
            SQLiteDatabase db, JSONObject sync, Set<String> allowedNamespaces) throws Exception {
        if (sync.optInt("version", 0) != 1) {
            throw new SecurityException("إصدار بيانات المزامنة في النسخة الاحتياطية غير مدعوم");
        }
        JSONArray versions = sync.optJSONArray("entityVersions");
        JSONArray pending = sync.optJSONArray("pendingChanges");
        if (versions == null || pending == null) {
            throw new SecurityException("بيانات المزامنة في النسخة الاحتياطية ناقصة");
        }

        for (int i = 0; i < versions.length(); i++) {
            JSONObject row = versions.optJSONObject(i);
            if (row == null) throw new SecurityException("سجل إصدار غير صالح في النسخة الاحتياطية");
            String namespace = row.optString("namespace", "");
            String entityType = row.optString("entityType", "");
            String entityId = row.optString("entityId", "");
            long version = row.optLong("entityVersion", 0L);
            String hash = row.optString("payloadHash", "");
            validateRestoredSyncIdentity(allowedNamespaces, namespace, entityType, entityId, version, hash);
            VersionState current = versionState(db, namespace, entityType, entityId);
            if (current == null || version > current.version) {
                saveVersionState(db, namespace, entityType, entityId, version, hash,
                        row.optBoolean("deleted", false),
                        Math.max(0L, row.optLong("updatedAt", System.currentTimeMillis())));
            }
        }

        for (int i = 0; i < pending.length(); i++) {
            JSONObject row = pending.optJSONObject(i);
            if (row == null) throw new SecurityException("حركة مزامنة غير صالحة في النسخة الاحتياطية");
            String operationId = row.optString("operationId", "");
            try { UUID.fromString(operationId); }
            catch (Exception e) { throw new SecurityException("معرّف حركة المزامنة غير صالح"); }
            String namespace = row.optString("namespace", "");
            String entityType = row.optString("entityType", "");
            String entityId = row.optString("entityId", "");
            String action = row.optString("action", "");
            long version = row.optLong("entityVersion", 0L);
            String hash = row.optString("payloadHash", "");
            validateRestoredSyncIdentity(allowedNamespaces, namespace, entityType, entityId, version, hash);
            if (!"UPSERT".equals(action) && !"DELETE".equals(action)) {
                throw new SecurityException("نوع حركة المزامنة غير صالح");
            }
            JSONObject payload = row.optJSONObject("payload");
            if (payload == null || !hash.equals(sha256(payload.toString()))) {
                throw new SecurityException("بصمة حركة المزامنة لا تطابق محتواها");
            }
            VersionState current = versionState(db, namespace, entityType, entityId);
            if (current != null && (version < current.version
                    || (version == current.version && !hash.equals(current.payloadHash)))) continue;

            ContentValues change = new ContentValues();
            change.put("operation_id", operationId);
            change.put("namespace", namespace);
            change.put("entity_type", entityType);
            change.put("entity_id", entityId);
            change.put("action", action);
            change.put("payload_json", payload.toString());
            change.put("payload_hash", hash);
            change.put("entity_version", version);
            change.put("source", row.optString("source", "BACKUP_RESTORED"));
            change.put("status", "PENDING");
            change.put("created_at", Math.max(0L, row.optLong("createdAt", System.currentTimeMillis())));
            db.insertWithOnConflict(
                    "qatra_sync_outbox", null, change, SQLiteDatabase.CONFLICT_IGNORE);
        }
    }

    private static void validateRestoredSyncIdentity(
            Set<String> allowedNamespaces, String namespace, String entityType,
            String entityId, long version, String payloadHash) {
        validateNamespace(namespace);
        if (!allowedNamespaces.contains(namespace)
                || entityType == null || !entityType.matches("[A-Z_]{2,64}")
                || entityId == null || entityId.isEmpty() || entityId.length() > 256
                || version <= 0L
                || payloadHash == null || !payloadHash.matches("[a-f0-9]{64}")) {
            throw new SecurityException("هوية سجل المزامنة في النسخة الاحتياطية غير صالحة");
        }
    }

    private static void createRelationalSchema(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS qatra_profiles(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "project_name TEXT NOT NULL DEFAULT '',owner_name TEXT NOT NULL DEFAULT ''," +
                "account_no TEXT NOT NULL DEFAULT '',currency TEXT NOT NULL DEFAULT ''," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS qatra_staff_users(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "username TEXT NOT NULL DEFAULT '',display_name TEXT NOT NULL DEFAULT ''," +
                "role TEXT NOT NULL DEFAULT '',employee_code TEXT NOT NULL DEFAULT ''," +
                "active INTEGER NOT NULL DEFAULT 1," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS qatra_subscribers(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "subscriber_code TEXT NOT NULL DEFAULT '',meter_no TEXT NOT NULL DEFAULT ''," +
                "full_name TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT ''," +
                "area TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT ''," +
                "reading_group TEXT NOT NULL DEFAULT '',opening_reading REAL NOT NULL DEFAULT 0," +
                "opening_arrears REAL NOT NULL DEFAULT 0,opening_credit REAL NOT NULL DEFAULT 0," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS qatra_billing_cycles(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "cycle_date TEXT NOT NULL DEFAULT '',cycle_type TEXT NOT NULL DEFAULT ''," +
                "status TEXT NOT NULL DEFAULT '',main_previous REAL NOT NULL DEFAULT 0," +
                "main_current REAL NOT NULL DEFAULT 0,closed_at TEXT NOT NULL DEFAULT ''," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS qatra_meter_readings(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "cycle_id TEXT NOT NULL DEFAULT '',subscriber_id TEXT NOT NULL DEFAULT ''," +
                "previous_reading REAL NOT NULL DEFAULT 0,current_reading REAL NOT NULL DEFAULT 0," +
                "consumption REAL NOT NULL DEFAULT 0,reader_id TEXT NOT NULL DEFAULT ''," +
                "assignment_id TEXT NOT NULL DEFAULT '',meter_changed INTEGER NOT NULL DEFAULT 0," +
                "has_attachment INTEGER NOT NULL DEFAULT 0," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS qatra_invoices(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "invoice_no TEXT NOT NULL DEFAULT '',cycle_id TEXT NOT NULL DEFAULT ''," +
                "subscriber_id TEXT NOT NULL DEFAULT '',invoice_date TEXT NOT NULL DEFAULT ''," +
                "amount REAL NOT NULL DEFAULT 0,paid_amount REAL NOT NULL DEFAULT 0," +
                "remaining_amount REAL NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT ''," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS qatra_payments(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "receipt_no TEXT NOT NULL DEFAULT '',subscriber_id TEXT NOT NULL DEFAULT ''," +
                "invoice_id TEXT NOT NULL DEFAULT '',payment_date TEXT NOT NULL DEFAULT ''," +
                "amount REAL NOT NULL DEFAULT 0,method TEXT NOT NULL DEFAULT ''," +
                "collector_id TEXT NOT NULL DEFAULT '',income_type TEXT NOT NULL DEFAULT ''," +
                "confirmed INTEGER NOT NULL DEFAULT 1,has_attachment INTEGER NOT NULL DEFAULT 0," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS qatra_expenses(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "expense_date TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT ''," +
                "description TEXT NOT NULL DEFAULT '',amount REAL NOT NULL DEFAULT 0," +
                "payee TEXT NOT NULL DEFAULT '',reference_no TEXT NOT NULL DEFAULT ''," +
                "payment_account TEXT NOT NULL DEFAULT '',cost_center TEXT NOT NULL DEFAULT ''," +
                "has_attachment INTEGER NOT NULL DEFAULT 0," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS qatra_cashbox_transactions(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "receipt_no TEXT NOT NULL DEFAULT '',transaction_date TEXT NOT NULL DEFAULT ''," +
                "transaction_type TEXT NOT NULL DEFAULT '',method TEXT NOT NULL DEFAULT ''," +
                "amount REAL NOT NULL DEFAULT 0,party TEXT NOT NULL DEFAULT ''," +
                "reference_no TEXT NOT NULL DEFAULT '',cashier_code TEXT NOT NULL DEFAULT ''," +
                "has_attachment INTEGER NOT NULL DEFAULT 0," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS qatra_direct_payments(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "receipt_no TEXT NOT NULL DEFAULT '',subscriber_id TEXT NOT NULL DEFAULT ''," +
                "subscriber_code TEXT NOT NULL DEFAULT '',meter_no TEXT NOT NULL DEFAULT ''," +
                "payment_date TEXT NOT NULL DEFAULT '',amount REAL NOT NULL DEFAULT 0," +
                "income_type TEXT NOT NULL DEFAULT '',method TEXT NOT NULL DEFAULT ''," +
                "cashier_code TEXT NOT NULL DEFAULT '',has_attachment INTEGER NOT NULL DEFAULT 0," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");

        db.execSQL("CREATE TABLE IF NOT EXISTS qatra_entity_versions(" +
                "namespace TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "entity_version INTEGER NOT NULL,payload_hash TEXT NOT NULL," +
                "is_deleted INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL," +
                "PRIMARY KEY(namespace,entity_type,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS qatra_sync_outbox(" +
                "local_sequence INTEGER PRIMARY KEY AUTOINCREMENT," +
                "operation_id TEXT NOT NULL UNIQUE,namespace TEXT NOT NULL," +
                "entity_type TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "action TEXT NOT NULL CHECK(action IN('UPSERT','DELETE'))," +
                "payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL," +
                "entity_version INTEGER NOT NULL,source TEXT NOT NULL," +
                "status TEXT NOT NULL DEFAULT 'PENDING' " +
                "CHECK(status IN('PENDING','FAILED','ACKNOWLEDGED'))," +
                "created_at INTEGER NOT NULL,acknowledged_at INTEGER," +
                "last_error TEXT NOT NULL DEFAULT ''," +
                "UNIQUE(namespace,entity_type,entity_id,entity_version,action))");

        db.execSQL("CREATE INDEX IF NOT EXISTS ix_qatra_subscriber_code " +
                "ON qatra_subscribers(namespace,subscriber_code)");
        db.execSQL("CREATE INDEX IF NOT EXISTS ix_qatra_meter_no " +
                "ON qatra_subscribers(namespace,meter_no)");
        db.execSQL("CREATE INDEX IF NOT EXISTS ix_qatra_cycles_date " +
                "ON qatra_billing_cycles(namespace,cycle_date)");
        db.execSQL("CREATE INDEX IF NOT EXISTS ix_qatra_readings_relation " +
                "ON qatra_meter_readings(namespace,cycle_id,subscriber_id)");
        db.execSQL("CREATE INDEX IF NOT EXISTS ix_qatra_invoices_relation " +
                "ON qatra_invoices(namespace,subscriber_id,invoice_date)");
        db.execSQL("CREATE INDEX IF NOT EXISTS ix_qatra_payments_relation " +
                "ON qatra_payments(namespace,subscriber_id,payment_date)");
        db.execSQL("CREATE INDEX IF NOT EXISTS ix_qatra_expenses_date " +
                "ON qatra_expenses(namespace,expense_date)");
        db.execSQL("CREATE INDEX IF NOT EXISTS ix_qatra_cashbox_date " +
                "ON qatra_cashbox_transactions(namespace,transaction_date)");
        db.execSQL("CREATE INDEX IF NOT EXISTS ix_qatra_outbox_pending " +
                "ON qatra_sync_outbox(status,local_sequence)");
    }

    private static void createEnterpriseRelationalSchema(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_suppliers(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "supplier_no TEXT NOT NULL DEFAULT '',name TEXT NOT NULL DEFAULT ''," +
                "tax_no TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT ''," +
                "email TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT ''," +
                "status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_purchase_requests(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "request_no TEXT NOT NULL DEFAULT '',requester TEXT NOT NULL DEFAULT ''," +
                "department TEXT NOT NULL DEFAULT '',needed_by TEXT NOT NULL DEFAULT ''," +
                "estimated_amount REAL NOT NULL DEFAULT 0,description TEXT NOT NULL DEFAULT ''," +
                "status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_purchase_request_lines(" +
                "namespace TEXT NOT NULL,request_id TEXT NOT NULL,line_no INTEGER NOT NULL," +
                "item_ref TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT ''," +
                "unit TEXT NOT NULL DEFAULT '',quantity REAL NOT NULL CHECK(quantity>0)," +
                "unit_cost REAL NOT NULL DEFAULT 0 CHECK(unit_cost>=0)," +
                "line_total REAL NOT NULL DEFAULT 0 CHECK(line_total>=0)," +
                "PRIMARY KEY(namespace,request_id,line_no)," +
                "FOREIGN KEY(namespace,request_id) REFERENCES erp_purchase_requests(" +
                "namespace,entity_id) ON DELETE CASCADE)");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_quotations(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "quotation_no TEXT NOT NULL DEFAULT '',request_ref TEXT," +
                "supplier_ref TEXT,amount REAL NOT NULL DEFAULT 0," +
                "valid_until TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_purchase_orders(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "order_no TEXT NOT NULL DEFAULT '',request_ref TEXT,supplier_ref TEXT," +
                "order_date TEXT NOT NULL DEFAULT '',delivery_date TEXT NOT NULL DEFAULT ''," +
                "amount REAL NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_purchase_order_lines(" +
                "namespace TEXT NOT NULL,order_id TEXT NOT NULL,line_no INTEGER NOT NULL," +
                "item_ref TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT ''," +
                "unit TEXT NOT NULL DEFAULT '',quantity REAL NOT NULL CHECK(quantity>0)," +
                "unit_cost REAL NOT NULL DEFAULT 0 CHECK(unit_cost>=0)," +
                "line_total REAL NOT NULL DEFAULT 0 CHECK(line_total>=0)," +
                "PRIMARY KEY(namespace,order_id,line_no)," +
                "FOREIGN KEY(namespace,order_id) REFERENCES erp_purchase_orders(" +
                "namespace,entity_id) ON DELETE CASCADE)");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_goods_receipts(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "receipt_no TEXT NOT NULL DEFAULT '',purchase_order_ref TEXT," +
                "warehouse_ref TEXT,receipt_date TEXT NOT NULL DEFAULT ''," +
                "received_by TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_goods_receipt_lines(" +
                "namespace TEXT NOT NULL,receipt_id TEXT NOT NULL,line_no INTEGER NOT NULL," +
                "item_ref TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT ''," +
                "unit TEXT NOT NULL DEFAULT '',quantity REAL NOT NULL CHECK(quantity>0)," +
                "unit_cost REAL NOT NULL DEFAULT 0 CHECK(unit_cost>=0)," +
                "line_total REAL NOT NULL DEFAULT 0 CHECK(line_total>=0)," +
                "PRIMARY KEY(namespace,receipt_id,line_no)," +
                "FOREIGN KEY(namespace,receipt_id) REFERENCES erp_goods_receipts(" +
                "namespace,entity_id) ON DELETE CASCADE)");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_supplier_invoices(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "invoice_no TEXT NOT NULL DEFAULT '',supplier_ref TEXT," +
                "purchase_order_ref TEXT,invoice_date TEXT NOT NULL DEFAULT ''," +
                "due_date TEXT NOT NULL DEFAULT '',amount REAL NOT NULL DEFAULT 0," +
                "status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_warehouses(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "warehouse_code TEXT NOT NULL DEFAULT '',name TEXT NOT NULL DEFAULT ''," +
                "location TEXT NOT NULL DEFAULT '',keeper TEXT NOT NULL DEFAULT ''," +
                "status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_inventory_items(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "sku TEXT NOT NULL DEFAULT '',name TEXT NOT NULL DEFAULT ''," +
                "unit TEXT NOT NULL DEFAULT '',minimum_qty REAL NOT NULL DEFAULT 0," +
                "average_cost REAL NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_stock_movements(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "movement_no TEXT NOT NULL DEFAULT '',item_id TEXT,warehouse_id TEXT," +
                "movement_type TEXT NOT NULL DEFAULT '',quantity REAL NOT NULL CHECK(quantity>=0)," +
                "unit_cost REAL NOT NULL DEFAULT 0 CHECK(unit_cost>=0)," +
                "total_cost REAL NOT NULL DEFAULT 0 CHECK(total_cost>=0)," +
                "movement_date TEXT NOT NULL DEFAULT '',reference_no TEXT NOT NULL DEFAULT ''," +
                "status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id)," +
                "FOREIGN KEY(namespace,item_id) REFERENCES erp_inventory_items(" +
                "namespace,entity_id) ON DELETE RESTRICT," +
                "FOREIGN KEY(namespace,warehouse_id) REFERENCES erp_warehouses(" +
                "namespace,entity_id) ON DELETE RESTRICT)");

        createUniqueIndex(db, "uq_erp_supplier_no",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_supplier_no " +
                        "ON erp_suppliers(namespace,supplier_no COLLATE NOCASE) " +
                        "WHERE supplier_no<>''");
        createUniqueIndex(db, "uq_erp_supplier_tax_no",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_supplier_tax_no " +
                        "ON erp_suppliers(namespace,tax_no COLLATE NOCASE) WHERE tax_no<>''");
        createUniqueIndex(db, "uq_erp_purchase_request_no",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_purchase_request_no " +
                        "ON erp_purchase_requests(namespace,request_no COLLATE NOCASE) " +
                        "WHERE request_no<>''");
        createUniqueIndex(db, "uq_erp_purchase_order_no",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_purchase_order_no " +
                        "ON erp_purchase_orders(namespace,order_no COLLATE NOCASE) " +
                        "WHERE order_no<>''");
        createUniqueIndex(db, "uq_erp_goods_receipt_no",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_goods_receipt_no " +
                        "ON erp_goods_receipts(namespace,receipt_no COLLATE NOCASE) " +
                        "WHERE receipt_no<>''");
        createUniqueIndex(db, "uq_erp_supplier_invoice_no",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_supplier_invoice_no " +
                        "ON erp_supplier_invoices(namespace,invoice_no COLLATE NOCASE) " +
                        "WHERE invoice_no<>''");
        createUniqueIndex(db, "uq_erp_warehouse_code",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_warehouse_code " +
                        "ON erp_warehouses(namespace,warehouse_code COLLATE NOCASE) " +
                        "WHERE warehouse_code<>''");
        createUniqueIndex(db, "uq_erp_inventory_sku",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_inventory_sku " +
                        "ON erp_inventory_items(namespace,sku COLLATE NOCASE) WHERE sku<>''");
        db.execSQL("CREATE INDEX IF NOT EXISTS ix_erp_stock_item_warehouse " +
                "ON erp_stock_movements(namespace,item_id,warehouse_id,movement_date)");
    }

    private static void backfillEnterpriseRelationalState(SQLiteDatabase db) throws Exception {
        try (Cursor cursor = db.rawQuery(
                "SELECT namespace,payload_json,updated_at FROM app_state " +
                        "WHERE namespace IN('erp.procurement','erp.inventory','enterprise.core')",
                null)) {
            while (cursor.moveToNext()) {
                projectRelationalState(db, cursor.getString(0),
                        new JSONObject(cursor.getString(1)), "ERP_SCHEMA_MIGRATION",
                        cursor.getLong(2));
            }
        }
    }

    private static void createWorkforceRelationalSchema(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_assets(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "asset_code TEXT NOT NULL DEFAULT '',name TEXT NOT NULL DEFAULT ''," +
                "category TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT ''," +
                "custodian TEXT NOT NULL DEFAULT '',purchase_date TEXT NOT NULL DEFAULT ''," +
                "cost REAL NOT NULL DEFAULT 0 CHECK(cost>=0)," +
                "residual_value REAL NOT NULL DEFAULT 0 CHECK(residual_value>=0)," +
                "useful_life_years REAL NOT NULL DEFAULT 0 CHECK(useful_life_years>=0)," +
                "status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_depreciation_runs(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "run_no TEXT NOT NULL DEFAULT '',period TEXT NOT NULL DEFAULT ''," +
                "asset_id TEXT,opening_value REAL NOT NULL DEFAULT 0 CHECK(opening_value>=0)," +
                "depreciation REAL NOT NULL DEFAULT 0 CHECK(depreciation>=0)," +
                "closing_value REAL NOT NULL DEFAULT 0 CHECK(closing_value>=0)," +
                "status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id)," +
                "FOREIGN KEY(namespace,asset_id) REFERENCES erp_assets(" +
                "namespace,entity_id) ON DELETE RESTRICT)");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_asset_transfers(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "transfer_no TEXT NOT NULL DEFAULT '',asset_id TEXT," +
                "from_location TEXT NOT NULL DEFAULT '',to_location TEXT NOT NULL DEFAULT ''," +
                "custodian TEXT NOT NULL DEFAULT '',transfer_date TEXT NOT NULL DEFAULT ''," +
                "status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id)," +
                "FOREIGN KEY(namespace,asset_id) REFERENCES erp_assets(" +
                "namespace,entity_id) ON DELETE RESTRICT)");

        db.execSQL("CREATE TABLE IF NOT EXISTS erp_employees(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "employee_no TEXT NOT NULL DEFAULT '',name TEXT NOT NULL DEFAULT ''," +
                "department TEXT NOT NULL DEFAULT '',job_title TEXT NOT NULL DEFAULT ''," +
                "hire_date TEXT NOT NULL DEFAULT '',basic_salary REAL NOT NULL DEFAULT 0 " +
                "CHECK(basic_salary>=0),active INTEGER NOT NULL DEFAULT 1," +
                "status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_attendance(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "attendance_no TEXT NOT NULL DEFAULT '',employee_id TEXT," +
                "attendance_date TEXT NOT NULL DEFAULT '',check_in TEXT NOT NULL DEFAULT ''," +
                "check_out TEXT NOT NULL DEFAULT '',attendance_status TEXT NOT NULL DEFAULT ''," +
                "status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id)," +
                "FOREIGN KEY(namespace,employee_id) REFERENCES erp_employees(" +
                "namespace,entity_id) ON DELETE RESTRICT)");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_leave_requests(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "leave_no TEXT NOT NULL DEFAULT '',employee_id TEXT," +
                "leave_type TEXT NOT NULL DEFAULT '',start_date TEXT NOT NULL DEFAULT ''," +
                "end_date TEXT NOT NULL DEFAULT '',reason TEXT NOT NULL DEFAULT ''," +
                "status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id)," +
                "FOREIGN KEY(namespace,employee_id) REFERENCES erp_employees(" +
                "namespace,entity_id) ON DELETE RESTRICT)");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_payroll_runs(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "run_no TEXT NOT NULL DEFAULT '',period TEXT NOT NULL DEFAULT ''," +
                "department TEXT NOT NULL DEFAULT '',gross REAL NOT NULL DEFAULT 0 CHECK(gross>=0)," +
                "deductions REAL NOT NULL DEFAULT 0 CHECK(deductions>=0)," +
                "net REAL NOT NULL DEFAULT 0 CHECK(net>=0),status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_payroll_lines(" +
                "namespace TEXT NOT NULL,run_id TEXT NOT NULL,line_no INTEGER NOT NULL," +
                "employee_id TEXT NOT NULL,basic_salary REAL NOT NULL DEFAULT 0 CHECK(basic_salary>=0)," +
                "allowances REAL NOT NULL DEFAULT 0 CHECK(allowances>=0)," +
                "deductions REAL NOT NULL DEFAULT 0 CHECK(deductions>=0)," +
                "net REAL NOT NULL DEFAULT 0 CHECK(net>=0)," +
                "PRIMARY KEY(namespace,run_id,line_no)," +
                "FOREIGN KEY(namespace,run_id) REFERENCES erp_payroll_runs(" +
                "namespace,entity_id) ON DELETE CASCADE," +
                "FOREIGN KEY(namespace,employee_id) REFERENCES erp_employees(" +
                "namespace,entity_id) ON DELETE RESTRICT)");

        db.execSQL("CREATE TABLE IF NOT EXISTS erp_work_orders(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "order_no TEXT NOT NULL DEFAULT '',title TEXT NOT NULL DEFAULT ''," +
                "asset_ref TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT ''," +
                "priority TEXT NOT NULL DEFAULT '',assigned_to TEXT NOT NULL DEFAULT ''," +
                "estimated_cost REAL NOT NULL DEFAULT 0 CHECK(estimated_cost>=0)," +
                "actual_cost REAL NOT NULL DEFAULT 0 CHECK(actual_cost>=0)," +
                "opened_date TEXT NOT NULL DEFAULT '',closed_date TEXT NOT NULL DEFAULT ''," +
                "status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_work_order_parts(" +
                "namespace TEXT NOT NULL,work_order_id TEXT NOT NULL,line_no INTEGER NOT NULL," +
                "item_ref TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT ''," +
                "unit TEXT NOT NULL DEFAULT '',quantity REAL NOT NULL CHECK(quantity>0)," +
                "unit_cost REAL NOT NULL DEFAULT 0 CHECK(unit_cost>=0)," +
                "line_total REAL NOT NULL DEFAULT 0 CHECK(line_total>=0)," +
                "PRIMARY KEY(namespace,work_order_id,line_no)," +
                "FOREIGN KEY(namespace,work_order_id) REFERENCES erp_work_orders(" +
                "namespace,entity_id) ON DELETE CASCADE)");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_preventive_plans(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "plan_no TEXT NOT NULL DEFAULT '',asset_ref TEXT NOT NULL DEFAULT ''," +
                "frequency TEXT NOT NULL DEFAULT '',next_date TEXT NOT NULL DEFAULT ''," +
                "responsible TEXT NOT NULL DEFAULT '',checklist TEXT NOT NULL DEFAULT ''," +
                "status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_failure_reports(" +
                "namespace TEXT NOT NULL,entity_id TEXT NOT NULL," +
                "failure_no TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT ''," +
                "reported_by TEXT NOT NULL DEFAULT '',reported_at TEXT NOT NULL DEFAULT ''," +
                "severity TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT ''," +
                "status TEXT NOT NULL DEFAULT 'DRAFT'," +
                commonProjectionColumns() + ",PRIMARY KEY(namespace,entity_id))");

        createUniqueIndex(db, "uq_erp_asset_code",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_asset_code " +
                        "ON erp_assets(namespace,asset_code COLLATE NOCASE) WHERE asset_code<>''");
        createUniqueIndex(db, "uq_erp_employee_no",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_employee_no " +
                        "ON erp_employees(namespace,employee_no COLLATE NOCASE) WHERE employee_no<>''");
        createUniqueIndex(db, "uq_erp_attendance_day",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_attendance_day " +
                        "ON erp_attendance(namespace,employee_id,attendance_date) " +
                        "WHERE employee_id IS NOT NULL AND attendance_date<>''");
        createUniqueIndex(db, "uq_erp_payroll_period_department",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_payroll_period_department " +
                        "ON erp_payroll_runs(namespace,period,department COLLATE NOCASE) " +
                        "WHERE period<>''");
        createUniqueIndex(db, "uq_erp_work_order_no",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_work_order_no " +
                        "ON erp_work_orders(namespace,order_no COLLATE NOCASE) WHERE order_no<>''");
    }

    private static void backfillWorkforceRelationalState(SQLiteDatabase db) throws Exception {
        try (Cursor cursor = db.rawQuery(
                "SELECT namespace,payload_json,updated_at FROM app_state WHERE namespace IN(" +
                        "'erp.assets','erp.hr','erp.maintenance','enterprise.core')", null)) {
            while (cursor.moveToNext()) {
                projectRelationalState(db, cursor.getString(0),
                        new JSONObject(cursor.getString(1)), "ERP_WORKFORCE_MIGRATION",
                        cursor.getLong(2));
            }
        }
    }

    private static void createRecoverySchema(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS erp_recovery_snapshots (" +
                "snapshot_id TEXT PRIMARY KEY NOT NULL," +
                "role TEXT NOT NULL," +
                "reason TEXT NOT NULL," +
                "payload_json TEXT NOT NULL," +
                "status TEXT NOT NULL DEFAULT 'AVAILABLE'," +
                "created_at INTEGER NOT NULL," +
                "rolled_back_at INTEGER," +
                "rolled_back_by TEXT)");
        db.execSQL("CREATE INDEX IF NOT EXISTS ix_erp_recovery_role " +
                "ON erp_recovery_snapshots(role,created_at)");
    }

    private void captureRecoverySnapshotInTransaction(
            SQLiteDatabase db, String role, String reason) throws Exception {
        java.util.List<String> portable = portableNamespacesForRole(role);
        JSONObject namespaces = new JSONObject();
        for (String namespace : portable) {
            String existing = stateInTransaction(db, namespace);
            namespaces.put(namespace, existing == null || existing.trim().isEmpty()
                    ? new JSONObject() : new JSONObject(existing));
        }
        JSONObject snapshot = new JSONObject();
        snapshot.put("role", role);
        snapshot.put("capturedAt", System.currentTimeMillis());
        snapshot.put("namespaces", namespaces);
        snapshot.put("relationalSync", exportRelationalSyncState(portable));
        ContentValues superseded = new ContentValues();
        superseded.put("status", "SUPERSEDED");
        db.update("erp_recovery_snapshots", superseded,
                "role=? AND status='AVAILABLE'", new String[]{role});
        ContentValues row = new ContentValues();
        String snapshotId = "RS-" + UUID.randomUUID();
        row.put("snapshot_id", snapshotId);
        row.put("role", role);
        row.put("reason", safe(reason));
        row.put("payload_json", snapshot.toString());
        row.put("status", "AVAILABLE");
        row.put("created_at", System.currentTimeMillis());
        db.insertOrThrow("erp_recovery_snapshots", null, row);
        db.execSQL("DELETE FROM erp_recovery_snapshots WHERE snapshot_id NOT IN " +
                "(SELECT snapshot_id FROM erp_recovery_snapshots " +
                "WHERE role=? ORDER BY created_at DESC LIMIT 3)",
                new Object[]{role});
        audit(db, "RECOVERY_SNAPSHOT_CREATED", role + ":" + snapshotId);
    }

    private static long latestAuditAt(SQLiteDatabase db, String eventType) {
        try (Cursor c = db.rawQuery(
                "SELECT created_at FROM audit_log WHERE event_type=? " +
                        "ORDER BY created_at DESC LIMIT 1",
                new String[]{eventType})) {
            return c.moveToFirst() ? c.getLong(0) : 0L;
        }
    }

    private static void createBusinessRuleSchema(SQLiteDatabase db) {
        createUniqueIndex(db, "uq_qatra_subscriber_code",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_qatra_subscriber_code " +
                        "ON qatra_subscribers(namespace,subscriber_code COLLATE NOCASE) " +
                        "WHERE subscriber_code<>''");
        createUniqueIndex(db, "uq_qatra_meter_no",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_qatra_meter_no " +
                        "ON qatra_subscribers(namespace,meter_no COLLATE NOCASE) " +
                        "WHERE meter_no<>''");
        createUniqueIndex(db, "uq_qatra_cycle_type_date",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_qatra_cycle_type_date " +
                        "ON qatra_billing_cycles(namespace,cycle_type,cycle_date) " +
                        "WHERE cycle_type<>'' AND cycle_date<>''");
        createUniqueIndex(db, "uq_qatra_reading_cycle_subscriber",
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_qatra_reading_cycle_subscriber " +
                        "ON qatra_meter_readings(namespace,cycle_id,subscriber_id) " +
                        "WHERE cycle_id<>'' AND subscriber_id<>''");

        db.execSQL("CREATE TRIGGER IF NOT EXISTS trg_qatra_subscriber_numbers_insert " +
                "BEFORE INSERT ON qatra_subscribers BEGIN " +
                "SELECT CASE WHEN NEW.opening_reading<0 OR NEW.opening_arrears<0 " +
                "OR NEW.opening_credit<0 THEN RAISE(ABORT,'NEGATIVE_SUBSCRIBER_VALUE') END; " +
                "SELECT CASE WHEN NEW.opening_arrears>0 AND NEW.opening_credit>0 " +
                "THEN RAISE(ABORT,'ARREARS_AND_CREDIT_CONFLICT') END; END");
        db.execSQL("CREATE TRIGGER IF NOT EXISTS trg_qatra_subscriber_numbers_update " +
                "BEFORE UPDATE OF opening_reading,opening_arrears,opening_credit ON qatra_subscribers BEGIN " +
                "SELECT CASE WHEN NEW.opening_reading<0 OR NEW.opening_arrears<0 " +
                "OR NEW.opening_credit<0 THEN RAISE(ABORT,'NEGATIVE_SUBSCRIBER_VALUE') END; " +
                "SELECT CASE WHEN NEW.opening_arrears>0 AND NEW.opening_credit>0 " +
                "THEN RAISE(ABORT,'ARREARS_AND_CREDIT_CONFLICT') END; END");
        db.execSQL("CREATE TRIGGER IF NOT EXISTS trg_qatra_reading_numbers_insert " +
                "BEFORE INSERT ON qatra_meter_readings BEGIN " +
                "SELECT CASE WHEN NEW.previous_reading<0 OR NEW.current_reading<0 " +
                "OR NEW.consumption<0 THEN RAISE(ABORT,'NEGATIVE_READING_VALUE') END; " +
                "SELECT CASE WHEN NEW.meter_changed=0 AND NEW.current_reading<NEW.previous_reading " +
                "THEN RAISE(ABORT,'CURRENT_READING_BELOW_PREVIOUS') END; END");
        db.execSQL("CREATE TRIGGER IF NOT EXISTS trg_qatra_reading_numbers_update " +
                "BEFORE UPDATE OF previous_reading,current_reading,consumption,meter_changed " +
                "ON qatra_meter_readings BEGIN " +
                "SELECT CASE WHEN NEW.previous_reading<0 OR NEW.current_reading<0 " +
                "OR NEW.consumption<0 THEN RAISE(ABORT,'NEGATIVE_READING_VALUE') END; " +
                "SELECT CASE WHEN NEW.meter_changed=0 AND NEW.current_reading<NEW.previous_reading " +
                "THEN RAISE(ABORT,'CURRENT_READING_BELOW_PREVIOUS') END; END");
    }

    private static void ensureColumn(
            SQLiteDatabase db, String table, String column, String definition) {
        try (Cursor c = db.rawQuery("PRAGMA table_info(" + table + ")", null)) {
            int nameIndex = c.getColumnIndex("name");
            while (c.moveToNext()) {
                if (column.equals(c.getString(nameIndex))) return;
            }
        }
        db.execSQL("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition);
    }

    private static void createUniqueIndex(SQLiteDatabase db, String name, String sql) {
        try {
            db.execSQL(sql);
        } catch (android.database.sqlite.SQLiteConstraintException conflict) {
            // Keep legacy installations readable. New state saves still fail closed through
            // validateBusinessRules until the operator corrects the conflicting legacy row.
            audit(db, "LEGACY_UNIQUE_CONFLICT", name);
        }
    }

    private static String commonProjectionColumns() {
        return "source_updated_at TEXT NOT NULL DEFAULT '',payload_json TEXT NOT NULL," +
                "payload_hash TEXT NOT NULL,updated_at INTEGER NOT NULL,sync_version INTEGER NOT NULL";
    }

    private static void backfillRelationalState(SQLiteDatabase db) throws Exception {
        try (Cursor c = db.rawQuery("SELECT namespace,payload_json,updated_at FROM app_state", null)) {
            while (c.moveToNext()) {
                projectRelationalState(db, c.getString(0), new JSONObject(c.getString(1)),
                        "SCHEMA_MIGRATION", c.getLong(2));
            }
        }
    }

    private static void projectRelationalState(
            SQLiteDatabase db, String namespace, JSONObject root, String source, long now) throws Exception {
        LinkedHashMap<String, JSONObject> profiles = new LinkedHashMap<>();
        JSONObject meta = root.optJSONObject("meta");
        JSONObject settings = root.optJSONObject("settings");
        if (meta != null || settings != null) {
            JSONObject profile = new JSONObject();
            profile.put("id", "PROFILE");
            if (meta != null) profile.put("meta", meta);
            if (settings != null) profile.put("settings", settings);
            profiles.put("PROFILE", profile);
        }
        syncProjectionTable(db, "qatra_profiles", "BUSINESS_PROFILE", namespace, profiles, source, now);

        LinkedHashMap<String, JSONObject> staff = new LinkedHashMap<>();
        collectRows(root.optJSONArray("users"), staff, "STAFF_USER", "id", "username", "code");
        syncProjectionTable(db, "qatra_staff_users", "STAFF_USER", namespace, staff, source, now);

        LinkedHashMap<String, JSONObject> subscribers = new LinkedHashMap<>();
        collectRows(root.optJSONArray("subscribers"), subscribers, "SUBSCRIBER",
                "id", "subscriberId", "code", "subscriberCode", "meterNo");
        JSONObject assignment = root.optJSONObject("assignment");
        if (assignment != null) collectRows(assignment.optJSONArray("subscribers"), subscribers,
                "SUBSCRIBER", "id", "subscriberId", "code", "subscriberCode", "meterNo");
        JSONObject setup = root.optJSONObject("setup");
        if (setup != null) collectRows(setup.optJSONArray("subscribers"), subscribers,
                "SUBSCRIBER", "id", "subscriberId", "code", "subscriberCode", "meterNo");
        syncProjectionTable(db, "qatra_subscribers", "SUBSCRIBER", namespace, subscribers, source, now);

        LinkedHashMap<String, JSONObject> cycles = new LinkedHashMap<>();
        collectRows(root.optJSONArray("cycles"), cycles, "BILLING_CYCLE", "id");
        if (assignment != null) collectObject(assignment.optJSONObject("cycle"), cycles,
                "BILLING_CYCLE", "id");
        syncProjectionTable(db, "qatra_billing_cycles", "BILLING_CYCLE", namespace, cycles, source, now);

        LinkedHashMap<String, JSONObject> readings = new LinkedHashMap<>();
        collectRows(root.optJSONArray("readings"), readings, "METER_READING", "id");
        syncProjectionTable(db, "qatra_meter_readings", "METER_READING", namespace, readings, source, now);

        LinkedHashMap<String, JSONObject> invoices = new LinkedHashMap<>();
        collectRows(root.optJSONArray("invoices"), invoices, "INVOICE", "id", "no");
        syncProjectionTable(db, "qatra_invoices", "INVOICE", namespace, invoices, source, now);

        LinkedHashMap<String, JSONObject> payments = new LinkedHashMap<>();
        collectRows(root.optJSONArray("payments"), payments, "PAYMENT", "id", "receiptNo");
        collectRows(root.optJSONArray("receipts"), payments, "PAYMENT", "id", "receiptNo");
        syncProjectionTable(db, "qatra_payments", "PAYMENT", namespace, payments, source, now);

        LinkedHashMap<String, JSONObject> expenses = new LinkedHashMap<>();
        collectRows(root.optJSONArray("expenses"), expenses, "EXPENSE", "id", "refNo");
        syncProjectionTable(db, "qatra_expenses", "EXPENSE", namespace, expenses, source, now);

        LinkedHashMap<String, JSONObject> cashbox = new LinkedHashMap<>();
        collectRows(root.optJSONArray("transactions"), cashbox, "CASHBOX_TRANSACTION", "id", "receiptNo");
        collectRows(root.optJSONArray("cashboxTransactions"), cashbox,
                "CASHBOX_TRANSACTION", "id", "receiptNo");
        syncProjectionTable(db, "qatra_cashbox_transactions", "CASHBOX_TRANSACTION",
                namespace, cashbox, source, now);

        LinkedHashMap<String, JSONObject> direct = new LinkedHashMap<>();
        collectRows(root.optJSONArray("directPayments"), direct, "DIRECT_PAYMENT", "id", "receiptNo");
        collectRows(root.optJSONArray("cashboxDirectPayments"), direct,
                "DIRECT_PAYMENT", "id", "receiptNo");
        syncProjectionTable(db, "qatra_direct_payments", "DIRECT_PAYMENT", namespace, direct, source, now);

        // Procurement and inventory are projected as first-class relational records while the
        // JSON document remains the portable application contract.
        LinkedHashMap<String, JSONObject> suppliers = new LinkedHashMap<>();
        collectRows(root.optJSONArray("suppliers"), suppliers, "SUPPLIER",
                "id", "supplierId", "supplierNo", "no", "code", "taxNo");
        syncProjectionTable(db, "erp_suppliers", "SUPPLIER", namespace, suppliers, source, now);

        LinkedHashMap<String, JSONObject> purchaseRequests = new LinkedHashMap<>();
        collectRows(root.optJSONArray("purchaseRequests"), purchaseRequests, "PURCHASE_REQUEST",
                "id", "requestId", "requestNo", "no");
        syncProjectionTable(db, "erp_purchase_requests", "PURCHASE_REQUEST",
                namespace, purchaseRequests, source, now);
        syncLineProjectionTable(db, "erp_purchase_request_lines", "request_id",
                namespace, purchaseRequests);

        LinkedHashMap<String, JSONObject> quotations = new LinkedHashMap<>();
        collectRows(root.optJSONArray("quotations"), quotations, "QUOTATION",
                "id", "quotationId", "quotationNo", "no");
        syncProjectionTable(db, "erp_quotations", "QUOTATION",
                namespace, quotations, source, now);

        LinkedHashMap<String, JSONObject> purchaseOrders = new LinkedHashMap<>();
        collectRows(root.optJSONArray("purchaseOrders"), purchaseOrders, "PURCHASE_ORDER",
                "id", "orderId", "orderNo", "no");
        syncProjectionTable(db, "erp_purchase_orders", "PURCHASE_ORDER",
                namespace, purchaseOrders, source, now);
        syncLineProjectionTable(db, "erp_purchase_order_lines", "order_id",
                namespace, purchaseOrders);

        LinkedHashMap<String, JSONObject> goodsReceipts = new LinkedHashMap<>();
        collectRows(root.optJSONArray("goodsReceipts"), goodsReceipts, "GOODS_RECEIPT",
                "id", "receiptId", "receiptNo", "no");
        syncProjectionTable(db, "erp_goods_receipts", "GOODS_RECEIPT",
                namespace, goodsReceipts, source, now);
        syncLineProjectionTable(db, "erp_goods_receipt_lines", "receipt_id",
                namespace, goodsReceipts);

        LinkedHashMap<String, JSONObject> supplierInvoices = new LinkedHashMap<>();
        collectRows(root.optJSONArray("supplierInvoices"), supplierInvoices, "SUPPLIER_INVOICE",
                "id", "invoiceId", "invoiceNo", "no");
        syncProjectionTable(db, "erp_supplier_invoices", "SUPPLIER_INVOICE",
                namespace, supplierInvoices, source, now);

        LinkedHashMap<String, JSONObject> warehouses = new LinkedHashMap<>();
        collectRows(root.optJSONArray("warehouses"), warehouses, "WAREHOUSE",
                "id", "warehouseId", "code", "warehouseCode");
        syncProjectionTable(db, "erp_warehouses", "WAREHOUSE",
                namespace, warehouses, source, now);

        LinkedHashMap<String, JSONObject> inventoryItems = new LinkedHashMap<>();
        collectRows(root.optJSONArray("items"), inventoryItems, "INVENTORY_ITEM",
                "id", "itemId", "sku", "code");
        collectRows(root.optJSONArray("inventoryItems"), inventoryItems, "INVENTORY_ITEM",
                "id", "itemId", "sku", "code");
        syncProjectionTable(db, "erp_inventory_items", "INVENTORY_ITEM",
                namespace, inventoryItems, source, now);

        LinkedHashMap<String, JSONObject> stockMovements = new LinkedHashMap<>();
        collectRows(root.optJSONArray("movements"), stockMovements, "STOCK_MOVEMENT",
                "id", "movementId", "movementNo", "no");
        collectRows(root.optJSONArray("stockMovements"), stockMovements, "STOCK_MOVEMENT",
                "id", "movementId", "movementNo", "no");
        syncProjectionTable(db, "erp_stock_movements", "STOCK_MOVEMENT",
                namespace, stockMovements, source, now);

        LinkedHashMap<String, JSONObject> assets = new LinkedHashMap<>();
        collectRows(root.optJSONArray("assets"), assets, "ASSET",
                "id", "assetId", "assetCode", "code");
        syncProjectionTable(db, "erp_assets", "ASSET", namespace, assets, source, now);

        LinkedHashMap<String, JSONObject> depreciationRuns = new LinkedHashMap<>();
        collectRows(root.optJSONArray("depreciationRuns"), depreciationRuns, "DEPRECIATION_RUN",
                "id", "runId", "no");
        syncProjectionTable(db, "erp_depreciation_runs", "DEPRECIATION_RUN",
                namespace, depreciationRuns, source, now);

        LinkedHashMap<String, JSONObject> assetTransfers = new LinkedHashMap<>();
        collectRows(root.optJSONArray("transfers"), assetTransfers, "ASSET_TRANSFER",
                "id", "transferId", "no");
        syncProjectionTable(db, "erp_asset_transfers", "ASSET_TRANSFER",
                namespace, assetTransfers, source, now);

        LinkedHashMap<String, JSONObject> employees = new LinkedHashMap<>();
        collectRows(root.optJSONArray("employees"), employees, "EMPLOYEE",
                "id", "employeeId", "employeeNo", "code");
        syncProjectionTable(db, "erp_employees", "EMPLOYEE", namespace, employees, source, now);

        LinkedHashMap<String, JSONObject> attendance = new LinkedHashMap<>();
        collectRows(root.optJSONArray("attendance"), attendance, "ATTENDANCE",
                "id", "attendanceId", "no");
        syncProjectionTable(db, "erp_attendance", "ATTENDANCE",
                namespace, attendance, source, now);

        LinkedHashMap<String, JSONObject> leaveRequests = new LinkedHashMap<>();
        collectRows(root.optJSONArray("leaveRequests"), leaveRequests, "LEAVE_REQUEST",
                "id", "leaveId", "no");
        collectRows(root.optJSONArray("leaves"), leaveRequests, "LEAVE_REQUEST",
                "id", "leaveId", "no");
        syncProjectionTable(db, "erp_leave_requests", "LEAVE_REQUEST",
                namespace, leaveRequests, source, now);

        LinkedHashMap<String, JSONObject> payrollRuns = new LinkedHashMap<>();
        collectRows(root.optJSONArray("payrollRuns"), payrollRuns, "PAYROLL_RUN",
                "id", "runId", "no");
        syncProjectionTable(db, "erp_payroll_runs", "PAYROLL_RUN",
                namespace, payrollRuns, source, now);
        syncPayrollLineProjectionTable(db, namespace, payrollRuns);

        LinkedHashMap<String, JSONObject> workOrders = new LinkedHashMap<>();
        collectRows(root.optJSONArray("workOrders"), workOrders, "WORK_ORDER",
                "id", "workOrderId", "no");
        syncProjectionTable(db, "erp_work_orders", "WORK_ORDER",
                namespace, workOrders, source, now);
        syncLineProjectionTable(db, "erp_work_order_parts", "work_order_id",
                namespace, workOrders);

        LinkedHashMap<String, JSONObject> preventivePlans = new LinkedHashMap<>();
        collectRows(root.optJSONArray("preventivePlans"), preventivePlans, "PREVENTIVE_PLAN",
                "id", "planId", "no");
        syncProjectionTable(db, "erp_preventive_plans", "PREVENTIVE_PLAN",
                namespace, preventivePlans, source, now);

        LinkedHashMap<String, JSONObject> failures = new LinkedHashMap<>();
        collectRows(root.optJSONArray("failures"), failures, "FAILURE_REPORT",
                "id", "failureId", "no");
        syncProjectionTable(db, "erp_failure_reports", "FAILURE_REPORT",
                namespace, failures, source, now);
    }

    private static void collectRows(
            JSONArray array, Map<String, JSONObject> target, String entityType, String... idKeys) throws Exception {
        if (array == null) return;
        for (int i = 0; i < array.length(); i++) {
            JSONObject row = array.optJSONObject(i);
            if (row == null) continue;
            String id = stableEntityId(row, entityType, idKeys);
            target.put(id, row);
        }
    }

    private static void collectObject(
            JSONObject row, Map<String, JSONObject> target, String entityType, String... idKeys) throws Exception {
        if (row == null) return;
        target.put(stableEntityId(row, entityType, idKeys), row);
    }

    private static void syncLineProjectionTable(
            SQLiteDatabase db, String table, String parentColumn, String namespace,
            Map<String, JSONObject> parents) {
        db.delete(table, "namespace=?", new String[]{namespace});
        for (Map.Entry<String, JSONObject> parent : parents.entrySet()) {
            JSONArray lines = parent.getValue().optJSONArray("lines");
            if (lines == null) continue;
            for (int index = 0; index < lines.length(); index++) {
                JSONObject line = lines.optJSONObject(index);
                if (line == null) continue;
                double quantity = finiteNumber(line, "quantity", "qty");
                double unitCost = finiteNumber(line, "unitCost", "rate", "price", "cost");
                if (quantity <= 0d || unitCost < 0d) continue;
                double total = finiteNumber(line, "lineTotal", "total", "amount");
                if (total <= 0d) total = quantity * unitCost;
                ContentValues values = new ContentValues();
                values.put("namespace", namespace);
                values.put(parentColumn, parent.getKey());
                values.put("line_no", index + 1);
                values.put("item_ref", firstString(line, "itemId", "item", "sku", "code"));
                values.put("description", firstString(line, "description", "name"));
                values.put("unit", firstString(line, "unit", "uom"));
                values.put("quantity", quantity);
                values.put("unit_cost", unitCost);
                values.put("line_total", total);
                if (db.insertOrThrow(table, null, values) == -1L) {
                    throw new IllegalStateException("تعذر إسقاط تفاصيل المستند في " + table);
                }
            }
        }
    }

    private static void syncPayrollLineProjectionTable(
            SQLiteDatabase db, String namespace, Map<String, JSONObject> payrollRuns) {
        db.delete("erp_payroll_lines", "namespace=?", new String[]{namespace});
        for (Map.Entry<String, JSONObject> run : payrollRuns.entrySet()) {
            JSONArray lines = run.getValue().optJSONArray("lines");
            if (lines == null) continue;
            for (int index = 0; index < lines.length(); index++) {
                JSONObject line = lines.optJSONObject(index);
                if (line == null) continue;
                String employeeId = line.optString("employeeId", "").trim();
                if (employeeId.isEmpty()) continue;
                double basic = finiteNumber(line, "basicSalary", "basic");
                double allowances = finiteNumber(line, "allowances");
                double deductions = finiteNumber(line, "deductions");
                double net = finiteNumber(line, "net");
                if (net <= 0d) net = Math.max(0d, basic + allowances - deductions);
                ContentValues values = new ContentValues();
                values.put("namespace", namespace);
                values.put("run_id", run.getKey());
                values.put("line_no", index + 1);
                values.put("employee_id", employeeId);
                values.put("basic_salary", basic);
                values.put("allowances", allowances);
                values.put("deductions", deductions);
                values.put("net", net);
                if (db.insertOrThrow("erp_payroll_lines", null, values) == -1L) {
                    throw new IllegalStateException("تعذر إسقاط تفاصيل مسير الرواتب");
                }
            }
        }
    }

    private static String stableEntityId(JSONObject row, String type, String... keys) throws Exception {
        for (String key : keys) {
            String value = row.optString(key, "").trim();
            if (!value.isEmpty()) return value;
        }
        JSONObject safePayload = sanitizedPayload(row);
        return type + "-" + sha256(safePayload.toString()).substring(0, 20);
    }

    private static void syncProjectionTable(
            SQLiteDatabase db, String table, String entityType, String namespace,
            Map<String, JSONObject> incoming, String source, long now) throws Exception {
        Set<String> seen = new HashSet<>();
        for (Map.Entry<String, JSONObject> entry : incoming.entrySet()) {
            String entityId = entry.getKey();
            JSONObject payload = sanitizedPayload(entry.getValue());
            ContentValues values = projectionValues(entityType, entry.getValue());
            upsertProjectedRow(db, table, entityType, namespace, entityId,
                    payload, values, source, now);
            seen.add(entityId);
        }
        Set<String> missing = new HashSet<>();
        try (Cursor c = db.query(table, new String[]{"entity_id"}, "namespace=?",
                new String[]{namespace}, null, null, null)) {
            while (c.moveToNext()) {
                String entityId = c.getString(0);
                if (!seen.contains(entityId)) missing.add(entityId);
            }
        }
        for (String entityId : missing) {
            db.delete(table, "namespace=? AND entity_id=?", new String[]{namespace, entityId});
            recordDeletion(db, namespace, entityType, entityId, source, now);
        }
    }

    private static void upsertProjectedRow(
            SQLiteDatabase db, String table, String entityType, String namespace, String entityId,
            JSONObject payload, ContentValues values, String source, long now) throws Exception {
        String payloadJson = payload.toString();
        String payloadHash = sha256(payloadJson);
        VersionState current = versionState(db, namespace, entityType, entityId);
        if (current != null && !current.deleted && payloadHash.equals(current.payloadHash)) {
            if (!projectionRowExists(db, table, namespace, entityId)) {
                values.put("namespace", namespace);
                values.put("entity_id", entityId);
                values.put("payload_json", payloadJson);
                values.put("payload_hash", payloadHash);
                values.put("updated_at", now);
                values.put("sync_version", current.version);
                if (db.insertWithOnConflict(
                        table, null, values, SQLiteDatabase.CONFLICT_REPLACE) == -1L) {
                    throw new IllegalStateException("تعذر استعادة جدول " + table);
                }
            }
            return;
        }

        long version = current == null ? 1L : current.version + 1L;
        values.put("namespace", namespace);
        values.put("entity_id", entityId);
        values.put("payload_json", payloadJson);
        values.put("payload_hash", payloadHash);
        values.put("updated_at", now);
        values.put("sync_version", version);
        long inserted = db.insertWithOnConflict(table, null, values, SQLiteDatabase.CONFLICT_REPLACE);
        if (inserted == -1L) throw new IllegalStateException("تعذر تحديث جدول " + table);

        saveVersionState(db, namespace, entityType, entityId, version, payloadHash, false, now);
        enqueueEntityChange(db, namespace, entityType, entityId, "UPSERT",
                payloadJson, payloadHash, version, source, now);
    }

    private static void recordDeletion(
            SQLiteDatabase db, String namespace, String entityType, String entityId,
            String source, long now) throws Exception {
        VersionState current = versionState(db, namespace, entityType, entityId);
        if (current != null && current.deleted) return;
        long version = current == null ? 1L : current.version + 1L;
        JSONObject tombstone = new JSONObject();
        tombstone.put("id", entityId);
        tombstone.put("deleted", true);
        String payloadJson = tombstone.toString();
        String payloadHash = sha256(payloadJson);
        saveVersionState(db, namespace, entityType, entityId, version, payloadHash, true, now);
        enqueueEntityChange(db, namespace, entityType, entityId, "DELETE",
                payloadJson, payloadHash, version, source, now);
    }

    private static void enqueueEntityChange(
            SQLiteDatabase db, String namespace, String entityType, String entityId,
            String action, String payloadJson, String payloadHash, long version,
            String source, long now) {
        // Only the newest unacknowledged state of an entity is needed. This bounds database
        // growth before the accounting connector is enabled and remains safe because the server
        // accepts the highest entity_version and treats operation_id as idempotent.
        db.delete("qatra_sync_outbox",
                "namespace=? AND entity_type=? AND entity_id=? AND status IN('PENDING','FAILED')",
                new String[]{namespace, entityType, entityId});
        ContentValues change = new ContentValues();
        change.put("operation_id", UUID.randomUUID().toString());
        change.put("namespace", namespace);
        change.put("entity_type", entityType);
        change.put("entity_id", entityId);
        change.put("action", action);
        change.put("payload_json", payloadJson);
        change.put("payload_hash", payloadHash);
        change.put("entity_version", version);
        change.put("source", source == null ? "LOCAL" : source);
        change.put("status", "PENDING");
        change.put("created_at", now);
        long inserted = db.insertWithOnConflict(
                "qatra_sync_outbox", null, change, SQLiteDatabase.CONFLICT_IGNORE);
        if (inserted == -1L && !outboxVersionExists(
                db, namespace, entityType, entityId, version, action)) {
            throw new IllegalStateException("تعذر إنشاء حركة مزامنة محاسبية");
        }
    }

    private static boolean outboxVersionExists(
            SQLiteDatabase db, String namespace, String entityType,
            String entityId, long version, String action) {
        try (Cursor c = db.rawQuery(
                "SELECT 1 FROM qatra_sync_outbox WHERE namespace=? AND entity_type=? " +
                        "AND entity_id=? AND entity_version=? AND action=? LIMIT 1",
                new String[]{namespace, entityType, entityId, String.valueOf(version), action})) {
            return c.moveToFirst();
        }
    }

    private static boolean projectionRowExists(
            SQLiteDatabase db, String table, String namespace, String entityId) {
        try (Cursor c = db.query(table, new String[]{"entity_id"},
                "namespace=? AND entity_id=?", new String[]{namespace, entityId},
                null, null, null, "1")) {
            return c.moveToFirst();
        }
    }

    private static VersionState versionState(
            SQLiteDatabase db, String namespace, String entityType, String entityId) {
        try (Cursor c = db.rawQuery(
                "SELECT entity_version,payload_hash,is_deleted FROM qatra_entity_versions " +
                        "WHERE namespace=? AND entity_type=? AND entity_id=? LIMIT 1",
                new String[]{namespace, entityType, entityId})) {
            return c.moveToFirst()
                    ? new VersionState(c.getLong(0), c.getString(1), c.getInt(2) != 0) : null;
        }
    }

    private static void saveVersionState(
            SQLiteDatabase db, String namespace, String entityType, String entityId,
            long version, String payloadHash, boolean deleted, long now) {
        ContentValues values = new ContentValues();
        values.put("namespace", namespace);
        values.put("entity_type", entityType);
        values.put("entity_id", entityId);
        values.put("entity_version", version);
        values.put("payload_hash", payloadHash);
        values.put("is_deleted", deleted ? 1 : 0);
        values.put("updated_at", now);
        db.insertWithOnConflict(
                "qatra_entity_versions", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    private static ContentValues projectionValues(String type, JSONObject row) {
        ContentValues values = new ContentValues();
        values.put("source_updated_at", firstString(row, "updatedAt", "createdAt", "date", "cycleDate"));
        if ("BUSINESS_PROFILE".equals(type)) {
            JSONObject settings = row.optJSONObject("settings");
            if (settings == null) settings = new JSONObject();
            values.put("project_name", settings.optString("projectName", ""));
            values.put("owner_name", settings.optString("ownerName", ""));
            values.put("account_no", settings.optString("projectAccountNo", ""));
            values.put("currency", firstString(settings, "currency", "currencyFull", "currencyShort"));
        } else if ("STAFF_USER".equals(type)) {
            values.put("username", row.optString("username", ""));
            values.put("display_name", row.optString("name", ""));
            values.put("role", row.optString("role", ""));
            values.put("employee_code", row.optString("code", ""));
            values.put("active", row.optBoolean("active", true) ? 1 : 0);
        } else if ("SUBSCRIBER".equals(type)) {
            values.put("subscriber_code", firstString(row, "code", "subscriberCode"));
            values.put("meter_no", row.optString("meterNo", ""));
            values.put("full_name", firstString(row, "name", "subscriberName"));
            values.put("phone", row.optString("phone", ""));
            values.put("area", row.optString("area", ""));
            values.put("status", row.optString("status", ""));
            values.put("reading_group", row.optString("readingGroup", ""));
            values.put("opening_reading", finiteNumber(row, "openingReading"));
            values.put("opening_arrears", finiteNumber(row, "openingArrears"));
            values.put("opening_credit", finiteNumber(row, "openingCredit"));
        } else if ("BILLING_CYCLE".equals(type)) {
            values.put("cycle_date", row.optString("cycleDate", ""));
            values.put("cycle_type", row.optString("type", ""));
            values.put("status", row.optString("status", ""));
            values.put("main_previous", finiteNumber(row, "mainPrev"));
            values.put("main_current", finiteNumber(row, "mainCurrent"));
            values.put("closed_at", row.optString("closedAt", ""));
        } else if ("METER_READING".equals(type)) {
            values.put("cycle_id", row.optString("cycleId", ""));
            values.put("subscriber_id", row.optString("subscriberId", ""));
            values.put("previous_reading", finiteNumber(row, "prev", "previousReading"));
            values.put("current_reading", finiteNumber(row, "current", "currentReading"));
            values.put("consumption", finiteNumber(row, "consumption"));
            values.put("reader_id", row.optString("readerId", ""));
            values.put("assignment_id", row.optString("assignmentId", ""));
            values.put("meter_changed", row.optString("meterChangeId", "").trim().isEmpty() ? 0 : 1);
            values.put("has_attachment", hasBinaryAttachment(row) ? 1 : 0);
        } else if ("INVOICE".equals(type)) {
            values.put("invoice_no", row.optString("no", ""));
            values.put("cycle_id", row.optString("cycleId", ""));
            values.put("subscriber_id", row.optString("subscriberId", ""));
            values.put("invoice_date", row.optString("date", ""));
            values.put("amount", finiteNumber(row, "amount"));
            values.put("paid_amount", finiteNumber(row, "paidAmount"));
            values.put("remaining_amount", finiteNumber(row, "remainingAmount"));
            values.put("status", row.optString("status", ""));
        } else if ("PAYMENT".equals(type)) {
            values.put("receipt_no", row.optString("receiptNo", ""));
            values.put("subscriber_id", row.optString("subscriberId", ""));
            values.put("invoice_id", row.optString("invoiceId", ""));
            values.put("payment_date", row.optString("date", ""));
            values.put("amount", finiteNumber(row, "amount"));
            values.put("method", row.optString("method", ""));
            values.put("collector_id", firstString(row, "collectorId", "collectorCode", "collector"));
            values.put("income_type", row.optString("incomeType", "WATER"));
            values.put("confirmed", row.optBoolean("confirmed", true) ? 1 : 0);
            values.put("has_attachment", hasBinaryAttachment(row) ? 1 : 0);
        } else if ("EXPENSE".equals(type)) {
            values.put("expense_date", row.optString("date", ""));
            values.put("category", row.optString("category", ""));
            values.put("description", row.optString("description", ""));
            values.put("amount", finiteNumber(row, "amount"));
            values.put("payee", row.optString("payee", ""));
            values.put("reference_no", row.optString("refNo", ""));
            values.put("payment_account", row.optString("paymentAccount", ""));
            values.put("cost_center", row.optString("costCenter", ""));
            values.put("has_attachment", hasBinaryAttachment(row) ? 1 : 0);
        } else if ("CASHBOX_TRANSACTION".equals(type)) {
            values.put("receipt_no", row.optString("receiptNo", ""));
            values.put("transaction_date", row.optString("date", ""));
            values.put("transaction_type", row.optString("type", ""));
            values.put("method", row.optString("method", ""));
            values.put("amount", finiteNumber(row, "amount"));
            values.put("party", row.optString("party", ""));
            values.put("reference_no", firstString(row, "refNo", "referenceNo"));
            values.put("cashier_code", row.optString("cashierCode", ""));
            values.put("has_attachment", hasBinaryAttachment(row) ? 1 : 0);
        } else if ("DIRECT_PAYMENT".equals(type)) {
            values.put("receipt_no", row.optString("receiptNo", ""));
            values.put("subscriber_id", row.optString("subscriberId", ""));
            values.put("subscriber_code", row.optString("subscriberCode", ""));
            values.put("meter_no", row.optString("meterNo", ""));
            values.put("payment_date", row.optString("date", ""));
            values.put("amount", finiteNumber(row, "amount"));
            values.put("income_type", row.optString("incomeType", "WATER"));
            values.put("method", row.optString("method", ""));
            values.put("cashier_code", row.optString("cashierCode", ""));
            values.put("has_attachment", hasBinaryAttachment(row) ? 1 : 0);
        } else if ("SUPPLIER".equals(type)) {
            values.put("supplier_no", firstString(row, "supplierNo", "no", "code"));
            values.put("name", row.optString("name", ""));
            values.put("tax_no", row.optString("taxNo", ""));
            values.put("phone", row.optString("phone", ""));
            values.put("email", row.optString("email", ""));
            values.put("address", row.optString("address", ""));
            values.put("status", upper(row.optString("status", "DRAFT")));
        } else if ("PURCHASE_REQUEST".equals(type)) {
            values.put("request_no", firstString(row, "requestNo", "no"));
            values.put("requester", row.optString("requester", ""));
            values.put("department", row.optString("department", ""));
            values.put("needed_by", row.optString("neededBy", ""));
            values.put("estimated_amount", finiteNumber(row, "estimatedAmount", "amount"));
            values.put("description", row.optString("description", ""));
            values.put("status", upper(row.optString("status", "DRAFT")));
        } else if ("QUOTATION".equals(type)) {
            values.put("quotation_no", firstString(row, "quotationNo", "no"));
            values.put("request_ref", firstString(row, "requestId", "requestNo", "request"));
            values.put("supplier_ref", firstString(row, "supplierId", "supplierNo", "supplier"));
            values.put("amount", finiteNumber(row, "amount"));
            values.put("valid_until", row.optString("validUntil", ""));
            values.put("status", upper(row.optString("status", "DRAFT")));
        } else if ("PURCHASE_ORDER".equals(type)) {
            values.put("order_no", firstString(row, "orderNo", "no"));
            values.put("request_ref", firstString(row, "requestId", "requestNo", "request"));
            values.put("supplier_ref", firstString(row, "supplierId", "supplierNo", "supplier"));
            values.put("order_date", row.optString("orderDate", ""));
            values.put("delivery_date", row.optString("deliveryDate", ""));
            values.put("amount", finiteNumber(row, "amount"));
            values.put("status", upper(row.optString("status", "DRAFT")));
        } else if ("GOODS_RECEIPT".equals(type)) {
            values.put("receipt_no", firstString(row, "receiptNo", "no"));
            values.put("purchase_order_ref",
                    firstString(row, "purchaseOrderId", "purchaseOrderNo", "purchaseOrder"));
            values.put("warehouse_ref",
                    firstString(row, "warehouseId", "warehouseCode", "warehouse"));
            values.put("receipt_date", row.optString("receiptDate", ""));
            values.put("received_by", row.optString("receivedBy", ""));
            values.put("status", upper(row.optString("status", "DRAFT")));
        } else if ("SUPPLIER_INVOICE".equals(type)) {
            values.put("invoice_no", firstString(row, "invoiceNo", "no"));
            values.put("supplier_ref", firstString(row, "supplierId", "supplierNo", "supplier"));
            values.put("purchase_order_ref",
                    firstString(row, "purchaseOrderId", "purchaseOrderNo", "purchaseOrder"));
            values.put("invoice_date", row.optString("invoiceDate", ""));
            values.put("due_date", row.optString("dueDate", ""));
            values.put("amount", finiteNumber(row, "amount"));
            values.put("status", upper(row.optString("status", "DRAFT")));
        } else if ("WAREHOUSE".equals(type)) {
            values.put("warehouse_code", firstString(row, "code", "warehouseCode"));
            values.put("name", row.optString("name", ""));
            values.put("location", row.optString("location", ""));
            values.put("keeper", row.optString("keeper", ""));
            values.put("status", upper(row.optString("status", row.optBoolean("active", true)
                    ? "ACTIVE" : "INACTIVE")));
        } else if ("INVENTORY_ITEM".equals(type)) {
            values.put("sku", firstString(row, "sku", "code"));
            values.put("name", row.optString("name", ""));
            values.put("unit", firstString(row, "unit", "uom"));
            values.put("minimum_qty", finiteNumber(row, "minimum", "minimumQty"));
            values.put("average_cost", finiteNumber(row, "averageCost", "unitCost"));
            values.put("status", upper(row.optString("status", row.optBoolean("active", true)
                    ? "ACTIVE" : "INACTIVE")));
        } else if ("STOCK_MOVEMENT".equals(type)) {
            values.put("movement_no", firstString(row, "movementNo", "no"));
            String itemId = row.optString("itemId", "").trim();
            String warehouseId = row.optString("warehouseId", "").trim();
            if (itemId.isEmpty()) values.putNull("item_id"); else values.put("item_id", itemId);
            if (warehouseId.isEmpty()) values.putNull("warehouse_id"); else values.put("warehouse_id", warehouseId);
            values.put("movement_type", upper(firstString(row, "movementType", "type")));
            values.put("quantity", finiteNumber(row, "quantity", "qty"));
            values.put("unit_cost", finiteNumber(row, "unitCost", "averageCost", "cost"));
            double totalCost = finiteNumber(row, "totalCost", "amount");
            if (totalCost <= 0d) totalCost = finiteNumber(row, "quantity", "qty")
                    * finiteNumber(row, "unitCost", "averageCost", "cost");
            values.put("total_cost", totalCost);
            values.put("movement_date", firstString(row, "movementDate", "date"));
            values.put("reference_no", firstString(row, "reference", "referenceNo"));
            values.put("status", upper(row.optString("status", "DRAFT")));
        } else if ("ASSET".equals(type)) {
            values.put("asset_code", firstString(row, "assetCode", "code", "no"));
            values.put("name", row.optString("name", ""));
            values.put("category", row.optString("category", ""));
            values.put("location", row.optString("location", ""));
            values.put("custodian", row.optString("custodian", ""));
            values.put("purchase_date", row.optString("purchaseDate", ""));
            values.put("cost", finiteNumber(row, "cost"));
            values.put("residual_value", finiteNumber(row, "residualValue"));
            values.put("useful_life_years", finiteNumber(row, "usefulLife", "usefulLifeYears"));
            values.put("status", upper(row.optString("status", "DRAFT")));
        } else if ("DEPRECIATION_RUN".equals(type)) {
            values.put("run_no", row.optString("no", ""));
            values.put("period", row.optString("period", ""));
            String assetId = row.optString("assetId", "").trim();
            if (assetId.isEmpty()) values.putNull("asset_id"); else values.put("asset_id", assetId);
            values.put("opening_value", finiteNumber(row, "openingValue"));
            values.put("depreciation", finiteNumber(row, "depreciation"));
            values.put("closing_value", finiteNumber(row, "closingValue"));
            values.put("status", upper(row.optString("status", "DRAFT")));
        } else if ("ASSET_TRANSFER".equals(type)) {
            values.put("transfer_no", row.optString("no", ""));
            String assetId = row.optString("assetId", "").trim();
            if (assetId.isEmpty()) values.putNull("asset_id"); else values.put("asset_id", assetId);
            values.put("from_location", row.optString("fromLocation", ""));
            values.put("to_location", row.optString("toLocation", ""));
            values.put("custodian", row.optString("custodian", ""));
            values.put("transfer_date", row.optString("transferDate", ""));
            values.put("status", upper(row.optString("status", "DRAFT")));
        } else if ("EMPLOYEE".equals(type)) {
            values.put("employee_no", firstString(row, "employeeNo", "code", "no"));
            values.put("name", row.optString("name", ""));
            values.put("department", row.optString("department", ""));
            values.put("job_title", row.optString("jobTitle", ""));
            values.put("hire_date", row.optString("hireDate", ""));
            values.put("basic_salary", finiteNumber(row, "basicSalary"));
            values.put("active", row.optBoolean("active", true) ? 1 : 0);
            values.put("status", upper(row.optString("status", "DRAFT")));
        } else if ("ATTENDANCE".equals(type)) {
            values.put("attendance_no", row.optString("no", ""));
            String employeeId = row.optString("employeeId", "").trim();
            if (employeeId.isEmpty()) values.putNull("employee_id"); else values.put("employee_id", employeeId);
            values.put("attendance_date", row.optString("date", ""));
            values.put("check_in", row.optString("checkIn", ""));
            values.put("check_out", row.optString("checkOut", ""));
            values.put("attendance_status", firstString(row, "attendanceStatus", "statusText"));
            values.put("status", upper(row.optString("status", "DRAFT")));
        } else if ("LEAVE_REQUEST".equals(type)) {
            values.put("leave_no", row.optString("no", ""));
            String employeeId = row.optString("employeeId", "").trim();
            if (employeeId.isEmpty()) values.putNull("employee_id"); else values.put("employee_id", employeeId);
            values.put("leave_type", row.optString("leaveType", ""));
            values.put("start_date", row.optString("startDate", ""));
            values.put("end_date", row.optString("endDate", ""));
            values.put("reason", row.optString("reason", ""));
            values.put("status", upper(row.optString("status", "DRAFT")));
        } else if ("PAYROLL_RUN".equals(type)) {
            values.put("run_no", row.optString("no", ""));
            values.put("period", row.optString("period", ""));
            values.put("department", row.optString("department", ""));
            values.put("gross", finiteNumber(row, "gross"));
            values.put("deductions", finiteNumber(row, "deductions"));
            values.put("net", finiteNumber(row, "net"));
            values.put("status", upper(row.optString("status", "DRAFT")));
        } else if ("WORK_ORDER".equals(type)) {
            values.put("order_no", row.optString("no", ""));
            values.put("title", row.optString("title", ""));
            values.put("asset_ref", firstString(row, "assetId", "asset"));
            values.put("location", row.optString("location", ""));
            values.put("priority", upper(row.optString("priority", "")));
            values.put("assigned_to", row.optString("assignedTo", ""));
            values.put("estimated_cost", finiteNumber(row, "estimatedCost"));
            values.put("actual_cost", finiteNumber(row, "actualCost"));
            values.put("opened_date", firstString(row, "openedDate", "date", "createdAt"));
            values.put("closed_date", row.optString("closedDate", ""));
            values.put("status", upper(row.optString("status", "DRAFT")));
        } else if ("PREVENTIVE_PLAN".equals(type)) {
            values.put("plan_no", row.optString("no", ""));
            values.put("asset_ref", firstString(row, "assetId", "asset"));
            values.put("frequency", upper(row.optString("frequency", "")));
            values.put("next_date", row.optString("nextDate", ""));
            values.put("responsible", row.optString("responsible", ""));
            values.put("checklist", row.optString("checklist", ""));
            values.put("status", upper(row.optString("status", "DRAFT")));
        } else if ("FAILURE_REPORT".equals(type)) {
            values.put("failure_no", row.optString("no", ""));
            values.put("location", row.optString("location", ""));
            values.put("reported_by", row.optString("reportedBy", ""));
            values.put("reported_at", row.optString("reportedAt", ""));
            values.put("severity", upper(row.optString("severity", "")));
            values.put("description", row.optString("description", ""));
            values.put("status", upper(row.optString("status", "DRAFT")));
        }
        return values;
    }

    private static JSONObject sanitizedPayload(JSONObject source) throws Exception {
        Object cleaned = sanitizeJson(source);
        return cleaned instanceof JSONObject ? (JSONObject) cleaned : new JSONObject();
    }

    private static Object sanitizeJson(Object value) throws Exception {
        if (value == null || value == JSONObject.NULL) return JSONObject.NULL;
        if (value instanceof JSONObject) {
            JSONObject source = (JSONObject) value;
            JSONObject result = new JSONObject();
            JSONArray names = source.names();
            if (names == null) return result;
            for (int i = 0; i < names.length(); i++) {
                String key = names.optString(i, "");
                Object child = source.opt(key);
                if (isBinaryKey(key)) {
                    if (child != null && child != JSONObject.NULL && !String.valueOf(child).isEmpty()) {
                        result.put(key + "Present", true);
                    }
                } else {
                    result.put(key, sanitizeJson(child));
                }
            }
            return result;
        }
        if (value instanceof JSONArray) {
            JSONArray source = (JSONArray) value;
            JSONArray result = new JSONArray();
            for (int i = 0; i < source.length(); i++) result.put(sanitizeJson(source.opt(i)));
            return result;
        }
        return value;
    }

    private static boolean isBinaryKey(String key) {
        String normalized = key == null ? "" : key.toLowerCase(Locale.ROOT);
        return normalized.endsWith("photo") || "projectlogo".equals(normalized);
    }

    private static boolean hasBinaryAttachment(JSONObject row) {
        for (String key : new String[]{"photo", "receiptPhoto", "attachmentPhoto"}) {
            if (!row.optString(key, "").isEmpty()) return true;
        }
        return false;
    }

    private static String firstString(JSONObject row, String... keys) {
        if (row == null) return "";
        for (String key : keys) {
            String value = row.optString(key, "").trim();
            if (!value.isEmpty()) return value;
        }
        return "";
    }

    private static double finiteNumber(JSONObject row, String... keys) {
        if (row == null) return 0d;
        for (String key : keys) {
            Object value = row.opt(key);
            if (value == null || value == JSONObject.NULL || String.valueOf(value).trim().isEmpty()) continue;
            try {
                double number = Double.parseDouble(String.valueOf(value).replace(",", ""));
                return Double.isNaN(number) || Double.isInfinite(number) ? 0d : number;
            } catch (NumberFormatException ignored) { }
        }
        return 0d;
    }

    private static final class VersionState {
        final long version;
        final String payloadHash;
        final boolean deleted;

        VersionState(long version, String payloadHash, boolean deleted) {
            this.version = version;
            this.payloadHash = payloadHash == null ? "" : payloadHash;
            this.deleted = deleted;
        }
    }

    private static String chooseId(JSONObject row, String type, int index) throws Exception {
        for (String key : new String[]{"id", "packageId", "operationId", "receiptNo", "no", "code"}) {
            String value = row.optString(key, "").trim();
            if (!value.isEmpty()) return value;
        }
        return type.toUpperCase(Locale.ROOT) + "-" + index + "-" + sha256(row.toString()).substring(0, 16);
    }

    private static ContentValues syncValues(
            String packageId, String operationId, String direction, String senderRole,
            String targetRole, String operationType, String payloadHash, String status) {
        ContentValues values = new ContentValues();
        values.put("package_id", packageId);
        values.put("operation_id", operationId);
        values.put("direction", direction);
        values.put("sender_role", senderRole);
        values.put("target_role", targetRole);
        values.put("operation_type", operationType);
        values.put("payload_hash", payloadHash);
        values.put("status", status);
        values.put("created_at", System.currentTimeMillis());
        return values;
    }

    private static boolean hasState(SQLiteDatabase db, String namespace) {
        try (Cursor c = db.rawQuery("SELECT 1 FROM app_state WHERE namespace=? LIMIT 1", new String[]{namespace})) {
            return c.moveToFirst();
        }
    }

    private static String primaryNamespaceForRole(String role) {
        return QatraNamespacePolicy.primaryNamespaceForRole(role);
    }

    private static java.util.List<String> portableNamespacesForRole(String role) {
        return QatraNamespacePolicy.portableNamespacesForRole(role);
    }

    private static JSONObject preserveOperationalStart(
            SQLiteDatabase db, String namespace, JSONObject incoming) throws Exception {
        JSONObject restored = new JSONObject(incoming.toString());
        String currentJson = stateInTransaction(db, namespace);
        if (currentJson == null) return restored;
        JSONObject current = new JSONObject(currentJson);
        if ("admin".equals(namespace)) {
            JSONObject oldMeta = current.optJSONObject("meta");
            String started = oldMeta == null ? "" : oldMeta.optString("productionStartedAt", "");
            JSONObject newMeta = restored.optJSONObject("meta");
            if (newMeta == null) { newMeta = new JSONObject(); restored.put("meta", newMeta); }
            if (!started.isEmpty() && newMeta.optString("productionStartedAt", "").isEmpty()) {
                newMeta.put("productionStartedAt", started);
            }
        } else {
            String started = current.optString("operationalStartedAt", "");
            if (!started.isEmpty() && restored.optString("operationalStartedAt", "").isEmpty()) {
                restored.put("operationalStartedAt", started);
            }
        }
        return restored;
    }

    private static String stateInTransaction(SQLiteDatabase db, String namespace) {
        try (Cursor c = db.query("app_state", new String[]{"payload_json"}, "namespace=?",
                new String[]{namespace}, null, null, null, "1")) {
            return c.moveToFirst() ? c.getString(0) : null;
        }
    }

    private static boolean hasMigration(SQLiteDatabase db, String namespace) {
        try (Cursor c = db.rawQuery("SELECT 1 FROM migration_log WHERE namespace=? LIMIT 1", new String[]{namespace})) {
            return c.moveToFirst();
        }
    }

    private static boolean isProcessedInTransaction(SQLiteDatabase db, String packageId, String operationId) {
        try (Cursor c = db.rawQuery(
                "SELECT 1 FROM sync_packages WHERE (package_id=? OR operation_id=?) AND status='PROCESSED' LIMIT 1",
                new String[]{safe(packageId), safe(operationId)})) {
            return c.moveToFirst();
        }
    }

    private static long count(SQLiteDatabase db, String table) {
        try (Cursor c = db.rawQuery("SELECT COUNT(*) FROM " + table, null)) {
            return c.moveToFirst() ? c.getLong(0) : 0L;
        }
    }

    private static long countWhere(SQLiteDatabase db, String table, String where) {
        try (Cursor c = db.rawQuery(
                "SELECT COUNT(*) FROM " + table + " WHERE " + where, null)) {
            return c.moveToFirst() ? c.getLong(0) : 0L;
        }
    }

    private static void audit(SQLiteDatabase db, String eventType, String details) {
        ContentValues row = new ContentValues();
        row.put("event_type", eventType);
        row.put("details", details == null ? "" : details);
        row.put("created_at", System.currentTimeMillis());
        db.insert("audit_log", null, row);
        db.execSQL("DELETE FROM audit_log WHERE id NOT IN " +
                "(SELECT id FROM audit_log ORDER BY id DESC LIMIT 5000)");
    }

    private static void validateNamespace(String namespace) {
        if (namespace == null || !namespace.matches("[a-z0-9_.-]{1,80}")) {
            throw new IllegalArgumentException("نطاق التخزين غير صالح");
        }
    }

    private static void validateState(String namespace, String payloadJson) throws Exception {
        validateNamespace(namespace);
        if (payloadJson == null || payloadJson.length() > 20_000_000) {
            throw new IllegalArgumentException("حجم البيانات غير صالح");
        }
        validateBusinessRules(namespace, new JSONObject(payloadJson));
    }

    private static void validateBusinessRules(String namespace, JSONObject root) {
        JSONArray subscribers = root.optJSONArray("subscribers");
        Set<String> subscriberCodes = new HashSet<>();
        Set<String> meterNumbers = new HashSet<>();
        if (subscribers != null) {
            for (int i = 0; i < subscribers.length(); i++) {
                JSONObject row = subscribers.optJSONObject(i);
                if (row == null) continue;
                String code = normalizedBusinessKey(firstString(row, "code", "subscriberCode"));
                String meter = normalizedBusinessKey(row.optString("meterNo", ""));
                if (!code.isEmpty() && !subscriberCodes.add(code)) {
                    throw new IllegalArgumentException("رقم المشترك مكرر");
                }
                if (!meter.isEmpty() && !meterNumbers.add(meter)) {
                    throw new IllegalArgumentException("رقم العداد مكرر");
                }
                double opening = strictNonNegativeNumber(row, "openingReading", "القراءة الافتتاحية");
                double arrears = strictNonNegativeNumber(row, "openingArrears", "المتأخرات السابقة");
                double credit = strictNonNegativeNumber(row, "openingCredit", "الرصيد المقدم");
                if (opening < 0 || arrears < 0 || credit < 0) {
                    throw new IllegalArgumentException("قيم المشترك الرقمية لا يمكن أن تكون سالبة");
                }
                if (arrears > 0 && credit > 0) {
                    throw new IllegalArgumentException(
                            "لا يمكن الجمع بين المتأخرات السابقة والرصيد المقدم");
                }
            }
        }

        JSONArray cycles = root.optJSONArray("cycles");
        Set<String> cycleKeys = new HashSet<>();
        if (cycles != null) {
            for (int i = 0; i < cycles.length(); i++) {
                JSONObject row = cycles.optJSONObject(i);
                if (row == null) continue;
                String date = row.optString("cycleDate", "").trim();
                String type = normalizedBusinessKey(row.optString("type", ""));
                if (!date.isEmpty() && !date.matches("\\d{4}-\\d{2}-\\d{2}")) {
                    throw new IllegalArgumentException("تاريخ دورة القراءة غير صالح");
                }
                if (!date.isEmpty() && !type.isEmpty() && !cycleKeys.add(type + "|" + date)) {
                    throw new IllegalArgumentException("توجد دورة قراءة مكررة في التاريخ نفسه");
                }
                Object mainCurrent = row.opt("mainCurrent");
                if (mainCurrent != null && mainCurrent != JSONObject.NULL
                        && !String.valueOf(mainCurrent).trim().isEmpty()) {
                    double previous = strictNonNegativeNumber(row, "mainPrev", "القراءة الرئيسية السابقة");
                    double current = strictNonNegativeNumber(row, "mainCurrent", "القراءة الرئيسية الحالية");
                    if (current < previous) {
                        throw new IllegalArgumentException(
                                "القراءة الرئيسية الحالية لا يمكن أن تقل عن السابقة");
                    }
                }
            }
        }

        JSONArray readings = root.optJSONArray("readings");
        Set<String> readingKeys = new HashSet<>();
        if (readings != null) {
            for (int i = 0; i < readings.length(); i++) {
                JSONObject row = readings.optJSONObject(i);
                if (row == null) continue;
                String cycleId = row.optString("cycleId", "").trim();
                String subscriberId = row.optString("subscriberId", "").trim();
                String relation = cycleId + "|" + subscriberId;
                if (!cycleId.isEmpty() && !subscriberId.isEmpty() && !readingKeys.add(relation)) {
                    throw new IllegalArgumentException("توجد قراءة مكررة للمشترك في الدورة نفسها");
                }
                double previous = strictNonNegativeNumber(row, "prev", "القراءة السابقة");
                double current = strictNonNegativeNumber(row, "current", "القراءة الحالية");
                strictNonNegativeNumber(row, "consumption", "الاستهلاك");
                boolean meterChanged = !row.optString("meterChangeId", "").trim().isEmpty();
                if (!meterChanged && current < previous) {
                    throw new IllegalArgumentException(
                            "القراءة الحالية لا يمكن أن تقل عن القراءة السابقة");
                }
            }
        }
        if ("erp.procurement".equals(namespace)) validateProcurementRules(root);
        if ("erp.inventory".equals(namespace)) validateInventoryRules(root);
        if ("erp.assets".equals(namespace)) validateAssetRules(root);
        if ("erp.hr".equals(namespace)) validateHrRules(root);
        if ("erp.maintenance".equals(namespace)) validateMaintenanceRules(root);
    }

    private static void validateAssetRules(JSONObject root) {
        JSONArray assets = root.optJSONArray("assets");
        Set<String> codes = new HashSet<>();
        Set<String> assetRefs = referenceSet(assets, "id", "assetId", "assetCode", "code", "name");
        validateUniqueKeys(assets, codes, "كود الأصل مكرر", "assetCode", "code", "no");
        if (assets != null) {
            for (int i = 0; i < assets.length(); i++) {
                JSONObject row = assets.optJSONObject(i);
                if (row == null) continue;
                double cost = strictNonNegativeNumberAny(row, "تكلفة الأصل", "cost");
                double residual = strictNonNegativeNumberAny(row,
                        "القيمة التخريدية للأصل", "residualValue");
                if (residual > cost) {
                    throw new IllegalArgumentException("القيمة التخريدية لا يمكن أن تتجاوز تكلفة الأصل");
                }
                if (requiresApprovalValidation(row)) {
                    strictPositiveNumber(row, "العمر الإنتاجي للأصل", "usefulLife", "usefulLifeYears");
                }
            }
        }
        JSONArray depreciation = root.optJSONArray("depreciationRuns");
        if (depreciation != null) {
            for (int i = 0; i < depreciation.length(); i++) {
                JSONObject row = depreciation.optJSONObject(i);
                if (row == null || !requiresApprovalValidation(row)) continue;
                requireKnownReference(row, assetRefs, "الأصل المرتبط بالإهلاك غير موجود",
                        "assetId", "asset", "assetCode");
                double opening = strictPositiveNumber(row, "القيمة الافتتاحية للإهلاك",
                        "openingValue");
                double charge = strictPositiveNumber(row, "قيمة الإهلاك", "depreciation");
                double closing = strictNonNegativeNumberAny(row, "القيمة الدفترية", "closingValue");
                if (charge > opening || Math.abs((opening - charge) - closing) > 0.01d) {
                    throw new IllegalArgumentException("قيم الإهلاك لا تحقق معادلة القيمة الدفترية");
                }
            }
        }
        JSONArray transfers = root.optJSONArray("transfers");
        if (transfers != null) {
            for (int i = 0; i < transfers.length(); i++) {
                JSONObject row = transfers.optJSONObject(i);
                if (row == null || !requiresApprovalValidation(row)) continue;
                requireKnownReference(row, assetRefs, "الأصل المرتبط بالنقل غير موجود",
                        "assetId", "asset", "assetCode");
                String from = normalizedBusinessKey(row.optString("fromLocation", ""));
                String to = normalizedBusinessKey(row.optString("toLocation", ""));
                if (from.isEmpty() || to.isEmpty() || from.equals(to)) {
                    throw new IllegalArgumentException("يجب تحديد موقعين مختلفين لنقل الأصل");
                }
            }
        }
    }

    private static void validateHrRules(JSONObject root) {
        JSONArray employees = root.optJSONArray("employees");
        Set<String> employeeNumbers = new HashSet<>();
        Set<String> employeeRefs = referenceSet(employees,
                "id", "employeeId", "employeeNo", "code", "name");
        validateUniqueKeys(employees, employeeNumbers, "الرقم الوظيفي مكرر",
                "employeeNo", "code", "no");
        if (employees != null) {
            for (int i = 0; i < employees.length(); i++) {
                JSONObject row = employees.optJSONObject(i);
                if (row != null) strictNonNegativeNumberAny(
                        row, "الراتب الأساسي", "basicSalary");
            }
        }

        JSONArray attendance = root.optJSONArray("attendance");
        Set<String> attendanceDays = new HashSet<>();
        if (attendance != null) {
            for (int i = 0; i < attendance.length(); i++) {
                JSONObject row = attendance.optJSONObject(i);
                if (row == null) continue;
                String employee = normalizedBusinessKey(firstString(
                        row, "employeeId", "employee", "employeeNo"));
                String date = row.optString("date", "").trim();
                if (!employee.isEmpty() && !date.isEmpty()
                        && !attendanceDays.add(employee + "|" + date)) {
                    throw new IllegalArgumentException("سجل حضور الموظف مكرر في اليوم نفسه");
                }
                if (!requiresApprovalValidation(row)) continue;
                requireKnownReference(row, employeeRefs, "الموظف المرتبط بالحضور غير موجود",
                        "employeeId", "employee", "employeeNo");
                if (!isIsoDate(date)) throw new IllegalArgumentException("تاريخ الحضور غير صالح");
                String checkIn = row.optString("checkIn", "");
                String checkOut = row.optString("checkOut", "");
                if (!checkIn.isEmpty() && !checkOut.isEmpty() && checkOut.compareTo(checkIn) < 0) {
                    throw new IllegalArgumentException("وقت الانصراف لا يمكن أن يسبق وقت الحضور");
                }
            }
        }

        JSONArray leaves = root.optJSONArray("leaveRequests");
        if (leaves == null) leaves = root.optJSONArray("leaves");
        if (leaves != null) {
            for (int i = 0; i < leaves.length(); i++) {
                JSONObject row = leaves.optJSONObject(i);
                if (row == null || !requiresApprovalValidation(row)) continue;
                requireKnownReference(row, employeeRefs, "الموظف المرتبط بالإجازة غير موجود",
                        "employeeId", "employee", "employeeNo");
                String start = row.optString("startDate", "");
                String end = row.optString("endDate", "");
                if (!isIsoDate(start) || !isIsoDate(end) || end.compareTo(start) < 0) {
                    throw new IllegalArgumentException("نطاق تاريخ الإجازة غير صالح");
                }
            }
        }

        JSONArray runs = root.optJSONArray("payrollRuns");
        Set<String> payrollKeys = new HashSet<>();
        if (runs == null) return;
        for (int i = 0; i < runs.length(); i++) {
            JSONObject run = runs.optJSONObject(i);
            if (run == null) continue;
            String period = normalizedBusinessKey(run.optString("period", ""));
            String department = normalizedBusinessKey(run.optString("department", ""));
            if (!period.isEmpty() && !payrollKeys.add(period + "|" + department)) {
                throw new IllegalArgumentException("مسير الرواتب مكرر للفترة والإدارة");
            }
            if (!requiresApprovalValidation(run)) continue;
            JSONArray lines = run.optJSONArray("lines");
            if (lines == null || lines.length() == 0) {
                throw new IllegalArgumentException("مسير الرواتب يجب أن يحتوي على موظف واحد على الأقل");
            }
            double gross = 0d, deductions = 0d, net = 0d;
            Set<String> runEmployees = new HashSet<>();
            for (int lineNo = 0; lineNo < lines.length(); lineNo++) {
                JSONObject line = lines.optJSONObject(lineNo);
                if (line == null) throw new IllegalArgumentException("بند مسير الرواتب غير صالح");
                requireKnownReference(line, employeeRefs, "موظف مسير الرواتب غير موجود",
                        "employeeId", "employee", "employeeNo");
                String employeeId = normalizedBusinessKey(firstString(
                        line, "employeeId", "employee", "employeeNo"));
                if (!runEmployees.add(employeeId)) {
                    throw new IllegalArgumentException("الموظف مكرر داخل مسير الرواتب");
                }
                double basic = strictNonNegativeNumberAny(line,
                        "الراتب الأساسي في المسير", "basicSalary", "basic");
                double allowances = strictNonNegativeNumberAny(line,
                        "بدلات المسير", "allowances");
                double lineDeductions = strictNonNegativeNumberAny(line,
                        "استقطاعات المسير", "deductions");
                double lineGross = basic + allowances;
                if (lineDeductions > lineGross) {
                    throw new IllegalArgumentException("الاستقطاعات تتجاوز استحقاق الموظف");
                }
                double lineNet = strictNonNegativeNumberAny(line, "صافي الموظف", "net");
                if (Math.abs(lineNet - (lineGross - lineDeductions)) > 0.01d) {
                    throw new IllegalArgumentException("صافي الموظف لا يطابق الاستحقاق ناقص الاستقطاع");
                }
                gross += lineGross;
                deductions += lineDeductions;
                net += lineNet;
            }
            if (Math.abs(strictNonNegativeNumberAny(run, "إجمالي المسير", "gross") - gross) > 0.01d
                    || Math.abs(strictNonNegativeNumberAny(
                    run, "استقطاعات المسير", "deductions") - deductions) > 0.01d
                    || Math.abs(strictNonNegativeNumberAny(run, "صافي المسير", "net") - net) > 0.01d) {
                throw new IllegalArgumentException("إجماليات مسير الرواتب لا تطابق تفاصيل الموظفين");
            }
        }
    }

    private static void validateMaintenanceRules(JSONObject root) {
        JSONArray workOrders = root.optJSONArray("workOrders");
        Set<String> orderNumbers = new HashSet<>();
        validateUniqueKeys(workOrders, orderNumbers, "رقم أمر الصيانة مكرر", "no", "orderNo");
        if (workOrders != null) {
            for (int i = 0; i < workOrders.length(); i++) {
                JSONObject row = workOrders.optJSONObject(i);
                if (row == null) continue;
                strictNonNegativeNumberAny(row, "التكلفة التقديرية", "estimatedCost");
                strictNonNegativeNumberAny(row, "التكلفة الفعلية", "actualCost");
                if (!requiresApprovalValidation(row)) continue;
                if (row.optString("title", "").trim().isEmpty()
                        || firstString(row, "assetId", "asset", "location").isEmpty()) {
                    throw new IllegalArgumentException("عنوان أمر الصيانة والأصل أو الموقع مطلوبان");
                }
                String priority = upper(row.optString("priority", ""));
                if (!Arrays.asList("LOW", "MEDIUM", "HIGH", "CRITICAL").contains(priority)) {
                    throw new IllegalArgumentException("أولوية أمر الصيانة غير معتمدة");
                }
                JSONArray parts = row.optJSONArray("lines");
                double partTotal = 0d;
                if (parts != null) {
                    for (int lineNo = 0; lineNo < parts.length(); lineNo++) {
                        JSONObject line = parts.optJSONObject(lineNo);
                        if (line == null) throw new IllegalArgumentException("قطعة غيار غير صالحة");
                        double quantity = strictPositiveNumber(line,
                                "كمية قطعة الغيار", "quantity", "qty");
                        double unitCost = strictNonNegativeNumberAny(line,
                                "تكلفة قطعة الغيار", "unitCost", "cost", "price");
                        if (firstString(line, "itemId", "item", "description", "name").isEmpty()) {
                            throw new IllegalArgumentException("وصف قطعة الغيار مطلوب");
                        }
                        partTotal += quantity * unitCost;
                    }
                }
                double actual = strictNonNegativeNumberAny(row,
                        "التكلفة الفعلية", "actualCost");
                if (actual + 0.01d < partTotal) {
                    throw new IllegalArgumentException(
                            "التكلفة الفعلية لا يمكن أن تقل عن تكلفة قطع الغيار");
                }
            }
        }

        JSONArray plans = root.optJSONArray("preventivePlans");
        if (plans != null) {
            for (int i = 0; i < plans.length(); i++) {
                JSONObject row = plans.optJSONObject(i);
                if (row == null || !requiresApprovalValidation(row)) continue;
                if (firstString(row, "assetId", "asset").isEmpty()
                        || !isIsoDate(row.optString("nextDate", ""))) {
                    throw new IllegalArgumentException(
                            "الأصل وموعد الصيانة الوقائية مطلوبان");
                }
                String frequency = upper(row.optString("frequency", ""));
                if (!Arrays.asList("WEEKLY", "MONTHLY", "QUARTERLY",
                        "SEMI_ANNUAL", "ANNUAL").contains(frequency)) {
                    throw new IllegalArgumentException("تكرار الصيانة الوقائية غير معتمد");
                }
            }
        }

        JSONArray failures = root.optJSONArray("failures");
        if (failures != null) {
            for (int i = 0; i < failures.length(); i++) {
                JSONObject row = failures.optJSONObject(i);
                if (row == null || !requiresApprovalValidation(row)) continue;
                if (row.optString("location", "").trim().isEmpty()
                        || row.optString("description", "").trim().isEmpty()) {
                    throw new IllegalArgumentException("موقع العطل ووصفه مطلوبان");
                }
                String severity = upper(row.optString("severity", ""));
                if (!Arrays.asList("LOW", "MEDIUM", "HIGH", "CRITICAL").contains(severity)) {
                    throw new IllegalArgumentException("خطورة بلاغ العطل غير معتمدة");
                }
            }
        }
    }

    private static boolean isIsoDate(String value) {
        return value != null && value.matches("\\d{4}-\\d{2}-\\d{2}");
    }

    private static void validateProcurementRules(JSONObject root) {
        JSONArray suppliers = root.optJSONArray("suppliers");
        Set<String> supplierNumbers = new HashSet<>();
        Set<String> supplierTaxNumbers = new HashSet<>();
        Set<String> supplierRefs = referenceSet(suppliers,
                "id", "supplierId", "supplierNo", "no", "code", "name");
        validateUniqueKeys(suppliers, supplierNumbers, "رقم المورد مكرر",
                "supplierNo", "no", "code");
        validateUniqueKeys(suppliers, supplierTaxNumbers, "الرقم الضريبي للمورد مكرر",
                "taxNo");

        JSONArray requests = root.optJSONArray("purchaseRequests");
        Set<String> requestNumbers = new HashSet<>();
        Set<String> requestRefs = referenceSet(requests,
                "id", "requestId", "requestNo", "no");
        validateUniqueKeys(requests, requestNumbers, "رقم طلب الشراء مكرر",
                "requestNo", "no");
        validateDocumentsWithLines(requests, "طلب الشراء", "estimatedAmount", "amount");

        JSONArray quotations = root.optJSONArray("quotations");
        Set<String> quotationNumbers = new HashSet<>();
        validateUniqueKeys(quotations, quotationNumbers, "رقم عرض السعر مكرر",
                "quotationNo", "no");
        if (quotations != null) {
            for (int i = 0; i < quotations.length(); i++) {
                JSONObject row = quotations.optJSONObject(i);
                if (row == null || !requiresApprovalValidation(row)) continue;
                requireKnownReference(row, requestRefs, "طلب الشراء المرتبط غير موجود",
                        "requestId", "requestNo", "request");
                requireKnownReference(row, supplierRefs, "المورد المرتبط بعرض السعر غير موجود",
                        "supplierId", "supplierNo", "supplier");
                strictPositiveNumber(row, "قيمة عرض السعر", "amount");
            }
        }

        JSONArray orders = root.optJSONArray("purchaseOrders");
        Set<String> orderNumbers = new HashSet<>();
        Set<String> orderRefs = referenceSet(orders,
                "id", "orderId", "orderNo", "no");
        validateUniqueKeys(orders, orderNumbers, "رقم أمر الشراء مكرر",
                "orderNo", "no");
        validateDocumentsWithLines(orders, "أمر الشراء", "amount");
        if (orders != null) {
            for (int i = 0; i < orders.length(); i++) {
                JSONObject row = orders.optJSONObject(i);
                if (row == null || !requiresApprovalValidation(row)) continue;
                requireKnownReference(row, requestRefs, "طلب الشراء المرتبط بأمر الشراء غير موجود",
                        "requestId", "requestNo", "request");
                requireKnownReference(row, supplierRefs, "المورد المرتبط بأمر الشراء غير موجود",
                        "supplierId", "supplierNo", "supplier");
            }
        }

        JSONArray receipts = root.optJSONArray("goodsReceipts");
        Set<String> receiptNumbers = new HashSet<>();
        validateUniqueKeys(receipts, receiptNumbers, "رقم استلام المشتريات مكرر",
                "receiptNo", "no");
        validateDocumentsWithLines(receipts, "استلام المشتريات");
        if (receipts != null) {
            for (int i = 0; i < receipts.length(); i++) {
                JSONObject row = receipts.optJSONObject(i);
                if (row == null || !requiresApprovalValidation(row)) continue;
                requireKnownReference(row, orderRefs, "أمر الشراء المرتبط بالاستلام غير موجود",
                        "purchaseOrderId", "purchaseOrderNo", "purchaseOrder");
                String warehouse = firstString(row, "warehouseId", "warehouseCode", "warehouse");
                if (warehouse.isEmpty()) {
                    throw new IllegalArgumentException("يجب تحديد المستودع في استلام المشتريات");
                }
            }
        }

        JSONArray invoices = root.optJSONArray("supplierInvoices");
        Set<String> invoiceNumbers = new HashSet<>();
        validateUniqueKeys(invoices, invoiceNumbers, "رقم فاتورة المورد مكرر",
                "invoiceNo", "no");
        if (invoices != null) {
            for (int i = 0; i < invoices.length(); i++) {
                JSONObject row = invoices.optJSONObject(i);
                if (row == null || !requiresApprovalValidation(row)) continue;
                requireKnownReference(row, supplierRefs, "المورد المرتبط بالفاتورة غير موجود",
                        "supplierId", "supplierNo", "supplier");
                requireKnownReference(row, orderRefs, "أمر الشراء المرتبط بالفاتورة غير موجود",
                        "purchaseOrderId", "purchaseOrderNo", "purchaseOrder");
                strictPositiveNumber(row, "قيمة فاتورة المورد", "amount");
            }
        }
    }

    private static void validateInventoryRules(JSONObject root) {
        JSONArray warehouses = root.optJSONArray("warehouses");
        Set<String> warehouseCodes = new HashSet<>();
        Set<String> warehouseRefs = referenceSet(warehouses,
                "id", "warehouseId", "code", "warehouseCode", "name");
        validateUniqueKeys(warehouses, warehouseCodes, "رمز المستودع مكرر",
                "code", "warehouseCode");

        JSONArray items = root.optJSONArray("items");
        Set<String> itemCodes = new HashSet<>();
        Set<String> itemRefs = referenceSet(items, "id", "itemId", "sku", "code", "name");
        validateUniqueKeys(items, itemCodes, "كود الصنف مكرر", "sku", "code");
        if (items != null) {
            for (int i = 0; i < items.length(); i++) {
                JSONObject row = items.optJSONObject(i);
                if (row == null) continue;
                strictNonNegativeNumberAny(row, "الحد الأدنى للصنف", "minimum", "minimumQty");
                strictNonNegativeNumberAny(row, "متوسط تكلفة الصنف", "averageCost", "unitCost");
            }
        }

        JSONArray movements = root.optJSONArray("movements");
        if (movements == null) movements = root.optJSONArray("stockMovements");
        Set<String> movementNumbers = new HashSet<>();
        validateUniqueKeys(movements, movementNumbers, "رقم حركة المخزون مكرر",
                "movementNo", "no");
        Map<String, Double> balances = new LinkedHashMap<>();
        if (movements == null) return;
        for (int i = 0; i < movements.length(); i++) {
            JSONObject row = movements.optJSONObject(i);
            if (row == null) continue;
            boolean governed = requiresApprovalValidation(row);
            String type = upper(firstString(row, "movementType", "type"));
            double quantity = governed
                    ? strictPositiveNumber(row, "كمية حركة المخزون", "quantity", "qty")
                    : strictNonNegativeNumberAny(row, "كمية حركة المخزون", "quantity", "qty");
            strictNonNegativeNumberAny(row, "تكلفة حركة المخزون",
                    "unitCost", "averageCost", "cost");
            if (!governed) continue;
            requireKnownReference(row, itemRefs, "الصنف المرتبط بحركة المخزون غير موجود",
                    "itemId", "item", "sku");
            requireKnownReference(row, warehouseRefs, "المستودع المرتبط بحركة المخزون غير موجود",
                    "warehouseId", "warehouse", "warehouseCode");
            int direction = stockDirection(type);
            if (direction == 0) {
                throw new IllegalArgumentException("نوع حركة المخزون غير معتمد");
            }
            if ("APPROVED".equals(upper(row.optString("status")))) {
                String key = normalizedBusinessKey(firstString(row, "warehouseId", "warehouse",
                        "warehouseCode")) + "|" + normalizedBusinessKey(firstString(
                        row, "itemId", "item", "sku"));
                double next = balances.containsKey(key) ? balances.get(key) : 0d;
                balances.put(key, next + direction * quantity);
            }
        }
        for (double balance : balances.values()) {
            if (balance < -0.000001d) {
                throw new IllegalArgumentException(
                        "لا يمكن اعتماد صرف يؤدي إلى رصيد مخزون سالب");
            }
        }
    }

    private static boolean requiresApprovalValidation(JSONObject row) {
        String status = upper(row.optString("status", ""));
        return "SUBMITTED".equals(status) || "APPROVED".equals(status);
    }

    private static void validateDocumentsWithLines(
            JSONArray rows, String label, String... amountKeys) {
        if (rows == null) return;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null || !requiresApprovalValidation(row)) continue;
            JSONArray lines = row.optJSONArray("lines");
            if (lines == null || lines.length() == 0) {
                throw new IllegalArgumentException(label + " يجب أن يحتوي على بند واحد على الأقل");
            }
            double total = 0d;
            for (int lineNo = 0; lineNo < lines.length(); lineNo++) {
                JSONObject line = lines.optJSONObject(lineNo);
                if (line == null) {
                    throw new IllegalArgumentException("بند " + label + " غير صالح");
                }
                double quantity = strictPositiveNumber(line, "كمية بند " + label,
                        "quantity", "qty");
                double unitCost = strictNonNegativeNumberAny(line, "سعر بند " + label,
                        "unitCost", "rate", "price", "cost");
                if (firstString(line, "itemId", "item", "sku", "code", "description", "name")
                        .isEmpty()) {
                    throw new IllegalArgumentException("وصف بند " + label + " مطلوب");
                }
                total += quantity * unitCost;
            }
            if (amountKeys.length > 0) {
                double declared = strictPositiveNumber(row, "قيمة " + label, amountKeys);
                if (Math.abs(declared - total) > Math.max(0.01d, total * 0.001d)) {
                    throw new IllegalArgumentException("قيمة " + label + " لا تطابق مجموع البنود");
                }
            }
        }
    }

    private static Set<String> referenceSet(JSONArray rows, String... keys) {
        Set<String> result = new HashSet<>();
        if (rows == null) return result;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null) continue;
            for (String key : keys) {
                String value = normalizedBusinessKey(row.optString(key, ""));
                if (!value.isEmpty()) result.add(value);
            }
        }
        return result;
    }

    private static void requireKnownReference(
            JSONObject row, Set<String> references, String message, String... keys) {
        String value = normalizedBusinessKey(firstString(row, keys));
        if (value.isEmpty() || !references.contains(value)) {
            throw new IllegalArgumentException(message);
        }
    }

    private static void validateUniqueKeys(
            JSONArray rows, Set<String> seen, String message, String... keys) {
        if (rows == null) return;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null) continue;
            String value = normalizedBusinessKey(firstString(row, keys));
            if (!value.isEmpty() && !seen.add(value)) {
                throw new IllegalArgumentException(message);
            }
        }
    }

    private static int stockDirection(String type) {
        if (Arrays.asList("IN", "RECEIPT", "PURCHASE", "OPENING",
                "ADJUSTMENT_IN", "TRANSFER_IN").contains(type)) return 1;
        if (Arrays.asList("OUT", "ISSUE", "SALE", "ADJUSTMENT_OUT",
                "TRANSFER_OUT").contains(type)) return -1;
        return 0;
    }

    private static double strictPositiveNumber(
            JSONObject row, String label, String... keys) {
        double value = strictNonNegativeNumberAny(row, label, keys);
        if (value <= 0d) throw new IllegalArgumentException(label + " يجب أن تكون أكبر من صفر");
        return value;
    }

    private static double strictNonNegativeNumberAny(
            JSONObject row, String label, String... keys) {
        for (String key : keys) {
            Object raw = row.opt(key);
            if (raw == null || raw == JSONObject.NULL
                    || String.valueOf(raw).trim().isEmpty()) continue;
            return strictNonNegativeNumber(row, key, label);
        }
        return 0d;
    }

    private static double strictNonNegativeNumber(JSONObject row, String key, String label) {
        Object raw = row.opt(key);
        if (raw == null || raw == JSONObject.NULL || String.valueOf(raw).trim().isEmpty()) return 0d;
        try {
            double value = Double.parseDouble(String.valueOf(raw).replace(",", "").trim());
            if (Double.isNaN(value) || Double.isInfinite(value) || value < 0d) {
                throw new NumberFormatException();
            }
            return value;
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(label + " يجب أن تكون رقمًا موجبًا أو صفرًا");
        }
    }

    private static String normalizedBusinessKey(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private static String upper(String value) {
        return safe(value).trim().toUpperCase(Locale.ROOT);
    }

    private static String safe(String value) { return value == null ? "" : value; }

    public static String sha256(String text) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest((text == null ? "" : text).getBytes(StandardCharsets.UTF_8));
        StringBuilder out = new StringBuilder(hash.length * 2);
        for (byte b : hash) out.append(String.format(Locale.US, "%02x", b & 0xff));
        return out.toString();
    }
}
