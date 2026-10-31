# BROS CONTENT — Offline JPEG decoded-pixel QA (28 Oct 2026, ~15:00 MYT)

Checkpoint: CONTENT_JPEG_PIXEL_WORKER_20261028_1500_V1
Status: **Verified local/source-byte QA, Draft PR #15 code + CI; NOT INTERNAL V1 or CONTENT-authorized publishing.**

## Boundary / ownership
CONTENT product layer only. Existing Draft PR #15 in bolehejassolutions/bros-commercial-intelligence. No shared BCI/Neon backend or migrations. The Python/Pillow offline worker complements the existing Node PNG validator and weaker Node JPEG marker-only validator; it is **not integrated into the hosted Next.js workflow**. Do not promote its evidence to independent generation, authenticated approval, provider byte identity, provider SENT, learning, shared BCI audit, or customer SaaS.

New files:
- scripts/content_jpeg_pixel_qa.py — full JPEG DCT decode, dimensions, strict RGB, reject EXIF rotation and ICC profiles, bounded raw source size, ordered SHA-256 of original bytes and decoded RGB pixels, duplicate-byte/pixel rejection, deterministic tenant/instance/plan-scoped candidate manifest. No external API, network or provider writes.
- tests/content_jpeg_pixel_qa_test.py — five synthetic offline regressions: valid distinct JPEGs, replay and scope/order identity, duplicate source bytes, different JPEG encodings of identical decoded pixels, corruption/dimensions, EXIF/ICC, forged scope/inputs.
- .github/workflows/content-observation-tests.yml — both Node CONTENT and Python/Pillow offline JPEG tests.

## Real BROS SELL internal pilot (read-only)
Read-only Buffer Instagram post 6ae1475321e984edd69a6b44 reported SENT at 2026-10-28T05:01:16.131Z (13:01:16 MYT) with five source references, image/jpeg metadata. Five exact referenced originals fetched from Primary Google Drive passed offline worker in provider order. Scope internal-bros / bros-sell-pilot / legacy-full-publisher-20261028-1300 is a **manual QA namespace, NOT an authenticated CONTENT plan or approval**.

Pillow 12.3.0; SOURCE_JPEG_PIXEL_QA_ONLY; 5/5 full JPEG decode, RGB 1080×1350; five distinct file hashes and five distinct decoded-pixel hashes. Total 1,537,262 bytes. Stable local candidate manifest:
content-jpeg-pixel-bf0db37a5aff285798496e5019b3205a5faf89315d4fe2f2895b6bbaa3737278

| Slot | Bytes | Original SHA-256 | Decoded RGB pixel SHA-256 |
|---|---:|---|---|
| 1 | 312940 | 45be643c4cc45295c52b7771605e0574cb2a1a45e7f761daf44191f683b874a8 | 5a73a6a3d465611054b839f521b24a8692eca2aae54c1c523a541a48a4e5ea38 |
| 2 | 301094 | 29b8ed6649d758ca335aa87311f1da19ce10e728db5bfda3c79ed1611bedf30e | 055e26b578627c50f10930fd1e6c50b03980a59312455a17c9a799632eb6116e |
| 3 | 298922 | 73d2789cfd926f3babaa2873a3005642a9462c1465a2ac08abf0078b4cb8db9d | 117e261d9d12da7885a96ee8b2f51b0936a2d812edeb009b96aa98699de6c055 |
| 4 | 314923 | a103b36a4c26865c8031a14d9ed2c322c63841fc0e2402ce0470f5e37685fb46 | b9b6def7012ccdb350a597e5b3ea8f96fc6e44c7035cc0efa153b10fd4afb20e |
| 5 | 309383 | eda6954d7924fbaa21177717e00e17b590c9a298e762d6a84a5469fdd5c0df5c | 8c6e439b527e948a76b8523d485f93fa3476826623ea85580666a76bf15e6db2 |

**Provenance limitations:** source Drive bytes, not independently downloaded Instagram-served media. Distinct decoded pixels do not prove five independent generation jobs or editorial quality. Post is from BROS SELL Full Publisher, not CONTENT-authorized publishing. At readback, Buffer metrics remained null with metricsUpdatedAt 2026-10-28T00:52:35.769Z, earlier than sentAt; no post-SENT performance or learning. Source bytes and raw captions are not committed.

## Reproduction (trusted local files only)
python scripts/content_jpeg_pixel_qa.py --tenant-id internal-bros --instance-id bros-sell-pilot --plan-id legacy-full-publisher-20261028-1300 /path/to/ordered/slide*.jpg

python -m unittest discover -s tests -p "content_jpeg_pixel_qa_test.py" -v

Output is offline QA only. Script does not authenticate tenant/plan, provider, generation jobs, reviewer, or publisher. Reject untrusted paths before invoking CLI; its output is not a durable BCI audit receipt.

## Acceptance / non-changes
Still OPEN: genuine independent production generation provenance, editorial QA, authenticated approval, authorized CONTENT publishing with provider-confirmed SENT, fresh measurement→learning, tenant-safe shared BCI reuse. All four INTERNAL V1 gates OPEN. No Buffer writes/queue/schedules, BROS SELL Full Publisher changes, BCI/Neon DB/migrations, merge, Production promotion, permissions, pricing, paid credits/spend, or BROS LABS.
