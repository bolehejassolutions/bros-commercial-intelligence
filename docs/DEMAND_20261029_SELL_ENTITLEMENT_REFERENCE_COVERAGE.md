# DEMAND — HitPay #1007 to BROS SELL entitlement reference coverage (read-only)

Checkpoint ID: DEMAND_SELL_ENTITLEMENT_REFERENCE_COVERAGE_20261029_0206_V1
Date: 29 Oct 2026 MYT
Authority: Primary portfolio decision 25 Oct + addendum; owner DEV authorization 28 Oct; DEMAND Issue #9.
Status: PROVIDER CONNECTOR READBACK + DEV CLASSIFIER, NOT VERIFIED BUYER ENTITLEMENT / ACQUISITION EXPERIMENT.

## Actual bounded provider observations

- HitPay live read-only order search keywords=#1007 returned exactly one order, display 1007, completed/paid/fulfilled, MYR50.00 (historical price, NOT current BROS SELL offer). This is a paid provider order, not bank-settlement or Meta-event identity proof.
- BROS SELL Supabase project cyryoirzxpvummckegyh is ACTIVE_HEALTHY. Its public products table contains two active codes: BROS_SELL_CORE and BROS_SELL_WEB_OS.
- Privileged Supabase read-only aggregate SQL returned: products=2, entitlements=1, entitlement_events=0, active_entitlements=1, source=hitpay entitlements=0.
- Grouped entitlement aggregate: one active manual core-access row under product code BROS_SELL_WEB_OS; external_purchase_id present, but it does NOT exactly equal the HitPay order UUID or the literal 1007/#1007. BROS_SELL_CORE has zero entitlement rows in this readback.
- This is NOT proof that #1007's buyer lacks access, that manual fulfilment failed, or that the stored external reference is invalid. A different external reference, account email, offline ZIP, or manually provisioned access may be legitimate. No customer email, UUID, token or raw external reference persisted here.
- Supabase connector's privileged SQL is NOT DEMAND application's independently authenticated/tenant-authorized API readback. The query is a snapshot, not a customer access audit.

## Implementation and safety

- New DEMAND-only lib/demand/sell-entitlement-coverage.ts and tests/demand-sell-entitlement-coverage.test.mjs. Input is strictly privacy-minimized aggregate and sanitized paid-order reference, not raw customer records.
- The classifier reports NO_EXPLICIT_ORDER_REFERENCE_IN_OBSERVED_ENTITLEMENTS for this readback, NOT entitlement failure. It remains fail-closed on unknown fields, mismatched aggregate totals, duplicate groups, forged verification, incomplete product inventory and malformed counts.
- It never computes verified paid/settled BROS SELL sales, CAC, CPA, conversion or causal lift; never upgrades owner approval, app provider authentication, tenant authorization, outcome or BCI learning.
- Next safe acceptance: SELL auth owner independently compares buyer account and legitimate fulfilment reference privately, without writing/altering entitlements. BCI worker retains shared auth/DB/lineage ownership.
- No Meta/HitPay writes, Supabase writes, Neon DDL, CONTENT/publisher changes, Vercel Preview request, production, costs, permissions, customer access or BROS LABS. Current BROS SELL offer RM100 one-off and Menjelaskan, bukan Memujuk unchanged.

## Gate

DEMAND INTERNAL V1 OPEN: controlled acquisition diagnosis → authorized action → authenticated provider outcome → durable BCI learning is still missing. All four portfolio INTERNAL V1 gates remain OPEN.
