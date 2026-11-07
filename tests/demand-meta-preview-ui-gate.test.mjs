import test from "node:test";
import assert from "node:assert/strict";
import { isDemandMetaPreviewUiEnabled, DEMAND_META_PREVIEW_BRANCH } from "../lib/demand/meta-preview-ui-gate.ts";

test("DEMAND operator test page admits only its exact Preview branch", () => {
  assert.equal(isDemandMetaPreviewUiEnabled({
    VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: DEMAND_META_PREVIEW_BRANCH,
  }), true);
  for (const env of [
    { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: DEMAND_META_PREVIEW_BRANCH },
    { VERCEL_ENV: "development", VERCEL_GIT_COMMIT_REF: DEMAND_META_PREVIEW_BRANCH },
    { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "main" },
    { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/neon-bci-dev-ledger-20261025" },
    { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/demand-meta-funnel-readonly-20261026" },
    { VERCEL_ENV: "preview" },
    {},
  ]) assert.equal(isDemandMetaPreviewUiEnabled(env), false);
});

test("DEMAND operator test UI can expose safe OFF-mode probes without enabling provider reads", () => {
  // The UI must not change the server-side feature flag. It only checks branch scope.
  assert.equal(isDemandMetaPreviewUiEnabled({
    VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: DEMAND_META_PREVIEW_BRANCH,
    BROS_DEMAND_META_DIRECT_READS: "disabled",
  }), true);
  assert.equal(isDemandMetaPreviewUiEnabled({
    VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: DEMAND_META_PREVIEW_BRANCH,
    BROS_DEMAND_META_DIRECT_READS: undefined,
  }), true);
});
