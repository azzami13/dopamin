import Decimal from "decimal.js";
import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  cashierExpenseLines, cashierReports, cashCounts, dataIssues, menuItems, menuPriceHistory,
  paymentLines, paymentMethods, salesReportItems, salesReports, sourceFieldMappings,
  expenseCategories, userSourceAliases, users,
} from "@/db/schema";
import { firstPayloadValue, parseBusinessDate, parseDecimal } from "@/lib/integration/parsers";
import { mappedOne, mappedValues } from "./mapping";
import type { GoogleFormEnvelope, MappingRow } from "./types";

export type IntegrationTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type NormalizeResult = { status: "VALID" | "NEEDS_REVIEW"; businessDate: string | null; issueCount: number };

function normalizeAlias(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function resolveSourceUser(dbLike: any, sourceCode: "CASHIER" | "KITCHEN" | "BEVERAGE", rawName: string | null) {
  if (!rawName) return null;
  const normalized = normalizeAlias(rawName);
  const [row] = await dbLike.select({ userId: userSourceAliases.userId })
    .from(userSourceAliases)
    .innerJoin(users, eq(users.id, userSourceAliases.userId))
    .where(and(
      eq(userSourceAliases.sourceCode, sourceCode),
      eq(userSourceAliases.normalizedAlias, normalized),
      eq(userSourceAliases.isActive, true),
      eq(users.isActive, true),
    ))
    .limit(1);
  return row?.userId ?? null;
}

async function mappingsFor(dataSourceId: string, connection: typeof db | IntegrationTx): Promise<MappingRow[]> {
  return connection.select({
    sourceFieldName: sourceFieldMappings.sourceFieldName,
    mappingType: sourceFieldMappings.mappingType,
    targetKey: sourceFieldMappings.targetKey,
  }).from(sourceFieldMappings).where(and(eq(sourceFieldMappings.dataSourceId, dataSourceId), eq(sourceFieldMappings.isActive, true)));
}

async function issue(dbLike: any, sourceSubmissionId: string, module: string, severity: "INFO" | "WARNING" | "CRITICAL", issueCode: string, message: string, fieldName?: string) {
  await dbLike.insert(dataIssues).values({ sourceSubmissionId, module, severity, issueCode, message, fieldName });
}

function documentedBusinessDate(source: string, payload: Record<string, unknown>) {
  if (source === "CASHIER") return firstPayloadValue(payload, ["Tanggal Pelaporan"]);
  return firstPayloadValue(payload, ["Tanggal Penjualan", "Tanggal penjualan"]);
}

export async function normalizeCashier(input: { dataSourceId: string; rawSubmissionId: string; envelope: GoogleFormEnvelope }, connection: typeof db | IntegrationTx = db): Promise<NormalizeResult> {
  const mappings = await mappingsFor(input.dataSourceId, connection);
  const payload = input.envelope.payload;
  const mappedDate = mappedOne(payload, mappings, "BUSINESS_DATE");
  const dateSource = mappedDate ? { sourceField: mappedDate.sourceFieldName, value: mappedDate.value } : documentedBusinessDate("CASHIER", payload);
  const businessDate = parseBusinessDate(dateSource?.value);

  if (!businessDate) {
    await issue(connection, input.rawSubmissionId, "CASHIER", "CRITICAL", "INVALID_BUSINESS_DATE", "Tanggal Pelaporan wajib ada dan harus berupa tanggal yang valid.", dateSource?.sourceField);
    return { status: "NEEDS_REVIEW", businessDate: null, issueCount: 1 };
  }

  return connection.transaction(async (tx) => {
    let needsReview = false;
    let issueCount = 0;
    const identity = mappedOne(payload, mappings, "CASHIER_NAME") ?? null;
    const fallbackName = firstPayloadValue(payload, ["Nama Cashier", "Cashier"]);
    const cashierNameRaw = String(identity?.value ?? fallbackName?.value ?? "").trim() || null;
    const cashierUserId = await resolveSourceUser(tx, "CASHIER", cashierNameRaw);
    const shift = mappedOne(payload, mappings, "SHIFT_CODE");
    const txType = mappedOne(payload, mappings, "TRANSACTION_TYPE");
    const openingClosing = mappedOne(payload, mappings, "OPENING_CLOSING_STATUS");
    const petty = mappedOne(payload, mappings, "PETTY_CASH");
    const outsidePetty = mappedOne(payload, mappings, "CASH_OUTSIDE_PETTY");

    const reportValues = {
      sourceSubmissionId: input.rawSubmissionId,
      businessDate,
      cashierUserId,
      cashierNameRaw,
      shiftCode: shift ? String(shift.value ?? "").trim() || null : null,
      transactionType: txType ? String(txType.value ?? "").trim() || null : null,
      openingClosingStatus: openingClosing ? String(openingClosing.value ?? "").trim() || null : null,
      pettyCashAmount: petty ? parseDecimal(petty.value) : null,
      cashOutsidePettyAmount: outsidePetty ? parseDecimal(outsidePetty.value) : null,
      reportStatus: "VALID",
    };
    const [report] = await tx.insert(cashierReports).values(reportValues).onConflictDoUpdate({ target: cashierReports.sourceSubmissionId, set: reportValues }).returning({ id: cashierReports.id });
    await tx.delete(paymentLines).where(eq(paymentLines.cashierReportId, report.id));
    await tx.delete(cashierExpenseLines).where(eq(cashierExpenseLines.cashierReportId, report.id));
    await tx.delete(cashCounts).where(eq(cashCounts.cashierReportId, report.id));

    if (cashierNameRaw && !cashierUserId) {
      needsReview = true; issueCount++;
      await issue(tx, input.rawSubmissionId, "CASHIER", "WARNING", "USER_NOT_RESOLVED", `Nama Cashier "${cashierNameRaw}" belum dipetakan ke user aktif.`, identity?.sourceFieldName ?? fallbackName?.sourceField);
    }

    const paymentMaps = mappedValues(payload, mappings, "PAYMENT");
    if (paymentMaps.length === 0) {
      needsReview = true; issueCount++;
      await issue(tx, input.rawSubmissionId, "CASHIER", "WARNING", "PAYMENT_MAPPING_MISSING", "Belum ada source_field_mapping bertipe PAYMENT untuk sumber Cashier.");
    }
    const observedByMethod = new Map<string, Array<{ amount: string; sourceField: string }>>();
    for (const p of paymentMaps) {
      const amount = parseDecimal(p.value);
      if (amount === null) continue;
      const amountD = new Decimal(amount);
      if (amountD.lt(0)) { needsReview = true; issueCount++; await issue(tx, input.rawSubmissionId, "CASHIER", "CRITICAL", "INVALID_PAYMENT_AMOUNT", `Nilai pembayaran ${p.targetKey} tidak valid.`, p.sourceFieldName); continue; }
      if (amountD.eq(0)) continue;
      const [method] = await tx.select({ id: paymentMethods.id }).from(paymentMethods).where(eq(paymentMethods.code, p.targetKey)).limit(1);
      if (!method) { needsReview = true; issueCount++; await issue(tx, input.rawSubmissionId, "CASHIER", "CRITICAL", "UNKNOWN_PAYMENT_METHOD", `Payment method ${p.targetKey} belum tersedia pada master.`, p.sourceFieldName); continue; }
      await tx.insert(paymentLines).values({ cashierReportId: report.id, paymentMethodId: method.id, amount, sourceField: p.sourceFieldName });
      const existing = observedByMethod.get(p.targetKey) ?? []; existing.push({ amount, sourceField: p.sourceFieldName }); observedByMethod.set(p.targetKey, existing);
    }
    for (const [method, values] of observedByMethod) {
      const duplicates = values.filter((v, i) => values.findIndex((x) => x.amount === v.amount) !== i);
      if (duplicates.length) {
        needsReview = true; issueCount++;
        await issue(tx, input.rawSubmissionId, "CASHIER", "WARNING", "DUPLICATE_BRANCH_VALUE", `Ditemukan nilai cabang ganda yang sama untuk ${method}; perlu ditinjau sebelum masuk laporan final.`);
      }
    }

    for (const e of mappedValues(payload, mappings, "EXPENSE")) {
      const amount = parseDecimal(e.value);
      if (amount === null) continue;
      const amountD = new Decimal(amount);
      if (amountD.eq(0)) continue;
      if (amountD.lt(0)) { needsReview = true; issueCount++; await issue(tx, input.rawSubmissionId, "CASHIER", "CRITICAL", "INVALID_EXPENSE_AMOUNT", "Nilai pengeluaran tidak boleh negatif.", e.sourceFieldName); continue; }
      const [category] = await tx.select({ id: expenseCategories.id }).from(expenseCategories).where(eq(expenseCategories.code, e.targetKey)).limit(1);
      const [resolvedCategory] = category ? [category] : await tx.select({ id: expenseCategories.id }).from(expenseCategories).where(eq(expenseCategories.code, "UNMAPPED")).limit(1);
      if (!category) { needsReview = true; issueCount++; await issue(tx, input.rawSubmissionId, "CASHIER", "WARNING", "UNKNOWN_EXPENSE_CATEGORY", `Kategori ${e.targetKey} belum tersedia; sementara dipetakan ke UNMAPPED.`, e.sourceFieldName); }
      await tx.insert(cashierExpenseLines).values({ cashierReportId: report.id, expenseCategoryId: resolvedCategory?.id, amount, sourceField: e.sourceFieldName });
    }

    for (const c of mappedValues(payload, mappings, "CASH_COUNT")) {
      const qty = parseDecimal(c.value, 0);
      const denomination = parseDecimal(c.targetKey, 2);
      if (qty === null || denomination === null) continue;
      const qtyD = new Decimal(qty), denomD = new Decimal(denomination);
      if (qtyD.lt(0) || !qtyD.isInteger() || denomD.lte(0)) {
        needsReview = true; issueCount++; await issue(tx, input.rawSubmissionId, "CASHIER", "WARNING", "INVALID_CASH_COUNT", "Denominasi atau jumlah lembar/koin tidak valid.", c.sourceFieldName); continue;
      }
      await tx.insert(cashCounts).values({ cashierReportId: report.id, denominationAmount: denomination, quantity: qtyD.toNumber(), sourceField: c.sourceFieldName });
    }

    if (needsReview) await tx.update(cashierReports).set({ reportStatus: "NEEDS_REVIEW" }).where(eq(cashierReports.id, report.id));
    return { status: needsReview ? "NEEDS_REVIEW" as const : "VALID" as const, businessDate, issueCount };
  });
}

export async function normalizeSales(input: { source: "KITCHEN" | "BEVERAGE"; dataSourceId: string; rawSubmissionId: string; envelope: GoogleFormEnvelope }, connection: typeof db | IntegrationTx = db): Promise<NormalizeResult> {
  const mappings = await mappingsFor(input.dataSourceId, connection);
  const payload = input.envelope.payload;
  const mappedDate = mappedOne(payload, mappings, "BUSINESS_DATE");
  const dateSource = mappedDate ? { sourceField: mappedDate.sourceFieldName, value: mappedDate.value } : documentedBusinessDate(input.source, payload);
  const businessDate = parseBusinessDate(dateSource?.value);
  if (!businessDate) {
    await issue(connection, input.rawSubmissionId, input.source, "CRITICAL", "INVALID_BUSINESS_DATE", input.source === "BEVERAGE" ? "Beverage wajib memiliki Tanggal Penjualan eksplisit sebelum dianggap final." : "Tanggal penjualan wajib ada dan valid.", dateSource?.sourceField);
    return { status: "NEEDS_REVIEW", businessDate: null, issueCount: 1 };
  }

  return connection.transaction(async (tx) => {
    const inputterMap = mappedOne(payload, mappings, "INPUTTER_NAME");
    const fallback = input.source === "BEVERAGE" ? firstPayloadValue(payload, ["Barista", "Nama Barista", "Nama Cashier"]) : firstPayloadValue(payload, ["Inputter", "Nama Inputter", "Nama"]);
    const inputterNameRaw = String(inputterMap?.value ?? fallback?.value ?? "").trim() || null;
    const inputterUserId = await resolveSourceUser(tx, input.source, inputterNameRaw);
    const reportValues = {
      sourceSubmissionId: input.rawSubmissionId,
      inputterUserId,
      reportType: input.source === "KITCHEN" ? "FOOD" : "BEVERAGE",
      businessDate,
      inputterNameRaw,
      reportStatus: "VALID",
    };
    const [report] = await tx.insert(salesReports).values(reportValues).onConflictDoUpdate({ target: salesReports.sourceSubmissionId, set: reportValues }).returning({ id: salesReports.id });
    await tx.delete(salesReportItems).where(eq(salesReportItems.salesReportId, report.id));

    let needsReview = false;
    let issueCount = 0;
    if (inputterNameRaw && !inputterUserId) {
      needsReview = true; issueCount++;
      await issue(tx, input.rawSubmissionId, input.source, "WARNING", "USER_NOT_RESOLVED", `Nama inputter "${inputterNameRaw}" belum dipetakan ke user aktif.`, inputterMap?.sourceFieldName ?? fallback?.sourceField);
    }
    const itemMaps = mappedValues(payload, mappings, "SALE_ITEM");
    if (!itemMaps.length) {
      needsReview = true; issueCount++;
      await issue(tx, input.rawSubmissionId, input.source, "WARNING", "SALE_ITEM_MAPPING_MISSING", "Belum ada source_field_mapping bertipe SALE_ITEM untuk source ini.");
    }

    const knownFields = new Set(mappings.map((mapping) => mapping.sourceFieldName));
    for (const [field, value] of Object.entries(payload)) {
      if (!knownFields.has(field) && value !== "" && value !== null) {
        needsReview = true; issueCount++;
        await issue(tx, input.rawSubmissionId, input.source, "WARNING", "UNMAPPED_SOURCE_FIELD", "Kolom berisi nilai belum dipetakan; konfigurasi mapping atau IGNORE eksplisit diperlukan.", field);
      }
    }

    for (const item of itemMaps) {
      const qty = parseDecimal(item.value, 3);
      if (qty === null) continue;
      const qtyD = new Decimal(qty);
      if (qtyD.eq(0)) continue;
      if (qtyD.lt(0)) { needsReview = true; issueCount++; await issue(tx, input.rawSubmissionId, input.source, "CRITICAL", "INVALID_SALE_QUANTITY", "Quantity penjualan tidak boleh negatif.", item.sourceFieldName); continue; }
      const [menu] = await tx.select({ id: menuItems.id, category: menuItems.category }).from(menuItems).where(and(eq(menuItems.code, item.targetKey), eq(menuItems.isActive, true))).limit(1);
      if (!menu) { needsReview = true; issueCount++; await issue(tx, input.rawSubmissionId, input.source, "CRITICAL", "UNKNOWN_MENU_ITEM", `Menu code ${item.targetKey} belum ada pada master menu.`, item.sourceFieldName); continue; }
      const expectedCategory = input.source === "KITCHEN" ? "FOOD" : "BEVERAGE";
      if (menu.category !== expectedCategory) { needsReview = true; issueCount++; await issue(tx, input.rawSubmissionId, input.source, "CRITICAL", "MENU_CATEGORY_MISMATCH", `Menu ${item.targetKey} tidak termasuk kategori ${expectedCategory}.`, item.sourceFieldName); continue; }
      const [price] = await tx.select({ id: menuPriceHistory.id, price: menuPriceHistory.price }).from(menuPriceHistory)
        .where(and(eq(menuPriceHistory.menuItemId, menu.id), lte(menuPriceHistory.effectiveFrom, businessDate), or(isNull(menuPriceHistory.effectiveTo), gte(menuPriceHistory.effectiveTo, businessDate))))
        .orderBy(desc(menuPriceHistory.effectiveFrom)).limit(1);
      if (!price) { needsReview = true; issueCount++; await issue(tx, input.rawSubmissionId, input.source, "CRITICAL", "PRICE_NOT_FOUND", `Tidak ada harga efektif untuk ${item.targetKey} pada ${businessDate}.`, item.sourceFieldName); continue; }
      await tx.insert(salesReportItems).values({ salesReportId: report.id, menuItemId: menu.id, menuPriceHistoryId: price.id, quantity: qty, unitPriceSnapshot: price.price, sourceField: item.sourceFieldName });
    }

    if (needsReview) await tx.update(salesReports).set({ reportStatus: "NEEDS_REVIEW" }).where(eq(salesReports.id, report.id));
    return { status: needsReview ? "NEEDS_REVIEW" as const : "VALID" as const, businessDate, issueCount };
  });
}
