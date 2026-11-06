import { createContentDemandLinkHttpHandler } from "@/lib/portfolio/content-demand-link-http";
import { demandMetaPilotRuntime } from "@/lib/demand/meta-direct-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const handle = createContentDemandLinkHttpHandler({
  enabled: demandMetaPilotRuntime.enabled,
  authorize: jwt => demandMetaPilotRuntime.authorize(jwt),
});
export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
