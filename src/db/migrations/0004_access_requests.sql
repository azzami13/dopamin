-- Fail before any schema change; do not merge identities or rewrite evidence.
LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.users GROUP BY lower(trim(email)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Migration 0004 blocked: duplicate normalized users emails exist. Resolve duplicates before retrying.';
  END IF;
END $$;
CREATE UNIQUE INDEX users_normalized_email_uq ON public.users (lower(trim(email)));

CREATE TABLE public.access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(320) NOT NULL,
  full_name varchar(160) NOT NULL,
  provider varchar(24) NOT NULL DEFAULT 'GOOGLE',
  status varchar(16) NOT NULL DEFAULT 'PENDING',
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz NULL,
  reviewed_by_user_id uuid NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_role_id uuid NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  CONSTRAINT access_requests_status_ck CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  CONSTRAINT access_requests_provider_ck CHECK (provider = 'GOOGLE'),
  CONSTRAINT access_requests_email_ck CHECK (email = lower(trim(email)) AND length(email) > 0),
  CONSTRAINT access_requests_review_ck CHECK (
    (status = 'PENDING' AND reviewed_at IS NULL AND reviewed_by_user_id IS NULL AND approved_role_id IS NULL) OR
    (status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL AND approved_role_id IS NOT NULL) OR
    (status = 'REJECTED' AND reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL AND approved_role_id IS NULL)
  )
);
CREATE UNIQUE INDEX access_requests_pending_email_uq ON public.access_requests (lower(trim(email))) WHERE status = 'PENDING';
