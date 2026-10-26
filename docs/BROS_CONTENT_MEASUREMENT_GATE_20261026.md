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

## CONTENT_REAL_MEDIA_BYTES_IG_20261026_2109 — Independent image-byte QA (26 Oct 2026, 21:09–21:15 MYT)
Status: **VERIFIED ORIGINAL DRIVE FILE BYTES + READ-ONLY BUFFER SENT; NOT NATIVE PLATFORM BYTE IDENTITY, LIVE BCI INGESTION OR INTERNAL V1**.

Scope: existing BROS SELL internal Instagram post `6adca7ad0b5343d0708289d1` (not a CONTENT SaaS customer), SENT `2026-10-26T01:02:51.262Z`, native URL `https://www.instagram.com/p/De8Djl1oNGa/`. Provider returned 2 image assets and two Drive source IDs in this order. Source images fetched via Primary Google Drive as complete raw bytes, then independently validated using Python Pillow `Image.verify()` and full pixel `Image.load()` (no OCR, no post edits).

| Slide | Drive source file ID | Raw bytes | SHA-256 | Decoded format / dimensions / mode |
|---|---|---:|---|---|
| 1 | `1ipqCnUALK-QAqO2ytfiv3jbEUidx6IsM` | 1,751,408 | `dbd7f3dbaef5eab3d031b45128153c34b57cd0ef85fb39294e6e990d7509e141` | PNG / 1080×1350 / RGB |
| 2 | `1WZY8YTFz-bOStIixu6uuTgLeCNQ-nJ4d` | 1,790,827 | `a396d0beeaa331510b7aa6f2c2c43991f4c59ec3191faac9680b6e19dac4cee6` | PNG / 1080×1350 / RGB |

QA results: both files fully decode without errors; nonempty 1080×1350 portrait images; distinct SHA-256 and distinct pixel content (pixel mean absolute difference 40.55/255, dHash Hamming distance 22/64). Human visual review: two distinct but coherent workshop scenes, same seller/customer, first slide documents the new shelf request and its unconfirmed status, second slide shows seller writing “Tambahan: satu rak” before confirming scope. Malay copy is legible and seller-directed, typographic BROS SELL™ signature and “Menjelaskan, bukan Memujuk.” are present. No new official logo was fabricated. These are **two genuine independent image files**, not a duplicated file.

**Provenance boundary:** Buffer asset metadata declares `image/jpeg` while its source URLs reference Drive PNG files. This may reflect provider conversion, but native Instagram media bytes were not retrieved; therefore SHA-256 only attests the Drive source bytes, **not** byte identity on Buffer/Instagram. Buffer post is SENT, but metrics remain `null` with `metricsUpdatedAt=2026-10-24T12:42:21.316Z` **before** SENT, so no measured outcome/learning or comparative uplift. Buffer AI flag `isAiGenerated:true` aligns with caption disclosure. No production publishing or queue changes.

Acceptance progress: independent byte-level source media QA for **this one existing internal post** now VERIFIED. Remaining: authenticated product-scoped Buffer ingestion, formal approval chain evidence, BCI shared auditable evidence reuse, fresh measurement and evidence-linked next-content learning. Do not infer a general automated QA pipeline or customer-ready SaaS from this manual check. No secrets, customer data, spending, permissions, schedules or BROS LABS changes.
