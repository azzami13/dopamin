import Decimal from "decimal.js";

export function parseBusinessDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m) return validateDate(m[1], m[2], m[3]);
  m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(text);
  if (m) return validateDate(m[3], m[2].padStart(2, "0"), m[1].padStart(2, "0"));
  return null;
}

function validateDate(year: string, month: string, day: string): string | null {
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

export function parseDecimal(value: unknown, scale = 2): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Decimal(value).toFixed(scale);
  if (typeof value !== "string") return null;
  let text = value.trim();
  if (!text) return null;
  text = text.replace(/\s/g, "").replace(/[Rr][Pp]/g, "").replace(/[^0-9,.-]/g, "");
  if (!text || text === "-") return null;

  const commas = (text.match(/,/g) ?? []).length;
  const dots = (text.match(/\./g) ?? []).length;
  if (commas && dots) {
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");
    const decimalSep = lastComma > lastDot ? "," : ".";
    const decimalDigits = text.length - Math.max(lastComma, lastDot) - 1;
    if (decimalDigits <= scale) {
      const thousandsSep = decimalSep === "," ? "." : ",";
      text = text.split(thousandsSep).join("").replace(decimalSep, ".");
    } else {
      text = text.replace(/[,.]/g, "");
    }
  } else if (commas || dots) {
    const sep = commas ? "," : ".";
    const count = commas || dots;
    if (count > 1) text = text.split(sep).join("");
    else {
      const digitsAfter = text.length - text.lastIndexOf(sep) - 1;
      text = digitsAfter === 3 ? text.replace(sep, "") : text.replace(sep, ".");
    }
  }

  try {
    const d = new Decimal(text);
    return d.isFinite() ? d.toFixed(scale) : null;
  } catch {
    return null;
  }
}

export function firstPayloadValue(payload: Record<string, unknown>, labels: string[]): { sourceField: string; value: unknown } | null {
  const lookup = new Map(Object.keys(payload).map((key) => [key.trim().toLowerCase(), key]));
  for (const label of labels) {
    const actual = lookup.get(label.trim().toLowerCase());
    if (actual) return { sourceField: actual, value: unwrap(payload[actual]) };
  }
  return null;
}

export function unwrap(value: unknown): unknown {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}
