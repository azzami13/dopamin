import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  auditLogs,
  cashierReports,
  dataIssues,
  dataSources,
  rawSubmissions,
  salesReports,
} from "@/db/schema";
import { stableStringify } from "@/lib/integration/canonical-json";
import { evaluateDailyClosing } from "@/modules/reporting/closing.service";

import {
  normalizeCashier,
  normalizeSales,
} from "./normalizers";
import type { GoogleFormEnvelope } from "./types";

export async function ingestGoogleForm(
  envelope: GoogleFormEnvelope,
  correlationId: string,
) {
  /*
   * sourceKey sudah divalidasi oleh googleFormEnvelopeSchema.
   * Tidak lagi memakai startsWith()/canonicalSourceKey().
   */
  const sourceCode = envelope.sourceKey;

  const [source] = await db
    .select()
    .from(dataSources)
    .where(
      and(
        eq(dataSources.code, sourceCode),
        eq(dataSources.isActive, true),
      ),
    )
    .limit(1);

  if (!source) {
    throw Object.assign(
      new Error(
        "Data source is not configured or active",
      ),
      {
        status: 404,
        code: "SOURCE_NOT_CONFIGURED",
      },
    );
  }

  /*
   * FAIL CLOSED.
   *
   * Jangan menerima webhook apabila source belum dikonfigurasi
   * ke Spreadsheet + Sheet yang sebenarnya.
   */
  if (
    !source.spreadsheetId ||
    !source.sheetName
  ) {
    throw Object.assign(
      new Error(
        "Google source is not fully configured",
      ),
      {
        status: 503,
        code: "SOURCE_NOT_FULLY_CONFIGURED",
      },
    );
  }

  if (
    source.spreadsheetId !==
    envelope.spreadsheetId
  ) {
    throw Object.assign(
      new Error(
        "Spreadsheet ID does not match configured source",
      ),
      {
        status: 409,
        code: "SOURCE_ID_MISMATCH",
      },
    );
  }

  if (
    source.sheetName !==
    envelope.sheetName
  ) {
    throw Object.assign(
      new Error(
        "Sheet name does not match configured source",
      ),
      {
        status: 409,
        code: "SOURCE_SHEET_MISMATCH",
      },
    );
  }

  const payloadHash = createHash("sha256")
    .update(
      stableStringify(envelope.payload),
      "utf8",
    )
    .digest("hex");

  return db.transaction(async (tx) => {
    /*
     * Semua revision/reprocess/correction untuk source yang sama
     * memakai advisory lock yang sama.
     *
     * Memang lebih konservatif daripada row-level lock,
     * tetapi menjaga sinkronisasi dengan service correction/reprocess.
     */
    await tx.execute(
      sql`
        select pg_advisory_xact_lock(
          hashtextextended(${source.id}, 0)
        )
      `,
    );

    /*
     * Ambil revision TERBARU terlebih dahulu.
     *
     * Idempotency harus dibandingkan dengan revision terbaru,
     * BUKAN mencari payloadHash yang sama di seluruh history.
     *
     * Ini penting untuk kasus:
     *
     * revision 1 = A
     * revision 2 = B
     * revision 3 = A lagi
     *
     * A pada revision 3 harus menjadi revision BARU,
     * bukan dianggap replay revision 1.
     */
    const [previous] = await tx
      .select()
      .from(rawSubmissions)
      .where(
        and(
          eq(
            rawSubmissions.dataSourceId,
            source.id,
          ),
          eq(
            rawSubmissions.sourceRecordKey,
            envelope.rowKey,
          ),
        ),
      )
      .orderBy(
        desc(
          rawSubmissions.sourceRevision,
        ),
      )
      .limit(1);

    /*
     * Replay payload yang sama dengan CURRENT revision.
     */
    if (
      previous &&
      previous.payloadHash === payloadHash
    ) {
      if (
        previous.processingStatus ===
          "ERROR" ||
        previous.processingStatus ===
          "PROCESSING"
      ) {
        throw Object.assign(
          new Error(
            "Stored submission requires controlled reprocessing",
          ),
          {
            status: 409,
            code: "REPROCESS_REQUIRED",
          },
        );
      }

      /*
       * Catat bahwa record terlihat lagi,
       * tanpa membuat revision baru.
       */
      await tx
        .update(rawSubmissions)
        .set({
          lastSeenAt: new Date(),
        })
        .where(
          eq(
            rawSubmissions.id,
            previous.id,
          ),
        );

      return {
        idempotent: true,
        rawSubmissionId: previous.id,
        status:
          previous.processingStatus,
        revision:
          previous.sourceRevision,
      };
    }

    const revision =
      (previous?.sourceRevision ?? 0) + 1;

    const [raw] = await tx
      .insert(rawSubmissions)
      .values({
        dataSourceId: source.id,
        sourceRecordKey:
          envelope.rowKey,
        sourceRevision: revision,
        supersedesSubmissionId:
          previous?.id,
        submittedAt: new Date(
          envelope.submittedAt,
        ),
        payloadHash,
        rawPayload: envelope.payload,
        processingStatus:
          "PROCESSING",
      })
      .returning({
        id: rawSubmissions.id,
      });

    let result;

    try {
      /*
       * Normalization dijalankan dalam nested transaction/savepoint.
       *
       * Jika normalization gagal:
       * - perubahan normalized rows rollback
       * - raw evidence tetap disimpan
       */
      result = await tx.transaction(
        async (normalizationTx) => {
          if (
            sourceCode === "CASHIER"
          ) {
            return normalizeCashier(
              {
                dataSourceId:
                  source.id,
                rawSubmissionId:
                  raw.id,
                envelope,
              },
              normalizationTx,
            );
          }

          return normalizeSales(
            {
              source: sourceCode,
              dataSourceId:
                source.id,
              rawSubmissionId:
                raw.id,
              envelope,
            },
            normalizationTx,
          );
        },
      );
    } catch {
      /*
       * Raw payload tetap dipertahankan.
       */
      await tx
        .update(rawSubmissions)
        .set({
          processingStatus:
            "ERROR",
        })
        .where(
          eq(
            rawSubmissions.id,
            raw.id,
          ),
        );

      await tx
        .insert(dataIssues)
        .values({
          sourceSubmissionId:
            raw.id,
          module: "INTEGRATION",
          severity: "CRITICAL",
          issueCode:
            "NORMALIZATION_ERROR",
          message:
            "Normalization failed; inspect mappings/master data and use controlled reprocess.",
        });

      await tx
        .insert(auditLogs)
        .values({
          action:
            "INGESTION_ERROR",
          module: "INTEGRATION",
          entityType:
            "raw_submission",
          entityId: raw.id,
          afterData: {
            sourceCode,
            revision,
          },
          source:
            "GOOGLE_SCRIPT",
          correlationId,
        });

      /*
       * Revision baru gagal.
       *
       * Jangan biarkan normalized revision lama tetap tampil
       * sebagai data final/complete tanpa warning.
       */
      const earlier =
        await tx
          .select({
            id: rawSubmissions.id,
          })
          .from(rawSubmissions)
          .where(
            and(
              eq(
                rawSubmissions.dataSourceId,
                source.id,
              ),
              eq(
                rawSubmissions.sourceRecordKey,
                envelope.rowKey,
              ),
            ),
          );

      const dates =
        new Set<string>();

      for (
        const submission of earlier
      ) {
        const cashier =
          await tx
            .update(
              cashierReports,
            )
            .set({
              reportStatus:
                "NEEDS_REVIEW",
            })
            .where(
              and(
                eq(
                  cashierReports.sourceSubmissionId,
                  submission.id,
                ),
                sql`
                  ${cashierReports.reportStatus}
                  <> 'SUPERSEDED'
                `,
              ),
            )
            .returning({
              date:
                cashierReports.businessDate,
            });

        const sales =
          await tx
            .update(salesReports)
            .set({
              reportStatus:
                "NEEDS_REVIEW",
            })
            .where(
              and(
                eq(
                  salesReports.sourceSubmissionId,
                  submission.id,
                ),
                sql`
                  ${salesReports.reportStatus}
                  <> 'SUPERSEDED'
                `,
              ),
            )
            .returning({
              date:
                salesReports.businessDate,
            });

        for (const row of [
          ...cashier,
          ...sales,
        ]) {
          dates.add(row.date);
        }
      }

      for (
        const date of [
          ...dates,
        ].sort()
      ) {
        await evaluateDailyClosing(
          date,
          undefined,
          tx,
        );
      }

      return {
        idempotent: false,
        rawSubmissionId: raw.id,
        revision,
        status: "ERROR" as const,
      };
    }

    /*
     * Normalization berhasil.
     * Revision lama sekarang menjadi SUPERSEDED.
     */
    await supersedeEarlierReports(
      tx,
      source.id,
      envelope.rowKey,
      raw.id,
    );

    await tx
      .update(rawSubmissions)
      .set({
        processingStatus:
          result.status,
        businessDateDetected:
          result.businessDate,
      })
      .where(
        eq(
          rawSubmissions.id,
          raw.id,
        ),
      );

    await tx
      .insert(auditLogs)
      .values({
        action:
          "INGESTION_PROCESSED",
        module: "INTEGRATION",
        entityType:
          "raw_submission",
        entityId: raw.id,
        afterData: {
          sourceCode,
          revision,
          status:
            result.status,
          issueCount:
            result.issueCount,
          businessDate:
            result.businessDate,
        },
        source:
          "GOOGLE_SCRIPT",
        correlationId,
      });

    if (result.businessDate) {
      await evaluateDailyClosing(
        result.businessDate,
        undefined,
        tx,
      );
    }

    return {
      idempotent: false,
      rawSubmissionId: raw.id,
      revision,
      ...result,
    };
  });
}

export async function supersedeEarlierReports(
  tx: import("./normalizers").IntegrationTx,
  sourceId: string,
  rowKey: string,
  currentId: string,
) {
  const earlier = await tx
    .select()
    .from(rawSubmissions)
    .where(
      and(
        eq(
          rawSubmissions.dataSourceId,
          sourceId,
        ),
        eq(
          rawSubmissions.sourceRecordKey,
          rowKey,
        ),
      ),
    );

  const dates = new Set<string>();

  for (const previous of earlier) {
    if (previous.id === currentId) {
      continue;
    }

    await tx
      .update(rawSubmissions)
      .set({
        processingStatus:
          "SUPERSEDED",
      })
      .where(
        eq(
          rawSubmissions.id,
          previous.id,
        ),
      );

    const cashier = await tx
      .update(cashierReports)
      .set({
        reportStatus:
          "SUPERSEDED",
      })
      .where(
        eq(
          cashierReports.sourceSubmissionId,
          previous.id,
        ),
      )
      .returning({
        date:
          cashierReports.businessDate,
      });

    const sales = await tx
      .update(salesReports)
      .set({
        reportStatus:
          "SUPERSEDED",
      })
      .where(
        eq(
          salesReports.sourceSubmissionId,
          previous.id,
        ),
      )
      .returning({
        date:
          salesReports.businessDate,
      });

    for (const row of [
      ...cashier,
      ...sales,
    ]) {
      dates.add(row.date);
    }
  }

  for (
    const date of [...dates].sort()
  ) {
    await evaluateDailyClosing(
      date,
      undefined,
      tx,
    );
  }
}
