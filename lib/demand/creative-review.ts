import { createDemandCreativeAdmission } from "./creative-admission.ts";
import { bindDemandCreativeForReview } from "./creative-plan-binding.ts";
import { preparePausedCampaignPlan } from "./meta-paused-campaign-plan.ts";
import type { PilotScope } from "./meta-pilot-ledger.ts";

type Admission = Parameters<typeof createDemandCreativeAdmission>[0];
type Reader = Pick<Admission, "approvedRecordFor" | "mediaFor" | "verifyApproval">;
type Dependencies = Readonly<{
  authorizeBoth: (jwt: string) => Promise<PilotScope>;
  readerFor: (scope: PilotScope, jwt: string) => Reader;
  maximumBudgetMinor: () => number;
  now: () => number;
}>;

export function createDemandCreativeReview(deps: Dependencies) {
  return async (scope: PilotScope, jwt: string, draft: unknown,
    asset: Readonly<{ assetId: string; creativeVersion: string }>) => {
    // Reuse the exact plan digest used by the campaign creator, without invoking it.
    const plan = preparePausedCampaignPlan(scope, draft, deps.maximumBudgetMinor(), deps.now());
    const checkScope = async () => {
      const current = await deps.authorizeBoth(jwt);
      if (current.tenantId !== scope.tenantId || current.principalId !== scope.principalId) throw Error();
      return current;
    };
    await checkScope();
    const admit = createDemandCreativeAdmission({
      ...deps.readerFor(scope, jwt),
      authenticate: async () => ({ userId: scope.principalId, authenticated: true }),
      membershipsFor: async () => {
        const current = await checkScope();
        return [{ ...current, active: true, product: "demand" }];
      },
    });
    const intake = await admit(asset);
    const binding = bindDemandCreativeForReview(intake, {
      tenantId: scope.tenantId, accountId: plan.accountId, campaignPlanDigest: plan.planSha256,
    });
    return {
      source: "BROS_DEMAND_CONTENT_CREATIVE_REVIEW" as const, state: binding.state,
      assetId: intake.assetId, creativeVersion: intake.creativeVersion, mediaSha256: intake.mediaSha256,
      approvalEvidenceId: intake.approvalEvidenceId, logoAssetVersionId: intake.logoAssetVersionId,
      planSha256: plan.planSha256, reviewDigest: binding.digest,
      metaUploadAllowed: false as const, campaignExecutionAllowed: false as const,
    };
  };
}
