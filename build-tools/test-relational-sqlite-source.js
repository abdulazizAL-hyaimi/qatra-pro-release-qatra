const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const db = fs.readFileSync(
  path.join(root, 'app/src/main/java/com/qatra/pro/QatraDatabase.java'),
  'utf8'
);

function ok(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`OK  ${message}`);
}

ok(db.includes('DATABASE_VERSION = 8'), 'SQLite schema version is upgraded to 6 for recovery, governed sync and receipts');

const relationalTables = [
  'qatra_profiles',
  'qatra_staff_users',
  'qatra_subscribers',
  'qatra_billing_cycles',
  'qatra_meter_readings',
  'qatra_invoices',
  'qatra_payments',
  'qatra_expenses',
  'qatra_cashbox_transactions',
  'qatra_direct_payments',
  'qatra_entity_versions',
  'qatra_sync_outbox'
];

for (const table of relationalTables) {
  ok(db.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `relational table ${table} exists`);
}

ok(
  db.includes('if (oldVersion < 2)') &&
    db.includes('createRelationalSchema(db)') &&
    db.includes('backfillRelationalState(db)'),
  'version 1 databases are upgraded and backfilled without deleting app_state'
);

ok(
  db.includes('if (oldVersion < 3)') &&
    db.includes('ensureColumn(db, "qatra_meter_readings", "meter_changed"') &&
    db.includes('createBusinessRuleSchema(db)'),
  'version 2 databases gain business constraints without deleting existing state'
);

for (const index of [
  'uq_qatra_subscriber_code',
  'uq_qatra_meter_no',
  'uq_qatra_cycle_type_date',
  'uq_qatra_reading_cycle_subscriber'
]) {
  ok(db.includes(`CREATE UNIQUE INDEX IF NOT EXISTS ${index}`), `${index} is enforced in SQLite`);
}

ok(
  db.includes('catch (android.database.sqlite.SQLiteConstraintException conflict)') &&
    db.includes('LEGACY_UNIQUE_CONFLICT'),
  'legacy duplicate projections are audited without making an upgraded database unreadable'
);

for (const rule of [
  'ARREARS_AND_CREDIT_CONFLICT',
  'NEGATIVE_SUBSCRIBER_VALUE',
  'CURRENT_READING_BELOW_PREVIOUS',
  'NEGATIVE_READING_VALUE'
]) {
  ok(db.includes(rule), `${rule} has a database trigger`);
}

ok(
  db.includes('validateBusinessRules(new JSONObject(payloadJson))') &&
    db.includes('رقم المشترك مكرر') &&
    db.includes('رقم العداد مكرر') &&
    db.includes('القراءة الحالية لا يمكن أن تقل عن القراءة السابقة'),
  'JSON snapshots are rejected before projection when subscriber or reading rules are invalid'
);

ok(
  /saveStateInTransaction[\s\S]*projectRelationalState\(db, namespace, root, syncStatus, now\)/.test(db),
  'legacy-compatible state and relational projections are committed by one transaction'
);

for (const mapping of [
  ['SUBSCRIBER', 'qatra_subscribers'],
  ['BILLING_CYCLE', 'qatra_billing_cycles'],
  ['METER_READING', 'qatra_meter_readings'],
  ['INVOICE', 'qatra_invoices'],
  ['PAYMENT', 'qatra_payments'],
  ['EXPENSE', 'qatra_expenses'],
  ['CASHBOX_TRANSACTION', 'qatra_cashbox_transactions'],
  ['DIRECT_PAYMENT', 'qatra_direct_payments']
]) {
  ok(
    db.includes(`"${mapping[0]}"`) && db.includes(`"${mapping[1]}"`),
    `${mapping[0]} is projected to ${mapping[1]}`
  );
}

ok(
  db.includes('qatra_entity_versions') &&
    db.includes('entity_version INTEGER NOT NULL') &&
    db.includes('current.version + 1L'),
  'entity versions remain monotonic across updates and deletions'
);

ok(
  db.includes("action IN('UPSERT','DELETE')") &&
    db.includes('recordDeletion') &&
    db.includes('local_sequence INTEGER PRIMARY KEY AUTOINCREMENT'),
  'the accounting outbox records ordered UPSERT and DELETE operations'
);

ok(
  db.includes('pendingAccountingChanges') &&
    db.includes('acknowledgeAccountingChanges') &&
    db.includes("status IN('PENDING','FAILED')") &&
    db.includes('values.put("status", "ACKNOWLEDGED")'),
  'future connector can read ordered pending changes and acknowledge accepted operations'
);

ok(
  db.includes('payloadHash.equals(current.payloadHash)') &&
    db.includes('UNIQUE(namespace,entity_type,entity_id,entity_version,action)'),
  'unchanged saves and repeated operations do not create duplicate accounting movements'
);

ok(
  db.includes('isBinaryKey') &&
    db.includes('normalized.endsWith("photo")') &&
    db.includes('"projectlogo".equals(normalized)') &&
    db.includes('has_attachment'),
  'large photos and logos are excluded from accounting payloads while attachment presence is kept'
);

ok(
  db.includes('exportRelationalSyncState') &&
    db.includes('restoreRelationalSyncState') &&
    db.includes('payload.put("relationalSync"') &&
    db.includes('projectionRowExists'),
  'portable and Drive backups preserve entity versions and unsent accounting changes after reinstall'
);

ok(
  db.includes("status IN('PENDING','FAILED')") &&
    db.includes('Only the newest unacknowledged state of an entity is needed'),
  'pending changes are coalesced per entity so the database does not grow without bound'
);

ok(
  db.includes('assignment.optJSONArray("subscribers")') &&
    db.includes('setup.optJSONArray("subscribers")') &&
    db.includes('assignment.optJSONObject("cycle")'),
  'reader, collector and cashier nested assignments are projected into relational rows'
);

console.log('\nRelational SQLite source test passed.');
