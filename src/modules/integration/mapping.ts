import { unwrap } from "@/lib/integration/parsers";
import type { MappingRow } from "./types";

export type MappedValue = MappingRow & { value: unknown };

export function mappedValues(payload: Record<string, unknown>, mappings: MappingRow[], mappingType: string): MappedValue[] {
  return mappings
    .filter((m) => m.mappingType === mappingType && Object.prototype.hasOwnProperty.call(payload, m.sourceFieldName))
    .map((m) => ({ ...m, value: unwrap(payload[m.sourceFieldName]) }));
}

export function mappedOne(payload: Record<string, unknown>, mappings: MappingRow[], mappingType: string): MappedValue | null {
  return mappedValues(payload, mappings, mappingType)[0] ?? null;
}
