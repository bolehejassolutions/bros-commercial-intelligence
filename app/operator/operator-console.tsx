"use client";

import { useState, type FormEvent } from "react";
import { simulateCampaign } from "@/lib/marketing-operator/engine";
import { MARKETING_OPERATOR_POLICY } from "@/lib/marketing-operator/safety";
import type { CampaignSnapshot, DryRunReport } from "@/lib/marketing-operator/contracts";

const percent = (value: number | null) => value === null ? "Not available" : (value * 100).toFixed(2) + "%";
const money = (value: number | null) => value === null ? "Not available" : "RM" + value.toFixed(2);
const multiple = (value: number | null) => value === null ? "Not available" : value.toFixed(2) + "x";

export function OperatorConsole() {
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [error, setError] = useState("");
  const [copyResult, setCopyResult] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (key: string) => String(form.get(key) ?? "").trim();
    const requiredNumber = (key: string) => {
      const raw = read(key);
      if (raw === "") throw new Error(key + " is required. Use 0 for a measured zero.");
      return Number(raw);
    };
    const optionalNumber = (key: string) => {
      const raw = read(key);
      return raw === "" ? null : Number(raw);
    };

    try {
      const snapshot: CampaignSnapshot = {
        market: "MY",
        currency: "MYR",
        campaignName: read("campaignName"),
        source: read("source") as CampaignSnapshot["source"],
        sourceReference: read("sourceReference"),
        capturedAt: new Date().toISOString(),
        periodStart: read("periodStart"),
        periodEnd: read("periodEnd"),
        spendMYR: requiredNumber("spendMYR"),
        impressions: requiredNumber("impressions"),
        linkClicks: requiredNumber("linkClicks"),
        landingPageViews: optionalNumber("landingPageViews"),
        purchases: optionalNumber("purchases"),
        attributedRevenueMYR: optionalNumber("attributedRevenueMYR"),
      };
      const next = simulateCampaign(snapshot);
      setReport(next);
      setError("");
      setCopyResult("");
    } catch (cause) {
      setReport(null);
      setError(cause instanceof Error ? cause.message : "Analysis failed.");
    }
  }

  async function copyReport() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopyResult("Report copied. Data was not sent to a server by this console.");
    } catch {
      setCopyResult("Clipboard unavailable; select the JSON report below to copy manually.");
    }
  }

  return (
    <div className="operator-layout">
      <section className="panel">
        <p className="label">01 · READ-ONLY EVIDENCE</p>
        <h2>Import campaign numbers</h2>
        <p className="muted">Manually transcribe a Meta Ads report or its read-only export. Blank conversion fields mean <strong>unknown</strong>, not zero. All analysis stays in this browser tab.</p>
        <form className="form operator-form" onSubmit={submit}>
          <label>Campaign name<input name="campaignName" defaultValue="BROS SELL™ | Malaysia" maxLength={140} required /></label>
          <label>Evidence source<select name="source" defaultValue="manual-transcription">
            <option value="manual-transcription">Manual transcription</option>
            <option value="meta-readonly-export">Meta read-only export</option>
          </select></label>
          <label>Source reference (required for audit)
            <input name="sourceReference" maxLength={500} placeholder="Export filename, screenshot ID or report URL" required />
          </label>
          <div className="row">
            <label>Period start<input name="periodStart" type="date" required /></label>
            <label>Period end<input name="periodEnd" type="date" required /></label>
          </div>
          <div className="row">
            <label>Spend (MYR)<input name="spendMYR" type="number" min="0" step="0.01" placeholder="Required" required /></label>
            <label>Impressions<input name="impressions" type="number" min="0" step="1" placeholder="Required" required /></label>
          </div>
          <div className="row">
            <label>Link clicks<input name="linkClicks" type="number" min="0" step="1" placeholder="Required" required /></label>
            <label>Landing-page views<input name="landingPageViews" type="number" min="0" step="1" placeholder="Leave blank if unavailable" /></label>
          </div>
          <div className="row">
            <label>Attributed purchases<input name="purchases" type="number" min="0" step="1" placeholder="Unknown unless verified" /></label>
            <label>Attributed revenue (MYR)<input name="attributedRevenueMYR" type="number" min="0" step="0.01" placeholder="Unknown unless verified" /></label>
          </div>
          {error && <p className="operator-error" role="alert">{error}</p>}
          <button type="submit">Simulate analysis — no API writes</button>
        </form>
      </section>

      <section className="operator-right">
        <section className="panel">
          <p className="label">02 · EXECUTION SAFETY</p>
          <h2>Dry-run enforcement</h2>
          <dl className="operator-policy">
            <div><dt>Run mode</dt><dd>{MARKETING_OPERATOR_POLICY.mode}</dd></div>
            <div><dt>Live spending limit</dt><dd>RM{MARKETING_OPERATOR_POLICY.maxAuthorizedSpendMYR}</dd></div>
            <div><dt>Meta write adapter</dt><dd>NOT INSTALLED</dd></div>
            <div><dt>Publishing</dt><dd>DISABLED</dd></div>
            <div><dt>Autonomous budget changes</dt><dd>DISABLED</dd></div>
          </dl>
          <div className="operator-disabled-actions">
            <button disabled type="button">Publish ads · Locked</button>
            <button disabled type="button">Change budgets · Locked</button>
          </div>
        </section>
        <section className="panel">
          <p className="label">03 · EXECUTION FLOW</p>
          <ol className="operator-steps">
            <li>Import verified, timestamped observations</li>
            <li>Calculate metrics and explain uncertainty</li>
            <li>Generate evidence-backed proposals</li>
            <li>Export report for human review</li>
            <li>Keep campaign execution blocked</li>
          </ol>
          <p className="muted">Automatic read-only ingestion, AI creative generation, durable scheduling and Meta write permissions are separate later milestones, not features of this dry-run release.</p>
        </section>
      </section>

      <section className="panel operator-output" aria-live="polite">
        <p className="label">04 · SIMULATION OUTPUT</p>
        {!report ? (
          <div className="operator-placeholder">
            <h2>Ready for a read-only snapshot</h2>
            <p>No campaign results are preloaded. Enter sourced metrics to generate a dry-run decision report.</p>
          </div>
        ) : (
          <>
            <div className="operator-report-head">
              <div><h2>{report.snapshot.campaignName}</h2><p className="muted">{report.snapshot.periodStart} → {report.snapshot.periodEnd} · {report.snapshot.sourceReference}</p></div>
              <span className="operator-mode">PROPOSAL ONLY</span>
            </div>
            <div className="operator-metrics">
              <div><span>Link CTR</span><strong>{percent(report.calculated.ctr)}</strong></div>
              <div><span>Click → page view</span><strong>{percent(report.calculated.clickToLandingViewRate)}</strong></div>
              <div><span>Cost / landing view</span><strong>{money(report.calculated.costPerLandingPageViewMYR)}</strong></div>
              <div><span>Reported ROAS</span><strong>{multiple(report.calculated.reportedRoas)}</strong></div>
            </div>
            <h3>Evidence &amp; findings</h3>
            <ul className="operator-items">{report.findings.map((finding) => (
              <li key={finding.id}><span className="operator-tag">{finding.classification.replace("_", " ")}</span><p>{finding.statement}</p></li>
            ))}</ul>
            <h3>Proposals requiring human review</h3>
            {report.proposedActions.length ? (
              <ul className="operator-items">{report.proposedActions.map((action) => (
                <li key={action.id}><span className="operator-tag">{action.priority} · {action.status}</span><strong>{action.summary}</strong><p>{action.rationale}</p></li>
              ))}</ul>
            ) : <p className="muted">No rule-triggered proposals. This is not a declaration of profitable performance.</p>}
            <p className="operator-guard-note">{report.execution.note} Campaign changes: 0 · Published ads: 0 · Authorized spend: RM0.</p>
            <div className="operator-export">
              <button type="button" onClick={copyReport}>Copy full audit report (JSON)</button>
              <p role="status" className="muted">{copyResult}</p>
              <details><summary>Inspect report JSON</summary><pre>{JSON.stringify(report, null, 2)}</pre></details>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
