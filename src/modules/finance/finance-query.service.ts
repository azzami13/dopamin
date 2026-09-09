import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { ActorContext } from "@/lib/auth/authorization";
import { assertPermission } from "@/lib/auth/authorization";
import { Permission } from "@/lib/auth/permissions";
import { appError } from "@/lib/http/api";

function rows<T = Record<string, unknown>>(value: unknown): T[] { return value as T[]; }

export async function getFinanceOverview(actor: ActorContext, from: string, to: string) {
  assertPermission(actor, Permission.FINANCE_VIEW);
  const balances = await db.execute(sql`
    select fa.id, fa.code, fa.name,
      coalesce(sum(case
        when ft.status='POSTED' and ft.destination_fund_account_id=fa.id then ft.amount
        when ft.status='POSTED' and ft.source_fund_account_id=fa.id then -ft.amount
        else 0 end),0) as balance
    from fund_accounts fa
    left join fund_transactions ft on ft.source_fund_account_id=fa.id or ft.destination_fund_account_id=fa.id
    where fa.is_active=true
    group by fa.id order by fa.code
  `);
  const txs = await db.execute(sql`
    select ft.id, ft.transaction_no, ft.business_date, ft.transaction_type, ft.amount, ft.status,
      ft.description, ft.counterparty_name, ft.reference_no, ft.created_at,
      s.code as source_account, d.code as destination_account,
      ec.name as expense_category, u.full_name as created_by_name
    from fund_transactions ft
    left join fund_accounts s on s.id=ft.source_fund_account_id
    left join fund_accounts d on d.id=ft.destination_fund_account_id
    left join expense_categories ec on ec.id=ft.expense_category_id
    join users u on u.id=ft.created_by
    where ft.business_date between ${from}::date and ${to}::date
    order by ft.business_date desc, ft.created_at desc limit 300
  `);
  return { balances: rows(balances), transactions: rows(txs) };
}

export async function getFinanceTransactionDetail(actor: ActorContext, id: string) {
  assertPermission(actor, Permission.FINANCE_VIEW);
  const txRows = await db.execute(sql`
    select ft.*, s.code as source_account, s.name as source_account_name,
      d.code as destination_account, d.name as destination_account_name,
      ec.code as expense_category_code, ec.name as expense_category_name,
      u.full_name as created_by_name, u.email as created_by_email
    from fund_transactions ft
    left join fund_accounts s on s.id=ft.source_fund_account_id
    left join fund_accounts d on d.id=ft.destination_fund_account_id
    left join expense_categories ec on ec.id=ft.expense_category_id
    join users u on u.id=ft.created_by
    where ft.id=${id}::uuid limit 1
  `);
  const transaction = rows(txRows)[0];
  if (!transaction) throw appError("Fund transaction not found", 404, "FUND_TRANSACTION_NOT_FOUND");
  const journals = await db.execute(sql`
    select je.id, je.entry_no, je.business_date, je.source_type, je.description, je.status,
      jl.id as line_id, coa.code as account_code, coa.name as account_name, jl.debit, jl.credit, jl.memo
    from journal_entries je join journal_lines jl on jl.journal_entry_id=je.id
    join chart_of_accounts coa on coa.id=jl.account_id
    where je.source_id=${id}::uuid
    order by je.entry_no, jl.id
  `);
  return { transaction, journalLines: rows(journals) };
}
