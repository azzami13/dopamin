import Decimal from "decimal.js";
import {
  and,
  desc,
  eq,
  gte,
  isNull,
  lte,
  or,
} from "drizzle-orm";

import { db } from "@/db/client";
import {
  cashierExpenseLines,
  cashierReports,
  cashCounts,
  dataIssues,
  expenseCategories,
  menuItems,
  menuPriceHistory,
  paymentLines,
  paymentMethods,
  salesReportItems,
  salesReports,
  sourceFieldMappings,
  userSourceAliases,
  users,
} from "@/db/schema";

import {
  firstPayloadValue,
  parseBusinessDate,
  parseDecimal,
  unwrap,
} from "@/lib/integration/parsers";

import {
  mappedOne,
  mappedValues,
} from "./mapping";

import type {
  GoogleFormEnvelope,
  MappingRow,
} from "./types";

export type IntegrationTx =
  Parameters<
    Parameters<
      typeof db.transaction
    >[0]
  >[0];

type IntegrationConnection =
  | typeof db
  | IntegrationTx;

type SourceCode =
  | "CASHIER"
  | "KITCHEN"
  | "BEVERAGE";

type SalesSourceCode =
  Exclude<
    SourceCode,
    "CASHIER"
  >;

type NormalizeResult = {
  status:
    | "VALID"
    | "NEEDS_REVIEW";

  businessDate:
    | string
    | null;

  issueCount: number;
};

/*
 * Normalisasi alias nama staff supaya
 * pencocokan dari Google Form konsisten.
 */
function normalizeAlias(
  value: string,
): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/*
 * Menentukan apakah suatu field benar-benar
 * berisi nilai yang harus diproses.
 */
function hasMeaningfulValue(
  value: unknown,
): boolean {
  const unwrapped =
    unwrap(value);

  if (
    unwrapped === null ||
    unwrapped === undefined
  ) {
    return false;
  }

  if (
    typeof unwrapped ===
    "string"
  ) {
    return (
      unwrapped.trim() !== ""
    );
  }

  if (
    Array.isArray(
      unwrapped,
    )
  ) {
    return unwrapped.some(
      (item) =>
        hasMeaningfulValue(
          item,
        ),
    );
  }

  return true;
}


/*
 * Ambil teks pendamping untuk satu logical expense target.
 *
 * Contoh:
 *   EXPENSE / TRANSPORT
 *   EXPENSE_STAFF / TRANSPORT
 *   EXPENSE_DESCRIPTION / TRANSPORT
 *
 * targetKey dipakai sebagai pengikat antar-field, walaupun
 * master expense category untuk target tersebut belum tersedia.
 */
function mappedCompanionText(
  payload:
    Record<
      string,
      unknown
    >,

  mappings:
    MappingRow[],

  mappingType:
    string,

  targetKey:
    string,
): string | null {
  const companion =
    mappedValues(
      payload,
      mappings,
      mappingType,
    ).find(
      (candidate) =>
        candidate.targetKey ===
          targetKey &&
        hasMeaningfulValue(
          candidate.value,
        ),
    );

  if (!companion) {
    return null;
  }

  const value =
    unwrap(
      companion.value,
    );

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    const parts =
      value
        .map(
          (item) =>
            String(
              unwrap(item) ??
                "",
            ).trim(),
        )
        .filter(
          (item) =>
            item.length >
            0,
        );

    return (
      parts.join(", ") ||
      null
    );
  }

  return (
    String(value)
      .trim() ||
    null
  );
}

/*
 * Resolve nama mentah dari Form
 * melalui user_source_aliases.
 *
 * Tidak melakukan fuzzy matching.
 */
async function resolveSourceUser(
  dbLike:
    IntegrationConnection,

  sourceCode:
    SourceCode,

  rawName:
    string | null,
): Promise<
  string | null
> {
  if (!rawName) {
    return null;
  }

  const normalized =
    normalizeAlias(
      rawName,
    );

  const [row] =
    await dbLike
      .select({
        userId:
          userSourceAliases.userId,
      })
      .from(
        userSourceAliases,
      )
      .innerJoin(
        users,
        eq(
          users.id,
          userSourceAliases.userId,
        ),
      )
      .where(
        and(
          eq(
            userSourceAliases.sourceCode,
            sourceCode,
          ),

          eq(
            userSourceAliases.normalizedAlias,
            normalized,
          ),

          eq(
            userSourceAliases.isActive,
            true,
          ),

          eq(
            users.isActive,
            true,
          ),
        ),
      )
      .limit(1);

  return (
    row?.userId ??
    null
  );
}

/*
 * Ambil hanya mapping aktif
 * untuk satu Data Source.
 */
async function mappingsFor(
  dataSourceId: string,

  connection:
    IntegrationConnection,
): Promise<
  MappingRow[]
> {
  return connection
    .select({
      sourceFieldName:
        sourceFieldMappings.sourceFieldName,

      mappingType:
        sourceFieldMappings.mappingType,

      targetKey:
        sourceFieldMappings.targetKey,
    })
    .from(
      sourceFieldMappings,
    )
    .where(
      and(
        eq(
          sourceFieldMappings.dataSourceId,
          dataSourceId,
        ),

        eq(
          sourceFieldMappings.isActive,
          true,
        ),
      ),
    );
}

/*
 * Helper pembuatan Data Issue.
 */
async function issue(
  dbLike:
    IntegrationConnection,

  sourceSubmissionId:
    string,

  module:
    string,

  severity:
    | "INFO"
    | "WARNING"
    | "CRITICAL",

  issueCode:
    string,

  message:
    string,

  fieldName?:
    string,
): Promise<void> {
  await dbLike
    .insert(
      dataIssues,
    )
    .values({
      sourceSubmissionId,
      module,
      severity,
      issueCode,
      message,
      fieldName,
    });
}

/*
 * Fallback nama field Business Date
 * sesuai desain operasional.
 *
 * Cashier:
 *   Tanggal Pelaporan
 *
 * Kitchen/Beverage:
 *   Tanggal Penjualan
 */
function documentedBusinessDate(
  source:
    SourceCode,

  payload:
    Record<
      string,
      unknown
    >,
) {
  if (
    source ===
    "CASHIER"
  ) {
    return firstPayloadValue(
      payload,
      [
        "Tanggal Pelaporan",
      ],
    );
  }

  return firstPayloadValue(
    payload,
    [
      "Tanggal Penjualan",
      "Tanggal penjualan",
    ],
  );
}

/*
 * Semua kolom non-empty dari Google Form harus:
 *
 * - mempunyai mapping aktif, atau
 * - mempunyai mapping_type IGNORE.
 *
 * Karena IGNORE juga berada di source_field_mappings,
 * field tersebut tetap dianggap "known".
 */
async function reportUnmappedSourceFields(
  dbLike:
    IntegrationConnection,

  sourceSubmissionId:
    string,

  module:
    SourceCode,

  payload:
    Record<
      string,
      unknown
    >,

  mappings:
    MappingRow[],
): Promise<number> {
  const knownFields =
    new Set(
      mappings.map(
        (mapping) =>
          mapping.sourceFieldName,
      ),
    );

  let issueCount = 0;

  for (
    const [
      field,
      value,
    ] of
      Object.entries(
        payload,
      )
  ) {
    if (
      !knownFields.has(
        field,
      ) &&
      hasMeaningfulValue(
        value,
      )
    ) {
      issueCount++;

      await issue(
        dbLike,
        sourceSubmissionId,
        module,
        "WARNING",
        "UNMAPPED_SOURCE_FIELD",

        module ===
          "CASHIER"
          ? "Kolom Cashier berisi nilai tetapi belum dipetakan; konfigurasi mapping atau IGNORE eksplisit diperlukan."
          : "Kolom berisi nilai belum dipetakan; konfigurasi mapping atau IGNORE eksplisit diperlukan.",

        field,
      );
    }
  }

  return issueCount;
}

/*
 * =========================================================
 * CASHIER NORMALIZER
 * =========================================================
 */

export async function normalizeCashier(
  input: {
    dataSourceId:
      string;

    rawSubmissionId:
      string;

    envelope:
      GoogleFormEnvelope;
  },

  connection:
    IntegrationConnection =
      db,
): Promise<
  NormalizeResult
> {
  const mappings =
    await mappingsFor(
      input.dataSourceId,
      connection,
    );

  const payload =
    input.envelope.payload;

  /*
   * BUSINESS DATE
   */
  const mappedDate =
    mappedOne(
      payload,
      mappings,
      "BUSINESS_DATE",
    );

  const dateSource =
    mappedDate
      ? {
          sourceField:
            mappedDate.sourceFieldName,

          value:
            mappedDate.value,
        }
      : documentedBusinessDate(
          "CASHIER",
          payload,
        );

  const businessDate =
    parseBusinessDate(
      dateSource?.value,
    );

  if (!businessDate) {
    await issue(
      connection,
      input.rawSubmissionId,
      "CASHIER",
      "CRITICAL",
      "INVALID_BUSINESS_DATE",
      "Tanggal Pelaporan wajib ada dan harus berupa tanggal yang valid.",
      dateSource?.sourceField,
    );

    return {
      status:
        "NEEDS_REVIEW",

      businessDate:
        null,

      issueCount:
        1,
    };
  }

  return connection.transaction(
    async (tx) => {
      let needsReview =
        false;

      let issueCount =
        0;

      /*
       * IDENTITY
       */
      const identity =
        mappedOne(
          payload,
          mappings,
          "CASHIER_NAME",
        );

      const fallbackName =
        firstPayloadValue(
          payload,
          [
            "Nama Cashier",
            "Cashier",
          ],
        );

      const cashierNameRaw =
        String(
          identity?.value ??
            fallbackName?.value ??
            "",
        ).trim() ||
        null;

      const cashierUserId =
        await resolveSourceUser(
          tx,
          "CASHIER",
          cashierNameRaw,
        );

      /*
       * OPTIONAL METADATA
       */
      const shift =
        mappedOne(
          payload,
          mappings,
          "SHIFT_CODE",
        );

      const txType =
        mappedOne(
          payload,
          mappings,
          "TRANSACTION_TYPE",
        );

      const openingClosing =
        mappedOne(
          payload,
          mappings,
          "OPENING_CLOSING_STATUS",
        );

      const petty =
        mappedOne(
          payload,
          mappings,
          "PETTY_CASH",
        );

      const outsidePetty =
        mappedOne(
          payload,
          mappings,
          "CASH_OUTSIDE_PETTY",
        );

      /*
       * PETTY CASH VALIDATION
       */
      let pettyCashAmount:
        string | null =
          null;

      if (
        petty &&
        hasMeaningfulValue(
          petty.value,
        )
      ) {
        const parsed =
          parseDecimal(
            petty.value,
          );

        if (
          parsed === null ||
          new Decimal(
            parsed,
          ).lt(0)
        ) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            "CASHIER",
            "CRITICAL",
            "INVALID_PETTY_CASH_AMOUNT",
            "Nilai petty cash tidak dapat dibaca sebagai angka non-negatif.",
            petty.sourceFieldName,
          );
        } else {
          pettyCashAmount =
            parsed;
        }
      }

      /*
       * CASH OUTSIDE PETTY
       */
      let cashOutsidePettyAmount:
        string | null =
          null;

      if (
        outsidePetty &&
        hasMeaningfulValue(
          outsidePetty.value,
        )
      ) {
        const parsed =
          parseDecimal(
            outsidePetty.value,
          );

        if (
          parsed === null ||
          new Decimal(
            parsed,
          ).lt(0)
        ) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            "CASHIER",
            "CRITICAL",
            "INVALID_CASH_OUTSIDE_PETTY_AMOUNT",
            "Nilai cash di luar petty cash tidak dapat dibaca sebagai angka non-negatif.",
            outsidePetty.sourceFieldName,
          );
        } else {
          cashOutsidePettyAmount =
            parsed;
        }
      }

      /*
       * UPSERT CASHIER REPORT
       */
      const reportValues = {
        sourceSubmissionId:
          input.rawSubmissionId,

        businessDate,

        cashierUserId,

        cashierNameRaw,

        shiftCode:
          shift
            ? String(
                shift.value ??
                  "",
              ).trim() ||
              null
            : null,

        transactionType:
          txType
            ? String(
                txType.value ??
                  "",
              ).trim() ||
              null
            : null,

        openingClosingStatus:
          openingClosing
            ? String(
                openingClosing.value ??
                  "",
              ).trim() ||
              null
            : null,

        pettyCashAmount,

        cashOutsidePettyAmount,

        /*
         * Mulai VALID.
         * Jika ditemukan issue,
         * akan diubah menjadi NEEDS_REVIEW.
         */
        reportStatus:
          "VALID",
      };

      const [report] =
        await tx
          .insert(
            cashierReports,
          )
          .values(
            reportValues,
          )
          .onConflictDoUpdate({
            target:
              cashierReports.sourceSubmissionId,

            set:
              reportValues,
          })
          .returning({
            id:
              cashierReports.id,
          });

      /*
       * Rebuild normalized child lines.
       */
      await tx
        .delete(
          paymentLines,
        )
        .where(
          eq(
            paymentLines.cashierReportId,
            report.id,
          ),
        );

      await tx
        .delete(
          cashierExpenseLines,
        )
        .where(
          eq(
            cashierExpenseLines.cashierReportId,
            report.id,
          ),
        );

      await tx
        .delete(
          cashCounts,
        )
        .where(
          eq(
            cashCounts.cashierReportId,
            report.id,
          ),
        );

      /*
       * CASHIER USER RESOLUTION
       */
      if (
        cashierNameRaw &&
        !cashierUserId
      ) {
        needsReview =
          true;

        issueCount++;

        await issue(
          tx,
          input.rawSubmissionId,
          "CASHIER",
          "WARNING",
          "USER_NOT_RESOLVED",
          `Nama Cashier "${cashierNameRaw}" belum dipetakan ke user aktif.`,
          identity
            ?.sourceFieldName ??
            fallbackName
              ?.sourceField,
        );
      }

      /*
       * UNMAPPED SOURCE FIELDS
       */
      const unmappedCount =
        await reportUnmappedSourceFields(
          tx,
          input.rawSubmissionId,
          "CASHIER",
          payload,
          mappings,
        );

      if (
        unmappedCount >
        0
      ) {
        needsReview =
          true;

        issueCount +=
          unmappedCount;
      }

      /*
       * =====================================================
       * PAYMENT LINES
       * =====================================================
       */

      const paymentMaps =
        mappedValues(
          payload,
          mappings,
          "PAYMENT",
        );

      if (
        paymentMaps.length ===
        0
      ) {
        needsReview =
          true;

        issueCount++;

        await issue(
          tx,
          input.rawSubmissionId,
          "CASHIER",
          "WARNING",
          "PAYMENT_MAPPING_MISSING",
          "Belum ada source_field_mapping bertipe PAYMENT untuk sumber Cashier.",
        );
      }

      const observedByMethod =
        new Map<
          string,
          Array<{
            amount: string;
            sourceField:
              string;
          }>
        >();

      for (
        const payment of
        paymentMaps
      ) {
        /*
         * Blank field boleh diabaikan.
         */
        if (
          !hasMeaningfulValue(
            payment.value,
          )
        ) {
          continue;
        }

        const amount =
          parseDecimal(
            payment.value,
          );

        /*
         * Non-empty tetapi tidak dapat diparse
         * tidak boleh silently skipped.
         */
        if (
          amount === null
        ) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            "CASHIER",
            "CRITICAL",
            "INVALID_PAYMENT_AMOUNT",
            `Nilai pembayaran ${payment.targetKey} tidak dapat dibaca sebagai angka.`,
            payment.sourceFieldName,
          );

          continue;
        }

        const amountD =
          new Decimal(
            amount,
          );

        if (
          amountD.lt(0)
        ) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            "CASHIER",
            "CRITICAL",
            "INVALID_PAYMENT_AMOUNT",
            `Nilai pembayaran ${payment.targetKey} tidak boleh negatif.`,
            payment.sourceFieldName,
          );

          continue;
        }

        /*
         * Nilai 0 tidak perlu dibuat menjadi line.
         */
        if (
          amountD.eq(0)
        ) {
          continue;
        }

        /*
         * Hanya payment method aktif
         * yang boleh digunakan.
         */
        const [method] =
          await tx
            .select({
              id:
                paymentMethods.id,
            })
            .from(
              paymentMethods,
            )
            .where(
              and(
                eq(
                  paymentMethods.code,
                  payment.targetKey,
                ),

                eq(
                  paymentMethods.isActive,
                  true,
                ),
              ),
            )
            .limit(1);

        if (!method) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            "CASHIER",
            "CRITICAL",
            "UNKNOWN_PAYMENT_METHOD",
            `Payment method ${payment.targetKey} belum tersedia atau tidak aktif pada master.`,
            payment.sourceFieldName,
          );

          continue;
        }

        await tx
          .insert(
            paymentLines,
          )
          .values({
            cashierReportId:
              report.id,

            paymentMethodId:
              method.id,

            amount,

            sourceField:
              payment.sourceFieldName,
          });

        const existing =
          observedByMethod.get(
            payment.targetKey,
          ) ?? [];

        existing.push({
          amount,

          sourceField:
            payment.sourceFieldName,
        });

        observedByMethod.set(
          payment.targetKey,
          existing,
        );
      }

      /*
       * Duplicate branch warning.
       *
       * Misalnya dua cabang Form untuk QRIS
       * menghasilkan nilai identik.
       */
      for (
        const [
          methodCode,
          values,
        ] of
          observedByMethod
      ) {
        const seenAmounts =
          new Set<string>();

        const duplicateAmounts =
          new Set<string>();

        for (
          const value of
          values
        ) {
          if (
            seenAmounts.has(
              value.amount,
            )
          ) {
            duplicateAmounts.add(
              value.amount,
            );
          }

          seenAmounts.add(
            value.amount,
          );
        }

        if (
          duplicateAmounts.size >
          0
        ) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            "CASHIER",
            "WARNING",
            "DUPLICATE_BRANCH_VALUE",
            `Ditemukan nilai cabang ganda yang sama untuk ${methodCode}; perlu ditinjau sebelum masuk laporan final.`,
          );
        }
      }

      /*
       * =====================================================
       * EXPENSE LINES
       * =====================================================
       *
       * Expense amount, staff, dan description diikat dengan
       * targetKey yang sama.
       *
       * Contoh:
       *
       *   EXPENSE             / TRANSPORT
       *   EXPENSE_STAFF       / TRANSPORT
       *   EXPENSE_DESCRIPTION / TRANSPORT
       *
       * Jika master expense category TRANSPORT belum tersedia,
       * line tetap disimpan memakai fallback UNMAPPED dan
       * report ditandai NEEDS_REVIEW.
       */

      const expenseMaps =
        mappedValues(
          payload,
          mappings,
          "EXPENSE",
        );

      if (
        expenseMaps.length ===
        0
      ) {
        needsReview =
          true;

        issueCount++;

        await issue(
          tx,
          input.rawSubmissionId,
          "CASHIER",
          "WARNING",
          "EXPENSE_MAPPING_MISSING",
          "Belum ada source_field_mapping bertipe EXPENSE untuk sumber Cashier.",
        );
      }

      const expenseTargetsWithValue =
        new Set(
          expenseMaps
            .filter(
              (expense) =>
                hasMeaningfulValue(
                  expense.value,
                ),
            )
            .map(
              (expense) =>
                expense.targetKey,
            ),
        );

      /*
       * Metadata expense yang terisi tanpa amount pasangannya
       * perlu ditinjau agar data staff/description tidak diam-diam
       * terlepas dari transaksi pengeluaran.
       */
      for (
        const metadataType of
        [
          "EXPENSE_STAFF",
          "EXPENSE_DESCRIPTION",
        ]
      ) {
        for (
          const metadata of
          mappedValues(
            payload,
            mappings,
            metadataType,
          )
        ) {
          if (
            !hasMeaningfulValue(
              metadata.value,
            ) ||
            expenseTargetsWithValue.has(
              metadata.targetKey,
            )
          ) {
            continue;
          }

          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            "CASHIER",
            "WARNING",
            "ORPHAN_EXPENSE_METADATA",
            `Field ${metadataType} untuk target ${metadata.targetKey} berisi nilai tetapi tidak ada amount EXPENSE yang terisi.`,
            metadata.sourceFieldName,
          );
        }
      }

      for (
        const expense of
        expenseMaps
      ) {
        if (
          !hasMeaningfulValue(
            expense.value,
          )
        ) {
          continue;
        }

        const amount =
          parseDecimal(
            expense.value,
          );

        /*
         * Non-empty invalid value
         * tidak boleh silently skipped.
         */
        if (
          amount === null
        ) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            "CASHIER",
            "CRITICAL",
            "INVALID_EXPENSE_AMOUNT",
            "Nilai pengeluaran tidak dapat dibaca sebagai angka.",
            expense.sourceFieldName,
          );

          continue;
        }

        const amountD =
          new Decimal(
            amount,
          );

        if (
          amountD.lt(0)
        ) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            "CASHIER",
            "CRITICAL",
            "INVALID_EXPENSE_AMOUNT",
            "Nilai pengeluaran tidak boleh negatif.",
            expense.sourceFieldName,
          );

          continue;
        }

        if (
          amountD.eq(0)
        ) {
          continue;
        }

        const staffNameRaw =
          mappedCompanionText(
            payload,
            mappings,
            "EXPENSE_STAFF",
            expense.targetKey,
          );

        const description =
          mappedCompanionText(
            payload,
            mappings,
            "EXPENSE_DESCRIPTION",
            expense.targetKey,
          );

        /*
         * Cari kategori pengeluaran aktif.
         */
        const [category] =
          await tx
            .select({
              id:
                expenseCategories.id,
            })
            .from(
              expenseCategories,
            )
            .where(
              and(
                eq(
                  expenseCategories.code,
                  expense.targetKey,
                ),

                eq(
                  expenseCategories.isActive,
                  true,
                ),
              ),
            )
            .limit(1);

        let resolvedCategoryId:
          string | null =
            category?.id ??
            null;

        /*
         * Jika kategori target belum ada,
         * gunakan fallback UNMAPPED.
         */
        if (!category) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            "CASHIER",
            "WARNING",
            "UNKNOWN_EXPENSE_CATEGORY",
            `Kategori ${expense.targetKey} belum tersedia atau tidak aktif; mencoba fallback UNMAPPED.`,
            expense.sourceFieldName,
          );

          const [
            fallbackCategory,
          ] =
            await tx
              .select({
                id:
                  expenseCategories.id,
              })
              .from(
                expenseCategories,
              )
              .where(
                and(
                  eq(
                    expenseCategories.code,
                    "UNMAPPED",
                  ),

                  eq(
                    expenseCategories.isActive,
                    true,
                  ),
                ),
              )
              .limit(1);

          resolvedCategoryId =
            fallbackCategory
              ?.id ??
            null;

          /*
           * Jangan insert expense tanpa kategori fallback
           * jika master belum siap.
           */
          if (
            !resolvedCategoryId
          ) {
            needsReview =
              true;

            issueCount++;

            await issue(
              tx,
              input.rawSubmissionId,
              "CASHIER",
              "CRITICAL",
              "UNMAPPED_EXPENSE_CATEGORY_MISSING",
              "Kategori fallback UNMAPPED belum tersedia atau tidak aktif; baris pengeluaran tidak dinormalisasi.",
              expense.sourceFieldName,
            );

            continue;
          }
        }

        await tx
          .insert(
            cashierExpenseLines,
          )
          .values({
            cashierReportId:
              report.id,

            expenseCategoryId:
              resolvedCategoryId,

            amount,

            staffNameRaw,

            description,

            sourceField:
              expense.sourceFieldName,
          });
      }

      /*
       * =====================================================
       * CASH DENOMINATION COUNTS
       * =====================================================
       */

      const seenDenominations =
        new Set<string>();

      for (
        const count of
        mappedValues(
          payload,
          mappings,
          "CASH_COUNT",
        )
      ) {
        if (
          !hasMeaningfulValue(
            count.value,
          )
        ) {
          continue;
        }

        const quantity =
          parseDecimal(
            count.value,
            0,
          );

        const denomination =
          parseDecimal(
            count.targetKey,
            2,
          );

        /*
         * Non-empty invalid field
         * tidak boleh silently skipped.
         */
        if (
          quantity === null ||
          denomination ===
            null
        ) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            "CASHIER",
            "WARNING",
            "INVALID_CASH_COUNT",
            "Denominasi atau jumlah lembar/koin tidak dapat dibaca sebagai angka.",
            count.sourceFieldName,
          );

          continue;
        }

        const quantityD =
          new Decimal(
            quantity,
          );

        const denominationD =
          new Decimal(
            denomination,
          );

        if (
          quantityD.lt(0) ||
          !quantityD.isInteger() ||
          denominationD.lte(
            0,
          )
        ) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            "CASHIER",
            "WARNING",
            "INVALID_CASH_COUNT",
            "Denominasi atau jumlah lembar/koin tidak valid.",
            count.sourceFieldName,
          );

          continue;
        }

        const denominationKey =
          denominationD.toFixed(
            2,
          );

        /*
         * cash_counts punya unique:
         *
         * cashier_report_id
         * + denomination_amount
         *
         * Maka duplicate mapping harus ditangani
         * sebelum database constraint meledak.
         */
        if (
          seenDenominations.has(
            denominationKey,
          )
        ) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            "CASHIER",
            "WARNING",
            "DUPLICATE_CASH_DENOMINATION_MAPPING",
            `Lebih dari satu source field memetakan denominasi ${denominationKey}; mapping harus ditinjau agar tidak terjadi double count.`,
            count.sourceFieldName,
          );

          continue;
        }

        seenDenominations.add(
          denominationKey,
        );

        await tx
          .insert(
            cashCounts,
          )
          .values({
            cashierReportId:
              report.id,

            denominationAmount:
              denomination,

            quantity:
              quantityD.toNumber(),

            sourceField:
              count.sourceFieldName,
          });
      }

      /*
       * FINAL CASHIER STATUS
       */
      if (needsReview) {
        await tx
          .update(
            cashierReports,
          )
          .set({
            reportStatus:
              "NEEDS_REVIEW",
          })
          .where(
            eq(
              cashierReports.id,
              report.id,
            ),
          );
      }

      return {
        status:
          needsReview
            ? (
                "NEEDS_REVIEW" as const
              )
            : (
                "VALID" as const
              ),

        businessDate,

        issueCount,
      };
    },
  );
}

/*
 * =========================================================
 * KITCHEN / BEVERAGE NORMALIZER
 * =========================================================
 */

export async function normalizeSales(
  input: {
    source:
      SalesSourceCode;

    dataSourceId:
      string;

    rawSubmissionId:
      string;

    envelope:
      GoogleFormEnvelope;
  },

  connection:
    IntegrationConnection =
      db,
): Promise<
  NormalizeResult
> {
  const mappings =
    await mappingsFor(
      input.dataSourceId,
      connection,
    );

  const payload =
    input.envelope.payload;

  /*
   * BUSINESS DATE
   */
  const mappedDate =
    mappedOne(
      payload,
      mappings,
      "BUSINESS_DATE",
    );

  const dateSource =
    mappedDate
      ? {
          sourceField:
            mappedDate.sourceFieldName,

          value:
            mappedDate.value,
        }
      : documentedBusinessDate(
          input.source,
          payload,
        );

  const businessDate =
    parseBusinessDate(
      dateSource?.value,
    );

  /*
   * Beverage tidak boleh memakai
   * submission timestamp sebagai Business Date.
   *
   * Harus explicit Tanggal Penjualan.
   */
  if (!businessDate) {
    await issue(
      connection,
      input.rawSubmissionId,
      input.source,
      "CRITICAL",
      "INVALID_BUSINESS_DATE",

      input.source ===
        "BEVERAGE"
        ? "Beverage wajib memiliki Tanggal Penjualan eksplisit sebelum dianggap final."
        : "Tanggal penjualan wajib ada dan valid.",

      dateSource?.sourceField,
    );

    return {
      status:
        "NEEDS_REVIEW",

      businessDate:
        null,

      issueCount:
        1,
    };
  }

  return connection.transaction(
    async (tx) => {
      /*
       * INPUTTER IDENTITY
       */
      const inputterMap =
        mappedOne(
          payload,
          mappings,
          "INPUTTER_NAME",
        );

      const fallback =
        input.source ===
        "BEVERAGE"
          ? firstPayloadValue(
              payload,
              [
                "Barista",
                "Nama Barista",
                "Nama Cashier",
              ],
            )
          : firstPayloadValue(
              payload,
              [
                "Inputter",
                "Nama Inputter",
                "Nama",
              ],
            );

      const inputterNameRaw =
        String(
          inputterMap?.value ??
            fallback?.value ??
            "",
        ).trim() ||
        null;

      const inputterUserId =
        await resolveSourceUser(
          tx,
          input.source,
          inputterNameRaw,
        );

      /*
       * UPSERT SALES REPORT
       */
      const reportValues = {
        sourceSubmissionId:
          input.rawSubmissionId,

        inputterUserId,

        reportType:
          input.source ===
          "KITCHEN"
            ? "FOOD"
            : "BEVERAGE",

        businessDate,

        inputterNameRaw,

        reportStatus:
          "VALID",
      };

      const [report] =
        await tx
          .insert(
            salesReports,
          )
          .values(
            reportValues,
          )
          .onConflictDoUpdate({
            target:
              salesReports.sourceSubmissionId,

            set:
              reportValues,
          })
          .returning({
            id:
              salesReports.id,
          });

      /*
       * Rebuild item lines.
       */
      await tx
        .delete(
          salesReportItems,
        )
        .where(
          eq(
            salesReportItems.salesReportId,
            report.id,
          ),
        );

      let needsReview =
        false;

      let issueCount =
        0;

      /*
       * USER ALIAS
       */
      if (
        inputterNameRaw &&
        !inputterUserId
      ) {
        needsReview =
          true;

        issueCount++;

        await issue(
          tx,
          input.rawSubmissionId,
          input.source,
          "WARNING",
          "USER_NOT_RESOLVED",
          `Nama inputter "${inputterNameRaw}" belum dipetakan ke user aktif.`,
          inputterMap
            ?.sourceFieldName ??
            fallback
              ?.sourceField,
        );
      }

      /*
       * SALE ITEM MAPPINGS
       */
      const itemMaps =
        mappedValues(
          payload,
          mappings,
          "SALE_ITEM",
        );

      if (
        itemMaps.length ===
        0
      ) {
        needsReview =
          true;

        issueCount++;

        await issue(
          tx,
          input.rawSubmissionId,
          input.source,
          "WARNING",
          "SALE_ITEM_MAPPING_MISSING",
          "Belum ada source_field_mapping bertipe SALE_ITEM untuk source ini.",
        );
      }

      /*
       * UNMAPPED SOURCE FIELDS
       */
      const unmappedCount =
        await reportUnmappedSourceFields(
          tx,
          input.rawSubmissionId,
          input.source,
          payload,
          mappings,
        );

      if (
        unmappedCount >
        0
      ) {
        needsReview =
          true;

        issueCount +=
          unmappedCount;
      }

      /*
       * sales_report_items punya unique:
       *
       * sales_report_id
       * + menu_item_id
       *
       * Maka duplicate target mapping
       * perlu dihentikan sebelum insert kedua.
       */
      const seenMenuTargets =
        new Set<string>();

      /*
       * =====================================================
       * SALE ITEMS
       * =====================================================
       */

      for (
        const item of
        itemMaps
      ) {
        /*
         * Blank field boleh diabaikan.
         */
        if (
          !hasMeaningfulValue(
            item.value,
          )
        ) {
          continue;
        }

        const quantity =
          parseDecimal(
            item.value,
            3,
          );

        /*
         * Non-empty invalid qty
         * tidak boleh silently skipped.
         */
        if (
          quantity ===
          null
        ) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            input.source,
            "CRITICAL",
            "INVALID_SALE_QUANTITY",
            "Quantity penjualan tidak dapat dibaca sebagai angka.",
            item.sourceFieldName,
          );

          continue;
        }

        const quantityD =
          new Decimal(
            quantity,
          );

        if (
          quantityD.lt(0)
        ) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            input.source,
            "CRITICAL",
            "INVALID_SALE_QUANTITY",
            "Quantity penjualan tidak boleh negatif.",
            item.sourceFieldName,
          );

          continue;
        }

        /*
         * Qty 0 tidak perlu dibuat menjadi item.
         */
        if (
          quantityD.eq(0)
        ) {
          continue;
        }

        /*
         * Jangan izinkan dua field non-zero
         * menuju menu yang sama secara diam-diam.
         */
        if (
          seenMenuTargets.has(
            item.targetKey,
          )
        ) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            input.source,
            "CRITICAL",
            "DUPLICATE_SALE_ITEM_MAPPING",
            `Lebih dari satu source field berisi nilai dan memetakan menu ${item.targetKey}; mapping harus ditinjau agar tidak terjadi double count.`,
            item.sourceFieldName,
          );

          continue;
        }

        seenMenuTargets.add(
          item.targetKey,
        );

        /*
         * MENU MASTER
         */
        const [menu] =
          await tx
            .select({
              id:
                menuItems.id,

              category:
                menuItems.category,
            })
            .from(
              menuItems,
            )
            .where(
              and(
                eq(
                  menuItems.code,
                  item.targetKey,
                ),

                eq(
                  menuItems.isActive,
                  true,
                ),
              ),
            )
            .limit(1);

        if (!menu) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            input.source,
            "CRITICAL",
            "UNKNOWN_MENU_ITEM",
            `Menu code ${item.targetKey} belum ada atau tidak aktif pada master menu.`,
            item.sourceFieldName,
          );

          continue;
        }

        const expectedCategory =
          input.source ===
          "KITCHEN"
            ? "FOOD"
            : "BEVERAGE";

        if (
          menu.category !==
          expectedCategory
        ) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            input.source,
            "CRITICAL",
            "MENU_CATEGORY_MISMATCH",
            `Menu ${item.targetKey} tidak termasuk kategori ${expectedCategory}.`,
            item.sourceFieldName,
          );

          continue;
        }

        /*
         * EFFECTIVE PRICE
         *
         * effective_from <= business date
         *
         * dan
         *
         * effective_to null
         * atau
         * effective_to >= business date
         */
        const [price] =
          await tx
            .select({
              id:
                menuPriceHistory.id,

              price:
                menuPriceHistory.price,
            })
            .from(
              menuPriceHistory,
            )
            .where(
              and(
                eq(
                  menuPriceHistory.menuItemId,
                  menu.id,
                ),

                lte(
                  menuPriceHistory.effectiveFrom,
                  businessDate,
                ),

                or(
                  isNull(
                    menuPriceHistory.effectiveTo,
                  ),

                  gte(
                    menuPriceHistory.effectiveTo,
                    businessDate,
                  ),
                ),
              ),
            )
            .orderBy(
              desc(
                menuPriceHistory.effectiveFrom,
              ),
            )
            .limit(1);

        /*
         * Harga tidak boleh dikarang.
         */
        if (!price) {
          needsReview =
            true;

          issueCount++;

          await issue(
            tx,
            input.rawSubmissionId,
            input.source,
            "CRITICAL",
            "PRICE_NOT_FOUND",
            `Tidak ada harga efektif untuk ${item.targetKey} pada ${businessDate}.`,
            item.sourceFieldName,
          );

          continue;
        }

        /*
         * Snapshot harga untuk menjaga
         * histori revenue.
         */
        await tx
          .insert(
            salesReportItems,
          )
          .values({
            salesReportId:
              report.id,

            menuItemId:
              menu.id,

            menuPriceHistoryId:
              price.id,

            quantity,

            unitPriceSnapshot:
              price.price,

            sourceField:
              item.sourceFieldName,
          });
      }

      /*
       * FINAL SALES STATUS
       */
      if (needsReview) {
        await tx
          .update(
            salesReports,
          )
          .set({
            reportStatus:
              "NEEDS_REVIEW",
          })
          .where(
            eq(
              salesReports.id,
              report.id,
            ),
          );
      }

      return {
        status:
          needsReview
            ? (
                "NEEDS_REVIEW" as const
              )
            : (
                "VALID" as const
              ),

        businessDate,

        issueCount,
      };
    },
  );
}
