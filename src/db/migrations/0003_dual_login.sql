-- Add password authentication to existing identities; Google-only users stay unchanged.
ALTER TABLE public.users
  ADD COLUMN password_hash text NULL,
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN password_updated_at timestamptz NULL,
  ADD COLUMN failed_login_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz NULL,
  ADD CONSTRAINT users_failed_login_attempts_ck CHECK (failed_login_attempts >= 0);
