import { createHash } from "node:crypto";
import { hasDemandCreativeAdmission, type createDemandCreativeAdmission } from "./creative-admission.ts";

/** Non-executable deterministic creative-to-plan review binding. Never a Meta write permit. */
type Intake = Awaited<ReturnType<ReturnType<typeof createDemandCreativeAdmission>>>;
type Plan = Readonly<{ campaignPlanDigest: string; tenantId: string; accountId: string }>;
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ACCOUNT = /^act_[0-9]{5,25}$/;

/** The plan comes from the server-authorized operator scope. Re-admit serialized intake before binding. */
export function bindDemandCreativeForReview(intake: Intake, plan: Plan) {
  if (!intake || !plan || typeof plan !== "object" || Object.getPrototypeOf(plan) !== Object.prototype ||
      Reflect.ownKeys(plan).length !== 3 ||
      Object.keys(plan).sort().join(",") !== "accountId,campaignPlanDigest,tenantId" ||
      Object.values(Object.getOwnPropertyDescriptors(plan)).some(d => !Object.hasOwn(d, "value")) ||
      typeof plan.tenantId !== "string" || !UUID.test(plan.tenantId) ||
      typeof plan.accountId !== "string" || !ACCOUNT.test(plan.accountId) ||
      typeof plan.campaignPlanDigest !== "string" || !HEX.test(plan.campaignPlanDigest) ||
      !hasDemandCreativeAdmission(intake, plan.tenantId)) throw Error("BROS_DEMAND_CREATIVE_BINDING_DENIED");

  const fields = ["BROS_DEMAND_CREATIVE_PLAN_BINDING_V2", plan.tenantId,
    plan.accountId, plan.campaignPlanDigest, intake.assetId, intake.creativeVersion,
    intake.brandInstanceId, intake.mediaSha256, intake.approvalEvidenceId, intake.logoAssetVersionId];
  const digest = createHash("sha256").update(JSON.stringify(fields)).digest("hex");
  return Object.freeze({ digest, state: "REVIEW_ONLY_NOT_AUTHORIZED" as const,
    metaUploadAllowed: false as const, campaignExecutionAllowed: false as const });
}
