-- Allow A -> B -> A as three revisions; source/row/revision stays unique.
-- Drop constraint-backed indexes through their owning constraint first.
-- Scope explicitly to public so unrelated schemas are never modified.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.raw_submissions'::regclass
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname::text ORDER BY k.ordinality)
        FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      ) = ARRAY['data_source_id', 'source_record_key', 'payload_hash']::text[]
  LOOP
    EXECUTE format('ALTER TABLE public.raw_submissions DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END
$$;

DROP INDEX IF EXISTS public.raw_submissions_payload_uq;

CREATE INDEX IF NOT EXISTS raw_submissions_payload_idx
  ON public.raw_submissions (data_source_id, source_record_key, payload_hash);
