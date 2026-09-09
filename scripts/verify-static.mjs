import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const required = [
  "package.json", ".env.example", "tsconfig.json",
  "src/app/layout.tsx", "src/app/manifest.ts", "public/sw.js",
  "src/auth.ts", "src/db/migrations/0000_initial_schema.sql", "src/db/migrations/0001_handoff_hardening.sql",
  "src/db/views/001_reporting_views.sql", "src/db/views/002_hardening_views.sql",
  "src/app/api/health/route.ts", "integrations/google-apps-script/Code.gs",
  "src/app/(protected)/dashboard/page.tsx", "src/app/(protected)/sales/page.tsx",
  "src/app/(protected)/cashier/page.tsx", "src/app/(protected)/finance/page.tsx",
  "src/app/(protected)/purchase/page.tsx", "src/app/(protected)/inventory/page.tsx",
  "src/app/(protected)/reports/page.tsx", "src/app/(protected)/data-issues/page.tsx",
  "src/app/(protected)/audit/page.tsx", "src/app/(protected)/settings/page.tsx",
  "docs/CODEX_HANDOFF.md", "docs/IMPLEMENTATION_STATUS_CURRENT.md", "docs/RELEASE_CHECKLIST.md",
];

const failures = [];
for (const rel of required) if (!fs.existsSync(path.join(root, rel))) failures.push(`Missing required artifact: ${rel}`);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === ".next") return [];
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const sources = walk(path.join(root, "src")).filter((f) => /\.(ts|tsx)$/.test(f));

let ts = null;
try {
  const globalRoot = spawnSync("npm", ["root", "-g"], { encoding: "utf8" }).stdout.trim();
  if (globalRoot) ts = createRequire(import.meta.url)(path.join(globalRoot, "typescript"));
} catch {}

if (ts) {
  for (const file of sources) {
    const text = fs.readFileSync(file, "utf8");
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    for (const diagnostic of sf.parseDiagnostics ?? []) {
      const pos = diagnostic.start == null ? null : sf.getLineAndCharacterOfPosition(diagnostic.start);
      failures.push(`Syntax: ${path.relative(root, file)}${pos ? `:${pos.line + 1}:${pos.character + 1}` : ""} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
    }
  }
} else {
  console.warn("WARN: global TypeScript parser not found; syntax parse skipped.");
}

const importRe = /(?:from\s+|import\s*\()(["'])(@\/[^"']+|\.\.?\/[^"']+)\1/g;
function resolves(importer, spec) {
  const base = spec.startsWith("@/") ? path.join(root, "src", spec.slice(2)) : path.resolve(path.dirname(importer), spec);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
  return candidates.some((c) => fs.existsSync(c));
}
for (const file of sources) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(importRe)) {
    const spec = match[2];
    if (!resolves(file, spec)) failures.push(`Unresolved local import: ${path.relative(root, file)} -> ${spec}`);
  }
}

const sw = fs.existsSync(path.join(root, "public/sw.js")) ? fs.readFileSync(path.join(root, "public/sw.js"), "utf8") : "";
if (/\/api\//.test(sw) && /cache\.put|cache\.add|cache\.addAll/.test(sw)) {
  // This is not automatically wrong; ensure explicit network-only guard is present.
  if (!/pathname\.startsWith\(["']\/api\//.test(sw) && !/\/api\//.test(sw.split("fetch")[1] ?? "")) failures.push("Service worker may cache API traffic; review public/sw.js");
}

if (failures.length) {
  console.error(`STATIC VERIFY FAILED (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`STATIC VERIFY PASSED`);
console.log(`${required.length} critical artifacts checked`);
console.log(`${sources.length} TypeScript/TSX files scanned${ts ? " and syntax-parsed" : ""}`);
