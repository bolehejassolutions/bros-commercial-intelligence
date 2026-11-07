import {handleDemandProposal} from "@/lib/bci/neon-demand-proposal-runtime";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const revalidate=0;
export const POST=handleDemandProposal;
