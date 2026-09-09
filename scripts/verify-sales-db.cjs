require('dotenv/config');
const assert = require('node:assert/strict');
const postgres = require('postgres');
const { PgDialect } = require('drizzle-orm/pg-core');
const { salesService } = require('./verify-integration.cjs');
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

async function main() {
  try {
    const [owner] = await sql`select u.id from users u join roles r on r.id=u.role_id where r.code='OWNER' and r.is_active and u.is_active limit 1`;
    assert.ok(owner, 'Active Owner required');
    const permissions = await sql`select p.code from permissions p join role_permissions rp on rp.permission_id=p.id join roles r on r.id=rp.role_id where r.code='OWNER'`;
    const service = salesService((query) => { const q = new PgDialect().sqlToQuery(query); return sql.unsafe(q.sql, q.params); });
    const result = await service.getSalesOverview({ role: 'OWNER', userId: owner.id, permissions: permissions.map((p) => p.code) }, '2099-01-02', '2099-01-01');
    assert.equal(result.summary.length + result.topItems.length + result.reports.length, 0);
    console.log('PASS: all three actual sales overview queries execute against PostgreSQL and return empty results for an empty date interval; active Owner permission loaded from DB.');
    const sources = await sql`select ds.code, ds.spreadsheet_id is not null as spreadsheet_configured, ds.sheet_name is not null as sheet_configured, ds.is_active, (select count(*)::int from source_field_mappings m where m.data_source_id=ds.id and m.is_active) as active_mappings, (select count(*)::int from user_source_aliases a where a.source_code=ds.code and a.is_active) as active_aliases from data_sources ds where ds.code in ('CASHIER','KITCHEN','BEVERAGE') order by ds.code`;
    console.log(JSON.stringify(sources));
  } finally { await sql.end(); }
}
main().catch((error) => { console.error('SALES DB CHECK FAILED:', error.code || error.name); process.exitCode = 1; });
