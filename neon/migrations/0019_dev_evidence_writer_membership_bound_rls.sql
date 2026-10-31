-- BCI DEV-only: require an active authoritative DEMAND membership for the
-- restricted evidence writer's SELECT and INSERT policies. No grants, roles,
-- credentials, data writes, or Production changes. Apply only on the existing
-- bros_intelligence_dev Neon DEV branch after reviewing the provider baseline.
--
-- This is defense in depth, NOT authentication: PostgreSQL session GUCs are
-- caller-settable. The server must independently verify signed JWT, membership,
-- direct restricted LOGIN and provider provenance before calling SQL.
--
-- Rollback: restore the two original policy expressions from the immutable
-- BCI Neon DEV provider checkpoint before this migration.

ALTER POLICY bci_evidence_writer_demand_select_v1 ON bci_dev.evidence
  USING (
    tenant_id = NULLIF(current_setting('bci.tenant_id', true), '')::uuid
    AND product = 'demand'
    AND product = NULLIF(current_setting('bci.product', true), '')
    AND provider = 'meta_ads'
    AND EXISTS (
      SELECT 1 FROM bci_dev.tenant_memberships AS membership
      WHERE membership.tenant_id = evidence.tenant_id
        AND membership.principal_id = NULLIF(current_setting('bci.principal_id', true), '')::uuid
        AND membership.product = 'demand'
        AND membership.active IS TRUE
        AND membership.revoked_at IS NULL
    )
  );

ALTER POLICY bci_evidence_writer_demand_insert_v1 ON bci_dev.evidence
  WITH CHECK (
    tenant_id = NULLIF(current_setting('bci.tenant_id', true), '')::uuid
    AND product = 'demand'
    AND product = NULLIF(current_setting('bci.product', true), '')
    AND provider = 'meta_ads'
    AND completeness = 'unverified'
    AND source_reference = 'demand:unattested:direct-meta-read-only'
    AND EXISTS (
      SELECT 1 FROM bci_dev.tenant_memberships AS membership
      WHERE membership.tenant_id = evidence.tenant_id
        AND membership.principal_id = NULLIF(current_setting('bci.principal_id', true), '')::uuid
        AND membership.product = 'demand'
        AND membership.active IS TRUE
        AND membership.revoked_at IS NULL
    )
  );
