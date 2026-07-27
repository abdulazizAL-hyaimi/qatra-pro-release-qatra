#!/usr/bin/env python3
"""Apply the Qatra Pro v3 native-boundary rebuild foundation.

The script is intentionally idempotent. It centralizes namespace authorization,
adds the enterprise state to portable backups and searchable records, and updates
the security verifier. Workflow files are updated separately with repository-owner
permissions so the automation token never needs workflow-write access.
"""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value, encoding="utf-8")


def replace_once(value: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, value, count=1, flags=re.S | re.M)
    if count != 1:
        raise RuntimeError(f"Expected one replacement for {label}, found {count}")
    return updated


def patch_main_activity() -> None:
    path = "app/src/main/java/com/qatra/pro/MainActivity.java"
    value = read(path)
    if "QatraNamespacePolicy.requireNamespace(APP_ROLE, namespace)" in value:
        return
    pattern = (
        r"    private String primaryNamespaceForCurrentRole\(\) \{.*?"
        r"\n    \}\n\n"
        r"    private void requireNamespace\(String namespace\) \{.*?"
        r"\n    \}\n\n"
        r"    private void requireLegacyKey"
    )
    replacement = (
        "    private String primaryNamespaceForCurrentRole() {\n"
        "        return QatraNamespacePolicy.primaryNamespaceForRole(APP_ROLE);\n"
        "    }\n\n"
        "    private void requireNamespace(String namespace) {\n"
        "        QatraNamespacePolicy.requireNamespace(APP_ROLE, namespace);\n"
        "    }\n\n"
        "    private void requireLegacyKey"
    )
    write(path, replace_once(value, pattern, replacement, "MainActivity namespace policy"))


def patch_database() -> None:
    path = "app/src/main/java/com/qatra/pro/QatraDatabase.java"
    value = read(path)

    if '"supplierInvoices"' not in value.split("public QatraDatabase", 1)[0]:
        indexed_pattern = (
            r"    private static final Set<String> INDEXED_ARRAYS = new HashSet<>\(Arrays\.asList\(\n"
            r".*?\n    \)\);"
        )
        indexed_replacement = (
            "    private static final Set<String> INDEXED_ARRAYS = new HashSet<>(Arrays.asList(\n"
            "            \"subscribers\", \"cycles\", \"readings\", \"invoices\", \"payments\", \"expenses\",\n"
            "            \"transactions\", \"directPayments\", \"cashboxTransactions\", \"cashboxDirectPayments\",\n"
            "            \"receipts\", \"exports\", \"audit\", \"confirmations\", \"users\",\n"
            "            \"suppliers\", \"purchaseRequests\", \"purchaseOrders\", \"goodsReceipts\",\n"
            "            \"supplierInvoices\", \"inventoryItems\", \"warehouses\", \"stockMovements\",\n"
            "            \"assets\", \"employees\", \"attendance\", \"leaves\", \"payrollRuns\",\n"
            "            \"workOrders\", \"budgets\", \"approvals\", \"documents\"\n"
            "    ));"
        )
        value = replace_once(value, indexed_pattern, indexed_replacement, "enterprise searchable arrays")

    if "QatraNamespacePolicy.portableNamespacesForRole(role)" not in value:
        namespace_pattern = (
            r"    private static String primaryNamespaceForRole\(String role\) \{.*?"
            r"\n    \}\n\n"
            r"    private static java\.util\.List<String> portableNamespacesForRole\(String role\) \{.*?"
            r"\n    \}\n\n"
            r"    private static JSONObject preserveOperationalStart"
        )
        namespace_replacement = (
            "    private static String primaryNamespaceForRole(String role) {\n"
            "        return QatraNamespacePolicy.primaryNamespaceForRole(role);\n"
            "    }\n\n"
            "    private static java.util.List<String> portableNamespacesForRole(String role) {\n"
            "        return QatraNamespacePolicy.portableNamespacesForRole(role);\n"
            "    }\n\n"
            "    private static JSONObject preserveOperationalStart"
        )
        value = replace_once(value, namespace_pattern, namespace_replacement, "SQLite namespace policy")

    write(path, value)


def patch_secure_verifier() -> None:
    path = "build-tools/verify-secure-source.js"
    value = read(path)
    if "const namespacePolicy=" not in value:
        value = value.replace(
            "const db=text(path.join(root,'app/src/main/java/com/qatra/pro/QatraDatabase.java'));",
            "const db=text(path.join(root,'app/src/main/java/com/qatra/pro/QatraDatabase.java'));\n"
            "const namespacePolicy=text(path.join(root,'app/src/main/java/com/qatra/pro/QatraNamespacePolicy.java'));",
            1,
        )
    value = value.replace(
        "ok(db.includes('exportPortableBackup')&&db.includes('restorePortableBackup')&&db.includes('admin.staff')&&db.includes('BACKUP_RESTORED'),'portable restore covers all role namespaces in SQLite');",
        "ok(db.includes('exportPortableBackup')&&db.includes('restorePortableBackup')&&db.includes('BACKUP_RESTORED')&&namespacePolicy.includes('admin.staff')&&namespacePolicy.includes('ENTERPRISE_CORE'),'portable restore covers operational and enterprise ADMIN namespaces in SQLite');",
    )
    value = value.replace(
        "ok(mainActivity.includes('manager_users.html')&&mainActivity.includes('admin.staff')&&mainActivity.includes('admin.reader.config'),'native allowlists include staff and reader administration');",
        "ok(mainActivity.includes('manager_users.html')&&mainActivity.includes('QatraNamespacePolicy.requireNamespace')&&namespacePolicy.includes('admin.staff')&&namespacePolicy.includes('admin.reader.config')&&namespacePolicy.includes('ENTERPRISE_CORE'),'native namespace policy includes administration and enterprise data');",
    )
    write(path, value)


def main() -> None:
    patch_main_activity()
    patch_database()
    patch_secure_verifier()
    print("Qatra Pro v3 rebuild foundation applied successfully.")


if __name__ == "__main__":
    main()
