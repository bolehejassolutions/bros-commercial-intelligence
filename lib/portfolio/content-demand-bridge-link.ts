/**
 * BCI → DEMAND operator-only, non-executing UI handoff after a genuine
 * CONTENT approval and reservation. No tenant/user/session or secret in URL.
 * The fragment never reaches the receiving web server; DEMAND still requires
 * its own verified JWT and both product memberships before creating a link.
 */
export function prepareContentDemandBridgeUrl(input: Readonly<{
  planId: string;
  creativeSha256: string;
  channelService: string;
}>): string {
  if (!input || !/^content-plan-[a-f0-9]{64}$/.test(input.planId) ||
    !/^[a-f0-9]{64}$/.test(input.creativeSha256) ||
    !["facebook","instagram","tiktok"].includes(input.channelService))
    throw Error("CONTENT_DEMAND_UI_HANDOFF_INVALID");
  const url = new URL("https://brosdemand.bolehejas.com/");
  url.hash = new URLSearchParams({
    contentPlanId: input.planId,
    creativeSha256: input.creativeSha256,
    channel: input.channelService,
  }).toString();
  return url.toString();
}
