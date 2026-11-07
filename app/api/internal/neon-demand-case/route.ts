import { handleDemandCaseLink } from "@/lib/bci/neon-demand-case-link-runtime";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const revalidate=0;
export const POST=handleDemandCaseLink;
