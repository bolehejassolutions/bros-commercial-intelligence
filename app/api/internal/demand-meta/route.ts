import { handleDemandMetaOperatorStatus, handleDemandMetaPrivatePreview } from "@/lib/demand/meta-direct-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Authenticated, READ-ONLY and default-OFF Preview policy.
// Every non-GET verb uses the same fail-closed HTTP handler.
// Use the existing DEMAND admission path for both Neon-authenticated views.
function handleDemandMetaRead(request: Request) {
  return new URL(request.url).searchParams.get("view") === "status"
    ? handleDemandMetaOperatorStatus(request)
    : handleDemandMetaPrivatePreview(request);
}

export const GET = handleDemandMetaRead;
export const POST = handleDemandMetaRead;
export const PUT = handleDemandMetaRead;
export const PATCH = handleDemandMetaRead;
export const DELETE = handleDemandMetaRead;
export const OPTIONS = handleDemandMetaRead;
export const HEAD = handleDemandMetaRead;
