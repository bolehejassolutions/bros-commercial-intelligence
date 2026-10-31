import { notFound } from "next/navigation";
import DemandMetaTestClient from "./test-client";
import { isDemandMetaPreviewUiEnabled } from "@/lib/demand/meta-preview-ui-gate";
import "../neon-preview/preview.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { robots: { index: false, follow: false }, title: "BROS DEMAND | Private Preview Test" };

/**
 * The test UI is NOT evidence of live Meta access, and must not be
 * available in Production or in a different PR/worker Preview.
 * The API keeps its separate default-OFF switch and JWT admission gate.
 */
export default function DemandMetaTestPage() {
  if (!isDemandMetaPreviewUiEnabled(process.env)) {
    notFound();
  }
  return <DemandMetaTestClient />;
}
