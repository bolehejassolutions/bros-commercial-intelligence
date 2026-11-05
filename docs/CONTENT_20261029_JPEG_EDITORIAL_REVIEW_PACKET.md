# CONTENT JPEG editorial review packet — 2026-10-29 (INTERNAL DEV ONLY)

Scope: BROS CONTENT product layer, existing Draft PR #15. Owner decision: 25 Oct architecture/addendum + 28 Oct DEV authorization. No BCI/Neon shared-core changes, Buffer writes, publishing, production, paid credits, pricing, or BROS LABS.

## Actual product gap closed

Prior CONTENT review request (`lib/content/approval-request.mjs`) accepts decoded PNG bytes only. Historical BROS SELL internal pilot has real JPEG carousel assets (5 JPEG files verified at source in prior 00:53 MYT checkpoint). A marker-only JPEG validator is not sufficient to promote a JPEG to a reviewable decoded-media packet.

`scripts/content_jpeg_pixel_qa.py` now supports a **local JPEG source-byte → decoded-pixel QA → editorial review-request** path. It opens and fully decodes each JPEG with Pillow, hashes file and decoded RGB pixels, rejects duplicate file/pixel content, binds media order and reviewer copy to stable tenant/instance/plan-specific IDs, and marks perceptually similar images for human review. The optional copy JSON file is read with a bounded, no-symlink, duplicate-key-rejecting reader.

## Usage (local offline; never a publisher)

```bash
python scripts/content_jpeg_pixel_qa.py \
  --tenant-id tenant-internal --instance-id bros-sell-pilot \
  --plan-id content-plan-existing --width 1080 --height 1350 \
  --review-copy-file review.json slide01.jpg slide02.jpg
```

`review.json` must contain exactly:

```json
{
  "schemaVersion": 1,
  "caption": "Pelanggan mahu semak ukuran. Penjual perlu minta izin sebelum susulan.",
  "altTexts": [
    "Pelanggan menerangkan perkara yang mahu disemak.",
    "Penjual meminta izin dan masa susulan."
  ],
  "aiDisclosure": "DECLARED_AI",
  "claimEvidenceRefs": []
}
```

The number of `altTexts` must match the source JPEG count. Output is a stable `content-jpeg-review-...` packet with `status=EDITORIAL_REVIEW_PENDING`, source-file hashes, RGB pixel hashes and review flags. Copy, order, media bytes, tenant, instance or plan changes yield a new review identity. Neither `review.json` nor the packet is an authenticated approval. The caller-supplied scope is **not** server-authenticated.

## Verified technical evidence

- Draft PR #15 exact code HEAD: `bb228fdadd4a025689278338f81fb150b51fcd7d`.
- Python JPEG QA suite now includes four new tests: decoded-byte/copy identity, forged approval rejection, unresolved editorial/disclosure flags, and bounded JSON duplicate-key/symlink rejection.
- First test HEAD `d7bdfbc...` failed because the test fixture used a literal backslash-n instead of a control character; corrected at `bb228fda...`.
- CONTENT CI at exact HEAD: https://github.com/bolehejassolutions/bros-commercial-intelligence/actions/runs/40740105806 — completed success.
- Marketing Operator dry-run CI at exact HEAD: pending independent completion at time of writing; do not infer success.
- Historical live Buffer read-only snapshot 29 Oct ~01:50 MYT: 81 SENT posts in 21–28 Oct filter, including 28 Instagram; newest 5-slide IG post `6ae1c60191b138e3084e1616` had 4 views/1 reach at 2.55h post age. Other 5-slide IG posts have materially different measurement ages (10.57h, 26.55h, 34.56h, etc.) and cannot be called a controlled same-age comparison or learning winner. These are BROS SELL Full Publisher historical posts, not CONTENT-owned publication.

## Remaining release gates — OPEN

This is **not** independent provider image-generation proof, authenticated editorial approval, authorized CONTENT-owned Buffer publishing, provider-confirmed CONTENT SENT, comparable learning, or durable tenant-safe BCI audit. JPEG pixel hashes prove original decoded local source bytes, not platform-served media identity. Human review must verify semantics, claims, policy and visual originality. The existing SELL pilot is not customer-ready multi-tenant SaaS.

Next: consume this review packet inside an authenticated tenant-scoped CONTENT reviewer and connect a verified provider image-generation operation, without granting publish authority from client-supplied metadata. Coordinate durable lineage with BCI worker only.
