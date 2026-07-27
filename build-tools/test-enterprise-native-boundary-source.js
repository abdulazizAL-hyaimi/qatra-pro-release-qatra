'use strict';

const fs = require('fs');
const assert = require('assert');

const read = file => fs.readFileSync(file, 'utf8');
const policy = read('app/src/main/java/com/qatra/pro/QatraNamespacePolicy.java');
const activity = read('app/src/main/java/com/qatra/pro/MainActivity.java');
const database = read('app/src/main/java/com/qatra/pro/QatraDatabase.java');
const mobile = read('app/src/main/assets/qatra/mobile.html');
const enterprise = read('app/src/main/assets/qatra/assets/enterprise.js');

assert.match(policy, /ENTERPRISE_CORE\s*=\s*"enterprise\.core"/,
  'enterprise.core must have one native policy constant');
assert.match(policy, /allowed\.put\(ADMIN,[\s\S]*?ENTERPRISE_CORE\)\);/,
  'ADMIN must be allowed to use enterprise.core');
assert.match(policy, /portable\.put\(ADMIN,[\s\S]*?ENTERPRISE_CORE\)\);/,
  'ADMIN portable backups must include enterprise.core');

for (const role of ['READER', 'COLLECTOR', 'CASHIER']) {
  const allowed = new RegExp(`allowed\\.put\\(${role},\\s*immutableSet\\([^)]*enterprise\\.core`, 'i');
  const portable = new RegExp(`portable\\.put\\(${role},\\s*immutableList\\([^)]*enterprise\\.core`, 'i');
  assert.doesNotMatch(policy, allowed, `${role} must not access enterprise.core`);
  assert.doesNotMatch(policy, portable, `${role} backups must not contain enterprise.core`);
}

assert.match(activity, /QatraNamespacePolicy\.requireNamespace\(APP_ROLE, namespace\)/,
  'Android bridge must delegate namespace checks to the central policy');
assert.match(activity, /QatraNamespacePolicy\.primaryNamespaceForRole\(APP_ROLE\)/,
  'Android bridge must delegate primary namespace selection');
assert.doesNotMatch(activity, /allowed\.add\("admin"\)/,
  'MainActivity must not keep a second namespace allowlist');

assert.match(database, /QatraNamespacePolicy\.portableNamespacesForRole\(role\)/,
  'SQLite backup scope must come from the central policy');
assert.match(database, /QatraNamespacePolicy\.primaryNamespaceForRole\(role\)/,
  'SQLite primary namespace must come from the central policy');
for (const arrayName of [
  'suppliers','purchaseRequests','purchaseOrders','goodsReceipts','supplierInvoices',
  'inventoryItems','warehouses','stockMovements','assets','employees','attendance',
  'leaves','payrollRuns','workOrders','budgets','approvals','documents'
]) {
  assert.ok(database.includes(`"${arrayName}"`),
    `SQLite searchable record index must include ${arrayName}`);
}

assert.match(enterprise, /const NS='enterprise\.core'/,
  'enterprise runtime must use the protected enterprise namespace');
assert.match(mobile, /id="enterprise" class="tab enterprise-body"/,
  'enterprise portal must remain embedded in the ADMIN application');
assert.match(mobile, /App\.switchTab\('enterprise'\)/,
  'ADMIN menu must open the embedded enterprise portal');
assert.doesNotMatch(mobile, /href="enterprise\.html"/,
  'enterprise portal must not navigate to a blocked standalone page');

console.log('Enterprise native namespace, backup scope and ADMIN access checks passed.');
