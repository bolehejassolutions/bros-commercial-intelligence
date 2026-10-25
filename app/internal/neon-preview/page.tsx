import { notFound } from "next/navigation";
import { isNeonPreviewEnabled } from "@/lib/bci/neon-preview-handler";
import NeonPreviewSignIn from "./sign-in-client";
import "./preview.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { robots: { index: false, follow: false } };

export default function NeonPreviewPage() {
  if (!isNeonPreviewEnabled(process.env)) notFound();
  return <NeonPreviewSignIn />;
}
