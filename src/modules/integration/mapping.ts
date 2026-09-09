import { unwrap } from "@/lib/integration/parsers";

import type {
  MappingRow,
} from "./types";

export type MappedValue =
  MappingRow & {
    value: unknown;
  };

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

export function mappedValues(
  payload:
    Record<
      string,
      unknown
    >,

  mappings:
    MappingRow[],

  mappingType:
    string,
): MappedValue[] {
  return mappings
    .filter(
      (mapping) =>
        mapping.mappingType ===
          mappingType &&
        Object.prototype
          .hasOwnProperty.call(
            payload,
            mapping.sourceFieldName,
          ),
    )
    .map(
      (mapping) => ({
        ...mapping,

        value:
          unwrap(
            payload[
              mapping.sourceFieldName
            ],
          ),
      }),
    );
}

export function mappedOne(
  payload:
    Record<
      string,
      unknown
    >,

  mappings:
    MappingRow[],

  mappingType:
    string,
): MappedValue | null {
  const values =
    mappedValues(
      payload,
      mappings,
      mappingType,
    );

  /*
   * Google Form branching dapat menghasilkan
   * beberapa source fields untuk konsep yang sama.
   *
   * Pilih field pertama yang benar-benar berisi
   * nilai, bukan sekadar mapping pertama.
   */
  const meaningful =
    values.find(
      (value) =>
        hasMeaningfulValue(
          value.value,
        ),
    );

  return (
    meaningful ??
    values[0] ??
    null
  );
}
