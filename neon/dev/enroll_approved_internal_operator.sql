-- Approved DEVELOPMENT target only: empty-tooth-43040036 / br-broad-math-b3f4d2r4.
-- Database bros_intelligence_dev. Run explicitly as the development administrator
-- for the explicitly approved operator; never as application startup.
-- Membership is authorization only. Every HTTP read still requires a valid
-- provider-signed JWT with emailVerified=true. Never change provider verification
-- flags or infer that this membership proves identity or authenticated success.
-- No customer membership; no database role, provider admin or production grant.
-- The new internal tenant intentionally has no copied synthetic/customer evidence.
DO $enroll$
BEGIN
  IF current_database() <> 'bros_intelligence_dev' THEN
    RAISE EXCEPTION 'Wrong development database';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM neon_auth."user"
    WHERE id = '8ae086ff-3f10-4863-b5e7-4b67e062024d'
      AND email = 'rasymokh@gmail.com'
      AND role = 'admin' AND banned IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Exact approved existing operator identity is required';
  END IF;
  INSERT INTO bci_dev.tenant_memberships (principal_id, tenant_id, product)
  SELECT '8ae086ff-3f10-4863-b5e7-4b67e062024d'::uuid,
         'c0d63101-218d-4b67-9efc-e27b45330963'::uuid, product
  FROM (VALUES ('content'), ('demand')) AS products(product)
  -- Do not resurrect a revoked grant or broaden any pre-existing scope.
  WHERE NOT EXISTS (
    SELECT 1 FROM bci_dev.tenant_memberships
    WHERE principal_id = '8ae086ff-3f10-4863-b5e7-4b67e062024d'::uuid
      AND tenant_id <> 'c0d63101-218d-4b67-9efc-e27b45330963'::uuid
  )
  ON CONFLICT DO NOTHING;
END $enroll$;
