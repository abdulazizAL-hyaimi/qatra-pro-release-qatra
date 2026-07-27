package com.qatra.pro;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.UUID;

/** Durable cloud queue, cursor, profile and conflict log. */
final class QatraCloudDatabase extends SQLiteOpenHelper {
    private static final String NAME = "qatra-cloud-sync.db";
    private static final int VERSION = 1;

    QatraCloudDatabase(Context context) {
        super(context.getApplicationContext(), NAME, null, VERSION);
        setWriteAheadLoggingEnabled(true);
    }

    @Override public void onConfigure(SQLiteDatabase db) {
        super.onConfigure(db);
        db.setForeignKeyConstraintsEnabled(true);
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE profile(" +
                "id INTEGER PRIMARY KEY CHECK(id=1)," +
                "base_url TEXT NOT NULL," +
                "username TEXT NOT NULL," +
                "workspace_id TEXT NOT NULL," +
                "employee_code TEXT NOT NULL," +
                "role TEXT NOT NULL," +
                "device_id TEXT NOT NULL," +
                "token_expires_at INTEGER NOT NULL," +
                "last_sequence INTEGER NOT NULL DEFAULT 0," +
                "last_sync_at INTEGER," +
                "last_error TEXT NOT NULL DEFAULT '')");
        db.execSQL("CREATE TABLE outbox(" +
                "operation_id TEXT PRIMARY KEY NOT NULL," +
                "namespace TEXT NOT NULL," +
                "payload_json TEXT NOT NULL," +
                "payload_hash TEXT NOT NULL," +
                "created_at INTEGER NOT NULL," +
                "attempts INTEGER NOT NULL DEFAULT 0," +
                "next_attempt_at INTEGER NOT NULL DEFAULT 0," +
                "status TEXT NOT NULL DEFAULT 'PENDING'," +
                "last_error TEXT NOT NULL DEFAULT '')");
        db.execSQL("CREATE UNIQUE INDEX ux_outbox_pending_namespace_hash ON outbox(namespace,payload_hash,status)");
        db.execSQL("CREATE INDEX ix_outbox_due ON outbox(status,next_attempt_at,created_at)");
        db.execSQL("CREATE TABLE inbox(" +
                "sequence INTEGER PRIMARY KEY NOT NULL," +
                "operation_id TEXT NOT NULL UNIQUE," +
                "source_role TEXT NOT NULL," +
                "namespace TEXT NOT NULL," +
                "payload_json TEXT NOT NULL," +
                "accepted_at TEXT NOT NULL," +
                "status TEXT NOT NULL DEFAULT 'RECEIVED'," +
                "received_at INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE conflicts(" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "namespace TEXT NOT NULL," +
                "operation_id TEXT NOT NULL," +
                "reason TEXT NOT NULL," +
                "payload_json TEXT NOT NULL," +
                "created_at INTEGER NOT NULL)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { }

    synchronized String deviceId() {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT device_id FROM profile WHERE id=1", null)) {
            if (c.moveToFirst()) return c.getString(0);
        }
        return "QD-" + UUID.randomUUID();
    }

    synchronized void saveProfile(JSONObject p) throws Exception {
        ContentValues v = new ContentValues();
        v.put("id", 1);
        v.put("base_url", p.getString("baseUrl"));
        v.put("username", p.getString("username"));
        v.put("workspace_id", p.optString("workspaceId", ""));
        v.put("employee_code", p.optString("employeeCode", ""));
        v.put("role", p.optString("role", ""));
        v.put("device_id", p.getString("deviceId"));
        v.put("token_expires_at", p.optLong("tokenExpiresAt", 0L));
        v.put("last_sequence", p.optLong("lastSequence", currentCursor()));
        v.put("last_sync_at", p.optLong("lastSyncAt", 0L));
        v.put("last_error", p.optString("lastError", ""));
        getWritableDatabase().insertWithOnConflict("profile", null, v, SQLiteDatabase.CONFLICT_REPLACE);
    }

    synchronized JSONObject profile() throws Exception {
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT base_url,username,workspace_id,employee_code,role,device_id,token_expires_at,last_sequence,last_sync_at,last_error FROM profile WHERE id=1",
                null)) {
            if (!c.moveToFirst()) return null;
            JSONObject o = new JSONObject();
            o.put("baseUrl", c.getString(0));
            o.put("username", c.getString(1));
            o.put("workspaceId", c.getString(2));
            o.put("employeeCode", c.getString(3));
            o.put("role", c.getString(4));
            o.put("deviceId", c.getString(5));
            o.put("tokenExpiresAt", c.getLong(6));
            o.put("lastSequence", c.getLong(7));
            o.put("lastSyncAt", c.getLong(8));
            o.put("lastError", c.getString(9));
            return o;
        }
    }

    synchronized boolean enqueueSnapshot(String namespace, String payloadJson, String payloadHash) {
        SQLiteDatabase db = getWritableDatabase();
        try (Cursor c = db.rawQuery(
                "SELECT 1 FROM outbox WHERE namespace=? AND payload_hash=? AND status IN('PENDING','SENDING','SENT') LIMIT 1",
                new String[]{namespace, payloadHash})) {
            if (c.moveToFirst()) return false;
        }
        ContentValues v = new ContentValues();
        v.put("operation_id", UUID.randomUUID().toString());
        v.put("namespace", namespace);
        v.put("payload_json", payloadJson);
        v.put("payload_hash", payloadHash);
        v.put("created_at", System.currentTimeMillis());
        v.put("attempts", 0);
        v.put("next_attempt_at", 0);
        v.put("status", "PENDING");
        v.put("last_error", "");
        return db.insert("outbox", null, v) != -1L;
    }

    synchronized JSONArray dueOutbox(int limit) throws Exception {
        JSONArray rows = new JSONArray();
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT operation_id,namespace,payload_json,payload_hash,attempts,created_at FROM outbox " +
                        "WHERE status IN('PENDING','FAILED') AND next_attempt_at<=? ORDER BY created_at LIMIT ?",
                new String[]{String.valueOf(System.currentTimeMillis()), String.valueOf(Math.max(1, Math.min(limit, 50))) })) {
            while (c.moveToNext()) {
                JSONObject o = new JSONObject();
                o.put("operationId", c.getString(0));
                o.put("namespace", c.getString(1));
                o.put("payload", new JSONObject(c.getString(2)));
                o.put("payloadHash", c.getString(3));
                o.put("attempts", c.getInt(4));
                o.put("createdAt", c.getLong(5));
                rows.put(o);
            }
        }
        return rows;
    }

    synchronized void markSending(String operationId) {
        ContentValues v = new ContentValues();
        v.put("status", "SENDING");
        getWritableDatabase().update("outbox", v, "operation_id=?", new String[]{operationId});
    }

    synchronized void markSent(String operationId) {
        ContentValues v = new ContentValues();
        v.put("status", "SENT");
        v.put("last_error", "");
        getWritableDatabase().update("outbox", v, "operation_id=?", new String[]{operationId});
    }

    synchronized void markFailed(String operationId, int attempts, String error) {
        long delay = Math.min(30L * 60_000L, (long) Math.pow(2, Math.min(10, Math.max(0, attempts))) * 5_000L);
        ContentValues v = new ContentValues();
        v.put("status", "FAILED");
        v.put("attempts", attempts + 1);
        v.put("next_attempt_at", System.currentTimeMillis() + delay);
        v.put("last_error", safe(error));
        getWritableDatabase().update("outbox", v, "operation_id=?", new String[]{operationId});
    }

    synchronized int pendingCount() {
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT COUNT(*) FROM outbox WHERE status IN('PENDING','FAILED','SENDING')", null)) {
            return c.moveToFirst() ? c.getInt(0) : 0;
        }
    }

    synchronized boolean hasPendingForNamespace(String namespace) {
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT 1 FROM outbox WHERE namespace=? AND status IN('PENDING','FAILED','SENDING') LIMIT 1",
                new String[]{namespace})) {
            return c.moveToFirst();
        }
    }

    synchronized void storeInbox(long sequence, String operationId, String sourceRole,
                                 String namespace, String payloadJson, String acceptedAt) {
        ContentValues v = new ContentValues();
        v.put("sequence", sequence);
        v.put("operation_id", operationId);
        v.put("source_role", sourceRole);
        v.put("namespace", namespace);
        v.put("payload_json", payloadJson);
        v.put("accepted_at", safe(acceptedAt));
        v.put("status", "RECEIVED");
        v.put("received_at", System.currentTimeMillis());
        getWritableDatabase().insertWithOnConflict("inbox", null, v, SQLiteDatabase.CONFLICT_IGNORE);
    }

    synchronized void markInboxApplied(long sequence) {
        ContentValues v = new ContentValues();
        v.put("status", "APPLIED");
        getWritableDatabase().update("inbox", v, "sequence=?", new String[]{String.valueOf(sequence)});
    }

    synchronized void recordConflict(String namespace, String operationId, String reason, String payloadJson) {
        ContentValues v = new ContentValues();
        v.put("namespace", safe(namespace));
        v.put("operation_id", safe(operationId));
        v.put("reason", safe(reason));
        v.put("payload_json", safe(payloadJson));
        v.put("created_at", System.currentTimeMillis());
        getWritableDatabase().insert("conflicts", null, v);
    }

    synchronized int conflictCount() {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM conflicts", null)) {
            return c.moveToFirst() ? c.getInt(0) : 0;
        }
    }

    synchronized long currentCursor() {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT last_sequence FROM profile WHERE id=1", null)) {
            return c.moveToFirst() ? c.getLong(0) : 0L;
        }
    }

    synchronized void updateCursor(long sequence) {
        ContentValues v = new ContentValues();
        v.put("last_sequence", Math.max(0L, sequence));
        getWritableDatabase().update("profile", v, "id=1", null);
    }

    synchronized void markSyncResult(boolean ok, String error) {
        ContentValues v = new ContentValues();
        v.put("last_sync_at", System.currentTimeMillis());
        v.put("last_error", ok ? "" : safe(error));
        getWritableDatabase().update("profile", v, "id=1", null);
    }

    synchronized void clearProfileAndQueue() {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("outbox", null, null);
            db.delete("inbox", null, null);
            db.delete("conflicts", null, null);
            db.delete("profile", null, null);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    private static String safe(String value) {
        if (value == null) return "";
        return value.length() > 2000 ? value.substring(0, 2000) : value;
    }
}
