# Dopamin Cafe UI polish

Shared green/cream styling now covers the existing workspace, authentication screens, forms and detail pages. Navigation preserves the server-filtered permission list, shows active routes, collapses on mobile, and supports Escape and a skip link. Tables use keyboard-focusable horizontal scrolling and a shared empty state. Dashboard KPI hierarchy and trend labels use existing values only. Loading and retry states are provided for protected routes.

The existing Business Date resolver is preserved: Dashboard prefers Jakarta today when data exists, otherwise the latest operational date. Sales/Cashier use the latest accessible report date and the preceding 29 days, preserving explicit filters.

## Validation

- PASS: npm run typecheck
- PASS: npm run build
- PASS: npm run db:smoke (41 tables, 7 views, financial invariants)
- PASS: npm run verify:static (its optional global TypeScript parser was unavailable; typecheck and build completed separately)
- PASS: node scripts/verify-date-filters.cjs
- PASS: React server-render checks for empty/populated tables, keyboard scroll region, and status labels
- PASS: git diff --check

Browser screenshots and interactive viewport testing were not available in this session. No business services, schema, authorization rules, accounting calculations or integrations changed. No packages were installed.

## Changed files

- `src/app/(auth)/login/page.tsx`
- `src/app/(auth)/verify-access/verification-countdown.tsx`
- `src/app/(protected)/audit/page.tsx`
- `src/app/(protected)/cashier/[id]/page.tsx`
- `src/app/(protected)/cashier/page.tsx`
- `src/app/(protected)/dashboard/page.tsx`
- `src/app/(protected)/data-issues/page.tsx`
- `src/app/(protected)/finance/[id]/page.tsx`
- `src/app/(protected)/finance/page.tsx`
- `src/app/(protected)/inventory/page.tsx`
- `src/app/(protected)/layout.tsx`
- `src/app/(protected)/purchase/page.tsx`
- `src/app/(protected)/reports/page.tsx`
- `src/app/(protected)/sales/[id]/page.tsx`
- `src/app/(protected)/sales/page.tsx`
- `src/app/globals.css`
- `src/components/correction/correction-form.tsx`
- `src/components/inventory/stock-lines-editor.tsx`
- `src/components/purchase/purchase-actions.tsx`
- `src/components/purchase/purchase-create-form.tsx`
- `src/components/settings/daily-report-settings-form.tsx`
- `src/components/settings/source-alias-manager.tsx`
- `src/app/(protected)/error.tsx`
- `src/app/(protected)/loading.tsx`
- `src/components/ui/navigation.tsx`
- `src/components/ui/responsive-table.tsx`
- `src/components/ui/status-badge.tsx`
- `docs/UI_POLISH.md` (this report)
