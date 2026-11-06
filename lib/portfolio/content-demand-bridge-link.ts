/**
 * BCI → DEMAND operator-only, non-executing UI handoff after a genuine
 * CONTENT approval and reservation. No tenant/user/session or secret in URL.
 * The bound proof-envelope hash, rather than the isolated caption hash, identifies\n * the reviewed composite creative (media, script, copy, destination).\n * The fragment never reaches the receiving web server; DEMAND still requires
 * its own verified JWT and both product memberships before creating a link.
 */
export function prepareContentDemandBridgeUrl(input: Readonly<{
  planId: string;
  /** Server-rebuilt hash over media, copy, script, destination and plan. */
  proofEnvelopeId: string;
  channelService: string;
}>): string {
  if (!input || !/^content-plan-[a-f0-9]{64}$/.test(input.planId) ||
    typeof input.proofEnvelopeId !== "string" ||
    !/^content-instance-script-proof-[a-f0-9]{64}$/.test(input.proofEnvelopeId) ||
    !["facebook","instagram","tiktok"].includes(input.channelService))
    throw Error("CONTENT_DEMAND_UI_HANDOFF_INVALID");
  const url = new URL("https://brosdemand.bolehejas.com/");
  url.hash = new URLSearchParams({
    contentPlanId: input.planId,
    creativeSha256: input.proofEnvelopeId.slice("content-instance-script-proof-".length),
    channel: input.channelService,
  }).toString();
  return url.toString();
}
