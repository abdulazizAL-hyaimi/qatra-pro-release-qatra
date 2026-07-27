package com.qatra.pro;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/** Generates idempotent double-entry journals from approved ERP documents. */
public final class QatraErpPostingService {
    private static final String ACCOUNTING_NS = "erp.accounting";
    private static final String BILLING_NS = "erp.billing";
    private final QatraDatabase database;

    public QatraErpPostingService(QatraDatabase database) {
        this.database = database;
    }

    public synchronized JSONObject post(String module, String entity, JSONObject record,
            QatraUnifiedUserStore.Session actor) throws Exception {
        JSONObject accounting = readAccounting();
        JSONObject out = applyPosting(module, entity, record, actor, accounting);
        boolean changed = out.optBoolean("_accountingChanged", false);
        out.remove("_accountingChanged");
        if (changed) database.saveState(ACCOUNTING_NS, accounting.toString());
        return out;
    }

    /**
     * Approves the operational record and creates its accounting entry in one SQLite
     * transaction. A crash or validation failure therefore cannot leave only one side saved.
     */
    public synchronized JSONObject approveAndPost(
            String module, String entity, JSONObject approvedRecord, JSONObject proposedModuleState,
            QatraUnifiedUserStore.Session actor) throws Exception {
        if (actor == null) throw new SecurityException("جلسة الاعتماد مطلوبة");
        String cleanModule = upper(module);
        String cleanEntity = safe(entity).trim();
        if (cleanEntity.isEmpty() || proposedModuleState == null || approvedRecord == null) {
            throw new IllegalArgumentException("بيانات الاعتماد المترابطة غير مكتملة");
        }
        String namespace = "erp." + cleanModule.toLowerCase(Locale.ROOT);
        JSONArray proposedRows = proposedModuleState.optJSONArray(cleanEntity);
        String sourceId = first(approvedRecord, "id", "no", "code");
        JSONObject proposed = findSourceRecord(proposedRows, sourceId);
        if (sourceId.isEmpty() || proposed == null
                || !"APPROVED".equals(upper(proposed.optString("status")))) {
            throw new IllegalStateException("السجل المعتمد غير موجود داخل حالة الوحدة المقترحة");
        }
        JSONObject currentState = readNamespace(namespace);
        JSONObject current = findSourceRecord(currentState.optJSONArray(cleanEntity), sourceId);
        if (current == null) throw new IllegalArgumentException("السجل التشغيلي غير موجود");
        String currentStatus = upper(current.optString("status"));
        if (!"SUBMITTED".equals(currentStatus) && !"APPROVED".equals(currentStatus)) {
            throw new IllegalStateException("يجب إرسال السجل للمراجعة قبل اعتماده");
        }
        if (proposed.optString("approvedBy").trim().isEmpty()) {
            proposed.put("approvedBy", actor.userId);
        }
        if (!proposed.has("approvedAt")) proposed.put("approvedAt", System.currentTimeMillis());

        JSONObject accounting = readAccounting();
        JSONObject out = applyPosting(cleanModule, cleanEntity, proposed, actor, accounting);
        out.remove("_accountingChanged");
        proposedModuleState.put("updatedAt", System.currentTimeMillis());

        Map<String, String> states = new LinkedHashMap<>();
        states.put(namespace, proposedModuleState.toString());
        states.put(ACCOUNTING_NS, accounting.toString());
        database.saveStates(states);
        out.put("atomic", true);
        out.put("status", "APPROVED");
        return out;
    }

    private JSONObject applyPosting(
            String module, String entity, JSONObject record,
            QatraUnifiedUserStore.Session actor, JSONObject accounting) throws Exception {
        String cleanModule = upper(module);
        String cleanEntity = record == null ? "" : safe(entity).trim();
        if (record == null) throw new IllegalArgumentException("سجل العملية مطلوب");
        String sourceId = first(record, "id", "no", "code");
        if (sourceId.isEmpty()) throw new IllegalArgumentException("العملية لا تحتوي معرّفًا محاسبيًا");
        String sourceKey = cleanModule + ":" + cleanEntity + ":" + sourceId;

        JSONObject postingIndex = accounting.optJSONObject("postingIndex");
        if (postingIndex == null) { postingIndex = new JSONObject(); accounting.put("postingIndex", postingIndex); }
        if (postingIndex.has(sourceKey)) {
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("posted", false);
            out.put("duplicate", true);
            out.put("journalId", postingIndex.optString(sourceKey));
            out.put("message", "القيد المحاسبي موجود مسبقًا ولم يتكرر");
            return out;
        }

        Posting posting = resolve(cleanModule, cleanEntity, record);
        if (posting == null || posting.amount <= 0d) {
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("posted", false);
            out.put("duplicate", false);
            out.put("message", "لا يتطلب هذا المستند قيدًا تلقائيًا");
            return out;
        }

        JSONArray accounts = accounting.optJSONArray("accounts");
        if (accounts == null) { accounts = new JSONArray(); accounting.put("accounts", accounts); }
        ensureAccount(accounts, posting.debitCode, posting.debitName, posting.debitType);
        ensureAccount(accounts, posting.creditCode, posting.creditName, posting.creditType);

        JSONArray journals = accounting.optJSONArray("journals");
        if (journals == null) { journals = new JSONArray(); accounting.put("journals", journals); }
        String journalId = "AUTO-JV-" + QatraDatabase.sha256(sourceKey).substring(0, 16).toUpperCase(Locale.ROOT);
        JSONObject journal = new JSONObject();
        journal.put("id", journalId);
        journal.put("no", "AJV-" + String.format(Locale.US, "%06d", journals.length() + 1));
        journal.put("date", first(record, "date", "invoiceDate", "paymentDate", "orderDate",
                "receiptDate", "stocktakeDate", "transferDate"));
        if (journal.optString("date").isEmpty()) {
            journal.put("date", new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US)
                    .format(new java.util.Date()));
        }
        journal.put("description", posting.description);
        journal.put("debitAccount", posting.debitCode + " - " + posting.debitName);
        journal.put("creditAccount", posting.creditCode + " - " + posting.creditName);
        journal.put("amount", posting.amount);
        journal.put("status", "APPROVED");
        journal.put("sourceModule", cleanModule);
        journal.put("sourceEntity", cleanEntity);
        journal.put("sourceId", sourceId);
        journal.put("sourceKey", sourceKey);
        journal.put("createdAt", System.currentTimeMillis());
        journal.put("createdBy", actor == null ? "SYSTEM" : actor.userId);
        JSONArray lines = new JSONArray();
        lines.put(line(posting.debitCode, posting.debitName, posting.amount, 0d));
        lines.put(line(posting.creditCode, posting.creditName, 0d, posting.amount));
        journal.put("lines", lines);
        journals.put(journal);
        postingIndex.put(sourceKey, journalId);

        JSONArray audit = accounting.optJSONArray("postingAudit");
        if (audit == null) { audit = new JSONArray(); accounting.put("postingAudit", audit); }
        JSONObject event = new JSONObject();
        event.put("action", "AUTO_JOURNAL_POSTED");
        event.put("journalId", journalId);
        event.put("sourceKey", sourceKey);
        event.put("amount", posting.amount);
        event.put("actorUserId", actor == null ? "SYSTEM" : actor.userId);
        event.put("at", System.currentTimeMillis());
        audit.put(event);
        while (audit.length() > 2000) audit.remove(0);
        accounting.put("updatedAt", System.currentTimeMillis());
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("posted", true);
        out.put("duplicate", false);
        out.put("journal", journal);
        out.put("message", "تم إنشاء القيد المحاسبي التلقائي " + journal.optString("no"));
        out.put("_accountingChanged", true);
        return out;
    
    }

    private static JSONObject findSourceRecord(JSONArray rows, String sourceId) {
        if (rows == null || sourceId == null || sourceId.trim().isEmpty()) return null;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row != null && sourceId.equals(first(row, "id", "no", "code"))) return row;
        }
        return null;
    }

    /**
     * Applies a billing correction only after an independent accounting reviewer decides it.
     * Source documents are preserved and approved financial documents receive linked reversals.
     */
    public synchronized JSONObject decideBillingCorrection(String requestId, String decision,
            String reviewNotes, QatraUnifiedUserStore.Session actor) throws Exception {
        if (actor == null) throw new SecurityException("الجلسة المحاسبية مطلوبة");
        JSONObject billing = readNamespace(BILLING_NS);
        JSONArray requests = billing.optJSONArray("correctionRequests");
        if (requests == null) throw new IllegalArgumentException("طلب التصحيح غير موجود");
        JSONObject request = findById(requests, requestId);
        if (request == null) throw new IllegalArgumentException("طلب التصحيح غير موجود");

        String existingStatus = upper(request.optString("status"));
        if ("EXECUTED".equals(existingStatus) || "REJECTED".equals(existingStatus)) {
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("duplicate", true);
            out.put("status", existingStatus);
            out.put("request", request);
            out.put("message", "سبق اتخاذ القرار في طلب التصحيح");
            return out;
        }
        if (!"SUBMITTED".equals(existingStatus)) {
            throw new IllegalStateException("طلب التصحيح ليس بانتظار المراجعة");
        }
        if (actor.userId.equals(request.optString("requestedBy"))) {
            throw new SecurityException("لا يجوز لمقدم طلب التصحيح اعتماد طلبه أو رفضه");
        }
        String cleanDecision = upper(decision);
        boolean approve = "APPROVE".equals(cleanDecision) || "APPROVED".equals(cleanDecision)
                || "EXECUTE".equals(cleanDecision);
        boolean reject = "REJECT".equals(cleanDecision) || "REJECTED".equals(cleanDecision);
        if (!approve && !reject) throw new IllegalArgumentException("قرار المراجعة غير معتمد");
        String notes = safe(reviewNotes).trim();
        if (reject && notes.length() < 5) {
            throw new IllegalArgumentException("سبب الرفض يجب ألا يقل عن 5 أحرف");
        }
        if (request.optString("reason").trim().length() < 8) {
            throw new IllegalArgumentException("سبب التصحيح غير كافٍ للمراجعة");
        }

        long now = System.currentTimeMillis();
        request.put("reviewedAt", now);
        request.put("reviewedBy", actor.userId);
        request.put("reviewedByUsername", actor.username);
        request.put("reviewNotes", notes);
        if (reject) {
            request.put("status", "REJECTED");
            appendHistory(request, "CORRECTION_REJECTED", actor, detail("notes", notes));
            billing.put("updatedAt", now);
            database.saveState(BILLING_NS, billing.toString());
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("status", "REJECTED");
            out.put("request", request);
            out.put("message", "تم رفض طلب التصحيح مع حفظ السبب");
            return out;
        }

        JSONObject accounting = readAccounting();
        String type = upper(request.optString("targetType"));
        String targetId = request.optString("targetId").trim();
        if (targetId.isEmpty()) throw new IllegalArgumentException("المستند المستهدف غير محدد");
        boolean accountingChanged = false;
        String reversalJournalId = "";

        if ("READING_CORRECTION".equals(type)) {
            applyReadingCorrection(billing, request, actor);
        } else if ("INVOICE_REVERSAL".equals(type)) {
            JSONObject invoice = requireRecord(billing, "invoices", targetId, "الفاتورة");
            ensureNoLiveInvoicePayments(billing, invoice);
            reversalJournalId = reverseJournal(accounting, "BILLING", "invoices",
                    recordId(invoice), request.optString("id"), request.optString("reason"), actor);
            accountingChanged = true;
            String before = invoice.optString("status");
            invoice.put("statusBeforeCorrection", before);
            invoice.put("status", "REVERSED");
            invoice.put("balance", 0d);
            invoice.put("reversalJournalId", reversalJournalId);
            invoice.put("reversedAt", now);
            invoice.put("reversedBy", actor.userId);
            appendHistory(invoice, "INVOICE_REVERSED", actor,
                    detail("correctionId", request.optString("id"), "journalId", reversalJournalId));
        } else if ("PAYMENT_REVERSAL".equals(type)) {
            JSONObject payment = requireRecord(billing, "payments", targetId, "سند القبض");
            String paymentStatus = upper(payment.optString("status"));
            if ("SUBMITTED".equals(paymentStatus)) {
                payment.put("statusBeforeCorrection", paymentStatus);
                payment.put("status", "CANCELLED");
                payment.put("cancelledAt", now);
                payment.put("cancelledBy", actor.userId);
                appendHistory(payment, "PAYMENT_CANCELLED", actor,
                        detail("correctionId", request.optString("id")));
                updateSettlementAfterPaymentCorrection(billing, payment, request, actor, false);
            } else if (isAppliedPaymentStatus(paymentStatus)) {
                reversalJournalId = reverseJournal(accounting, "BILLING", "payments",
                        recordId(payment), request.optString("id"), request.optString("reason"), actor);
                accountingChanged = true;
                payment.put("statusBeforeCorrection", paymentStatus);
                payment.put("status", "REVERSED");
                payment.put("reversalJournalId", reversalJournalId);
                payment.put("reversedAt", now);
                payment.put("reversedBy", actor.userId);
                appendHistory(payment, "PAYMENT_REVERSED", actor,
                        detail("correctionId", request.optString("id"), "journalId", reversalJournalId));
                updateInvoiceAfterPaymentCorrection(billing, payment, actor);
                updateSettlementAfterPaymentCorrection(billing, payment, request, actor, true);
                addCashboxReversal(billing, payment, request, actor);
            } else {
                throw new IllegalStateException("حالة سند القبض لا تسمح بالإلغاء أو العكس");
            }
        } else {
            throw new IllegalArgumentException("نوع طلب التصحيح غير معتمد");
        }

        request.put("status", "EXECUTED");
        request.put("executedAt", now);
        request.put("executedBy", actor.userId);
        if (!reversalJournalId.isEmpty()) request.put("reversalJournalId", reversalJournalId);
        appendHistory(request, "CORRECTION_EXECUTED", actor,
                detail("targetType", type, "reversalJournalId", reversalJournalId));
        billing.put("updatedAt", now);
        if (accountingChanged) {
            accounting.put("updatedAt", now);
            Map<String, String> states = new LinkedHashMap<>();
            states.put(ACCOUNTING_NS, accounting.toString());
            states.put(BILLING_NS, billing.toString());
            database.saveStates(states);
        } else {
            database.saveState(BILLING_NS, billing.toString());
        }

        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("duplicate", false);
        out.put("status", "EXECUTED");
        out.put("request", request);
        if (!reversalJournalId.isEmpty()) out.put("reversalJournalId", reversalJournalId);
        out.put("message", reversalJournalId.isEmpty()
                ? "تم تنفيذ التصحيح وحفظ أثر المراجعة"
                : "تم تنفيذ التصحيح وإنشاء القيد العكسي " + reversalJournalId);
        return out;
    }

    public JSONObject validateBalance() throws Exception {
        JSONObject accounting = readAccounting();
        JSONArray journals = accounting.optJSONArray("journals");
        double debit = 0d, credit = 0d;
        int invalid = 0;
        if (journals != null) {
            for (int i = 0; i < journals.length(); i++) {
                JSONObject journal = journals.optJSONObject(i);
                if (journal == null || !"APPROVED".equalsIgnoreCase(journal.optString("status"))) continue;
                JSONArray lines = journal.optJSONArray("lines");
                double jd = 0d, jc = 0d;
                if (lines != null) {
                    for (int l = 0; l < lines.length(); l++) {
                        JSONObject line = lines.optJSONObject(l);
                        if (line == null) continue;
                        jd += number(line, "debit");
                        jc += number(line, "credit");
                    }
                } else {
                    double amount = number(journal, "amount");
                    jd += amount; jc += amount;
                }
                debit += jd; credit += jc;
                if (Math.abs(jd - jc) > 0.005d) invalid++;
            }
        }
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("totalDebit", debit);
        out.put("totalCredit", credit);
        out.put("difference", debit - credit);
        out.put("invalidJournals", invalid);
        out.put("balanced", invalid == 0 && Math.abs(debit - credit) <= 0.005d);
        return out;
    }

    private void applyReadingCorrection(JSONObject billing, JSONObject request,
            QatraUnifiedUserStore.Session actor) throws Exception {
        JSONObject reading = requireRecord(billing, "readings", request.optString("targetId"), "القراءة");
        if (!"APPROVED".equals(upper(reading.optString("status")))) {
            throw new IllegalStateException("يمكن تصحيح قراءة معتمدة فقط");
        }
        JSONObject cycle = findById(billing.optJSONArray("cycles"),
                first(reading, "cycleId", "cycle", "cycleNo"));
        if (cycle != null) {
            String cycleStatus = upper(cycle.optString("status"));
            if ("CLOSED".equals(cycleStatus) || "ARCHIVED".equals(cycleStatus)) {
                throw new IllegalStateException("لا يمكن تصحيح قراءة دورة مغلقة أو مؤرشفة");
            }
        }
        JSONArray invoices = billing.optJSONArray("invoices");
        if (invoices != null) {
            for (int i = 0; i < invoices.length(); i++) {
                JSONObject invoice = invoices.optJSONObject(i);
                if (invoice == null) continue;
                if (same(recordId(reading), invoice.optString("readingId"))
                        && !isTerminalCorrectionStatus(invoice.optString("status"))) {
                    throw new IllegalStateException("يجب عكس الفاتورة المرتبطة قبل تصحيح القراءة");
                }
            }
        }
        if (!request.has("replacementCurrent")) {
            throw new IllegalArgumentException("القراءة البديلة مطلوبة");
        }
        double previous = firstNumber(reading, "previous");
        double replacement = firstNumber(request, "replacementCurrent");
        if (replacement < previous) {
            throw new IllegalArgumentException("القراءة البديلة لا يمكن أن تقل عن السابقة");
        }
        JSONObject before = new JSONObject();
        before.put("current", reading.opt("current"));
        before.put("consumption", reading.opt("consumption"));
        reading.put("current", replacement);
        reading.put("consumption", replacement - previous);
        reading.put("correctedAt", System.currentTimeMillis());
        reading.put("correctedBy", actor.userId);
        reading.put("lastCorrectionId", request.optString("id"));
        JSONObject details = new JSONObject();
        details.put("correctionId", request.optString("id"));
        details.put("before", before);
        details.put("replacementCurrent", replacement);
        appendHistory(reading, "READING_CORRECTED", actor, details);
    }

    private void ensureNoLiveInvoicePayments(JSONObject billing, JSONObject invoice) throws Exception {
        JSONArray payments = billing.optJSONArray("payments");
        if (payments == null) return;
        String invoiceId = recordId(invoice);
        for (int i = 0; i < payments.length(); i++) {
            JSONObject payment = payments.optJSONObject(i);
            if (payment == null) continue;
            String linked = first(payment, "invoiceId", "invoiceNo");
            if (!same(invoiceId, linked) && !same(invoice.optString("no"), linked)) continue;
            if (!isTerminalCorrectionStatus(payment.optString("status"))) {
                throw new IllegalStateException("يجب إلغاء أو عكس سندات القبض المرتبطة قبل عكس الفاتورة");
            }
        }
    }

    private void updateInvoiceAfterPaymentCorrection(JSONObject billing, JSONObject payment,
            QatraUnifiedUserStore.Session actor) throws Exception {
        JSONObject invoice = findById(billing.optJSONArray("invoices"),
                first(payment, "invoiceId", "invoiceNo"));
        if (invoice == null) return;
        JSONArray payments = billing.optJSONArray("payments");
        double paid = 0d;
        if (payments != null) {
            for (int i = 0; i < payments.length(); i++) {
                JSONObject candidate = payments.optJSONObject(i);
                if (candidate == null || !isAppliedPaymentStatus(upper(candidate.optString("status")))) continue;
                String linked = first(candidate, "invoiceId", "invoiceNo");
                if (same(recordId(invoice), linked) || same(invoice.optString("no"), linked)) {
                    paid += firstNumber(candidate, "amount");
                }
            }
        }
        double total = firstNumber(invoice, "total", "amount");
        double balance = Math.max(0d, total - paid);
        invoice.put("paidAmount", paid);
        invoice.put("balance", balance);
        invoice.put("status", balance <= 0.005d ? "PAID" : paid > 0.005d ? "PARTIAL" : "APPROVED");
        invoice.put("updatedAt", System.currentTimeMillis());
        invoice.put("updatedBy", actor.userId);
        appendHistory(invoice, "PAYMENT_REVERSAL_APPLIED", actor,
                detail("paymentId", recordId(payment), "paidAmount", paid, "balance", balance));
    }

    private void updateSettlementAfterPaymentCorrection(JSONObject billing, JSONObject payment,
            JSONObject request, QatraUnifiedUserStore.Session actor, boolean approvedSettlement)
            throws Exception {
        String settlementId = payment.optString("settlementId");
        if (settlementId.isEmpty()) return;
        JSONObject settlement = findById(billing.optJSONArray("collectorSettlements"), settlementId);
        if (settlement == null) return;
        JSONArray adjustments = settlement.optJSONArray("adjustments");
        if (adjustments == null) {
            adjustments = new JSONArray();
            settlement.put("adjustments", adjustments);
        }
        boolean exists = false;
        for (int i = 0; i < adjustments.length(); i++) {
            JSONObject adjustment = adjustments.optJSONObject(i);
            if (adjustment != null && same(adjustment.optString("correctionId"), request.optString("id"))) {
                exists = true;
                break;
            }
        }
        if (!exists) {
            JSONObject adjustment = new JSONObject();
            adjustment.put("correctionId", request.optString("id"));
            adjustment.put("paymentId", recordId(payment));
            adjustment.put("amount", -firstNumber(payment, "amount"));
            adjustment.put("at", System.currentTimeMillis());
            adjustment.put("by", actor.userId);
            adjustments.put(adjustment);
        }
        if (!approvedSettlement && "SUBMITTED".equals(upper(settlement.optString("status")))) {
            JSONArray originalIds = settlement.optJSONArray("paymentIds");
            JSONArray activeIds = new JSONArray();
            double amount = 0d;
            if (originalIds != null) {
                JSONArray payments = billing.optJSONArray("payments");
                for (int i = 0; i < originalIds.length(); i++) {
                    String id = originalIds.optString(i);
                    if (same(id, recordId(payment))) continue;
                    JSONObject candidate = findById(payments, id);
                    if (candidate == null || isTerminalCorrectionStatus(candidate.optString("status"))) continue;
                    activeIds.put(id);
                    amount += firstNumber(candidate, "amount");
                }
            }
            settlement.put("paymentIds", activeIds);
            settlement.put("count", activeIds.length());
            settlement.put("amount", amount);
            if (activeIds.length() == 0) settlement.put("status", "CANCELLED");
        } else {
            double adjustedAmount = settlement.optDouble("amount", 0d);
            for (int i = 0; i < adjustments.length(); i++) {
                JSONObject adjustment = adjustments.optJSONObject(i);
                if (adjustment != null) adjustedAmount += adjustment.optDouble("amount", 0d);
            }
            settlement.put("adjustedAmount", Math.max(0d, adjustedAmount));
        }
        settlement.put("updatedAt", System.currentTimeMillis());
        settlement.put("updatedBy", actor.userId);
        appendHistory(settlement, "PAYMENT_CORRECTION_APPLIED", actor,
                detail("correctionId", request.optString("id"), "paymentId", recordId(payment)));
    }

    private void addCashboxReversal(JSONObject billing, JSONObject payment, JSONObject request,
            QatraUnifiedUserStore.Session actor) throws Exception {
        JSONArray transactions = billing.optJSONArray("cashboxTransactions");
        if (transactions == null) {
            transactions = new JSONArray();
            billing.put("cashboxTransactions", transactions);
        }
        String correctionId = request.optString("id");
        for (int i = 0; i < transactions.length(); i++) {
            JSONObject transaction = transactions.optJSONObject(i);
            if (transaction != null && same(transaction.optString("correctionId"), correctionId)) return;
        }
        String digest = QatraDatabase.sha256(correctionId).substring(0, 12).toUpperCase(Locale.ROOT);
        JSONObject transaction = new JSONObject();
        transaction.put("id", "CBT-REV-" + digest);
        transaction.put("no", "CBR-REV-" + digest);
        transaction.put("type", "PAYMENT_REVERSAL");
        transaction.put("sourcePaymentId", recordId(payment));
        transaction.put("sourcePaymentNo", payment.optString("no"));
        transaction.put("correctionId", correctionId);
        transaction.put("settlementId", payment.optString("settlementId"));
        transaction.put("amount", -firstNumber(payment, "amount"));
        transaction.put("date", today());
        transaction.put("cashboxSessionId", "");
        transaction.put("status", "APPROVED");
        transaction.put("createdAt", System.currentTimeMillis());
        transaction.put("createdBy", actor.userId);
        transactions.put(transaction);
    }

    private String reverseJournal(JSONObject accounting, String module, String entity,
            String sourceId, String correctionId, String reason,
            QatraUnifiedUserStore.Session actor) throws Exception {
        String sourceKey = upper(module) + ":" + safe(entity).trim() + ":" + safe(sourceId).trim();
        JSONObject postingIndex = accounting.optJSONObject("postingIndex");
        if (postingIndex == null || !postingIndex.has(sourceKey)) {
            throw new IllegalStateException("لا يوجد قيد أصلي مرتبط بالمستند");
        }
        JSONObject reversalIndex = accounting.optJSONObject("reversalIndex");
        if (reversalIndex == null) {
            reversalIndex = new JSONObject();
            accounting.put("reversalIndex", reversalIndex);
        }
        String reversalKey = sourceKey + ":" + correctionId;
        if (reversalIndex.has(reversalKey)) return reversalIndex.optString(reversalKey);

        JSONArray journals = accounting.optJSONArray("journals");
        JSONObject original = findById(journals, postingIndex.optString(sourceKey));
        if (original == null) throw new IllegalStateException("تعذر العثور على القيد الأصلي");
        if (original.optBoolean("reversed", false)) {
            if (same(original.optString("reversalCorrectionId"), correctionId)) {
                return original.optString("reversedByJournalId");
            }
            throw new IllegalStateException("سبق عكس القيد الأصلي بطلب تصحيح آخر");
        }

        String journalId = "REV-JV-" + QatraDatabase.sha256(reversalKey)
                .substring(0, 16).toUpperCase(Locale.ROOT);
        JSONObject reversal = new JSONObject();
        reversal.put("id", journalId);
        reversal.put("no", "RJV-" + String.format(Locale.US, "%06d", journals.length() + 1));
        reversal.put("date", today());
        reversal.put("description", "عكس " + original.optString("description") + " — " + reason);
        reversal.put("debitAccount", original.optString("creditAccount"));
        reversal.put("creditAccount", original.optString("debitAccount"));
        reversal.put("amount", firstNumber(original, "amount"));
        reversal.put("status", "APPROVED");
        reversal.put("sourceModule", upper(module));
        reversal.put("sourceEntity", "reversals");
        reversal.put("sourceId", correctionId);
        reversal.put("sourceKey", "REVERSAL:" + reversalKey);
        reversal.put("reversesJournalId", original.optString("id"));
        reversal.put("reversesSourceKey", sourceKey);
        reversal.put("correctionId", correctionId);
        reversal.put("reason", reason);
        reversal.put("createdAt", System.currentTimeMillis());
        reversal.put("createdBy", actor.userId);
        JSONArray reversedLines = new JSONArray();
        JSONArray originalLines = original.optJSONArray("lines");
        if (originalLines == null || originalLines.length() == 0) {
            throw new IllegalStateException("القيد الأصلي لا يحتوي أطرافًا قابلة للعكس");
        }
        for (int i = 0; i < originalLines.length(); i++) {
            JSONObject sourceLine = originalLines.optJSONObject(i);
            if (sourceLine == null) continue;
            reversedLines.put(line(sourceLine.optString("accountCode"),
                    sourceLine.optString("accountName"), firstNumber(sourceLine, "credit"),
                    firstNumber(sourceLine, "debit")));
        }
        reversal.put("lines", reversedLines);
        journals.put(reversal);
        reversalIndex.put(reversalKey, journalId);
        original.put("reversed", true);
        original.put("reversedAt", System.currentTimeMillis());
        original.put("reversedBy", actor.userId);
        original.put("reversedByJournalId", journalId);
        original.put("reversalCorrectionId", correctionId);

        JSONArray audit = accounting.optJSONArray("postingAudit");
        if (audit == null) {
            audit = new JSONArray();
            accounting.put("postingAudit", audit);
        }
        JSONObject event = new JSONObject();
        event.put("action", "AUTO_JOURNAL_REVERSED");
        event.put("journalId", journalId);
        event.put("reversesJournalId", original.optString("id"));
        event.put("sourceKey", sourceKey);
        event.put("correctionId", correctionId);
        event.put("reason", reason);
        event.put("actorUserId", actor.userId);
        event.put("at", System.currentTimeMillis());
        audit.put(event);
        while (audit.length() > 2000) audit.remove(0);
        return journalId;
    }

    private JSONObject readNamespace(String namespace) throws Exception {
        String payload = database.getState(namespace);
        return payload == null || payload.trim().isEmpty() ? new JSONObject() : new JSONObject(payload);
    }

    private static JSONObject requireRecord(JSONObject state, String arrayName, String id,
            String label) throws Exception {
        JSONObject record = findById(state.optJSONArray(arrayName), id);
        if (record == null) throw new IllegalArgumentException(label + " غير موجود");
        return record;
    }

    private static JSONObject findById(JSONArray rows, String id) {
        if (rows == null) return null;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row != null && (same(recordId(row), id) || same(row.optString("no"), id))) return row;
        }
        return null;
    }

    private static String recordId(JSONObject record) {
        return first(record, "id", "no", "code");
    }

    private static boolean isAppliedPaymentStatus(String status) {
        String clean = upper(status);
        return "APPROVED".equals(clean) || "PAID".equals(clean) || "CLOSED".equals(clean);
    }

    private static boolean isTerminalCorrectionStatus(String status) {
        String clean = upper(status);
        return "CANCELLED".equals(clean) || "REVERSED".equals(clean) || "REJECTED".equals(clean);
    }

    private static boolean same(String left, String right) {
        return safe(left).trim().equals(safe(right).trim());
    }

    private static void appendHistory(JSONObject record, String action,
            QatraUnifiedUserStore.Session actor, JSONObject details) throws Exception {
        JSONArray history = record.optJSONArray("history");
        if (history == null) {
            history = new JSONArray();
            record.put("history", history);
        }
        JSONObject event = new JSONObject();
        event.put("id", "EVT-" + java.util.UUID.randomUUID());
        event.put("action", action);
        event.put("at", System.currentTimeMillis());
        event.put("by", actor == null ? "SYSTEM" : actor.userId);
        event.put("byUsername", actor == null ? "SYSTEM" : actor.username);
        event.put("details", details == null ? new JSONObject() : details);
        history.put(event);
        while (history.length() > 100) history.remove(0);
    }

    private static JSONObject detail(Object... values) throws Exception {
        JSONObject out = new JSONObject();
        for (int i = 0; i + 1 < values.length; i += 2) {
            out.put(String.valueOf(values[i]), values[i + 1]);
        }
        return out;
    }

    private static String today() {
        return new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US)
                .format(new java.util.Date());
    }

    private Posting resolve(String module, String entity, JSONObject record) {
        double amount = amount(record);
        if ("BILLING".equals(module) && "invoices".equals(entity)) {
            return new Posting("1100", "ذمم المشتركين", "ASSET", "4100", "إيرادات المياه",
                    "REVENUE", amount, "إثبات فاتورة مياه " + first(record, "no", "id"));
        }
        if ("BILLING".equals(module) && "payments".equals(entity)) {
            return new Posting("1000", "النقدية والبنوك", "ASSET", "1100", "ذمم المشتركين",
                    "ASSET", amount, "تحصيل من مشترك " + first(record, "no", "id"));
        }
        if ("PROCUREMENT".equals(module) && "supplierInvoices".equals(entity)) {
            return new Posting("1200", "المخزون والمشتريات", "ASSET", "2100", "ذمم الموردين",
                    "LIABILITY", amount, "إثبات فاتورة مورد " + first(record, "no", "id"));
        }
        if ("INVENTORY".equals(module) && "movements".equals(entity)) {
            String type = upper(first(record, "movementType", "type"));
            double value = firstNumber(record, "value", "totalCost", "amount");
            if (value <= 0d) value = amount;
            if (type.contains("OUT") || type.contains("صرف") || type.contains("ISSUE")) {
                return new Posting("5100", "تكلفة المواد المصروفة", "EXPENSE", "1200", "المخزون والمشتريات",
                        "ASSET", value, "صرف مخزني " + first(record, "no", "id"));
            }
            return new Posting("1200", "المخزون والمشتريات", "ASSET", "2190", "استلامات غير مفوترة",
                    "LIABILITY", value, "استلام مخزني " + first(record, "no", "id"));
        }
        if ("ASSETS".equals(module) && "depreciationRuns".equals(entity)) {
            return new Posting("5200", "مصروف الإهلاك", "EXPENSE", "1290", "مجمع الإهلاك",
                    "CONTRA_ASSET", firstNumber(record, "depreciation", "amount"),
                    "إهلاك أصل " + first(record, "asset", "no", "id"));
        }
        if ("HR".equals(module) && "payrollRuns".equals(entity)) {
            double net = firstNumber(record, "net", "gross", "amount");
            return new Posting("5300", "مصروف الرواتب والأجور", "EXPENSE", "2200", "رواتب مستحقة",
                    "LIABILITY", net, "إثبات مسير رواتب " + first(record, "period", "no", "id"));
        }
        if ("MAINTENANCE".equals(module) && "workOrders".equals(entity)) {
            return new Posting("5400", "مصروف الصيانة", "EXPENSE", "2100", "ذمم الموردين",
                    "LIABILITY", firstNumber(record, "actualCost", "estimatedCost", "amount"),
                    "تكلفة أمر صيانة " + first(record, "no", "id"));
        }
        return null;
    }

    private JSONObject readAccounting() throws Exception {
        String payload = database.getState(ACCOUNTING_NS);
        return payload == null || payload.trim().isEmpty() ? new JSONObject() : new JSONObject(payload);
    }

    private static void ensureAccount(JSONArray accounts, String code, String name, String type) throws Exception {
        for (int i = 0; i < accounts.length(); i++) {
            JSONObject account = accounts.optJSONObject(i);
            if (account != null && code.equals(account.optString("code"))) return;
        }
        JSONObject account = new JSONObject();
        account.put("id", "ACC-" + code);
        account.put("code", code);
        account.put("name", name);
        account.put("type", type);
        account.put("status", "APPROVED");
        account.put("system", true);
        account.put("createdAt", System.currentTimeMillis());
        accounts.put(account);
    }

    private static JSONObject line(String code, String name, double debit, double credit) throws Exception {
        JSONObject line = new JSONObject();
        line.put("accountCode", code);
        line.put("accountName", name);
        line.put("debit", debit);
        line.put("credit", credit);
        return line;
    }

    private static double amount(JSONObject record) {
        return firstNumber(record, "amount", "total", "net", "gross", "estimatedAmount",
                "estimatedCost", "cost", "differenceValue");
    }

    private static double firstNumber(JSONObject record, String... keys) {
        for (String key : keys) {
            Object raw = record.opt(key);
            if (raw == null || raw == JSONObject.NULL || String.valueOf(raw).trim().isEmpty()) continue;
            try {
                double value = Double.parseDouble(String.valueOf(raw).replace(",", "").trim());
                if (Double.isFinite(value) && value >= 0d) return value;
            } catch (Exception ignored) { }
        }
        return 0d;
    }

    private static double number(JSONObject object, String key) {
        return firstNumber(object, key);
    }

    private static String first(JSONObject record, String... keys) {
        for (String key : keys) {
            String value = record.optString(key, "").trim();
            if (!value.isEmpty()) return value;
        }
        return "";
    }

    private static String upper(String value) {
        return safe(value).trim().toUpperCase(Locale.ROOT);
    }

    private static String safe(String value) { return value == null ? "" : value; }

    private static final class Posting {
        final String debitCode, debitName, debitType;
        final String creditCode, creditName, creditType;
        final double amount;
        final String description;
        Posting(String debitCode, String debitName, String debitType,
                String creditCode, String creditName, String creditType,
                double amount, String description) {
            this.debitCode = debitCode; this.debitName = debitName; this.debitType = debitType;
            this.creditCode = creditCode; this.creditName = creditName; this.creditType = creditType;
            this.amount = amount; this.description = description;
        }
    }
}