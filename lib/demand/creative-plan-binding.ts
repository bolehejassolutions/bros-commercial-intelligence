import { createHash } from "node:crypto";

/** Non-executable deterministic creative-to-plan review binding. Never a Meta write permit. */
type Intake = Readonly<{
  assetId: string; creativeVersion: string; brandInstanceId: string;
  mediaSha256: string; approvalEvidenceId: string;
  state: "INTAKE_VERIFIED_NOT_AD_APPROVED";
  metaUploadAllowed: false; campaignExecutionAllowed: false;
  admissionChecksApplied: true; membershipRecheckedAfterRead: true;
  approvalRecheckedAfterRead: true; approvalIndependentlyAttested: false;
}>;
type Plan = Readonly<{ campaignPlanDigest: string; tenantId: string; accountId: string }>;
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,127}$/;
const ACCOUNT = /^act_[0-9]{5,25}$/;
const denied = (): never => { throw new Error("BROS_DEMAND_CREATIVE_BINDING_DENIED"); };
export function bindDemandCreativeForReview(intake: Intake, plan: Plan) {
  if (!intake || !plan || typeof intake !== "object" || typeof plan !== "object" ||
      Object.keys(plan).sort().join(",") !== "accountId,campaignPlanDigest,tenantId" ||
      !UUID.test(plan.tenantId) || !ACCOUNT.test(plan.accountId) ||
      !HEX.test(plan.campaignPlanDigest) || !HEX.test(intake.mediaSha256) ||
      ![intake.assetId, intake.creativeVersion, intake.brandInstanceId,
        intake.approvalEvidenceId].every(v => typeof v === "string" && ID.test(v)) ||
      intake.state !== "INTAKE_VERIFIED_NOT_AD_APPROVED" ||
      intake.metaUploadAllowed !== false || intake.campaignExecutionAllowed !== false ||
      intake.admissionChecksApplied !== true ||
      intake.membershipRecheckedAfterRead !== true ||
      intake.approvalRecheckedAfterRead !== true ||
      intake.approvalIndependentlyAttested !== false) denied();
  const fields = ["BROS_DEMAND_CREATIVE_PLAN_BINDING_V1", plan.tenantId.toLowerCase(),
    plan.accountId, plan.campaignPlanDigest, intake.assetId, intake.creativeVersion,
    intake.brandInstanceId, intake.mediaSha256, intake.approvalEvidenceId];
  const digest = createHash("sha256").update(JSON.stringify(fields)).digest("hex");
  return Object.freeze({ digest, state: "REVIEW_ONLY_NOT_AUTHORIZED" as const,
    metaUploadAllowed: false as const, campaignExecutionAllowed: false as const });
}
