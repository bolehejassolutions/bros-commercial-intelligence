import { notFound } from "next/navigation";
import DemandMetaTestClient from "./test-client";
import "../neon-preview/preview.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { robots: { index: false, follow: false }, title: "BROS DEMAND | Private Preview Test" };

const DEMAND_PREVIEW_BRANCH = "feat/demand-direct-meta-readonly-20261031";

/**
 * The test UI is NOT evidence of live Meta access, and must not be
 * available in Production or in a different PR/worker Preview.
 * The API keeps its separate default-OFF switch and JWT admission gate.
 */
export default function DemandMetaTestPage() {
  if (process.env.VERCEL_ENV !== "preview" ||
      process.env.VERCEL_GIT_COMMIT_REF !== DEMAND_PREVIEW_BRANCH) {
    notFound();
  }
  return <DemandMetaTestClient />;
}
