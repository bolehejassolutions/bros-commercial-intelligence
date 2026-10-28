import {NextRequest,NextResponse} from "next/server";
import {createClient as createAdminClient} from "@supabase/supabase-js";
import {timingSafeEqual} from "node:crypto";
import {FIXED_META_ACCOUNT} from "@/lib/marketing-operator/meta-write";
import {malaysiaDate,pauseOnlyWhenAtCap} from "@/lib/marketing-operator/monitor";
import {fetchMetaReadOnlyInsights,normalizeMetaInsight} from "@/lib/marketing-operator/meta-readonly";
import {requireVerifiedMetaCredential} from "@/lib/marketing-operator/meta-connection";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const NO_CACHE={"Cache-Control":"no-store"};
export async function GET(req:NextRequest){
 const secret=process.env.CRON_SECRET;
 const supplied=req.headers.get("authorization")?.replace(/^Bearer /,"")??"";
 if(!secret||!supplied||Buffer.byteLength(supplied)!==Buffer.byteLength(secret)||
   !timingSafeEqual(Buffer.from(supplied),Buffer.from(secret)))
  return NextResponse.json({error:"Unauthorized scheduled run"},{status:401,headers:NO_CACHE});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const serviceKey=process.env.BCI_SUPABASE_SERVICE_KEY;
 const readToken=process.env.META_ADS_READ_TOKEN;
 if(!url||!serviceKey||!readToken)return NextResponse.json({
  mode:"LOCKED",error:"Scheduled read requires server-held Supabase service key and Meta ads_read token."},
  {status:503,headers:NO_CACHE});

 const database=createAdminClient(url,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}});
 const {data:members,error:membershipError}=await database.from("bci_operator_members")
  .select("user_id").eq("role","admin").eq("active",true).limit(2);
 if(membershipError||!members||members.length!==1)
  return NextResponse.json({error:"Exactly one verified BCI administrator required for automatic attribution."},
   {status:503,headers:NO_CACHE});
 const now=new Date();
 const day=malaysiaDate(new Date(now.getTime()-86400000));
 let rows;
 try{
  await requireVerifiedMetaCredential("read");
  rows=await fetchMetaReadOnlyInsights(FIXED_META_ACCOUNT,readToken,day,day);
 }
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Meta read failed"},{status:502,headers:NO_CACHE});}
 const mapped=[];
 try{
  for(const row of rows){
   const result=normalizeMetaInsight(row,FIXED_META_ACCOUNT,now.toISOString());
   if(!result)continue;
   const {campaignId,snapshot}=result;
   mapped.push({
    market:"MY",account_id:FIXED_META_ACCOUNT,campaign_id:campaignId,
    campaign_name:snapshot.campaignName,period_start:snapshot.periodStart,period_end:snapshot.periodEnd,
    spend_myr:snapshot.spendMYR,impressions:snapshot.impressions,link_clicks:snapshot.linkClicks,
    landing_page_views:snapshot.landingPageViews,purchases:snapshot.purchases,
    attributed_revenue_myr:snapshot.attributedRevenueMYR,source_reference:snapshot.sourceReference,
    fetched_at:now.toISOString(),created_by:members[0].user_id,
   });
  }
 }catch{return NextResponse.json({error:"Meta data failed validation; no data saved."},{status:422,headers:NO_CACHE});}
 if(mapped.length){
  const {error}=await database.from("marketing_meta_snapshots").upsert(mapped,{
   onConflict:"account_id,campaign_id,period_start,period_end"});
  if(error)return NextResponse.json({error:"BCI snapshot storage failed."},{status:503,headers:NO_CACHE});
 }
 // Optimization is pause-only and never increases bids, targeting or spend.
 let autoPaused=0;
 const warnings:string[]=[];
 const {data:livePlans,error:liveError}=await database.from("bci_campaign_plans")
  .select("id,account_id,meta_campaign_id,budget_cap_myr,authorized_at,status")
  .eq("status","ACTIVE").eq("account_id",FIXED_META_ACCOUNT).limit(2);
 if(liveError)warnings.push("Active plan monitoring unavailable.");
 else for(const plan of livePlans??[]){
  try{
   const monitor=await pauseOnlyWhenAtCap({
    account_id:plan.account_id,meta_campaign_id:plan.meta_campaign_id,
    budget_cap_myr:plan.budget_cap_myr,authorized_at:plan.authorized_at,
   });
   if(monitor.paused){
    const {error:statusError}=await database.from("bci_campaign_plans")
     .update({status:"PAUSED",updated_at:now.toISOString()})
     .eq("id",plan.id).eq("status","ACTIVE");
    if(statusError)throw Error("Meta paused, but internal state update failed.");
    await database.from("bci_campaign_audit").insert({
     plan_id:plan.id,actor_id:null,event:"AUTOMATIC_BUDGET_SAFETY_PAUSE",
     details:{reported_spend_myr:monitor.spendMYR,cap_myr:Number(plan.budget_cap_myr)}
    });
    autoPaused++;
   }
  }catch{warnings.push("Campaign monitoring needs human reconciliation.");}
 }
 return NextResponse.json({mode:"CONTROLLED",source:"Meta GET insights",date:day,
  received:rows.length,stored:mapped.length,autoPaused,warnings,
  newCampaigns:0,budgetIncreases:0},{headers:NO_CACHE});
}
