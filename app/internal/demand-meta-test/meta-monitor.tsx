"use client";

import { useState, type FormEvent } from "react";
import { parseDemandMonitorResponse, type DemandMonitorSnapshot } from "@/lib/demand/meta-monitor-response";
import { demandMetaReportingDate } from "@/lib/demand/meta-reporting-date";

const providerMessages: Record<string, string> = {
  DEMAND_STATUS_DISABLED: "Meta monitoring is disabled for this Preview.",
  INVALID_REPORTING_WINDOW: "Choose a past or current window of up to 31 calendar days.",
  UNAUTHORIZED: "Sign in again to read Meta data.",
  DEMAND_STATUS_DENIED: "The current operator could not be verified for this DEMAND tenant.",
  DEMAND_STATUS_BUSY: "The monitor is busy. Try again after the current read finishes.",
  DEMAND_META_SCOPE_UNAVAILABLE: "The Preview’s configured Meta account or object scope is invalid.",
  DEMAND_META_CREDENTIAL_UNAVAILABLE: "The Preview’s server-side Meta read credential is unavailable.",
  DEMAND_META_PROVIDER_TOKEN_REJECTED: "Meta rejected the server-side read credential.",
  DEMAND_META_PROVIDER_PERMISSION_DENIED: "Meta denied this read for the configured account or object.",
  DEMAND_META_PROVIDER_REQUEST_REJECTED: "Meta rejected the configured report or status request.",
  DEMAND_META_PROVIDER_RATE_LIMITED: "Meta rate-limited the request. Try again later.",
  DEMAND_META_PROVIDER_TIMEOUT: "The Meta read timed out. Try again.",
  DEMAND_META_PROVIDER_UNAVAILABLE: "Meta did not return a valid, complete observation for this scope.",
};
const objectLabels = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };
const accountLabels: Record<number, string> = {
  1: "Active", 2: "Disabled", 3: "Unsettled", 7: "Pending review",
  8: "Pending settlement", 9: "In grace period", 100: "Pending closure", 101: "Closed",
};
const dateOffset = (days: number) => demandMetaReportingDate(new Date(Date.now() - days * 86_400_000));
const money = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" });
const count = new Intl.NumberFormat("en-MY");

function InsightMetrics({ insights }: { insights: DemandMonitorSnapshot["insights"] }) {
  if (insights.state === "NO_ROWS_NOT_ZERO") {
    return <p>Meta returned no rows. Spend, impressions and clicks are unknown.</p>;
  }
  return <dl>
    <div><dt>Spend</dt><dd>{money.format(insights.spend)}</dd></div>
    <div><dt>Impressions</dt><dd>{count.format(insights.impressions)}</dd></div>
    <div><dt>Clicks</dt><dd>{count.format(insights.clicks)}</dd></div>
  </dl>;
}

function formatReport(snapshot: DemandMonitorSnapshot) {
  const { account, insights, campaignInsights, collectedAt } = snapshot;
  const metrics = (report: DemandMonitorSnapshot["insights"]) =>
    report.state === "NO_ROWS_NOT_ZERO"
      ? "Spend unknown | Impressions unknown | Clicks unknown (Meta returned no rows)"
      : `Spend ${account.currency} ${report.spend.toFixed(2)} | Impressions ${report.impressions} | Clicks ${report.clicks}`;

  return [
    "BROS DEMAND Meta Ads report",
    "Source: Meta Graph API",
    `Account: ${account.accountId}`,
    `Campaign: ${campaignInsights.campaignId}`,
    `Window: ${insights.since} to ${insights.until} inclusive (${account.timezone})`,
    `Currency: ${account.currency}`,
    `Collected: ${collectedAt}`,
    `Account Insights: ${metrics(insights)}`,
    `Campaign Insights: ${metrics(campaignInsights)}`,
  ].join("\n");
}

export default function MetaMonitor({ getToken }: { getToken: () => Promise<string> }) {
  const [since, setSince] = useState(() => dateOffset(7));
  const [until, setUntil] = useState(() => dateOffset(1));
  const [snapshot, setSnapshot] = useState<DemandMonitorSnapshot | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<{
    state: "pending" | "copied" | "manual";
    report: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setSnapshot(null);
    setCopyFeedback(null);
    if (!since || !until || since > until || (Date.parse(until) - Date.parse(since)) / 86_400_000 >= 31) {
      setMessage(providerMessages.INVALID_REPORTING_WINDOW);
      return;
    }
    setBusy(true);
    setMessage("Reading Meta account status and Insights…");
    try {
      const jwt = await getToken();
      const query = new URLSearchParams({ view: "status", since, until });
      const response = await fetch("/api/internal/demand-meta?" + query, {
        method: "GET", headers: { Authorization: "Bearer " + jwt },
        cache: "no-store", redirect: "error",
      });
      if (!response.headers.get("cache-control")?.includes("no-store") ||
          !response.headers.get("vary")?.toLowerCase().includes("authorization")) throw Error();
      if (!response.ok) {
        const body: { error?: unknown } | null = await response.json().catch(() => null);
        const code = body?.error;
        setMessage(typeof code === "string" && Object.hasOwn(providerMessages, code)
          ? providerMessages[code] : "Meta monitoring is unavailable.");
        return;
      }
      const result = parseDemandMonitorResponse(await response.json(), { since, until });
      if (!result) {
        setMessage("The Meta report was incomplete or did not match the requested scope.");
        return;
      }
      setSnapshot(result);
      setMessage("Meta read completed.");
    } catch {
      setMessage("The signed-in Meta read could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function copyReport(snapshot: DemandMonitorSnapshot) {
    const pending = { state: "pending", report: formatReport(snapshot) } as const;
    setCopyFeedback(pending);
    let state: "copied" | "manual";
    try {
      await navigator.clipboard.writeText(pending.report);
      state = "copied";
    } catch {
      state = "manual";
    }
    setCopyFeedback(current => current === pending ? { state, report: pending.report } : current);
  }

  return (
    <section id="demand-monitor" className="demand-toolkit" aria-labelledby="demand-monitor-title">
      <h2 id="demand-monitor-title" className="demand-tools-title">Meta Ads monitor</h2>
      <p>Choose up to 31 days in the Meta account’s Malaysia time zone.</p>
      <form className="auth-form" onSubmit={load}>
        <label htmlFor="demand-monitor-since">Insights start date</label>
        <input id="demand-monitor-since" type="date" required max={until} value={since}
          disabled={busy} onChange={event => setSince(event.target.value)} />
        <label htmlFor="demand-monitor-until">Insights end date</label>
        <input id="demand-monitor-until" type="date" required min={since} max={dateOffset(0)} value={until}
          disabled={busy} onChange={event => setUntil(event.target.value)} />
        <button type="submit" disabled={busy}>Read Meta status and Insights</button>
      </form>
      <p role="status" aria-live="polite">{message}</p>
      {snapshot && (
        <>
          <h3>Account and delivery status</h3>
          <p>Account {snapshot.account.accountId} · {accountLabels[snapshot.account.statusCode] ??
            "Meta status code " + snapshot.account.statusCode} · {snapshot.account.timezone}</p>
          <dl>
            {snapshot.status.rows.map(row => (
              <div key={row.objectId}>
                <dt>{objectLabels[row.kind]} {row.objectId}</dt>
                <dd>Configured {row.configuredStatus} · Effective {row.effectiveStatus}</dd>
              </div>
            ))}
          </dl>
          {(["adset", "ad"] as const).filter(kind => !snapshot.status.rows.some(row => row.kind === kind))
            .map(kind => <p key={kind}>{objectLabels[kind]} status unavailable in this Preview’s configured scope.</p>)}
          <h3>Campaign Insights</h3>
          <p>Campaign {snapshot.campaignInsights.campaignId} · {snapshot.campaignInsights.since} to {snapshot.campaignInsights.until} · Meta Graph API</p>
          <InsightMetrics insights={snapshot.campaignInsights} />
          <h3>Account Insights</h3>
          <p>{snapshot.insights.since} to {snapshot.insights.until} · Meta Graph API</p>
          <InsightMetrics insights={snapshot.insights} />
          <p>Read started <time dateTime={snapshot.observedAt}>{snapshot.observedAt}</time> · Completed{" "}
            <time dateTime={snapshot.collectedAt}>{snapshot.collectedAt}</time></p>
          <button type="button" disabled={copyFeedback?.state === "pending"} onClick={() => void copyReport(snapshot)}>
            Copy report for comparison
          </button>
          <p role="status">{copyFeedback?.state === "copied" ? "Report copied." :
            copyFeedback?.state === "manual" ? "Copy the report from the field below." : ""}</p>
          {copyFeedback?.state === "manual" && (
            <label>Meta report for manual copy
              <textarea readOnly rows={9} value={copyFeedback.report} onFocus={event => event.currentTarget.select()} />
            </label>
          )}
        </>
      )}
    </section>
  );
}
