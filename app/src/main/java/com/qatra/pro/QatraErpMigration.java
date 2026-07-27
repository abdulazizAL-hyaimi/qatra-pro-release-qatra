package com.qatra.pro;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Idempotent migration from the four legacy Qatra role states into the unified ERP namespaces.
 * A SQLite snapshot and an IN_PROGRESS ledger are saved before target states are changed. Re-running
 * the same source hash is safe and never duplicates a source record.
 */
public final class QatraErpMigration {
    public static final String MIGRATION_NS = "erp.migration";
    private static final String SOURCE_ADMIN = "admin";
    private static final String SOURCE_ENTERPRISE = "enterprise.core";
    private static final String SOURCE_STAFF = "admin.staff";
    private static final String SOURCE_READER = "reader";
    private static final String SOURCE_COLLECTOR = "collector";
    private static final String SOURCE_CASHIER = "cashier";

    private final QatraDatabase database;

    public QatraErpMigration(QatraDatabase database) {
        this.database = database;
    }

    public JSONObject preview() throws Exception {
        Sources sources = readSources();
        JSONObject counts = counts(sources);
        String hash = sourceHash(sources);
        JSONObject ledger = readObject(MIGRATION_NS);
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("sourceFound", sources.any());
        out.put("sourceHash", hash);
        out.put("counts", counts);
        out.put("alreadyMigrated", hash.equals(ledger.optString("lastCommittedSourceHash", "")));
        out.put("lastStatus", ledger.optString("status", "NOT_STARTED"));
        out.put("lastCommittedAt", ledger.optLong("committedAt", 0L));
        out.put("warnings", warnings(sources));
        return out;
    }

    public synchronized JSONObject commit(String actorUserId) throws Exception {
        Sources sources = readSources();
        if (!sources.any()) throw new SecurityException("لا توجد بيانات قديمة لترحيلها");
        String hash = sourceHash(sources);
        JSONObject ledger = readObject(MIGRATION_NS);
        if (hash.equals(ledger.optString("lastCommittedSourceHash", ""))) {
            JSONObject duplicate = preview();
            duplicate.put("duplicate", true);
            duplicate.put("message", "تم ترحيل هذه البيانات سابقًا ولم تُكرر");
            return duplicate;
        }

        long startedAt = System.currentTimeMillis();
        JSONObject snapshot = new JSONObject();
        snapshot.put(SOURCE_ADMIN, sources.admin);
        snapshot.put(SOURCE_ENTERPRISE, sources.enterprise);
        snapshot.put(SOURCE_STAFF, sources.staff);
        snapshot.put(SOURCE_READER, sources.reader);
        snapshot.put(SOURCE_COLLECTOR, sources.collector);
        snapshot.put(SOURCE_CASHIER, sources.cashier);

        JSONArray history = ledger.optJSONArray("history");
        if (history == null) history = new JSONArray();
        JSONObject run = new JSONObject();
        run.put("id", "MIG-" + startedAt);
        run.put("sourceHash", hash);
        run.put("status", "IN_PROGRESS");
        run.put("actorUserId", safe(actorUserId));
        run.put("startedAt", startedAt);
        run.put("sourceCounts", counts(sources));
        run.put("snapshot", snapshot);
        history.put(run);
        trimHistory(history, 3);
        ledger.put("version", 1);
        ledger.put("status", "IN_PROGRESS");
        ledger.put("activeSourceHash", hash);
        ledger.put("history", history);
        database.saveState(MIGRATION_NS, ledger.toString());

        try {
            Map<String, JSONObject> targets = transform(sources, actorUserId, hash);
            for (Map.Entry<String, JSONObject> entry : targets.entrySet()) {
                database.saveState(entry.getKey(), entry.getValue().toString());
            }
            run.put("status", "COMMITTED");
            run.put("committedAt", System.currentTimeMillis());
            run.put("targetCounts", targetCounts(targets));
            ledger.put("status", "COMMITTED");
            ledger.put("lastCommittedSourceHash", hash);
            ledger.put("committedAt", run.optLong("committedAt"));
            ledger.remove("activeSourceHash");
            database.saveState(MIGRATION_NS, ledger.toString());
            JSONObject out = preview();
            out.put("duplicate", false);
            out.put("message", "تم ترحيل بيانات التطبيقات القديمة إلى Qatra ERP");
            out.put("targetCounts", run.optJSONObject("targetCounts"));
            return out;
        } catch (Exception error) {
            run.put("status", "FAILED");
            run.put("failedAt", System.currentTimeMillis());
            run.put("error", safe(error.getMessage()));
            ledger.put("status", "FAILED");
            ledger.put("lastError", safe(error.getMessage()));
            try { database.saveState(MIGRATION_NS, ledger.toString()); } catch (Exception ignored) { }
            throw error;
        }
    }

    public synchronized JSONObject restoreLastSnapshot(String actorUserId) throws Exception {
        JSONObject ledger = readObject(MIGRATION_NS);
        JSONArray history = ledger.optJSONArray("history");
        if (history == null || history.length() == 0) {
            throw new SecurityException("لا توجد لقطة ترحيل يمكن استعادتها");
        }
        JSONObject latest = history.optJSONObject(history.length() - 1);
        JSONObject snapshot = latest == null ? null : latest.optJSONObject("snapshot");
        if (snapshot == null) throw new SecurityException("لقطة الترحيل غير مكتملة");
        for (String namespace : new String[]{SOURCE_ADMIN, SOURCE_ENTERPRISE, SOURCE_STAFF,
                SOURCE_READER, SOURCE_COLLECTOR, SOURCE_CASHIER}) {
            JSONObject state = snapshot.optJSONObject(namespace);
            if (state != null && state.length() > 0) database.saveState(namespace, state.toString());
        }
        JSONObject event = new JSONObject();
        event.put("id", "RESTORE-" + System.currentTimeMillis());
        event.put("status", "SOURCE_SNAPSHOT_RESTORED");
        event.put("actorUserId", safe(actorUserId));
        event.put("at", System.currentTimeMillis());
        history.put(event);
        trimHistory(history, 4);
        ledger.put("history", history);
        ledger.put("lastSourceRestoreAt", event.optLong("at"));
        database.saveState(MIGRATION_NS, ledger.toString());
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("message", "تمت استعادة لقطة بيانات التطبيقات القديمة داخل SQLite");
        return out;
    }

    private Map<String, JSONObject> transform(Sources s, String actor, String sourceHash) throws Exception {
        Map<String, JSONObject> targets = new LinkedHashMap<>();
        JSONObject billing = readObject("erp.billing");
        JSONObject accounting = readObject("erp.accounting");
        JSONObject procurement = readObject("erp.procurement");
        JSONObject inventory = readObject("erp.inventory");
        JSONObject assets = readObject("erp.assets");
        JSONObject hr = readObject("erp.hr");
        JSONObject maintenance = readObject("erp.maintenance");
        JSONObject documents = readObject("erp.documents");
        JSONObject core = readObject("erp.core");
        JSONObject audit = readObject("erp.audit");

        merge(billing, "subscribers", s.admin.optJSONArray("subscribers"), SOURCE_ADMIN);
        merge(billing, "cycles", s.admin.optJSONArray("cycles"), SOURCE_ADMIN);
        merge(billing, "readings", s.admin.optJSONArray("readings"), SOURCE_ADMIN);
        merge(billing, "invoices", s.admin.optJSONArray("invoices"), SOURCE_ADMIN);
        merge(billing, "payments", s.admin.optJSONArray("payments"), SOURCE_ADMIN);
        deriveMeters(billing);

        merge(accounting, "operationalExpenses", s.admin.optJSONArray("expenses"), SOURCE_ADMIN);
        copyObject(core, "legacyProjectSettings", s.admin.optJSONObject("settings"));
        copyObject(core, "legacyMeta", s.admin.optJSONObject("meta"));

        merge(procurement, "suppliers", s.enterprise.optJSONArray("suppliers"), SOURCE_ENTERPRISE);
        merge(procurement, "purchaseRequests", s.enterprise.optJSONArray("purchaseRequests"), SOURCE_ENTERPRISE);
        merge(procurement, "purchaseOrders", s.enterprise.optJSONArray("purchaseOrders"), SOURCE_ENTERPRISE);
        merge(procurement, "goodsReceipts", s.enterprise.optJSONArray("goodsReceipts"), SOURCE_ENTERPRISE);
        merge(procurement, "supplierInvoices", s.enterprise.optJSONArray("supplierInvoices"), SOURCE_ENTERPRISE);

        merge(inventory, "items", s.enterprise.optJSONArray("inventoryItems"), SOURCE_ENTERPRISE);
        merge(inventory, "warehouses", s.enterprise.optJSONArray("warehouses"), SOURCE_ENTERPRISE);
        merge(inventory, "movements", s.enterprise.optJSONArray("stockMovements"), SOURCE_ENTERPRISE);

        merge(assets, "assets", s.enterprise.optJSONArray("assets"), SOURCE_ENTERPRISE);
        merge(hr, "employees", s.enterprise.optJSONArray("employees"), SOURCE_ENTERPRISE);
        merge(hr, "attendance", s.enterprise.optJSONArray("attendance"), SOURCE_ENTERPRISE);
        merge(hr, "leaveRequests", s.enterprise.optJSONArray("leaves"), SOURCE_ENTERPRISE);
        merge(hr, "payrollRuns", s.enterprise.optJSONArray("payrollRuns"), SOURCE_ENTERPRISE);
        merge(maintenance, "workOrders", s.enterprise.optJSONArray("workOrders"), SOURCE_ENTERPRISE);
        merge(core, "budgets", s.enterprise.optJSONArray("budgets"), SOURCE_ENTERPRISE);
        merge(core, "legacyApprovals", s.enterprise.optJSONArray("approvals"), SOURCE_ENTERPRISE);
        merge(documents, "documents", s.enterprise.optJSONArray("documents"), SOURCE_ENTERPRISE);
        merge(audit, "legacyEnterpriseAudit", s.enterprise.optJSONArray("audit"), SOURCE_ENTERPRISE);
        merge(audit, "legacyStaff", s.staff.optJSONArray("users"), SOURCE_STAFF);

        JSONObject migrationMeta = new JSONObject();
        migrationMeta.put("sourceHash", sourceHash);
        migrationMeta.put("migratedAt", System.currentTimeMillis());
        migrationMeta.put("migratedBy", safe(actor));
        for (JSONObject target : new JSONObject[]{billing, accounting, procurement, inventory,
                assets, hr, maintenance, documents, core, audit}) {
            target.put("migration", migrationMeta);
            target.put("updatedAt", System.currentTimeMillis());
        }

        targets.put("erp.billing", billing);
        targets.put("erp.accounting", accounting);
        targets.put("erp.procurement", procurement);
        targets.put("erp.inventory", inventory);
        targets.put("erp.assets", assets);
        targets.put("erp.hr", hr);
        targets.put("erp.maintenance", maintenance);
        targets.put("erp.documents", documents);
        targets.put("erp.core", core);
        targets.put("erp.audit", audit);
        return targets;
    }

    private static void merge(JSONObject target, String key, JSONArray source, String sourceNamespace)
            throws Exception {
        JSONArray destination = target.optJSONArray(key);
        if (destination == null) { destination = new JSONArray(); target.put(key, destination); }
        if (source == null) return;
        Map<String, Boolean> seen = new LinkedHashMap<>();
        for (int i = 0; i < destination.length(); i++) {
            JSONObject row = destination.optJSONObject(i);
            if (row == null) continue;
            String identity = row.optString("sourceIdentity", "");
            if (!identity.isEmpty()) seen.put(identity, true);
        }
        for (int i = 0; i < source.length(); i++) {
            JSONObject raw = source.optJSONObject(i);
            if (raw == null) continue;
            String sourceId = first(raw, "id", "no", "code", "username", "meterNo");
            if (sourceId.isEmpty()) sourceId = "ROW-" + i + "-" + QatraDatabase.sha256(raw.toString()).substring(0, 12);
            String identity = sourceNamespace + ":" + key + ":" + sourceId;
            if (seen.containsKey(identity)) continue;
            JSONObject row = new JSONObject(raw.toString());
            row.put("sourceNamespace", sourceNamespace);
            row.put("sourceId", sourceId);
            row.put("sourceIdentity", identity);
            if (!row.has("status")) row.put("status", "DRAFT");
            else row.put("status", normalizeStatus(row.optString("status")));
            if (!row.has("updatedAt")) row.put("updatedAt", System.currentTimeMillis());
            destination.put(row);
            seen.put(identity, true);
        }
    }

    private static void deriveMeters(JSONObject billing) throws Exception {
        JSONArray subscribers = billing.optJSONArray("subscribers");
        JSONArray meters = billing.optJSONArray("meters");
        if (meters == null) { meters = new JSONArray(); billing.put("meters", meters); }
        Map<String, Boolean> seen = new LinkedHashMap<>();
        for (int i = 0; i < meters.length(); i++) {
            String no = meters.optJSONObject(i) == null ? "" : meters.optJSONObject(i).optString("meterNo", "");
            if (!no.isEmpty()) seen.put(no.trim().toLowerCase(Locale.ROOT), true);
        }
        if (subscribers == null) return;
        for (int i = 0; i < subscribers.length(); i++) {
            JSONObject sub = subscribers.optJSONObject(i);
            if (sub == null) continue;
            String meterNo = first(sub, "meterNo", "meterNumber", "meter");
            if (meterNo.isEmpty() || seen.containsKey(meterNo.toLowerCase(Locale.ROOT))) continue;
            JSONObject meter = new JSONObject();
            meter.put("id", "MTR-MIG-" + QatraDatabase.sha256(meterNo).substring(0, 12));
            meter.put("meterNo", meterNo);
            meter.put("subscriberId", first(sub, "id", "subscriberId", "code"));
            meter.put("subscriber", first(sub, "name", "subscriberName"));
            meter.put("status", "ACTIVE");
            meter.put("sourceNamespace", SOURCE_ADMIN);
            meter.put("sourceIdentity", SOURCE_ADMIN + ":meters:" + meterNo);
            meter.put("updatedAt", System.currentTimeMillis());
            meters.put(meter);
            seen.put(meterNo.toLowerCase(Locale.ROOT), true);
        }
    }

    private Sources readSources() throws Exception {
        return new Sources(readObject(SOURCE_ADMIN), readObject(SOURCE_ENTERPRISE),
                readObject(SOURCE_STAFF), readObject(SOURCE_READER),
                readObject(SOURCE_COLLECTOR), readObject(SOURCE_CASHIER));
    }

    private JSONObject readObject(String namespace) throws Exception {
        String payload = database.getState(namespace);
        return payload == null || payload.trim().isEmpty() ? new JSONObject() : new JSONObject(payload);
    }

    private static JSONObject counts(Sources s) throws Exception {
        JSONObject out = new JSONObject();
        out.put("subscribers", length(s.admin, "subscribers"));
        out.put("cycles", length(s.admin, "cycles"));
        out.put("readings", length(s.admin, "readings"));
        out.put("invoices", length(s.admin, "invoices"));
        out.put("payments", length(s.admin, "payments"));
        out.put("expenses", length(s.admin, "expenses"));
        out.put("staff", length(s.staff, "users"));
        out.put("suppliers", length(s.enterprise, "suppliers"));
        out.put("purchaseRequests", length(s.enterprise, "purchaseRequests"));
        out.put("inventoryItems", length(s.enterprise, "inventoryItems"));
        out.put("assets", length(s.enterprise, "assets"));
        out.put("employees", length(s.enterprise, "employees"));
        out.put("workOrders", length(s.enterprise, "workOrders"));
        out.put("readerRecords", arrayTotal(s.reader));
        out.put("collectorRecords", arrayTotal(s.collector));
        out.put("cashierRecords", arrayTotal(s.cashier));
        return out;
    }

    private static JSONObject targetCounts(Map<String, JSONObject> targets) throws Exception {
        JSONObject out = new JSONObject();
        for (Map.Entry<String, JSONObject> entry : targets.entrySet()) {
            out.put(entry.getKey(), arrayTotal(entry.getValue()));
        }
        return out;
    }

    private static JSONArray warnings(Sources s) throws Exception {
        JSONArray warnings = new JSONArray();
        if (s.staff.optJSONArray("users") != null && s.staff.optJSONArray("users").length() > 0) {
            warnings.put("ستُنقل هويات الموظفين للسجل المرجعي فقط؛ يجب إنشاء كلمات مرور مؤقتة في إدارة المستخدمين.");
        }
        if (arrayTotal(s.reader) + arrayTotal(s.collector) + arrayTotal(s.cashier) > 0) {
            warnings.put("بيانات الأجهزة الميدانية تُحفظ في اللقطة؛ دمج العمليات غير المسلّمة يحتاج مراجعة قبل اعتمادها.");
        }
        warnings.put("لا تُحذف بيانات التطبيقات الأربعة بعد الترحيل؛ تبقى متاحة للرجوع والمطابقة.");
        return warnings;
    }

    private static String sourceHash(Sources s) throws Exception {
        return QatraDatabase.sha256(s.admin.toString() + "|" + s.enterprise.toString() + "|"
                + s.staff.toString() + "|" + s.reader.toString() + "|"
                + s.collector.toString() + "|" + s.cashier.toString());
    }

    private static int length(JSONObject object, String key) {
        JSONArray rows = object.optJSONArray(key);
        return rows == null ? 0 : rows.length();
    }

    private static int arrayTotal(JSONObject object) {
        int count = 0;
        JSONArray names = object.names();
        if (names == null) return 0;
        for (int i = 0; i < names.length(); i++) {
            JSONArray rows = object.optJSONArray(names.optString(i));
            if (rows != null) count += rows.length();
        }
        return count;
    }

    private static void copyObject(JSONObject target, String key, JSONObject value) throws Exception {
        if (value != null && value.length() > 0 && !target.has(key)) {
            target.put(key, new JSONObject(value.toString()));
        }
    }

    private static String first(JSONObject object, String... keys) {
        for (String key : keys) {
            String value = object.optString(key, "").trim();
            if (!value.isEmpty()) return value;
        }
        return "";
    }

    private static String normalizeStatus(String value) {
        String status = safe(value).trim().toUpperCase(Locale.ROOT);
        if (status.isEmpty()) return "DRAFT";
        if ("PENDING".equals(status) || "OPEN".equals(status)) return "SUBMITTED";
        if ("ACTIVE".equals(status) || "COMPLETED".equals(status) || "PAID".equals(status)) return "APPROVED";
        if ("CANCELLED".equals(status) || "DISABLED".equals(status)) return "ARCHIVED";
        if ("PARTIAL".equals(status) || "UNPAID".equals(status)) return "APPROVED";
        return status;
    }

    private static void trimHistory(JSONArray history, int max) throws Exception {
        while (history.length() > max) history.remove(0);
    }

    private static String safe(String value) { return value == null ? "" : value; }

    private static final class Sources {
        final JSONObject admin, enterprise, staff, reader, collector, cashier;
        Sources(JSONObject admin, JSONObject enterprise, JSONObject staff,
                JSONObject reader, JSONObject collector, JSONObject cashier) {
            this.admin = admin; this.enterprise = enterprise; this.staff = staff;
            this.reader = reader; this.collector = collector; this.cashier = cashier;
        }
        boolean any() {
            return admin.length() > 0 || enterprise.length() > 0 || staff.length() > 0
                    || reader.length() > 0 || collector.length() > 0 || cashier.length() > 0;
        }
    }
}