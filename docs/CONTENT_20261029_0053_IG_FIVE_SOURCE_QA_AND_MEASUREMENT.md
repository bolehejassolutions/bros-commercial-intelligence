# BROS CONTENT — Real Source JPEG QA + Post-SENT Measurement (29 Oct 2026, 00:53 MYT)

Status: **READ-ONLY PILOT EVIDENCE / NOT CONTENT INTERNAL V1 VERIFIED**. Existing BROS SELL Full Publisher publication, **not** CONTENT-owned publishing, new approval or customer SaaS.

## Provenance and scope
- Canonical owner decision: https://docs.google.com/document/d/1AmnN8agBGkMNCVMzQ6esJ1neWtKVuvqBa-F_j3U7rGM/edit
- Product spec: https://docs.google.com/document/d/1_9-rYsiWaTeDzi4PR9Gkrs4glKddbi8SxzXeDDSRgl8/edit
- Connected Buffer read-only get_post: Instagram post `6ae1c60191b138e3084e1616`, native link https://www.instagram.com/p/DfCfhOhIPYg/ .
- Buffer status `sent`, `sentAt=2026-10-28T13:02:05.324Z` (21:02:05 MYT), 5 image/jpeg assets, 5/5 nonempty Buffer media IDs, metadata `isAiGenerated=true`. Provider reports Google Drive source links for all five assets.
- Five *original Google Drive files* referenced by those Buffer assets were downloaded **through the connected Primary Drive provider**, then checked locally with Pillow (full JPEG verification + decoded RGB pixel data). This is original Drive source-byte evidence, **not** independent platform-served byte attestation.

## Byte/pixel audit
All 5 files: JPEG, 1080x1350, RGB, complete full decode, source-byte hashes unique (5/5), decoded RGB pixel hashes unique (5/5); total 1,623,511 bytes. Source byte SHA-256 (per slot):

| Slot | Bytes | Source SHA-256 | Decoded RGB SHA-256 (domain-separated) |
| --- | ---: | --- | --- |
| IG_01 | 344359 | `3db093a00597ef009d7e1177dec0300bfab397d86b8186ee875d87da4f1ebf4c` | `bea2c9240e47b0a3b31a94d3000d21c59d880c132b9a73a90d435e1fcad4d1fb` |
| IG_02 | 282218 | `451ed9a3b22c4b364e10d06b88b6d3b6ce94ea5fc8143724077af726b377ab33` | `f62864b33b911391076ae7667712fc588e097a28f89908a2e0bef83cbb1b0296` |
| IG_03 | 336257 | `de7991b4da1ae43c318f3f6cef2c3943761476642fa19ee4c6f8d7c48dde5cf2` | `a288cbd6135a0337c8ff11d60cbad2b6bfb41c42565ace9705b67ee42395dd9f` |
| IG_04 | 326709 | `0e316ca407bc33fd7519576dd78b915100a078d8478d7f988f29e54de05ab4a4` | `eb6b2710c402db946cad27e19e7a0c7e280e4c785143deb22fb3a4fc410a76ba` |
| IG_05 | 333968 | `1baf61a4a5267511a8523b9e764de46fce43f918c592dcffeb0ebc61690b7098` | `d8ceadf04997418947d95532d4d3376fe216ad63ec6eb3284862d0372c1e494a` |

Domain-separated RGB digest uses SHA256(`b"RGB\\0" + width.to_bytes(4,"big") + height.to_bytes(4,"big") + image.tobytes()`). The canonical JPEG QA heuristic (64-bit dHash, Hamming <=12) flags **1↔3 (7/64), 1↔4 (4/64), 3↔4 (7/64)** for *human editorial review*, not automatic failure. Contact-sheet review confirms the same staged characters/location/table and recurring composition, but text/action evolves: verify intended carousel continuity versus excessive visual reuse. Unique pixel hashes **do not** prove independently generated provider operations.

Local scope used only to compute an illustrative deterministic manifest fingerprint: tenant=`pilot-internal`, instance=`bros-sell`, plan=`ig-20261028-2100`; these are **analyst-local labels, not authenticated tenant IDs or canonical plan ID**. Fingerprint: `content-jpeg-pixel-6ce38ce1d4b430f19cb6670003da6137512d7968d1a5bc514f21fa2039921acd`. Do not ingest it as a trusted BCI audit record.

## Fresh provider measurement (same post)
Connected Buffer get_post at approximately 29 Oct 00:53 MYT: `metricsUpdatedAt=2026-10-28T15:35:15.545Z` (23:35:15 MYT), strictly **after** SENT; reported `views=4`, `reach=1`, `reactions=0`, `comments=0`, `saves=0`. These are provider-reported observed values, not qualified leads or conversions. Earlier checkpoint for this post had a pre-SENT metrics timestamp; **this new snapshot closes the timestamp/freshness gap for this historical post only**.

For comparison, historical 18:00 IG post `6ae17ecc1b33b85d1be3218f` was SENT at 10:03:40Z and has a post-SENT snapshot at 15:35:15Z with views=2/reach=1; **different post ages and formats (2 vs 5 images)**, so do not infer which creative performed better or create a learned winner.

## Acceptance and ownership
- VERIFIED in this offline read-only pilot: 5 genuine Drive JPEG source bytes fully decoded; source/pixel uniqueness; visual near-duplicate advisory; provider-reported historical IG SENT with native link; post-SENT numeric metrics snapshot.
- NOT VERIFIED: independent image-generation operation receipts; authenticated CONTENT review/approval; CONTENT API-owned publishing/new CONTENT SENT; platform-native served-media byte identity; same-channel comparable measurement window; reviewed learning; trusted tenant-safe shared BCI write/audit; external SaaS.
- This run performs **no Buffer writes, scheduling, new publishing, changes to BROS SELL Full Publisher, BCI/Neon backend/DDL, production release, permissions, pricing, spend/credits or BROS LABS**.
- Release gates for all four INTERNAL V1 products remain OPEN. Next CONTENT acceptance priority: provider-backed independent generation receipts + trusted source-byte linkage, authenticated approval and authorized CONTENT-only publisher E2E; do not promote these historical observations to a release pass.
