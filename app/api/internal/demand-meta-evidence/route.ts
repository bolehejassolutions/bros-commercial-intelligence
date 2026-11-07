import { handleDemandMetaEvidenceAppend } from "@/lib/demand/meta-direct-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = handleDemandMetaEvidenceAppend;
export const GET = handleDemandMetaEvidenceAppend;
export const PUT = handleDemandMetaEvidenceAppend;
export const PATCH = handleDemandMetaEvidenceAppend;
export const DELETE = handleDemandMetaEvidenceAppend;
export const OPTIONS = handleDemandMetaEvidenceAppend;
export const HEAD = handleDemandMetaEvidenceAppend;
