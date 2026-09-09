import { z } from "zod";

export const googleSourceKeySchema =
  z.enum([
    "CASHIER",
    "KITCHEN",
    "BEVERAGE",
  ]);

export type GoogleSourceKey =
  z.infer<
    typeof googleSourceKeySchema
  >;

export const googleFormEnvelopeSchema =
  z
    .object({
      sourceKey:
        googleSourceKeySchema,

      spreadsheetId: z
        .string()
        .trim()
        .min(1)
        .max(255),

      /*
       * Jangan trim sheetName.
       *
       * Backend melakukan exact match
       * dengan nama Sheet yang tersimpan.
       */
      sheetName: z
        .string()
        .min(1)
        .max(255),

      rowKey: z
        .string()
        .trim()
        .min(1)
        .max(255),

      submittedAt: z
        .string()
        .datetime({
          offset: true,
        }),

      eventCreatedAt: z
        .string()
        .datetime({
          offset: true,
        })
        .optional(),

      payload: z.record(
        z.string(),
        z.unknown(),
      ),
    })
    .strict();

export type GoogleFormEnvelope =
  z.infer<
    typeof googleFormEnvelopeSchema
  >;

export type MappingRow = {
  sourceFieldName: string;
  mappingType: string;
  targetKey: string;
};
