const assert = require('node:assert/strict');
const fs = require('node:fs');
const { transformSync } = require('esbuild');
const { PgDialect } = require('drizzle-orm/pg-core');
function load(file, overrides = {}) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code)(name => overrides[name] ?? require(name), module, module.exports);
  return module.exports;
}
async function main() {
  let latest = '2026-09-09';
  const queries = [];
  const helper = load('src/lib/time/default-business-date.ts', {
    '@/db/client': { db: { execute: async query => { queries.push(new PgDialect().sqlToQuery(query)); return [{ resolved: latest }]; } } },
    './business-date': load('src/lib/time/business-date.ts'),
  });
  const now = new Date('2026-09-09T17:30:00Z'); // September 10 in Jakarta.
  const actor = { userId: '00000000-0000-0000-0000-000000000001', role: 'OWNER' };
  assert.equal(await helper.resolveDashboardDate('2026-08-01', now), '2026-08-01');
  assert.equal(queries.length, 0);
  assert.equal(await helper.resolveDashboardDate(undefined, now), latest);
  assert.ok(queries[0].params.includes('2026-09-10'));
  for (const table of ['cashier_reports', 'sales_reports', 'daily_closings']) assert.ok(queries[0].sql.includes(table));
  assert.ok(queries[0].sql.includes('filter (where business_date'));
  latest = '2026-09-10';
  assert.equal(await helper.resolveDashboardDate(undefined, now), latest);
  latest = null;
  assert.equal(await helper.resolveDashboardDate(undefined, now), '2026-09-10');
  assert.equal(await helper.resolveDashboardDate('2026-02-30', now), '2026-09-10');
  for (const source of ['sales', 'cashier']) {
    latest = '2026-09-09';
    assert.deepEqual(await helper.resolveReportDateRange(source, actor, {}, now), { from: '2026-08-11', to: latest });
    const count = queries.length;
    assert.deepEqual(await helper.resolveReportDateRange(source, actor, { from: '2026-01-01', to: '2026-01-02' }, now), { from: '2026-01-01', to: '2026-01-02' });
    assert.equal(queries.length, count);
    assert.deepEqual(await helper.resolveReportDateRange(source, actor, { to: '2024-03-01' }, now), { from: '2024-02-01', to: '2024-03-01' });
    assert.deepEqual(await helper.resolveReportDateRange(source, actor, { from: '2026-08-01' }, now), { from: '2026-08-01', to: latest });
    latest = null;
    assert.deepEqual(await helper.resolveReportDateRange(source, actor, {}, now), { from: '2026-08-12', to: '2026-09-10' });
  }
  await helper.resolveReportDateRange('sales', { ...actor, role: 'KITCHEN' }, {}, now);
  assert.deepEqual(queries.at(-1).params, [false, true, false, actor.userId]);
  await helper.resolveReportDateRange('sales', { ...actor, role: 'CASHIER' }, {}, now);
  assert.deepEqual(queries.at(-1).params, [true, false, false, actor.userId]);
  await helper.resolveReportDateRange('cashier', { ...actor, role: 'CASHIER' }, {}, now);
  assert.deepEqual(queries.at(-1).params, [false, actor.userId]);
  console.log('DATE FILTER REGRESSION PASSED: explicit/partial filters, latest/empty data, Jakarta boundary, leap year and report scope.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
