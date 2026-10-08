"use client";

import { useState } from "react";
import type { CampaignSnapshot } from "@/lib/marketing-operator/contracts";

interface Row {
  campaign_name: string;
  period_start: string;
  period_end: string;
  spend_myr: number;
  impressions: number;
  link_clicks: number;
  landing_page_views: number | null;
  purchases: number | null;
  attributed_revenue_myr: number | null;
  source_reference: string;
  fetched_at: string;
}

export function MetaReadOnlyPanel({ onUse }: { onUse: (value: CampaignSnapshot) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const response = await fetch("/api/operator/meta", { method: "GET", cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Read-only observations unavailable.");
      setRows(data.snapshots ?? []);
      setLoaded(true);
      setMessage("Retrieved " + (data.snapshots?.length ?? 0) + " saved observations.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load observations.");
    } finally { setBusy(false); }
  }

  async function ingest() {
    setBusy(true);
    try {
      const response = await fetch("/api/operator/meta", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Read-only refresh unavailable.");
      setMessage("Meta GET complete: " + data.stored + " observations saved, zero ad mutations. Load saved observations to inspect.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Meta refresh failed.");
    } finally { setBusy(false); }
  }

  function select(row: Row) {
    onUse({
      market: "MY",
      currency: "MYR",
      campaignName: row.campaign_name,
      source: "meta-readonly-export",
      sourceReference: row.source_reference,
      capturedAt: row.fetched_at,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      spendMYR: Number(row.spend_myr),
      impressions: Number(row.impressions),
      linkClicks: Number(row.link_clicks),
      landingPageViews: row.landing_page_views === null ? null : Number(row.landing_page_views),
      purchases: row.purchases === null ? null : Number(row.purchases),
      attributedRevenueMYR: row.attributed_revenue_myr === null ? null : Number(row.attributed_revenue_myr),
    });
  }
  return (
    <section className="panel operator-meta-panel">
      <p className="label">READ-ONLY PROVIDER INGESTION · META ADS</p>
      <h2>Verified snapshots</h2>
      <p className="muted">Access restricted to enrolled BCI operators. Refresh uses a server-side Meta Graph API GET, saves observations in the BCI database and never changes ads. No token is sent to the browser.</p>
      <div className="operator-meta-controls">
        <button type="button" disabled={busy} onClick={load}>Load saved observations</button>
        <button type="button" disabled={busy} onClick={ingest}>Read yesterday from Meta</button>
      </div>
      <p role="status" className="muted">{message}</p>
      {loaded && rows.length === 0 && <p className="muted">No stored observations yet. Configure read-only access before refreshing.</p>}
      <div className="operator-meta-rows">
        {rows.map((row, i) => <button key={i} type="button" onClick={() => select(row)} className="operator-meta-row">
          <strong>{row.campaign_name}</strong>
          <span>{row.period_start} · RM{Number(row.spend_myr).toFixed(2)} · {row.link_clicks} link clicks</span>
          <span>Simulate this observation →</span>
        </button>)}
      </div>
    </section>
  );
}
