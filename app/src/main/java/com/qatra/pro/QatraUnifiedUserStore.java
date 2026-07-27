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
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/**
 * Local-first multi-user identity store for the unified Qatra ERP application.
 * Passwords are never stored. Each verifier uses a random salt and PBKDF2.
 * The store is intentionally separate from operational data so backups and
 * permission checks can be reviewed independently.
 */
public final class QatraUnifiedUserStore extends SQLiteOpenHelper {
    private static final String DB_NAME = "qatra-erp-identity.db";
    private static final int DB_VERSION = 1;
    private static final int ITERATIONS = 180_000;
    private static final int KEY_LENGTH = 256;
    private static final SecureRandom RANDOM = new SecureRandom();

    public static final String ROLE_SYSTEM_ADMIN = "SYSTEM_ADMIN";
    public static final String ROLE_ADMIN = "ADMIN";
    public static final String ROLE_ACCOUNTANT = "ACCOUNTANT";
    public static final String ROLE_READER = "READER";
    public static final String ROLE_COLLECTOR = "COLLECTOR";
    public static final String ROLE_CASHIER = "CASHIER";
    public static final String ROLE_PROCUREMENT = "PROCUREMENT";
    public static final String ROLE_INVENTORY = "INVENTORY";
    public static final String ROLE_HR = "HR";
    public static final String ROLE_MAINTENANCE = "MAINTENANCE";
    public static final String ROLE_AUDITOR = "AUDITOR";

    public static final String P_MANAGE_USERS = "MANAGE_USERS";
    public static final String P_MANAGE_SECURITY = "MANAGE_SECURITY";
    public static final String P_VIEW_DASHBOARD = "VIEW_DASHBOARD";
    public static final String P_MANAGE_BILLING = "MANAGE_BILLING";
    public static final String P_CAPTURE_READINGS = "CAPTURE_READINGS";
    public static final String P_COLLECT_PAYMENTS = "COLLECT_PAYMENTS";
    public static final String P_MANAGE_CASHBOX = "MANAGE_CASHBOX";
    public static final String P_MANAGE_ACCOUNTING = "MANAGE_ACCOUNTING";
    public static final String P_APPROVE_ACCOUNTING = "APPROVE_ACCOUNTING";
    public static final String P_MANAGE_PROCUREMENT = "MANAGE_PROCUREMENT";
    public static final String P_APPROVE_PROCUREMENT = "APPROVE_PROCUREMENT";
    public static final String P_MANAGE_INVENTORY = "MANAGE_INVENTORY";
    public static final String P_APPROVE_INVENTORY = "APPROVE_INVENTORY";
    public static final String P_MANAGE_ASSETS = "MANAGE_ASSETS";
    public static final String P_MANAGE_HR = "MANAGE_HR";
    public static final String P_APPROVE_PAYROLL = "APPROVE_PAYROLL";
    public static final String P_MANAGE_MAINTENANCE = "MANAGE_MAINTENANCE";
    public static final String P_APPROVE_MAINTENANCE = "APPROVE_MAINTENANCE";
    public static final String P_VIEW_REPORTS = "VIEW_REPORTS";
    public static final String P_EXPORT_DATA = "EXPORT_DATA";
    public static final String P_VIEW_AUDIT = "VIEW_AUDIT";
    public static final String P_MANAGE_SETTINGS = "MANAGE_SETTINGS";

    private static final Map<String, Set<String>> DEFAULT_ROLE_PERMISSIONS;
    static {
        Map<String, Set<String>> roles = new LinkedHashMap<>();
        Set<String> all = immutableSet(
                P_MANAGE_USERS, P_MANAGE_SECURITY, P_VIEW_DASHBOARD, P_MANAGE_BILLING,
                P_CAPTURE_READINGS, P_COLLECT_PAYMENTS, P_MANAGE_CASHBOX,
                P_MANAGE_ACCOUNTING, P_APPROVE_ACCOUNTING, P_MANAGE_PROCUREMENT,
                P_APPROVE_PROCUREMENT, P_MANAGE_INVENTORY, P_APPROVE_INVENTORY,
                P_MANAGE_ASSETS, P_MANAGE_HR, P_APPROVE_PAYROLL,
                P_MANAGE_MAINTENANCE, P_APPROVE_MAINTENANCE, P_VIEW_REPORTS,
                P_EXPORT_DATA, P_VIEW_AUDIT, P_MANAGE_SETTINGS);
        roles.put(ROLE_SYSTEM_ADMIN, all);
        roles.put(ROLE_ADMIN, immutableSet(P_VIEW_DASHBOARD, P_MANAGE_BILLING,
                P_MANAGE_PROCUREMENT, P_APPROVE_PROCUREMENT, P_MANAGE_INVENTORY,
                P_MANAGE_ASSETS, P_MANAGE_HR, P_MANAGE_MAINTENANCE, P_VIEW_REPORTS,
                P_EXPORT_DATA, P_VIEW_AUDIT, P_MANAGE_SETTINGS));
        roles.put(ROLE_ACCOUNTANT, immutableSet(P_VIEW_DASHBOARD, P_MANAGE_ACCOUNTING,
                P_APPROVE_ACCOUNTING, P_MANAGE_CASHBOX, P_VIEW_REPORTS, P_EXPORT_DATA));
        roles.put(ROLE_READER, immutableSet(P_VIEW_DASHBOARD, P_CAPTURE_READINGS));
        roles.put(ROLE_COLLECTOR, immutableSet(P_VIEW_DASHBOARD, P_COLLECT_PAYMENTS));
        roles.put(ROLE_CASHIER, immutableSet(P_VIEW_DASHBOARD, P_MANAGE_CASHBOX,
                P_COLLECT_PAYMENTS));
        roles.put(ROLE_PROCUREMENT, immutableSet(P_VIEW_DASHBOARD, P_MANAGE_PROCUREMENT,
                P_VIEW_REPORTS));
        roles.put(ROLE_INVENTORY, immutableSet(P_VIEW_DASHBOARD, P_MANAGE_INVENTORY,
                P_MANAGE_ASSETS, P_VIEW_REPORTS));
        roles.put(ROLE_HR, immutableSet(P_VIEW_DASHBOARD, P_MANAGE_HR, P_VIEW_REPORTS));
        roles.put(ROLE_MAINTENANCE, immutableSet(P_VIEW_DASHBOARD, P_MANAGE_MAINTENANCE,
                P_MANAGE_ASSETS, P_VIEW_REPORTS));
        roles.put(ROLE_AUDITOR, immutableSet(P_VIEW_DASHBOARD, P_VIEW_REPORTS,
                P_VIEW_AUDIT, P_EXPORT_DATA));
        DEFAULT_ROLE_PERMISSIONS = Collections.unmodifiableMap(roles);
    }

    public static final class Session {
        public final String userId;
        public final String username;
        public final String fullName;
        public final Set<String> roles;
        public final Set<String> permissions;
        public final boolean mustChangePassword;

        Session(String userId, String username, String fullName, Set<String> roles,
                Set<String> permissions, boolean mustChangePassword) {
            this.userId = userId;
            this.username = username;
            this.fullName = fullName;
            this.roles = Collections.unmodifiableSet(new LinkedHashSet<>(roles));
            this.permissions = Collections.unmodifiableSet(new LinkedHashSet<>(permissions));
            this.mustChangePassword = mustChangePassword;
        }

        public boolean has(String permission) {
            return permissions.contains(permission);
        }

        public JSONObject toJson() throws Exception {
            JSONObject out = new JSONObject();
            out.put("userId", userId);
            out.put("username", username);
            out.put("fullName", fullName);
            out.put("roles", new JSONArray(roles));
            out.put("permissions", new JSONArray(permissions));
            out.put("mustChangePassword", mustChangePassword);
            return out;
        }
    }

    public QatraUnifiedUserStore(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
        setWriteAheadLoggingEnabled(true);
    }

    @Override public void onConfigure(SQLiteDatabase db) {
        super.onConfigure(db);
        db.setForeignKeyConstraintsEnabled(true);
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE erp_users (" +
                "id TEXT PRIMARY KEY NOT NULL," +
                "username TEXT UNIQUE NOT NULL COLLATE NOCASE," +
                "full_name TEXT NOT NULL," +
                "password_salt BLOB NOT NULL," +
                "password_hash BLOB NOT NULL," +
                "active INTEGER NOT NULL DEFAULT 1," +
                "must_change_password INTEGER NOT NULL DEFAULT 1," +
                "failed_attempts INTEGER NOT NULL DEFAULT 0," +
                "locked_until INTEGER NOT NULL DEFAULT 0," +
                "last_login_at INTEGER," +
                "created_at INTEGER NOT NULL," +
                "updated_at INTEGER NOT NULL," +
                "archived_at INTEGER)");
        db.execSQL("CREATE TABLE erp_user_roles (" +
                "user_id TEXT NOT NULL," +
                "role_code TEXT NOT NULL," +
                "PRIMARY KEY(user_id, role_code)," +
                "FOREIGN KEY(user_id) REFERENCES erp_users(id) ON DELETE RESTRICT)");
        db.execSQL("CREATE TABLE erp_user_permissions (" +
                "user_id TEXT NOT NULL," +
                "permission_code TEXT NOT NULL," +
                "granted INTEGER NOT NULL," +
                "PRIMARY KEY(user_id, permission_code)," +
                "FOREIGN KEY(user_id) REFERENCES erp_users(id) ON DELETE RESTRICT)");
        db.execSQL("CREATE TABLE erp_identity_audit (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "actor_user_id TEXT," +
                "action TEXT NOT NULL," +
                "target_user_id TEXT," +
                "details TEXT NOT NULL DEFAULT ''," +
                "created_at INTEGER NOT NULL)");
        db.execSQL("CREATE INDEX idx_erp_users_active ON erp_users(active, archived_at)");
        db.execSQL("CREATE INDEX idx_erp_identity_audit_target ON erp_identity_audit(target_user_id, created_at)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { }

    public boolean hasUsers() {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT 1 FROM erp_users LIMIT 1", null)) {
            return c.moveToFirst();
        }
    }

    public synchronized Session createInitialAdministrator(String username, String fullName,
            String password) throws Exception {
        if (hasUsers()) throw new SecurityException("تم إنشاء مدير النظام مسبقًا");
        validatePassword(password);
        String normalized = normalizeUsername(username);
        String id = "USR-" + UUID.randomUUID().toString();
        long now = System.currentTimeMillis();
        byte[] salt = randomSalt();
        byte[] hash = hash(password, salt);
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues user = new ContentValues();
            user.put("id", id);
            user.put("username", normalized);
            user.put("full_name", cleanName(fullName));
            user.put("password_salt", salt);
            user.put("password_hash", hash);
            user.put("active", 1);
            user.put("must_change_password", 0);
            user.put("created_at", now);
            user.put("updated_at", now);
            db.insertOrThrow("erp_users", null, user);
            addRole(db, id, ROLE_SYSTEM_ADMIN);
            audit(db, id, "INITIAL_ADMIN_CREATED", id, "");
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
            Arrays.fill(hash, (byte) 0);
        }
        return sessionForUser(id);
    }

    public synchronized Session authenticate(String username, String password) throws Exception {
        String normalized = normalizeUsername(username);
        SQLiteDatabase db = getWritableDatabase();
        String id;
        byte[] salt;
        byte[] expected;
        boolean active;
        boolean mustChange;
        long lockedUntil;
        int failed;
        try (Cursor c = db.rawQuery("SELECT id,password_salt,password_hash,active,must_change_password,locked_until,failed_attempts " +
                "FROM erp_users WHERE username=? AND archived_at IS NULL", new String[]{normalized})) {
            if (!c.moveToFirst()) throw new SecurityException("اسم المستخدم أو كلمة المرور غير صحيحة");
            id = c.getString(0);
            salt = c.getBlob(1);
            expected = c.getBlob(2);
            active = c.getInt(3) == 1;
            mustChange = c.getInt(4) == 1;
            lockedUntil = c.getLong(5);
            failed = c.getInt(6);
        }
        if (!active) throw new SecurityException("الحساب موقوف من الإدارة");
        long now = System.currentTimeMillis();
        if (lockedUntil > now) throw new SecurityException("الحساب مقفل مؤقتًا بسبب محاولات متكررة");
        byte[] actual = hash(password == null ? "" : password, salt);
        boolean matches = MessageDigest.isEqual(expected, actual);
        Arrays.fill(actual, (byte) 0);
        if (!matches) {
            int next = failed + 1;
            ContentValues values = new ContentValues();
            values.put("failed_attempts", next);
            if (next >= 5) values.put("locked_until", now + 5 * 60_000L);
            db.update("erp_users", values, "id=?", new String[]{id});
            audit(db, id, "LOGIN_FAILED", id, "attempt=" + next);
            throw new SecurityException("اسم المستخدم أو كلمة المرور غير صحيحة");
        }
        ContentValues success = new ContentValues();
        success.put("failed_attempts", 0);
        success.put("locked_until", 0);
        success.put("last_login_at", now);
        success.put("updated_at", now);
        db.update("erp_users", success, "id=?", new String[]{id});
        audit(db, id, "LOGIN_SUCCESS", id, mustChange ? "must-change" : "");
        return sessionForUser(id);
    }

    public synchronized JSONObject createUser(Session actor, JSONObject input) throws Exception {
        require(actor, P_MANAGE_USERS);
        String username = normalizeUsername(input.optString("username"));
        String fullName = cleanName(input.optString("fullName"));
        String temporaryPassword = input.optString("temporaryPassword", "");
        validatePassword(temporaryPassword);
        Set<String> roles = validateRoles(input.optJSONArray("roles"));
        if (roles.isEmpty()) throw new IllegalArgumentException("اختر دورًا واحدًا على الأقل");
        String id = "USR-" + UUID.randomUUID().toString();
        long now = System.currentTimeMillis();
        byte[] salt = randomSalt();
        byte[] passwordHash = hash(temporaryPassword, salt);
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues user = new ContentValues();
            user.put("id", id);
            user.put("username", username);
            user.put("full_name", fullName);
            user.put("password_salt", salt);
            user.put("password_hash", passwordHash);
            user.put("active", 1);
            user.put("must_change_password", 1);
            user.put("created_at", now);
            user.put("updated_at", now);
            db.insertOrThrow("erp_users", null, user);
            for (String role : roles) addRole(db, id, role);
            replaceOverrides(db, id, input.optJSONArray("permissionOverrides"));
            audit(db, actor.userId, "USER_CREATED", id, "roles=" + roles);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
            Arrays.fill(passwordHash, (byte) 0);
        }
        return userJson(id, true);
    }

    public synchronized JSONObject updateUser(Session actor, JSONObject input) throws Exception {
        require(actor, P_MANAGE_USERS);
        String id = input.optString("id", "").trim();
        if (id.isEmpty()) throw new IllegalArgumentException("معرّف المستخدم مطلوب");
        String fullName = cleanName(input.optString("fullName"));
        Set<String> roles = validateRoles(input.optJSONArray("roles"));
        if (roles.isEmpty()) throw new IllegalArgumentException("اختر دورًا واحدًا على الأقل");
        if (id.equals(actor.userId) && !roles.contains(ROLE_SYSTEM_ADMIN)
                && actor.roles.contains(ROLE_SYSTEM_ADMIN)) {
            throw new SecurityException("لا يمكن للمدير إزالة آخر صلاحية إدارية من حسابه أثناء الجلسة");
        }
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues values = new ContentValues();
            values.put("full_name", fullName);
            values.put("updated_at", System.currentTimeMillis());
            if (db.update("erp_users", values, "id=? AND archived_at IS NULL", new String[]{id}) != 1) {
                throw new SecurityException("المستخدم غير موجود أو مؤرشف");
            }
            db.delete("erp_user_roles", "user_id=?", new String[]{id});
            for (String role : roles) addRole(db, id, role);
            replaceOverrides(db, id, input.optJSONArray("permissionOverrides"));
            audit(db, actor.userId, "USER_UPDATED", id, "roles=" + roles);
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        return userJson(id, true);
    }

    public synchronized void setActive(Session actor, String userId, boolean active) throws Exception {
        require(actor, P_MANAGE_USERS);
        if (actor.userId.equals(userId) && !active) throw new SecurityException("لا يمكنك إيقاف حسابك الحالي");
        ContentValues values = new ContentValues();
        values.put("active", active ? 1 : 0);
        values.put("updated_at", System.currentTimeMillis());
        SQLiteDatabase db = getWritableDatabase();
        if (db.update("erp_users", values, "id=? AND archived_at IS NULL", new String[]{userId}) != 1) {
            throw new SecurityException("المستخدم غير موجود");
        }
        audit(db, actor.userId, active ? "USER_ENABLED" : "USER_DISABLED", userId, "");
    }

    public synchronized void resetPassword(Session actor, String userId, String temporaryPassword) throws Exception {
        require(actor, P_MANAGE_SECURITY);
        validatePassword(temporaryPassword);
        updatePassword(userId, temporaryPassword, true);
        audit(getWritableDatabase(), actor.userId, "PASSWORD_RESET", userId, "force-change");
    }

    public synchronized Session changeOwnPassword(Session actor, String currentPassword,
            String newPassword) throws Exception {
        if (actor == null) throw new SecurityException("الجلسة غير صالحة");
        Session verified = authenticate(actor.username, currentPassword);
        if (!verified.userId.equals(actor.userId)) throw new SecurityException("تعذر التحقق من الحساب");
        validatePassword(newPassword);
        updatePassword(actor.userId, newPassword, false);
        audit(getWritableDatabase(), actor.userId, "PASSWORD_CHANGED", actor.userId, "");
        return sessionForUser(actor.userId);
    }

    /** Archives accounts that have audit history; permanently deletes only never-used accounts. */
    public synchronized String deleteOrArchive(Session actor, String userId) throws Exception {
        require(actor, P_MANAGE_USERS);
        if (actor.userId.equals(userId)) throw new SecurityException("لا يمكنك حذف حسابك الحالي");
        SQLiteDatabase db = getWritableDatabase();
        long auditCount;
        try (Cursor c = db.rawQuery("SELECT COUNT(*) FROM erp_identity_audit WHERE actor_user_id=? OR target_user_id=?",
                new String[]{userId, userId})) {
            c.moveToFirst();
            auditCount = c.getLong(0);
        }
        if (auditCount == 0) {
            db.beginTransaction();
            try {
                db.delete("erp_user_permissions", "user_id=?", new String[]{userId});
                db.delete("erp_user_roles", "user_id=?", new String[]{userId});
                int removed = db.delete("erp_users", "id=?", new String[]{userId});
                if (removed != 1) throw new SecurityException("المستخدم غير موجود");
                audit(db, actor.userId, "USER_DELETED_UNUSED", null, "deleted-id=" + userId);
                db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
            return "deleted";
        }
        ContentValues values = new ContentValues();
        values.put("active", 0);
        values.put("archived_at", System.currentTimeMillis());
        values.put("updated_at", System.currentTimeMillis());
        if (db.update("erp_users", values, "id=? AND archived_at IS NULL", new String[]{userId}) != 1) {
            throw new SecurityException("المستخدم غير موجود أو مؤرشف");
        }
        audit(db, actor.userId, "USER_ARCHIVED", userId, "");
        return "archived";
    }

    public synchronized JSONArray listUsers(Session actor, boolean includeArchived) throws Exception {
        require(actor, P_MANAGE_USERS);
        JSONArray out = new JSONArray();
        String where = includeArchived ? "" : " WHERE archived_at IS NULL";
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT id FROM erp_users" + where + " ORDER BY full_name COLLATE NOCASE", null)) {
            while (c.moveToNext()) out.put(userJson(c.getString(0), true));
        }
        return out;
    }

    public synchronized JSONArray audit(Session actor, int limit) throws Exception {
        require(actor, P_VIEW_AUDIT);
        JSONArray rows = new JSONArray();
        int safeLimit = Math.max(1, Math.min(limit, 500));
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT id,actor_user_id,action,target_user_id,details,created_at " +
                        "FROM erp_identity_audit ORDER BY id DESC LIMIT " + safeLimit, null)) {
            while (c.moveToNext()) {
                JSONObject row = new JSONObject();
                row.put("id", c.getLong(0));
                row.put("actorUserId", c.isNull(1) ? JSONObject.NULL : c.getString(1));
                row.put("action", c.getString(2));
                row.put("targetUserId", c.isNull(3) ? JSONObject.NULL : c.getString(3));
                row.put("details", c.getString(4));
                row.put("createdAt", c.getLong(5));
                rows.put(row);
            }
        }
        return rows;
    }

    public static JSONArray roleCatalogJson() throws Exception {
        JSONArray roles = new JSONArray();
        for (Map.Entry<String, Set<String>> entry : DEFAULT_ROLE_PERMISSIONS.entrySet()) {
            JSONObject role = new JSONObject();
            role.put("code", entry.getKey());
            role.put("label", roleLabel(entry.getKey()));
            role.put("permissions", new JSONArray(entry.getValue()));
            roles.put(role);
        }
        return roles;
    }

    private Session sessionForUser(String id) throws Exception {
        SQLiteDatabase db = getReadableDatabase();
        String username;
        String fullName;
        boolean active;
        boolean mustChange;
        try (Cursor c = db.rawQuery("SELECT username,full_name,active,must_change_password " +
                "FROM erp_users WHERE id=? AND archived_at IS NULL", new String[]{id})) {
            if (!c.moveToFirst()) throw new SecurityException("المستخدم غير موجود");
            username = c.getString(0);
            fullName = c.getString(1);
            active = c.getInt(2) == 1;
            mustChange = c.getInt(3) == 1;
        }
        if (!active) throw new SecurityException("الحساب موقوف");
        Set<String> roles = rolesFor(db, id);
        Set<String> permissions = permissionsFor(db, id, roles);
        return new Session(id, username, fullName, roles, permissions, mustChange);
    }

    private JSONObject userJson(String id, boolean includePermissions) throws Exception {
        SQLiteDatabase db = getReadableDatabase();
        JSONObject out = new JSONObject();
        try (Cursor c = db.rawQuery("SELECT id,username,full_name,active,must_change_password," +
                "last_login_at,created_at,updated_at,archived_at FROM erp_users WHERE id=?",
                new String[]{id})) {
            if (!c.moveToFirst()) throw new SecurityException("المستخدم غير موجود");
            out.put("id", c.getString(0));
            out.put("username", c.getString(1));
            out.put("fullName", c.getString(2));
            out.put("active", c.getInt(3) == 1);
            out.put("mustChangePassword", c.getInt(4) == 1);
            out.put("lastLoginAt", c.isNull(5) ? JSONObject.NULL : c.getLong(5));
            out.put("createdAt", c.getLong(6));
            out.put("updatedAt", c.getLong(7));
            out.put("archivedAt", c.isNull(8) ? JSONObject.NULL : c.getLong(8));
        }
        Set<String> roles = rolesFor(db, id);
        out.put("roles", new JSONArray(roles));
        out.put("permissionOverrides", permissionOverridesJson(db, id));
        if (includePermissions) out.put("permissions", new JSONArray(permissionsFor(db, id, roles)));
        return out;
    }

    private static Set<String> rolesFor(SQLiteDatabase db, String id) {
        Set<String> roles = new LinkedHashSet<>();
        try (Cursor c = db.rawQuery("SELECT role_code FROM erp_user_roles WHERE user_id=? ORDER BY role_code",
                new String[]{id})) {
            while (c.moveToNext()) roles.add(c.getString(0));
        }
        return roles;
    }

    private static Set<String> permissionsFor(SQLiteDatabase db, String id, Set<String> roles) {
        Set<String> permissions = new LinkedHashSet<>();
        for (String role : roles) {
            Set<String> defaults = DEFAULT_ROLE_PERMISSIONS.get(role);
            if (defaults != null) permissions.addAll(defaults);
        }
        try (Cursor c = db.rawQuery("SELECT permission_code,granted FROM erp_user_permissions WHERE user_id=?",
                new String[]{id})) {
            while (c.moveToNext()) {
                String permission = c.getString(0);
                if (c.getInt(1) == 1) permissions.add(permission); else permissions.remove(permission);
            }
        }
        return permissions;
    }

    private static JSONArray permissionOverridesJson(SQLiteDatabase db, String id) throws Exception {
        JSONArray rows = new JSONArray();
        try (Cursor c = db.rawQuery(
                "SELECT permission_code,granted FROM erp_user_permissions WHERE user_id=? ORDER BY permission_code",
                new String[]{id})) {
            while (c.moveToNext()) {
                JSONObject row = new JSONObject();
                row.put("permission", c.getString(0));
                row.put("granted", c.getInt(1) == 1);
                rows.put(row);
            }
        }
        return rows;
    }

    private void updatePassword(String userId, String password, boolean forceChange) throws Exception {
        byte[] salt = randomSalt();
        byte[] passwordHash = hash(password, salt);
        try {
            ContentValues values = new ContentValues();
            values.put("password_salt", salt);
            values.put("password_hash", passwordHash);
            values.put("must_change_password", forceChange ? 1 : 0);
            values.put("failed_attempts", 0);
            values.put("locked_until", 0);
            values.put("updated_at", System.currentTimeMillis());
            if (getWritableDatabase().update("erp_users", values, "id=? AND archived_at IS NULL",
                    new String[]{userId}) != 1) throw new SecurityException("المستخدم غير موجود");
        } finally { Arrays.fill(passwordHash, (byte) 0); }
    }

    private static void addRole(SQLiteDatabase db, String userId, String role) {
        ContentValues values = new ContentValues();
        values.put("user_id", userId);
        values.put("role_code", role);
        db.insertOrThrow("erp_user_roles", null, values);
    }

    private static void replaceOverrides(SQLiteDatabase db, String userId, JSONArray overrides) throws Exception {
        db.delete("erp_user_permissions", "user_id=?", new String[]{userId});
        if (overrides == null) return;
        for (int i = 0; i < overrides.length(); i++) {
            JSONObject row = overrides.optJSONObject(i);
            if (row == null) continue;
            String permission = row.optString("permission", "").trim().toUpperCase(Locale.ROOT);
            if (!allPermissions().contains(permission)) continue;
            ContentValues values = new ContentValues();
            values.put("user_id", userId);
            values.put("permission_code", permission);
            values.put("granted", row.optBoolean("granted", true) ? 1 : 0);
            db.insertOrThrow("erp_user_permissions", null, values);
        }
    }

    private static Set<String> validateRoles(JSONArray input) throws Exception {
        Set<String> roles = new LinkedHashSet<>();
        if (input == null) return roles;
        for (int i = 0; i < input.length(); i++) {
            String role = input.optString(i, "").trim().toUpperCase(Locale.ROOT);
            if (!DEFAULT_ROLE_PERMISSIONS.containsKey(role)) throw new IllegalArgumentException("دور غير معروف: " + role);
            roles.add(role);
        }
        return roles;
    }

    private static Set<String> allPermissions() {
        Set<String> out = new LinkedHashSet<>();
        for (Set<String> values : DEFAULT_ROLE_PERMISSIONS.values()) out.addAll(values);
        return out;
    }

    private static void audit(SQLiteDatabase db, String actor, String action, String target, String details) {
        ContentValues values = new ContentValues();
        values.put("actor_user_id", actor);
        values.put("action", action);
        values.put("target_user_id", target);
        values.put("details", details == null ? "" : details);
        values.put("created_at", System.currentTimeMillis());
        db.insert("erp_identity_audit", null, values);
    }

    private static void require(Session actor, String permission) {
        if (actor == null || !actor.has(permission)) throw new SecurityException("لا تملك صلاحية " + permission);
    }

    private static String normalizeUsername(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        if (!normalized.matches("[a-z0-9_.-]{3,32}")) {
            throw new IllegalArgumentException("اسم المستخدم من 3 إلى 32 حرفًا إنجليزيًا أو رقمًا دون مسافات");
        }
        return normalized;
    }

    private static String cleanName(String value) {
        String name = value == null ? "" : value.trim().replaceAll("\\s+", " ");
        if (name.length() < 2 || name.length() > 100) throw new IllegalArgumentException("أدخل الاسم الكامل");
        return name;
    }

    private static void validatePassword(String value) {
        String password = value == null ? "" : value;
        if (password.length() < 8 || password.length() > 64) {
            throw new IllegalArgumentException("كلمة المرور من 8 إلى 64 محرفًا");
        }
        boolean letter = password.matches(".*[A-Za-z].*");
        boolean digit = password.matches(".*[0-9].*");
        if (!letter || !digit) throw new IllegalArgumentException("كلمة المرور يجب أن تحتوي حرفًا ورقمًا على الأقل");
    }

    private static byte[] randomSalt() {
        byte[] salt = new byte[24];
        RANDOM.nextBytes(salt);
        return salt;
    }

    private static byte[] hash(String password, byte[] salt) throws Exception {
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, KEY_LENGTH);
        try {
            try {
                return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
            } catch (Exception unsupported) {
                return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1").generateSecret(spec).getEncoded();
            }
        } finally { spec.clearPassword(); }
    }

    private static Set<String> immutableSet(String... values) {
        return Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList(values)));
    }

    private static String roleLabel(String role) {
        switch (role) {
            case ROLE_SYSTEM_ADMIN: return "مدير النظام";
            case ROLE_ADMIN: return "الإدارة";
            case ROLE_ACCOUNTANT: return "المحاسبة";
            case ROLE_READER: return "الكاشف";
            case ROLE_COLLECTOR: return "المحصل";
            case ROLE_CASHIER: return "الصندوق";
            case ROLE_PROCUREMENT: return "المشتريات";
            case ROLE_INVENTORY: return "المخزون";
            case ROLE_HR: return "الموارد البشرية";
            case ROLE_MAINTENANCE: return "الصيانة";
            case ROLE_AUDITOR: return "المراجعة";
            default: return role;
        }
    }
}