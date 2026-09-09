import { z } from "zod";

export const googleFormEnvelopeSchema = z.object({
  sourceKey: z.string().min(1).max(80),
  spreadsheetId: z.string().min(1).max(255).optional(),
  sheetName: z.string().min(1).max(255).optional(),
  rowKey: z.string().min(1).max(255),
  submittedAt: z.string().datetime({ offset: true }),
  eventCreatedAt: z.string().datetime({ offset: true }).optional(),
  payload: z.record(z.string(), z.unknown()),
});

export type GoogleFormEnvelope = z.infer<typeof googleFormEnvelopeSchema>;
export type MappingRow = {
  sourceFieldName: string;
  mappingType: string;
  targetKey: string;
};
