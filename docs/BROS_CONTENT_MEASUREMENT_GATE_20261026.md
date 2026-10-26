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


## CONTENT_NATIVE_PERMALINK_AND_FUTURE_SNAPSHOT_GUARD_20261026 — 26 Oct 2026, 22:00 MYT
Status: **VERIFIED CONTENT-only draft code + 3 regression tests + dedicated CI; NOT live authenticated ingestion or INTERNAL V1**.

- Existing `lib/content/buffer-observation.mjs` now rejects platform homepages, profiles, login pages, off-domain lookalikes, URL userinfo, and unknown permalink shapes as SENT evidence. Pilot-verified formats: Facebook numeric /posts/ permalink, Instagram /p|reel|tv/ shortcode, TikTok /@handle/video/numeric. Tracking query/fragment is removed from the canonical native URL.
- Optional server-derived `scope.asOf` UTC boundary flags future `sentAt` and future `metricsUpdatedAt`; invalid trusted observation timestamps fail closed. This is a **pure projection**, not a provider attestation. A trusted authenticated server must derive the time and scope; caller-supplied values are not authoritative.
- Source commit: `a2981e07ed78fc72649059dd950e8d78ec535698`. Test/head commit: `d69cda8af46a44d01cabce1669f7b96215c34011`. Dedicated CONTENT CI: https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40335640654 — SUCCESS; source/test readback matched expected blobs.
- Read-only Buffer recheck of existing BROS SELL posts: FB `6ad9683fecaa6cda042066e0`, IG `6ad96845b086d40f572a8ef6`, TT `6ad968481093844846d6daae` each returned provider status SENT and supported native post URLs. IG `6adca7ad0b5343d0708289d1` remains SENT with metrics NULL and pre-SENT metricsUpdatedAt; do not infer zero or learning.
- Remaining OPEN: authenticated Buffer server ingestion, approval provenance, automated independent media-byte QA, fresh same-channel measurement→learning, private BCI audit reuse, customer SaaS. No Buffer writes/queue, Full Publisher schedule, Production, new costs, permissions, prices or BROS LABS changes.


## CONTENT_IG_FRESH_METRICS_LEARNING_6ADCA7AD_20261026 — 26 Oct 2026, 23:01 MYT
Status: **FRESH READ-ONLY BUFFER MEASUREMENT + DRAFT PR PRODUCT-LAYER PROPOSAL CODE + DEDICATED CI SUCCESS; NOT AUTHENTICATED SERVER INGESTION, CAUSAL LEARNING OR INTERNAL V1**.

- Fresh read-only Buffer get_post(includeMetrics=true) for BROS SELL internal IG post 6adca7ad0b5343d0708289d1: SENT 2026-10-26T01:02:51.262Z; native https://www.instagram.com/p/De8Djl1oNGa/; two images; provider metricsUpdatedAt 2026-10-26T14:32:54.244Z AFTER SENT. Observed views=6, reach=4, reactions=0, comments=0, shares=0, saves=0, follows=0. Unsupported impressions/clicks remain NULL, not zero. Previous pre-SENT stale snapshot superseded by fresh provider read.
- Same IG channel older post 6ad96845b086d40f572a8ef6: SENT 2026-10-22T05:00:56.507Z, snapshot 2026-10-26T14:32:54.245Z, views=7, reach=4. Cumulative post ages ~105.5h vs ~13.5h. NOT a comparable performance experiment or winner. No qualified leads, attributed sales, revenue or causal uplift inferred.
- CONTENT-only pure proposeContentNextStep now returns deterministic evidence-linked post IDs, native URLs, snapshot time, observed views/reach and a nonexecuting COLLECT_COMPARABLE_SAME_CHANNEL_MEASUREMENT action. Explicit UNATTESTED_PROVIDER_PROJECTION and providerAttestedByModule=false; no authentication/attestation claimed. Three new synthetic regression tests cover fresh post, unequal-age pair and AI-disclosure hold.
- Source commit 7d1ec6e2ed9ea6590bd1ec6f73c1a133f4af4c34; test/head commit 1d40747acc7f1f0b165d8b948974a539439d4efc. Exact-head CONTENT CI https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40345646520 SUCCESS (Node tests). Source/test readback confirmed.
- Gate partial: original source media bytes QA verified previously, Buffer SENT and fresh measurement now verified for same internal post. OPEN: formal approval provenance, repeatable automated media QA/publisher ingestion, authenticated tenant-scoped server adapter, shared BCI audit handoff, repeatable measurement-to-learning and SaaS. No Production, Buffer writes, paid credits, permissions, schedules, Full Publisher or BROS LABS changes.
END CONTENT_IG_FRESH_METRICS_LEARNING_6ADCA7AD_20261026


## CONTENT_PNG_SOURCE_BYTE_QA_V1_20261026_2355 — 26 Oct 2026, 23:55 MYT
**Status: DRAFT PR PRODUCT-LAYER SOURCE QA + LOCAL/CI TESTS; NOT LIVE MEDIA INGESTION OR INTERNAL V1.**
- Added `lib/content/png-source-qa.mjs`: an offline, dependency-free, bounded PNG source-byte validator. It checks PNG signature, per-chunk CRC32, critical chunks, IHDR dimensions/color format, contiguous IDAT, complete IEND, bounded zlib decompression, scanline filter bytes and SHA-256. A two-to-twenty-image batch rejects duplicate byte hashes. Default dimensions 1080×1350; unsupported JPEG, interlaced or non-RGB PNG fail closed rather than being silently approved.
- Added `tests/content-png-source-qa.test.mjs` (5 offline regression tests: valid distinct PNG, duplicate, CRC/truncation/trailing bytes, dimensions/format/size and scanline corruption); wired into CONTENT CI with the existing Buffer observation tests.
- Exact branch head `6e708dc3edfbf0186622b97cb2fd9dea1cf90e0a`; local Node 22 tests **5/5 PASS**. Dedicated GitHub CONTENT workflow [40354731057](https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40354731057) **SUCCESS**. Source/test/workflow GitHub readback passed.
- This validator checks PNG structural integrity, **not independent pixel reconstruction or visual distinctness**, brand/editorial QA, approval provenance, Buffer/Instagram media-byte identity, authenticated provider ingestion or shared BCI audit. Previous manual independent Pillow decode of the two original Drive PNGs remains a separate historical checkpoint; these new regression tests use synthetic PNGs. Do not treat this as automated publication clearance.
- Fresh read-only Buffer post `6adca7ad0b5343d0708289d1` remains provider **SENT**, with two image assets and a native Instagram URL. No queue/post modifications.
- OPEN: invoke source-byte QA in authenticated product-scoped media workflow; formal approval chain; server-side Buffer adapter; provider-confirmed SENT→fresh measurement→learning handoff into shared BCI. No Production, credentials, permissions, costs, prices, scheduling, BROS SELL Full Publisher or BROS LABS changes.
