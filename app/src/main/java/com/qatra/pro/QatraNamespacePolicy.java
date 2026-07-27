package com.qatra.pro;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Central role-to-namespace policy for native persistence and backups. */
public final class QatraNamespacePolicy {
    public static final String ADMIN = "ADMIN";
    public static final String READER = "READER";
    public static final String COLLECTOR = "COLLECTOR";
    public static final String CASHIER = "CASHIER";
    public static final String UNIFIED = "UNIFIED";

    public static final String ADMIN_PRIMARY = "admin";
    public static final String ENTERPRISE_CORE = "enterprise.core";
    public static final String ERP_PRIMARY = "erp.core";
    public static final String ERP_MIGRATION = "erp.migration";

    private static final Map<String, Set<String>> ALLOWED_BY_ROLE;
    private static final Map<String, List<String>> PORTABLE_BY_ROLE;

    static {
        Map<String, Set<String>> allowed = new LinkedHashMap<>();
        allowed.put(ADMIN, immutableSet(
                ADMIN_PRIMARY,
                "admin.backups",
                "admin.collector.config",
                "admin.reader.config",
                "admin.staff",
                "admin.cashbox",
                ENTERPRISE_CORE));
        allowed.put(READER, immutableSet("reader"));
        allowed.put(COLLECTOR, immutableSet("collector"));
        allowed.put(CASHIER, immutableSet("cashier"));
        allowed.put(UNIFIED, immutableSet(
                ERP_PRIMARY,
                "erp.billing",
                "erp.accounting",
                "erp.procurement",
                "erp.inventory",
                "erp.assets",
                "erp.hr",
                "erp.maintenance",
                "erp.documents",
                "erp.audit",
                ENTERPRISE_CORE,
                ADMIN_PRIMARY,
                "admin.staff",
                "admin.reader.config",
                "admin.collector.config",
                "admin.cashbox",
                "reader",
                "collector",
                "cashier"));
        allowed.put(UNIFIED, immutableSet(
                ERP_PRIMARY,
                ERP_MIGRATION,
                "erp.billing",
                "erp.accounting",
                "erp.procurement",
                "erp.inventory",
                "erp.assets",
                "erp.hr",
                "erp.maintenance",
                "erp.documents",
                "erp.audit",
                ENTERPRISE_CORE,
                ADMIN_PRIMARY,
                "admin.staff",
                "admin.reader.config",
                "admin.collector.config",
                "admin.cashbox",
                "reader",
                "collector",
                "cashier"));
        ALLOWED_BY_ROLE = Collections.unmodifiableMap(allowed);

        Map<String, List<String>> portable = new LinkedHashMap<>();
        portable.put(ADMIN, immutableList(
                ADMIN_PRIMARY,
                "admin.staff",
                "admin.reader.config",
                "admin.collector.config",
                "admin.cashbox",
                ENTERPRISE_CORE));
        portable.put(READER, immutableList("reader"));
        portable.put(COLLECTOR, immutableList("collector"));
        portable.put(CASHIER, immutableList("cashier"));
        portable.put(UNIFIED, immutableList(
                ERP_PRIMARY,
                "erp.billing",
                "erp.accounting",
                "erp.procurement",
                "erp.inventory",
                "erp.assets",
                "erp.hr",
                "erp.maintenance",
                "erp.documents",
                "erp.audit",
                ENTERPRISE_CORE,
                ADMIN_PRIMARY,
                "admin.staff",
                "admin.reader.config",
                "admin.collector.config",
                "admin.cashbox",
                "reader",
                "collector",
                "cashier"));
        portable.put(UNIFIED, immutableList(
                ERP_PRIMARY,
                ERP_MIGRATION,
                "erp.billing",
                "erp.accounting",
                "erp.procurement",
                "erp.inventory",
                "erp.assets",
                "erp.hr",
                "erp.maintenance",
                "erp.documents",
                "erp.audit",
                ENTERPRISE_CORE,
                ADMIN_PRIMARY,
                "admin.staff",
                "admin.reader.config",
                "admin.collector.config",
                "admin.cashbox",
                "reader",
                "collector",
                "cashier"));
        PORTABLE_BY_ROLE = Collections.unmodifiableMap(portable);
    }

    private QatraNamespacePolicy() { }

    public static String normalizeRole(String role) {
        return role == null ? "" : role.trim().toUpperCase(Locale.ROOT);
    }

    public static String primaryNamespaceForRole(String role) {
        String normalized = normalizeRole(role);
        if (ADMIN.equals(normalized)) return ADMIN_PRIMARY;
        if (READER.equals(normalized)) return "reader";
        if (COLLECTOR.equals(normalized)) return "collector";
        if (CASHIER.equals(normalized)) return "cashier";
        if (UNIFIED.equals(normalized)) return ERP_PRIMARY;
        throw new SecurityException("صلاحية نطاق البيانات غير معروفة");
    }

    public static Set<String> allowedNamespacesForRole(String role) {
        Set<String> namespaces = ALLOWED_BY_ROLE.get(normalizeRole(role));
        if (namespaces == null) throw new SecurityException("صلاحية نطاق البيانات غير معروفة");
        return namespaces;
    }

    public static List<String> portableNamespacesForRole(String role) {
        List<String> namespaces = PORTABLE_BY_ROLE.get(normalizeRole(role));
        if (namespaces == null) throw new SecurityException("صلاحية النسخة الاحتياطية غير معروفة");
        return namespaces;
    }

    public static boolean isAllowed(String role, String namespace) {
        return namespace != null && allowedNamespacesForRole(role).contains(namespace);
    }

    public static void requireNamespace(String role, String namespace) {
        if (!isAllowed(role, namespace)) {
            throw new SecurityException("نطاق البيانات غير مسموح لصلاحية " + normalizeRole(role));
        }
    }

    private static Set<String> immutableSet(String... values) {
        return Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList(values)));
    }

    private static List<String> immutableList(String... values) {
        return Collections.unmodifiableList(new ArrayList<>(Arrays.asList(values)));
    }
}