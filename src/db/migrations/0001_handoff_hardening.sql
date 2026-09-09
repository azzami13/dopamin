BEGIN;

CREATE TABLE IF NOT EXISTS user_source_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_code varchar(24) NOT NULL,
  alias varchar(160) NOT NULL,
  normalized_alias varchar(160) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_source_aliases_source_ck CHECK (source_code IN ('CASHIER','KITCHEN','BEVERAGE')),
  CONSTRAINT user_source_aliases_normalized_ck CHECK (normalized_alias = lower(btrim(normalized_alias)))
);
CREATE UNIQUE INDEX IF NOT EXISTS user_source_aliases_source_normalized_uq
  ON user_source_aliases(source_code, normalized_alias);
CREATE INDEX IF NOT EXISTS user_source_aliases_user_idx
  ON user_source_aliases(user_id, source_code, is_active);

COMMIT;
