import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchMetaReadOnlyInsights, normalizeMetaInsight } from "@/lib/marketing-operator/meta-readonly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedAccountId = "act_1997776120879476";
const cacheHeaders = { "Cache-Control": "no-store" };

async function getOperator() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const { data: granted, error: membershipError } = await supabase.rpc("is_bci_operator");
  if (membershipError || granted !== true) return null;
  return { supabase, user };
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function GET() {
  const operator = await getOperator();
  if (!operator) return NextResponse.json({ error: "BCI operator access required." }, { status: 403, headers: cacheHeaders });
  const { data, error } = await operator.supabase.from("marketing_meta_snapshots")
    .select("account_id,campaign_id,campaign_name,period_start,period_end,spend_myr,impressions,link_clicks,landing_page_views,purchases,attributed_revenue_myr,source_reference,fetched_at")
    .eq("account_id", allowedAccountId).order("fetched_at", { ascending: false }).limit(20);
  if (error) return NextResponse.json({ error: "Read-only snapshots are not available." }, { status: 503, headers: cacheHeaders });
  return NextResponse.json({ snapshots: data ?? [] }, { headers: cacheHeaders });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Same-origin request required." }, { status: 403, headers: cacheHeaders });
  }
  const operator = await getOperator();
  if (!operator) return NextResponse.json({ error: "BCI operator access required." }, { status: 403, headers: cacheHeaders });
  const token = process.env.META_ADS_READ_TOKEN;
  if (!token) return NextResponse.json({ error: "Meta read-only token is not configured. No provider request was made." }, { status: 503, headers: cacheHeaders });

  // Single fixed account; yesterday only, max 3 pages. No ad mutations or spend.
  const yesterday = new Date(Date.now() - 86400000);
  const day = isoDay(yesterday);
  let rows;
  try {
    rows = await fetchMetaReadOnlyInsights(allowedAccountId, token, day, day);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Meta read failed.";
    const status = message.includes("rate limit") ? 429 : 502;
    return NextResponse.json({ error: message, stored: 0 }, { status, headers: cacheHeaders });
  }

  const fetchedAt = new Date().toISOString();
  const records = [];
  try {
    for (const row of rows) {
      const result = normalizeMetaInsight(row, allowedAccountId, fetchedAt);
      if (!result) continue;
      const { campaignId, snapshot } = result;
      records.push({
        market: "MY",
        account_id: allowedAccountId,
        campaign_id: campaignId,
        campaign_name: snapshot.campaignName,
        period_start: snapshot.periodStart,
        period_end: snapshot.periodEnd,
        spend_myr: snapshot.spendMYR,
        impressions: snapshot.impressions,
        link_clicks: snapshot.linkClicks,
        landing_page_views: snapshot.landingPageViews,
        purchases: snapshot.purchases,
        attributed_revenue_myr: snapshot.attributedRevenueMYR,
        source_reference: snapshot.sourceReference,
        fetched_at: fetchedAt,
        created_by: operator.user.id,
      });
    }
  } catch {
    return NextResponse.json({ error: "Provider metrics failed validation. No observations were stored." }, { status: 422, headers: cacheHeaders });
  }

  if (records.length > 0) {
    const { error } = await operator.supabase.from("marketing_meta_snapshots").upsert(records, {
      onConflict: "account_id,campaign_id,period_start,period_end",
    });
    if (error) return NextResponse.json({ error: "Validated observations could not be stored. Check database migration and membership." }, { status: 503, headers: cacheHeaders });
  }
  return NextResponse.json({
    mode: "DRY_RUN",
    market: "MY",
    source: "Meta Graph API GET only",
    fetchedAt,
    returned: rows.length,
    stored: records.length,
    campaignChanges: 0,
    publishedAds: 0,
    authorizedSpendMYR: 0,
  }, { headers: cacheHeaders });
}
