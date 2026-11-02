import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isNeonPreviewEnabled } from "@/lib/bci/neon-preview-handler";
import { neonPreviewCanonicalRedirect } from "@/lib/bci/neon-preview-canonical-origin";
import NeonPreviewSignIn from "./sign-in-client";
import "./preview.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { robots: { index: false, follow: false } };

export default async function NeonPreviewPage() {
  if (!isNeonPreviewEnabled(process.env)) notFound();
  // Immutable Vercel deployment URLs are not Neon Auth trusted origins.
  // Use only the existing branch alias, never a caller-provided redirect URL.
  const target = neonPreviewCanonicalRedirect((await headers()).get("host"));
  if (target) redirect(target);
  return <NeonPreviewSignIn />;
}
