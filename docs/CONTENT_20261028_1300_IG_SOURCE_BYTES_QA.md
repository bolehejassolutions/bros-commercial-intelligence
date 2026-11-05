# BROS CONTENT — Real source-byte QA checkpoint (historical internal pilot)

**Checkpoint:** CONTENT_REAL_IG_SOURCE_BYTE_QA_20261028_1400_V1  
**Date:** 2026-10-28 MYT  
**Status:** VERIFIED SOURCE-FILE QA ONLY; NOT standalone CONTENT publication, authenticated approval, native Instagram media-byte attestation, or INTERNAL V1.

## Ownership / provenance

- Source of authority: Primary Google Drive 25 October 2026 portfolio decision and CONTENT product boundary/addendum.
- Scope: CONTENT product layer, existing Draft PR #15 only. Shared BCI/Neon security, storage and migrations belong to the Neon/BCI worker.
- Historical internal BROS SELL Full Publisher pilot, **not** a new BROS CONTENT-authorized post and **not** a customer-ready multi-tenant SaaS demonstration.
- Provider: Buffer `get_post` read-only, Instagram post `6ae1475321e984edd69a6b44`, `sentAt=2026-10-28T05:01:16.131Z` (13:01:16 MYT), five JPEG assets in a fixed order. Provider post permalink: https://www.instagram.com/p/DfBodmmDgn_/ .
- Source acquisition: each of the five exact Google Drive file IDs referenced in the Buffer asset metadata was independently fetched from the user's Primary Drive, as original raw bytes. File names/IDs/URLs are deliberately **not** reproduced in this public repository. This is source-file readback, **not** a download of bytes served by Instagram.

## Actual image-byte QA

Method: Pillow `Image.verify()` followed by a fresh `Image.load()`, EXIF orientation normalization, conversion to RGB, full SHA-256 of raw file bytes, SHA-256 of decoded RGB pixel bytes, pairwise pixel comparison. All five assets have JPEG structure that Pillow fully decoded. This goes beyond the existing JS `jpeg-source-qa.mjs` marker-bounds-only check, but is **not** yet a production-integrated JS pipeline.

| Buffer carousel slot | File bytes | Dimensions | Raw SHA-256 | Decoded RGB pixel SHA-256 |
|---|---:|---|---|---|
| 1 | 312940 | 1080 × 1350 | `45be643c4cc45295c52b7771605e0574cb2a1a45e7f761daf44191f683b874a8` | `45ff6b916f3ed3e16d9717b8899f3a28792ed36c44a0b43c684edd4840840b85` |
| 2 | 301094 | 1080 × 1350 | `29b8ed6649d758ca335aa87311f1da19ce10e728db5bfda3c79ed1611bedf30e` | `388d36897c8e5dd0524c626ccf7195984df1b9339b7c3e253de3fde46921a475` |
| 3 | 298922 | 1080 × 1350 | `73d2789cfd926f3babaa2873a3005642a9462c1465a2ac08abf0078b4cb8db9d` | `9ed8019a93ee3f39a73ba58172de9cb977658f927ff1d51640be76ae19135a88` |
| 4 | 314923 | 1080 × 1350 | `a103b36a4c26865c8031a14d9ed2c322c63841fc0e2402ce0470f5e37685fb46` | `7b0dcd1e185c39c0fe98332cee35e234d071ecf45ead9d2f902a2af66487a5fd` |
| 5 | 309383 | 1080 × 1350 | `eda6954d7924fbaa21177717e00e17b590c9a298e762d6a84a5469fdd5c0df5c` | `d4a791882f45188c01c502a3068ea9921a226521b1a1b4eefbca18fe8f7e73bc` |

**QA result:** 5/5 original files downloaded; 5/5 decoded; 5/5 correct dimensions; 5 unique file SHA-256; 5 unique decoded-pixel SHA-256; 10/10 image pairs had nonzero decoded RGB differences; total 1,537,262 source bytes. Visual contact-sheet review: five sequential, legible Malay seller-training headlines and a consistent illustrative scenario; this is a bounded manual spot-check, **not** comprehensive editorial, legal, disclosure, or independent generation QA.

## Provider measurement and release gates

- Provider `status=sent` is confirmed for the **historical Full Publisher** post only. Source bytes were fetched from linked Drive originals; Instagram's native served media bytes were not downloaded/compared, so `providerByteIdentityVerified=false`.
- Buffer `metricsUpdatedAt=2026-10-28T00:52:35.769Z` predates `sentAt` by ~8 minutes 40 seconds; metrics are `null`. **No fresh measurement or learning can be inferred.**
- `independentGenerationVerified=false`: five distinct pixels do not prove five independently generated creatives. `approvalAuthenticated=false`, `contentSpecificPublishingAuthorized=false`, `newContentSentVerified=false`, `measurementVerified=false`, `learningVerified=false`, `sharedBciAuditVerified=false`, `customerSaasReady=false`.
- The CONTENT INTERNAL V1 gate remains **OPEN**: production-integrated genuine independent media + visual/editorial QA → authenticated exact-version approval → authorized API publisher → new provider-confirmed CONTENT SENT → fresh comparable measurement → evidence-based learning → tenant-safe shared BCI audit.

No Buffer writes, queue/schedule changes, Full Publisher edits, Neon/BCI DB work, production deployment, merge, permissions, pricing, spend, paid credits or BROS LABS.
