/** DEMAND-only operator test UI gate. Independent from Meta read feature switch. */
export const DEMAND_META_PREVIEW_BRANCH = "feat/demand-direct-meta-readonly-20261031";

export function isDemandMetaPreviewUiEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env.VERCEL_ENV === "preview" &&
    env.VERCEL_GIT_COMMIT_REF === DEMAND_META_PREVIEW_BRANCH;
}
