import { createHash } from "node:crypto";
import { FIXED_META_ACCOUNT, makePausedObjects, validateApprovedPlan, type ApprovedPlan } from "../marketing-operator/meta-write.ts";

/**
 * Deterministic, server-owned PAUSED-only proposal. This is a planning contract,
 * NOT authority to POST. Never accept an arbitrary campaign ID as a write target.
 * Provider creation must be separately gated by authenticated operator approval,
 * durable per-plan intent and verified provider readback.
 */
export type DemandPausedProposal = Readonly<{
  schema: "BROS_DEMAND_PAUSED_PROPOSAL_V1";
  digest: string;
  accountId: typeof FIXED_META_ACCOUNT;
  status: "PAUSED";
  budgetMinor: number;
  campaign: Record<string, unknown>;
  adset: (campaignId: string) => Record<string, unknown>;
  creative: Record<string, unknown>;
  ad: (adsetId: string, creativeId: string) => Record<string, unknown>;
}>;

const id = (value: string): string => {
  if (!/^[0-9]{6,30}$/.test(value)) throw Error("META_VERIFIED_ID_REQUIRED");
  return value;
};

/** No Meta POST; fails closed on expired or unapproved campaign configuration. */
export function buildDemandPausedProposal(plan: ApprovedPlan, portfolioCapMYR: number, now = Date.now()): DemandPausedProposal {
  if (plan.meta_campaign_id || plan.meta_adset_id || plan.meta_creative_id || plan.meta_ad_id)
    throw Error("EXISTING_META_OBJECTS_CANNOT_BE_RECREATED");
  const checked = validateApprovedPlan(plan, portfolioCapMYR, now);
  const bodies = makePausedObjects(plan, now);
  if (bodies.campaign.status !== "PAUSED" || bodies.adset("123456").status !== "PAUSED" ||
      bodies.ad("123456", "234567").status !== "PAUSED")
    throw Error("META_PAUSED_ONLY_REQUIRED");
  const digest = createHash("sha256").update(JSON.stringify({
    plan, budgetMinor: checked.budgetMinorUnits, campaign: bodies.campaign,
    adset: bodies.adset("123456"), creative: bodies.creative,
    ad: bodies.ad("123456", "234567"),
  })).digest("hex");
  return Object.freeze({
    schema: "BROS_DEMAND_PAUSED_PROPOSAL_V1" as const,
    digest, accountId: FIXED_META_ACCOUNT, status: "PAUSED" as const,
    budgetMinor: checked.budgetMinorUnits,
    campaign: bodies.campaign,
    adset: (campaignId: string) => bodies.adset(id(campaignId)),
    creative: bodies.creative,
    ad: (adsetId: string, creativeId: string) => bodies.ad(id(adsetId), id(creativeId)),
  });
}
