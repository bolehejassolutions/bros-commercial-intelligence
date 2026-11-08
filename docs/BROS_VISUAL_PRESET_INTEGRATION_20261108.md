# BROS Visual Presets — integration handoff (2026-11-08)

**Authority:** [Primary Drive owner-approved visual preset governance](https://docs.google.com/document/d/1JAECi1KYEBZ1VaQBIdZtOkvSXjnjHKSXCIvz1MQIvB4/edit). This GitHub change is an isolated, reversible adapter **candidate**, not a deployed content engine or finished 12-asset pilot.

## Included

- `lib/visual-presets/catalog.mjs`: six *brand-neutral* visual formats, four primary and two secondary; immutable references.
- `lib/visual-presets/bros-instance.mjs`: BROS SELL-specific direction, four template prompts, Malaysian Malay gate, historical lockup rejection, 4/4/3/1 **proposed** creative mix.
- `lib/visual-presets/validate.mjs`: pre-generation fail-closed request contract. Requires explicit matching tenant+brand, recognized preset/ratio, scoped approved logo, verified original screenshot for product mockups, separately verified claims, and portrait consent. Returns `DRAFT_NOT_GENERATED`, `mediaQa=NOT_RUN`, `editorialApproval=NOT_GRANTED`, `publishAuthorized=false`, `adAuthorized=false`.
- `tests/visual-presets.test.mjs`: Node 22 native tests for contract and negative conditions.

## Intentionally excluded

No provider image-generation call, byte decode/hash, asset storage, UI, persistence migration, credentials, cross-tenant learning, Buffer/Meta publishing, production release, permissions or spend. The `sourceScreenshot.verifiedBytes` pre-generation assertion is **trusted input** from a future authenticated asset service; this library does not verify the bytes itself. A caller must perform its own authoritative verification and audit. An approved logo asset must be supplied by a tenant-bound approved asset register, not guessed by string.

## How to connect to current CONTENT recovery

1. Check the active CONTENT PR chain (notably PR #15 and the v3.6.1→Neon DEV recovery successors) for an existing media/prompt/QA contract. Do not duplicate existing infrastructure.
2. On an owned branch, import the catalog into the existing CONTENT configuration layer and keep BROS-only prompts in a BROS SELL instance fixture; never default all tenants to BROS SELL.
3. Resolve verified brand assets and source screenshots from authenticated tenant-scoped storage. Reject mismatches and missing original media; use media-byte decoder to check real output before advancing status.
4. Treat all creative output as draft until independently reviewed. Keep UI integration optional and non-breaking; feature parity/recovery gates take precedence.
5. Expose approved immutable creative asset IDs to DEMAND only via authorized handoff metadata. DEMAND owns its own provider approval/spend gates.

## Pilot and validation

Proposed 12 draft assets: four manga, four candid Malaysian UGC, three factual explainer maps, one product showcase. No generation/publishing is claimed by this PR.

Run: `node --test tests/visual-presets.test.mjs` (Node 22). Existing PR CI executes `node --experimental-strip-types --test tests/*.test.mjs`, TypeScript and Next production build. Verify actual workflow run before claiming green. Neither unit tests nor a build can prove generated-media QA, production readiness, creative quality or audience performance.

Owner-approved brand restrictions remain effective: no recreated logos, natural Bahasa Melayu Malaysia, “BROS SELL” public name without retired “Closing OS” lockup, truthful claims, Islamic values, and “Menjelaskan, bukan Memujuk”. Existing published assets and historic evidence remain unchanged.
