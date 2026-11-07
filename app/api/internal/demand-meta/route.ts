import { handleDemandMetaPrivatePreview } from "@/lib/demand/meta-direct-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Authenticated, READ-ONLY and default-OFF Preview policy.
// Every non-GET verb uses the same fail-closed HTTP handler.
export const GET = handleDemandMetaPrivatePreview;
export const POST = handleDemandMetaPrivatePreview;
export const PUT = handleDemandMetaPrivatePreview;
export const PATCH = handleDemandMetaPrivatePreview;
export const DELETE = handleDemandMetaPrivatePreview;
export const OPTIONS = handleDemandMetaPrivatePreview;
export const HEAD = handleDemandMetaPrivatePreview;
