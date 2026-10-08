import Link from "next/link";
import { requireBciOperator } from "@/lib/bci/operator-access";
import { MARKETING_OPERATOR_POLICY } from "@/lib/marketing-operator/safety";
import { OperatorConsole } from "./operator-console";
import "./operator.css";

export const metadata = {
  title: "AI Marketing Operator | BROS Internal",
  description: "Internal campaign analysis and access to gated Campaign Studio.",
};

export default async function OperatorPage() {
  await requireBciOperator();

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
      <section className="panel operator-meta-panel"><p className="label">CAMPAIGN OPERATIONS</p><h2>Automated Campaign Studio</h2><p className="muted">Plan campaigns, generate verified draft copy, upload approved creative assets, authorize finite lifetime budgets and stage Meta ads as PAUSED. Live activation is separately protected by a server-side credential and spending limit.</p><Link className="operator-studio-link" href="/operator/studio">Open Campaign Studio →</Link></section>
      <OperatorConsole />
    </main>
  );
}
