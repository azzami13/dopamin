BEGIN;
INSERT INTO permissions (code, name) VALUES
('FINANCE_VOID','Void a posted financial transaction with journal reversal'),
('REPORT_RESEND','Generate/resend a revised immutable daily report')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('OWNER','DIRECTOR') AND p.code IN ('FINANCE_VOID','REPORT_RESEND')
ON CONFLICT DO NOTHING;

COMMIT;
