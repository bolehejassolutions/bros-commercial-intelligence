import { createLineageReceiptHttpHandler } from "@/lib/bci/neon-lineage-receipt-http";
import { appendFixedDemandMetaReceiptLineage } from "@/lib/bci/neon-lineage-receipt-runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const POST = createLineageReceiptHttpHandler({
  env: () => process.env,
  execute: appendFixedDemandMetaReceiptLineage,
});
