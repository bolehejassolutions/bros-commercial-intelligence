# BROS CONTENT — Provider Observation Gate (internal-only)
Checkpoint: `CONTENT_PROVIDER_DISCLOSURE_GATE_20261026`
Status: **Draft PR code + local/provider read-only observations; NOT a live authenticated ingestion service or INTERNAL V1**.

## Ownership and safety
This is a **CONTENT product-layer** pure projection, not a second BCI/Neon backend. Shared evidence/tenant auth/storage remain owned by the Neon/BCI worker. No Buffer write, schedule, queue, post, permission, paid API, customer entitlement or production deployment is performed. The module cannot attest provider origin: a trusted server must fetch from Buffer, authenticate the operator and derive tenant/instance/channel scope before calling it. Do not accept client-asserted scope or raw provider_verified booleans.

`lib/content/buffer-observation.mjs` projects one provider post into an explicitly scoped observation with:
- `NOT_SENT` vs `SENT_UNMEASURED` vs `MEASURED` vs `REVIEW_REQUIRED`;
- native HTTPS platform URL, sent timestamp, asset count, fresh metrics with `null` distinct from observed zero;
- held stale/invalid/duplicate metric evidence, missing native URL, asset count mismatch, channel mismatch and explicit AI-caption/native metadata conflict;
- non-executing `PROPOSED` next step; no cross-tenant/instance comparison, no cross-platform winner or causal lift claim.

## Actual provider read-only checkpoint — 26 Oct 2026
Buffer organisation: BROS SELL / My Organization. Existing approved package `FIVEVISUAL|20261022|1300|02`, three historical provider posts:
- Facebook `6ad9683fecaa6cda042066e0`: SENT, 1 asset, 16 impressions, 1 reaction, metricsUpdatedAt `2026-10-25T17:43:10.477Z`.
- Instagram `6ad96845b086d40f572a8ef6`: SENT, 2 assets, 7 views, 4 reach, metricsUpdatedAt `2026-10-25T15:34:40.061Z`; `isAiGenerated:true`.
- TikTok `6ad968481093844846d6daae`: SENT, 2 assets, 304 views, 299 reach, metricsUpdatedAt `2026-10-26T09:01:08.416Z`; caption explicitly says `ilustrasi AI` while Buffer `metadata.isAiGenerated:false`.

The TikTok discrepancy is a **review flag**, not proof of a platform policy violation: provider metadata semantics and actual native platform disclosure must be independently checked. Do not retroactively edit/repost without separate approval. Historical media QA is from the existing manifest, **not** a new byte-level decode in this checkpoint. Raw post text and user PII are not stored in this document.

## Remaining acceptance gates
1. CI for the exact PR commit and regression tests; all changes stay in Draft PR until review.
2. Real authenticated, server-side product-scoped Buffer read adapter and safe audit handoff to BCI, with tenant isolation negative tests; no client-controlled authority.
3. One repeatable QA→approval→SENT→fresh measurement→next hypothesis workflow, including actual independent media-byte QA; no unverified claim of automatic learning.
4. Compare only same-channel posts with comparable time windows and similar formats, with alternatives and uncertainty; no automatic publication or optimisation.
5. No BROS LABS, SaaS release, spending or production cutover.

Source of truth: [Primary portfolio decision](https://docs.google.com/document/d/1AmnN8agBGkMNCVMzQ6esJ1neWtKVuvqBa-F_j3U7rGM/edit) and [CONTENT product spec](https://docs.google.com/document/d/1_9-rYsiWaTeDzi4PR9Gkrs4glKddbi8SxzXeDDSRgl8/edit).
