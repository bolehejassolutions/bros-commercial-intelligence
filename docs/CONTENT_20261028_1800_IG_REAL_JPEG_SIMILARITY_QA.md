# BROS CONTENT — real JPEG byte/pixel/similarity observation — 28 Oct 2026, 18:00 MYT

Evidence classification: **READ-ONLY BROS SELL historical pilot observation**, NOT a BROS CONTENT-created or CONTENT-authorized post, and NOT independently attested image generation.

## Ownership and provider references
- Canonical owner decision (25 Oct plus later addenda): https://docs.google.com/document/d/1AmnN8agBGkMNCVMzQ6esJ1neWtKVuvqBa-F_j3U7rGM/edit
- CONTENT product spec: https://docs.google.com/document/d/1_9-rYsiWaTeDzi4PR9Gkrs4glKddbi8SxzXeDDSRgl8/edit
- Buffer organization: `5c8ff5094c54ee487265a5c6`; Instagram channel: `6ac9e9716a5c39ccb66e9544`.
- Buffer historical post: `6ae17ecc1b33b85d1be3218f`; provider reports `status=sent`, `sentAt=2026-10-28T10:03:40.687Z` (18:03:40 MYT).
- `metricsUpdatedAt=2026-10-28T04:49:16.215Z` precedes `sentAt`. No post-SENT measurement or learning may be inferred. The Buffer post is from existing BROS SELL Full Publisher, not CONTENT.
- Original source references from the provider's ordered image asset list (Google Drive IDs were fetched with the owner's Primary Drive connector, raw JPEG bytes were materialized and independently decoded):
  1. https://drive.google.com/file/d/1_qiX-MBb4NBOOcDNzF4Uni9l8Ou9zPqg/view
  2. https://drive.google.com/file/d/1V9s24ec0oIVWkt-x9EAAHquFpj8zc1ai/view
- Drive source file names: `BROS-FIVE-20261028-1800_IG_01.jpg`, `BROS-FIVE-20261028-1800_IG_02.jpg`. Buffer's asset URLs refer to those same Drive file IDs. This is reference equivalence, NOT a cryptographically authenticated provider upload receipt.

## Actual decoded JPEG source-byte QA (Pillow 12.3.0)

| Slot | JPEG bytes | Dimensions | SHA-256 of original JPEG | SHA-256 of RGB\0+dimensions+decoded pixels | dHash64 |
| --- | ---: | --- | --- | --- | --- |
| 1 | 291612 | 1080×1350 RGB | `d71b237c0c2ab953ee57d3eaeac7bdf8273a5c09c5e9bdd973921e2827acafb5` | `58f81ccdbbe9666fe92493ccff2ef6dc68d4a2575f3856786de5c07cbf0565a6` | `e4e4cea781d9f909` |
| 2 | 284537 | 1080×1350 RGB | `ff9a57b32fa3a948dac6e5840018653c75ac597522ba5927d27963c394b5bc4c` | `fa4d3644b80756923377d93cd7932e8c1b70adb14d9c58b7385150ba164e0ed6` | `69e8d6a785c9b909` |

Total original bytes: **576149**. Both JPEGs fully decoded; expected dimensions, RGB mode, no ICC profile, EXIF orientation 1. Source SHA-256 and decoded RGB pixel SHA-256 distinct for both slots. Perceptual 64-bit dHash Hamming distance **11/64**, under the advisory-only threshold <=12. Both slides use a closely related scene and framing with distinct explanatory text and gestures. **Human visual diversity review recommended**, not an automatic duplicate rejection or editorial approval.

## Reusable CONTENT product-layer improvement
- `scripts/content_jpeg_pixel_qa.py` now emits `perceptualDHash64` per image and `visualSimilarityAdvisories` / `visualSimilarityReviewRequired` for near-duplicate-looking slides.
- Similarity is heuristic, advisory only. It does not alter the existing stable `qaManifestId` input identity, does not treat near-duplicates as identical pixels, and never sets `visualEditorialQaVerified`, `independentGenerationVerified`, `approvalGranted`, `providerSentVerified`, or `learningVerified`.
- Two new offline regressions cover near-similar pixels (advisory) and intentionally different luminance layouts (no advisory). No provider write or paid generation.
- Code/test commit: `a5ce4593742d3e3f46653350d520bfa136577632`.
- CONTENT CI https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40683841326 — **COMPLETED SUCCESS** (Node CONTENT suite and Python/Pillow tests).
- Repository CI https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40683841384 — **COMPLETED SUCCESS** (fail-closed Node, TypeScript and Next.js build).
- Vercel Preview deployment `dpl_C9sQN3c6BLSedyRKN15kpqCpjPWA` at the exact code commit — **READY**, target=null, not Production. No authenticated hosted workflow proven.

## Acceptance gate (still OPEN)
Independent provider generation receipts + original source bytes + editorial QA; authenticated content-specific approval; authorized API-supported CONTENT publisher with provider-confirmed new SENT; valid post-SENT measurement and reviewed learning; shared tenant-safe durable BCI/Neon reuse. This real historical source-byte check is **not** a complete acceptance test. BROS SELL internal pilot != customer-ready multi-tenant SaaS. No Buffer post/queue/schedule or Full Publisher changes, Neon/BCI backend/migrations, paid credits/spend, permissions, Production release, merge, pricing/policy changes or BROS LABS.
