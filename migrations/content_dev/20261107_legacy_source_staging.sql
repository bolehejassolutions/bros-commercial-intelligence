-- Restricted source snapshot for BROS CONTENT Supabase -> Neon recovery.
-- Not an application API; does not authorize customers or grant credits.
-- Run only in DEV until verified identity/ledger reconciliation and cutover approval.
CREATE SCHEMA IF NOT EXISTS content_import_dev;
REVOKE ALL ON SCHEMA content_import_dev FROM PUBLIC;
CREATE TABLE IF NOT EXISTS content_import_dev.legacy_rows (
 source_table text NOT NULL CHECK (source_table IN (
   'profiles','business_dna','projects','campaigns','content_items','scenes',
   'generation_jobs','credit_wallets','credit_transactions','billing_entitlements',
   'payment_orders','credit_packs','auth_user_identity'
 )),
 source_pk text NOT NULL CHECK (length(source_pk) BETWEEN 1 AND 240),
 source_user_id uuid,
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
 source_md5 text GENERATED ALWAYS AS (md5(payload::text)) STORED,
 captured_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (source_table,source_pk)
);
ALTER TABLE content_import_dev.legacy_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_import_dev.legacy_rows FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE content_import_dev.legacy_rows FROM PUBLIC;
COMMENT ON TABLE content_import_dev.legacy_rows IS
'Private staged original Supabase CONTENT records; no app role grants or policies. Auth metadata excludes credentials, wallets are not active spendable balances. Copy back only after reconciliation.';
