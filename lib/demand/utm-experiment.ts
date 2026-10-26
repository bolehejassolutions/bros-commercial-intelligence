/**
 * BROS DEMAND internal pilot: deterministic, unlaunched UTM link proposals.
 *
 * This is NOT a website/GA4/HitPay integration or proof that a platform post
 * exposes a clickable link. Only an independently authenticated provider
 * readback can verify UTM capture, checkout attribution or actual outcomes.
 * No publishing, tracking write, ad operation or BCI database access here.
 */
export type DemandPilotChannel = "facebook" | "instagram" | "tiktok" | "whatsapp";
export type DemandPilotVariant = "a" | "b";
export type DemandUtmProposalInput = Readonly<{
  experimentId: string;
  channel: DemandPilotChannel;
  variant: DemandPilotVariant;
  landingUrl: string;
}>;
export type DemandUtmProposal = Readonly<{
  proposalId: string;
  experimentId: string;
  channel: DemandPilotChannel;
  variant: DemandPilotVariant;
  taggedUrl: string;
  status: "PROPOSED";
  utmCaptureVerified: false;
  checkoutAttributionVerified: false;
  providerOutcomeVerified: false;
  qualifiedLeads: null;
  settledOrders: null;
  verifiedCacMinor: null;
  causalLift: null;
}>;

const EXPERIMENT = /^[a-z][a-z0-9_]{2,63}$/;
const CHANNELS: readonly string[] = ["facebook", "instagram", "tiktok", "whatsapp"];
const fail = (): never => { throw new Error("Invalid BROS DEMAND UTM proposal"); };

export function proposeDemandPilotUtm(input: DemandUtmProposalInput): DemandUtmProposal {
  if (!input || !EXPERIMENT.test(input.experimentId) ||
      !CHANNELS.includes(input.channel) || (input.variant !== "a" && input.variant !== "b") ||
      typeof input.landingUrl !== "string" || input.landingUrl.length > 500) fail();
  let url: URL;
  try { url = new URL(input.landingUrl); } catch { return fail(); }
  // No arbitrary destinations, redirect parameters, pre-existing trackers,
  // credentials, fragments or noncanonical paths in the first internal pilot.
  if (url.origin !== "https://bros.bolehejas.com" ||
      url.username || url.password || url.pathname !== "/" ||
      url.search || url.hash) fail();
  url.searchParams.set("utm_source", input.channel);
  url.searchParams.set("utm_medium", "organic_social");
  url.searchParams.set("utm_campaign", input.experimentId);
  url.searchParams.set("utm_content", input.variant);
  return Object.freeze({
    proposalId: "demand:utm:" + input.experimentId + ":" + input.channel + ":" + input.variant,
    experimentId: input.experimentId,
    channel: input.channel,
    variant: input.variant,
    taggedUrl: url.toString(),
    status: "PROPOSED" as const,
    utmCaptureVerified: false as const,
    checkoutAttributionVerified: false as const,
    providerOutcomeVerified: false as const,
    qualifiedLeads: null,
    settledOrders: null,
    verifiedCacMinor: null,
    causalLift: null,
  });
}
