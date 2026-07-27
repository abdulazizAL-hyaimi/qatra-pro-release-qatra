package com.qatra.pro;

import android.content.Context;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** HTTPS transport plus conflict-aware snapshot synchronization for every Qatra role. */
final class QatraCloudSyncEngine {
    private static final String SNAPSHOT_FORMAT = "QATRA_STATE_SNAPSHOT_V1";
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;
    private static final int MAX_SNAPSHOT_BYTES = 900_000;

    private final Context context;
    private final String role;
    private final QatraCloudDatabase cloud;
    private final QatraSecretStore secrets;
    private final QatraDatabase local;

    QatraCloudSyncEngine(Context context) {
        this.context = context.getApplicationContext();
        this.role = BuildConfig.APP_ROLE;
        this.cloud = new QatraCloudDatabase(this.context);
        this.secrets = new QatraSecretStore(this.context);
        this.local = new QatraDatabase(this.context);
    }

    JSONObject login(String baseUrl, String username, String pin) throws Exception {
        String cleanUrl = normalizeBaseUrl(baseUrl);
        String cleanUser = normalizeUsername(username);
        if (cleanUser.length() < 3) throw new IllegalArgumentException("اسم المستخدم غير صالح");
        if (pin == null || !pin.matches("[0-9]{6,12}")) {
            throw new IllegalArgumentException("رمز PIN يجب أن يكون من 6 إلى 12 رقمًا");
        }

        String deviceId = cloud.deviceId();
        JSONObject body = new JSONObject();
        body.put("username", cleanUser);
        body.put("pin", pin);
        body.put("deviceId", deviceId);
        JSONObject response = request("POST", cleanUrl + "/api/v1/auth/login", body, null);
        String serverRole = response.optString("role", "").toUpperCase(Locale.ROOT);
        if (!role.equals(serverRole)) {
            throw new SecurityException("هذا الحساب مخصص لصلاحية " + serverRole + " وليس " + role);
        }
        String token = response.getString("accessToken");

        JSONObject registration = new JSONObject();
        registration.put("deviceId", deviceId);
        registration.put("deviceName", Build.MANUFACTURER + " " + Build.MODEL);
        registration.put("appVersion", BuildConfig.VERSION_NAME);
        request("POST", cleanUrl + "/api/v1/devices/register", registration, token);

        long expiresAt = System.currentTimeMillis() + (11L * 60L * 60L * 1000L);
        JSONObject session = new JSONObject();
        session.put("accessToken", token);
        session.put("baseUrl", cleanUrl);
        session.put("username", cleanUser);
        session.put("deviceId", deviceId);
        session.put("role", serverRole);
        session.put("workspaceId", response.optString("workspaceId", ""));
        session.put("employeeCode", response.optString("employeeCode", ""));
        session.put("tokenExpiresAt", expiresAt);
        secrets.saveSession(session);

        JSONObject profile = new JSONObject(session.toString());
        profile.remove("accessToken");
        profile.put("lastSequence", cloud.currentCursor());
        profile.put("lastSyncAt", 0L);
        profile.put("lastError", "");
        cloud.saveProfile(profile);
        schedule();

        JSONObject out = status();
        out.put("message", "تم ربط الجهاز بالخادم المركزي بنجاح");
        return out;
    }

    JSONObject syncNow() throws Exception {
        JSONObject session = requireSession();
        int queued = captureSnapshots();
        int pushed = pushPending(session);
        PullResult pull = pullAndApply(session);
        cloud.markSyncResult(true, "");
        schedule();

        JSONObject out = status();
        out.put("ok", true);
        out.put("queued", queued);
        out.put("pushed", pushed);
        out.put("received", pull.received);
        out.put("applied", pull.applied);
        out.put("conflictsAdded", pull.conflicts);
        out.put("message", "اكتملت المزامنة");
        return out;
    }

    JSONObject status() throws Exception {
        JSONObject p = cloud.profile();
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("configured", p != null);
        out.put("role", role);
        out.put("pending", cloud.pendingCount());
        out.put("conflicts", cloud.conflictCount());
        out.put("lastSequence", cloud.currentCursor());
        if (p != null) {
            out.put("baseUrl", p.optString("baseUrl", ""));
            out.put("username", p.optString("username", ""));
            out.put("workspaceId", p.optString("workspaceId", ""));
            out.put("employeeCode", p.optString("employeeCode", ""));
            out.put("lastSyncAt", p.optLong("lastSyncAt", 0L));
            out.put("lastError", p.optString("lastError", ""));
            out.put("tokenExpiresAt", p.optLong("tokenExpiresAt", 0L));
            out.put("authenticated", hasValidSession());
        } else {
            out.put("authenticated", false);
        }
        return out;
    }

    void disconnect() {
        QatraCloudScheduler.cancel(context);
        secrets.clearSession();
        cloud.clearProfileAndQueue();
    }

    private int captureSnapshots() throws Exception {
        int queued = 0;
        for (String namespace : namespacesForRole(role)) {
            String stateJson = local.getState(namespace);
            if (stateJson == null || stateJson.trim().isEmpty()) continue;
            JSONObject state = new JSONObject(stateJson);
            String canonical = state.toString();
            String stateHash = QatraDatabase.sha256(canonical);
            JSONObject envelope = new JSONObject();
            envelope.put("format", SNAPSHOT_FORMAT);
            envelope.put("role", role);
            envelope.put("namespace", namespace);
            envelope.put("stateHash", stateHash);
            envelope.put("capturedAt", System.currentTimeMillis());
            envelope.put("state", state);
            String payload = envelope.toString();
            if (payload.getBytes(StandardCharsets.UTF_8).length > MAX_SNAPSHOT_BYTES) {
                cloud.recordConflict(namespace, "LOCAL", "حجم الحالة يتجاوز حد المزامنة؛ يلزم تقسيم السجلات", "{}");
                continue;
            }
            if (cloud.enqueueSnapshot(namespace, payload, stateHash)) queued++;
        }
        return queued;
    }

    private int pushPending(JSONObject session) throws Exception {
        JSONArray rows = cloud.dueOutbox(25);
        int sent = 0;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            String operationId = row.getString("operationId");
            int attempts = row.optInt("attempts", 0);
            cloud.markSending(operationId);
            try {
                JSONObject request = new JSONObject();
                request.put("operationId", operationId);
                request.put("deviceId", session.getString("deviceId"));
                request.put("entityType", "STATE_SNAPSHOT");
                request.put("entityId", role + ":" + row.getString("namespace"));
                request.put("action", "UPSERT");
                request.put("clientCreatedAt", JSONObject.NULL);
                request.put("payload", row.getJSONObject("payload"));
                request("POST", session.getString("baseUrl") + "/api/v1/sync/push",
                        request, session.getString("accessToken"));
                cloud.markSent(operationId);
                sent++;
            } catch (Exception error) {
                cloud.markFailed(operationId, attempts, error.getMessage());
                throw error;
            }
        }
        return sent;
    }

    private PullResult pullAndApply(JSONObject session) throws Exception {
        PullResult result = new PullResult();
        long cursor = cloud.currentCursor();
        boolean hasMore = true;
        int pages = 0;
        while (hasMore && pages++ < 10) {
            JSONObject response = request("GET",
                    session.getString("baseUrl") + "/api/v1/sync/pull?afterSequence=" + cursor + "&limit=200",
                    null, session.getString("accessToken"));
            JSONArray items = response.optJSONArray("items");
            if (items == null) items = new JSONArray();
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                long sequence = item.optLong("sequence", 0L);
                cursor = Math.max(cursor, sequence);
                if (!"STATE_SNAPSHOT".equalsIgnoreCase(item.optString("entityType"))) continue;
                JSONObject payload = item.optJSONObject("payload");
                if (payload == null || !SNAPSHOT_FORMAT.equals(payload.optString("format"))) continue;
                String namespace = payload.optString("namespace", "");
                String sourceRole = payload.optString("role", item.optString("role", "")).toUpperCase(Locale.ROOT);
                String operationId = item.optString("operationId", "");
                cloud.storeInbox(sequence, operationId, sourceRole, namespace,
                        payload.toString(), item.optString("acceptedAt", ""));
                result.received++;

                if (session.optString("deviceId").equals(item.optString("deviceId"))) {
                    cloud.markInboxApplied(sequence);
                    continue;
                }

                boolean applied = applySnapshot(sourceRole, namespace, payload.optJSONObject("state"), operationId);
                if (applied) {
                    cloud.markInboxApplied(sequence);
                    result.applied++;
                } else {
                    result.conflicts++;
                }
            }
            long next = response.optLong("nextSequence", cursor);
            cursor = Math.max(cursor, next);
            cloud.updateCursor(cursor);
            hasMore = response.optBoolean("hasMore", false);
        }
        return result;
    }

    private boolean applySnapshot(String sourceRole, String namespace, JSONObject remote,
                                  String operationId) throws Exception {
        if (remote == null) return false;
        if (role.equals(sourceRole) && namespacesForRole(role).contains(namespace)) {
            if (cloud.hasPendingForNamespace(namespace)) {
                cloud.recordConflict(namespace, operationId,
                        "توجد تعديلات محلية غير مرفوعة؛ لم تُستبدل البيانات تلقائيًا", remote.toString());
                return false;
            }
            JSONObject localState = readState(namespace);
            JSONObject merged = mergeStates(localState, remote);
            local.saveState(namespace, merged.toString());
            return true;
        }

        if ("ADMIN".equals(role)) {
            JSONObject admin = readState("admin");
            boolean changed = false;
            if ("COLLECTOR".equals(sourceRole)) {
                changed |= mergeArrayInto(admin, "payments", remote.optJSONArray("payments"), "sourceRole", "COLLECTOR");
            } else if ("READER".equals(sourceRole)) {
                changed |= mergeArrayInto(admin, "readings", remote.optJSONArray("readings"), "sourceRole", "READER");
            } else if ("CASHIER".equals(sourceRole)) {
                changed |= mergeCashierIntoAdmin(admin, remote);
            }
            if (changed) {
                local.saveState("admin", admin.toString());
                return true;
            }
        }

        cloud.recordConflict(namespace, operationId,
                "تم استلام بيانات لا تنطبق عليها قاعدة دمج تلقائية؛ حُفظت للمراجعة", remote.toString());
        return false;
    }

    private boolean mergeCashierIntoAdmin(JSONObject admin, JSONObject cashier) throws Exception {
        boolean changed = false;
        JSONArray direct = cashier.optJSONArray("directPayments");
        if (direct != null) {
            JSONArray mapped = new JSONArray();
            for (int i = 0; i < direct.length(); i++) {
                JSONObject src = direct.optJSONObject(i);
                if (src == null) continue;
                JSONObject p = new JSONObject(src.toString());
                if (!p.has("receiptNo")) p.put("receiptNo", p.optString("referenceNo", p.optString("id", "")));
                p.put("confirmed", true);
                p.put("sourceRole", "CASHIER");
                mapped.put(p);
            }
            changed |= mergeArrayInto(admin, "payments", mapped, null, null);
        }
        changed |= mergeArrayInto(admin, "cashboxTransactions", cashier.optJSONArray("transactions"),
                "sourceRole", "CASHIER");
        return changed;
    }

    private static JSONObject mergeStates(JSONObject local, JSONObject remote) throws Exception {
        JSONObject out = new JSONObject(local == null ? "{}" : local.toString());
        JSONArray names = remote.names();
        if (names == null) return out;
        for (int i = 0; i < names.length(); i++) {
            String key = names.getString(i);
            Object value = remote.opt(key);
            if (value instanceof JSONArray) {
                mergeArrayInto(out, key, (JSONArray) value, null, null);
            } else if (value instanceof JSONObject) {
                JSONObject base = out.optJSONObject(key);
                JSONObject merged = base == null ? new JSONObject() : new JSONObject(base.toString());
                JSONObject incoming = (JSONObject) value;
                JSONArray objectKeys = incoming.names();
                if (objectKeys != null) for (int j = 0; j < objectKeys.length(); j++) {
                    String objectKey = objectKeys.getString(j);
                    merged.put(objectKey, incoming.opt(objectKey));
                }
                out.put(key, merged);
            } else if (value != null && value != JSONObject.NULL) {
                out.put(key, value);
            }
        }
        return out;
    }

    private static boolean mergeArrayInto(JSONObject target, String key, JSONArray incoming,
                                          String markerKey, String markerValue) throws Exception {
        if (incoming == null || incoming.length() == 0) return false;
        JSONArray current = target.optJSONArray(key);
        if (current == null) current = new JSONArray();
        List<JSONObject> rows = new ArrayList<>();
        for (int i = 0; i < current.length(); i++) {
            JSONObject row = current.optJSONObject(i);
            if (row != null) rows.add(new JSONObject(row.toString()));
        }
        boolean changed = false;
        for (int i = 0; i < incoming.length(); i++) {
            JSONObject source = incoming.optJSONObject(i);
            if (source == null) continue;
            JSONObject copy = new JSONObject(source.toString());
            if (markerKey != null) copy.put(markerKey, markerValue);
            String id = identity(copy, key, i);
            int found = -1;
            for (int j = 0; j < rows.size(); j++) {
                if (id.equals(identity(rows.get(j), key, j))) { found = j; break; }
            }
            if (found < 0) {
                rows.add(copy);
                changed = true;
            } else if (isIncomingNewer(rows.get(found), copy)) {
                rows.set(found, copy);
                changed = true;
            }
        }
        if (changed) {
            JSONArray merged = new JSONArray();
            for (JSONObject row : rows) merged.put(row);
            target.put(key, merged);
        }
        return changed;
    }

    private static boolean isIncomingNewer(JSONObject current, JSONObject incoming) {
        String a = firstNonEmpty(current.optString("updatedAt"), current.optString("createdAt"), current.optString("date"));
        String b = firstNonEmpty(incoming.optString("updatedAt"), incoming.optString("createdAt"), incoming.optString("date"));
        return b.compareTo(a) >= 0;
    }

    private static String identity(JSONObject row, String type, int index) throws Exception {
        for (String key : Arrays.asList("syncId", "id", "receiptNo", "no", "code", "operationId")) {
            String value = row.optString(key, "").trim();
            if (!value.isEmpty()) return key + ":" + value;
        }
        String composite = row.optString("cycleId") + "|" + row.optString("subscriberId");
        if (!"|".equals(composite)) return "composite:" + composite;
        return type + ":" + index + ":" + QatraDatabase.sha256(row.toString()).substring(0, 16);
    }

    private JSONObject readState(String namespace) throws Exception {
        String raw = local.getState(namespace);
        return raw == null ? new JSONObject() : new JSONObject(raw);
    }

    private JSONObject requireSession() throws Exception {
        JSONObject session = secrets.loadSession();
        if (session == null) throw new SecurityException("اربط التطبيق بالخادم المركزي أولًا");
        if (session.optLong("tokenExpiresAt", 0L) <= System.currentTimeMillis()) {
            throw new SecurityException("انتهت جلسة الخادم. افتح شاشة المزامنة وسجّل الدخول مجددًا");
        }
        if (!role.equals(session.optString("role"))) {
            throw new SecurityException("صلاحية جلسة الخادم لا تطابق هذه النسخة");
        }
        return session;
    }

    private boolean hasValidSession() {
        try {
            JSONObject s = secrets.loadSession();
            return s != null && role.equals(s.optString("role"))
                    && s.optLong("tokenExpiresAt", 0L) > System.currentTimeMillis();
        } catch (Exception ignored) { return false; }
    }

    private void schedule() {
        QatraCloudScheduler.schedule(context);
    }

    private static Set<String> namespacesForRole(String role) {
        if ("ADMIN".equals(role)) return new HashSet<>(Arrays.asList(
                "admin", "admin.collector.config", "admin.reader.config", "admin.cashbox", "admin.staff"));
        if ("READER".equals(role)) return new HashSet<>(Arrays.asList("reader"));
        if ("COLLECTOR".equals(role)) return new HashSet<>(Arrays.asList("collector"));
        if ("CASHIER".equals(role)) return new HashSet<>(Arrays.asList("cashier"));
        return new HashSet<>();
    }

    private static String normalizeBaseUrl(String value) {
        String url = value == null ? "" : value.trim();
        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        if (!url.matches("https://[A-Za-z0-9._:-]+(?:/.*)?")) {
            throw new IllegalArgumentException("اكتب رابط خادم HTTPS صحيحًا");
        }
        return url;
    }

    private static String normalizeUsername(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private static String firstNonEmpty(String... values) {
        for (String value : values) if (value != null && !value.isEmpty()) return value;
        return "";
    }

    private static JSONObject request(String method, String url, JSONObject body, String token) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        if (token != null && !token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
        if (body != null) {
            connection.setDoOutput(true);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
        }
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300
                ? connection.getInputStream() : connection.getErrorStream();
        String text = readText(stream);
        connection.disconnect();
        if (status < 200 || status >= 300) {
            String detail = text;
            try { detail = new JSONObject(text).optString("error", text); } catch (Exception ignored) { }
            if (status == 401) throw new SecurityException("بيانات الدخول غير صحيحة أو انتهت الجلسة");
            if (status == 403) throw new SecurityException("هذا الجهاز أو الحساب غير مخول للمزامنة");
            throw new IllegalStateException("فشل الخادم " + status + ": " + detail);
        }
        return text.trim().isEmpty() ? new JSONObject() : new JSONObject(text);
    }

    private static String readText(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder out = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) out.append(line);
        }
        return out.toString();
    }

    private static final class PullResult {
        int received;
        int applied;
        int conflicts;
    }
}
