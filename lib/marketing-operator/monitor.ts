/**
 * Guardrails for scheduled operation:
 * - No auto budget increases, no ad creation, no new targeting
 * - Lifetime Meta budget remains the primary financial ceiling
 * - Auto-pause only when campaign-level spend is unambiguously measurable.
 */
import {FIXED_META_ACCOUNT,metaSetStatus,readVerifiedWriteGate} from "./meta-write.ts";
import {metaProviderRequest,metaProviderJson} from "./meta-provider.ts";
export const PAUSE_RATIO=0.95;
export function shouldPauseAtCap(spendMYR:unknown,authorizedMYR:unknown):boolean{
 const spend=Number(spendMYR),limit=Number(authorizedMYR);
 return spendMYR!==null&&spendMYR!==undefined&&authorizedMYR!==null&&
  Number.isFinite(spend)&&Number.isFinite(limit)&&limit>=5&&spend>=0&&
  spend>=Math.round(limit*PAUSE_RATIO*100)/100;
}
export function malaysiaDate(utc:Date):string{
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kuala_Lumpur",
  year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(utc);
 const key=(type:string)=>parts.find(p=>p.type===type)?.value??"";
 return key("year")+"-"+key("month")+"-"+key("day");
}
export async function metaCampaignSpend(
 campaignId:string,token:string,startDay:string,endDay:string,transport:typeof fetch=fetch
):Promise<number|null> {
 if(!/^[0-9]{6,}$/.test(campaignId)||!token||!/^\d{4}-\d{2}-\d{2}$/.test(startDay)||
   !/^\d{4}-\d{2}-\d{2}$/.test(endDay)||endDay<startDay)throw Error("Invalid campaign report parameters.");
 const url=new URL("https://graph.facebook.com/v24.0/"+campaignId+"/insights");
 url.searchParams.set("fields","spend");
 url.searchParams.set("time_range",JSON.stringify({since:startDay,until:endDay}));
 const res=await metaProviderRequest(url.toString(),{
  method:"GET",headers:{Authorization:"Bearer "+token},cache:"no-store",signal:AbortSignal.timeout(12000)
 },transport);
 if(!res.ok)throw Error("Cannot measure Meta campaign spend (HTTP "+res.status+").");
 const body=await metaProviderJson(res) as {data?:Array<{spend?:string}>,error?:{code?:number}};
 if(body.error||!Array.isArray(body.data)||body.data.length>1)
   throw Error("Ambiguous Meta spend response; no automatic optimization.");
 if(body.data.length===0||body.data[0].spend===undefined)return null;
 const value=Number(body.data[0].spend);
 if(!Number.isFinite(value)||value<0)return null;
 return value;
}
export async function pauseOnlyWhenAtCap(
 campaign:{account_id:string;meta_campaign_id:string;budget_cap_myr:number|string;authorized_at:string},
 transport:typeof fetch=fetch,
 env:NodeJS.ProcessEnv=process.env
):Promise<{paused:boolean;spendMYR:number|null}> {
 if(campaign.account_id!==FIXED_META_ACCOUNT)throw Error("Unapproved campaign account.");
 if(!/^[0-9]{6,}$/.test(campaign.meta_campaign_id))throw Error("Unverified campaign ID.");
 const gate=await readVerifiedWriteGate(env,transport);
 const cap=Number(campaign.budget_cap_myr);
 if(!Number.isFinite(cap)||cap>gate.portfolioCapMYR||cap<5)
   throw Error("Campaign cap exceeds deployment authority.");
 const day=malaysiaDate(new Date());
 const from=malaysiaDate(new Date(campaign.authorized_at));
 const spend=await metaCampaignSpend(campaign.meta_campaign_id,gate.token,from,day,transport);
 if(!shouldPauseAtCap(spend,cap))return {paused:false,spendMYR:spend};
 await metaSetStatus(campaign.meta_campaign_id,"PAUSED",gate.token,transport);
 return {paused:true,spendMYR:spend};
}
