import { handleContentCreativeReuse } from "@/lib/portfolio/content-review-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const GET = handleContentCreativeReuse;
export const POST = handleContentCreativeReuse;
export const PUT = handleContentCreativeReuse;
export const PATCH = handleContentCreativeReuse;
export const DELETE = handleContentCreativeReuse;
export const OPTIONS = handleContentCreativeReuse;
export const HEAD = handleContentCreativeReuse;
