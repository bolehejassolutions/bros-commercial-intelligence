import { handleNeonPreviewEvidence } from "@/lib/bci/neon-preview-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = handleNeonPreviewEvidence;
export const POST = handleNeonPreviewEvidence;
export const PUT = handleNeonPreviewEvidence;
export const PATCH = handleNeonPreviewEvidence;
export const DELETE = handleNeonPreviewEvidence;
export const OPTIONS = handleNeonPreviewEvidence;
export const HEAD = handleNeonPreviewEvidence;
