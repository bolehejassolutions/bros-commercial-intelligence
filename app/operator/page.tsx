import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MARKETING_OPERATOR_POLICY } from "@/lib/marketing-operator/safety";
import { OperatorConsole } from "./operator-console";
import "./operator.css";

export const metadata = {
  title: "AI Marketing Operator | BROS Internal",
  description: "Internal dry-run campaign analysis and proposal workspace.",
};

export default async function OperatorPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");

  return (
    <main className="shell operator">
      <Link href="/" className="back">← Commercial Intelligence</Link>
      <header className="header compact">
        <div>
          <p className="eyebrow">BROS INTERNAL · MALAYSIA</p>
          <h1>AI Marketing Operator</h1>
          <p className="sub">Traceable campaign diagnosis, simulated decisions and human-review proposals. No live Meta Ads writes.</p>
        </div>
        <span className="operator-mode" role="status">{MARKETING_OPERATOR_POLICY.mode} · RM0 AUTHORITY</span>
      </header>
      <OperatorConsole />
    </main>
  );
}
