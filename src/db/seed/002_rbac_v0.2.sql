BEGIN;
INSERT INTO permissions (code, name) VALUES
('PURCHASE_SPEND_RECORD','Record actual spend for an approved Purchase Request'),
('PURCHASE_RECEIPT_UPLOAD','Upload/link purchase receipt'),
('AUDIT_VIEW_LIMITED','View operational audit history within authorized scope')
ON CONFLICT (code) DO NOTHING;

-- Owner/Director always receive all known permissions.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code IN ('OWNER','DIRECTOR')
ON CONFLICT DO NOTHING;

-- Manager may complete approved purchases and receipts, but does not receive standalone funding/transfer powers.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN ('PURCHASE_SPEND_RECORD','PURCHASE_RECEIPT_UPLOAD','AUDIT_VIEW_LIMITED')
WHERE r.code='MANAGER' ON CONFLICT DO NOTHING;
COMMIT;
