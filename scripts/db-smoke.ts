import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL is required");
}

const sql = postgres(url, {
  max: 1,
  prepare: false,
});

const requiredTables = [
  "access_requests",
  "roles",
  "permissions",
  "role_permissions",
  "users",
  "user_source_aliases",
  "data_sources",
  "source_field_mappings",
  "raw_submissions",
  "data_issues",
  "chart_of_accounts",
  "payment_methods",
  "expense_categories",
  "menu_items",
  "menu_price_history",
  "fund_accounts",
  "cashier_reports",
  "payment_lines",
  "cashier_expense_lines",
  "cash_counts",
  "sales_reports",
  "sales_report_items",
  "fund_transactions",
  "journal_entries",
  "journal_lines",
  "purchase_requests",
  "purchase_request_items",
  "purchase_request_actions",
  "purchase_receipts",
  "inventory_items",
  "stock_opname_sessions",
  "stock_opname_lines",
  "daily_closings",
  "daily_report_settings",
  "daily_report_recipients",
  "daily_report_runs",
  "daily_report_deliveries",
  "data_corrections",
  "data_correction_items",
  "audit_logs",
  "system_settings",
];

const requiredViews = [
  "vw_daily_sales_summary",
  "vw_daily_payment_summary",
  "vw_daily_cashier_expenses",
  "vw_housebank_ledger",
  "vw_cashier_cash_reconciliation_base",
  "vw_daily_completeness",
  "vw_daily_management_report",
];

async function count(query: any) {
  const rows = await query;
  return Number(rows[0]?.count ?? 0);
}

async function main() {
  try {
    const tables = await sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
    `;

    const tableSet = new Set(
      tables.map((r) => String(r.table_name))
    );

    const missingTables = requiredTables.filter(
      (x) => !tableSet.has(x)
    );

    if (missingTables.length) {
      throw new Error(
        `Missing tables: ${missingTables.join(", ")}`
      );
    }

    const views = await sql`
      select table_name
      from information_schema.views
      where table_schema = 'public'
    `;

    const viewSet = new Set(
      views.map((r) => String(r.table_name))
    );

    const missingViews = requiredViews.filter(
      (x) => !viewSet.has(x)
    );

    if (missingViews.length) {
      throw new Error(
        `Missing views: ${missingViews.join(", ")}`
      );
    }

    const unbalanced = await sql`
      select
        je.id,
        je.entry_no,
        sum(jl.debit) as debit,
        sum(jl.credit) as credit
      from journal_entries je
      join journal_lines jl
        on jl.journal_entry_id = je.id
      where je.status = 'POSTED'
      group by je.id, je.entry_no
      having sum(jl.debit) <> sum(jl.credit)
    `;

    if (unbalanced.length) {
      throw new Error(
        `Unbalanced posted journals: ${unbalanced.length}`
      );
    }

    const invalidTransfers = await count(sql`
      select count(*)
      from fund_transactions
      where transaction_type = 'INTERNAL_TRANSFER'
        and (
          source_fund_account_id is null
          or destination_fund_account_id is null
          or source_fund_account_id = destination_fund_account_id
        )
    `);

    if (invalidTransfers) {
      throw new Error(
        `Invalid internal transfers: ${invalidTransfers}`
      );
    }

    const duplicateAdjacentRaw = await count(sql`
      select count(*) from (
        select payload_hash,
          lag(payload_hash) over (
            partition by data_source_id, source_record_key
            order by source_revision
          ) as previous_payload_hash
        from raw_submissions
      ) x where payload_hash = previous_payload_hash
    `);
    if (duplicateAdjacentRaw) {
      throw new Error(`Adjacent duplicate raw revisions: ${duplicateAdjacentRaw}`);
    }

    const overlappingPrices = await count(sql`
      select count(*)
      from menu_price_history a
      join menu_price_history b
        on a.menu_item_id = b.menu_item_id
        and a.id <> b.id
        and daterange(
          a.effective_from,
          coalesce(a.effective_to, 'infinity'::date),
          '[]'
        ) &&
        daterange(
          b.effective_from,
          coalesce(b.effective_to, 'infinity'::date),
          '[]'
        )
      where a.id < b.id
    `);

    if (overlappingPrices) {
      console.warn(
        `WARN: ${overlappingPrices} overlapping menu-price pairs detected. ` +
        `This needs remediation before production.`
      );
    }

    const masterRoles = await sql`
      select code
      from roles
      where code in (
        'OWNER',
        'DIRECTOR',
        'MANAGER',
        'CASHIER',
        'KITCHEN'
      )
    `;

    if (masterRoles.length < 5) {
      throw new Error(
        "Core role seed is incomplete"
      );
    }

    const fundMasters = await sql`
      select code
      from fund_accounts
      where code in (
        'HOUSEBANK',
        'CASHIER_CASH'
      )
    `;

    if (fundMasters.length < 2) {
      throw new Error(
        "Core fund-account seed is incomplete"
      );
    }

    const passwordColumns = await sql`select column_name, data_type, is_nullable from information_schema.columns
      where table_schema='public' and table_name='users' and column_name in
      ('password_hash','must_change_password','password_updated_at','failed_login_attempts','locked_until')`;
    const expectedPasswordColumns: Record<string, [string, string]> = {
      password_hash: ['text', 'YES'], must_change_password: ['boolean', 'NO'],
      password_updated_at: ['timestamp with time zone', 'YES'], failed_login_attempts: ['integer', 'NO'],
      locked_until: ['timestamp with time zone', 'YES'],
    };
    if (passwordColumns.length !== 5 || passwordColumns.some(column => {
      const expected = expectedPasswordColumns[column.column_name];
      return !expected || expected[0] !== column.data_type || expected[1] !== column.is_nullable;
    })) throw new Error('Dual login schema is incomplete');
    const [invalidAttempts] = await sql`select count(*)::int as count from users where failed_login_attempts < 0`;
    if (invalidAttempts.count) throw new Error('Invalid login attempt counter');
    const normalizedDuplicates = await sql`select 1 from users group by lower(trim(email)) having count(*) > 1`;
    const pendingDuplicates = await sql`select 1 from access_requests where status='PENDING' group by lower(trim(email)) having count(*) > 1`;
    const accessIndexes = await sql`select indexname from pg_indexes where schemaname='public' and indexname in ('users_normalized_email_uq','access_requests_pending_email_uq') and indexdef like 'CREATE UNIQUE INDEX%'`;
    if (normalizedDuplicates.length || pendingDuplicates.length || accessIndexes.length !== 2) throw new Error('Access request uniqueness invariant failed');
    console.log("DB SMOKE PASSED");
    console.log(
      `${requiredTables.length} tables, ` +
      `${requiredViews.length} views and core financial invariants checked.`
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("DB SMOKE FAILED");
  console.error(error);
  process.exit(1);
});
