/** Read-only, bounded Meta Insights observation. Caller must verify tenant and account authorization. */
export type InsightsTransport = (url: string, init: {method:"GET";headers:Record<string,string>;signal:AbortSignal;redirect:"error";cache:"no-store"}) => Promise<{ok:boolean;json():Promise<unknown>}>;
export type InsightsRequest = Readonly<{accountId:string;apiVersion:string;since:string;until:string;observedAt:string}>;
const deny = ():never => {throw Error("BROS_DEMAND_META_INSIGHTS_READ_FAILED");};
const obj = (x:unknown):x is Record<string,unknown> => !!x && typeof x==="object" && !Array.isArray(x);
const date = (x:unknown):x is string => typeof x==="string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x)) && new Date(Date.parse(x)).toISOString().slice(0,10)===x;
// Impression and click counts are discrete observations: never coerce fractional textual counts.
const metric = (x:unknown):number => typeof x==="string" && /^(?:0|[1-9]\d*)$/.test(x) && Number.isSafeInteger(Number(x)) ? Number(x) : deny();
// MYR account spend must be an exact non-negative cent amount; never silently round sub-cent provider values.
const spendMetric = (x:unknown):number => {
 if(typeof x!=="string" || !/^(?:0|[1-9]\\d*)(?:\\.\\d{1,2})?$/.test(x)) deny();
 // Parse integer cents without floating-point rounding. Reject amounts whose cents
 // cannot survive conversion to the public numeric spend representation exactly.
 const [whole, fractional=""] = x.split(".");
 const cents=BigInt(whole)*100n+BigInt((fractional+"00").slice(0,2));
 if(cents>BigInt(Number.MAX_SAFE_INTEGER)) deny();
 const spend=Number(x);
 if(!Number.isFinite(spend) || !Number.isSafeInteger(Math.round(spend*100)) ||
    BigInt(Math.round(spend*100))!==cents) deny();
 return spend;
};
export async function readDemandMetaAccountInsights(req:InsightsRequest,token:string,transport:InsightsTransport) {
 try {
  if (!obj(req) || typeof req.accountId!=="string" || !/^act_\d{5,30}$/.test(req.accountId) ||
   typeof req.apiVersion!=="string" || !/^v[1-9]\d?\.\d+$/.test(req.apiVersion) ||
   !date(req.since) || !date(req.until) || req.since>req.until ||
   (Date.parse(req.until)-Date.parse(req.since))/86400000>=31 ||
   typeof req.observedAt!=="string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(req.observedAt) ||
   !Number.isFinite(Date.parse(req.observedAt)) || new Date(req.observedAt).toISOString().slice(0,19)!==req.observedAt.slice(0,19) ||
   typeof token!=="string" || token.length<20 || token.length>4096 || /[^\x21-\x7e]/.test(token) || typeof transport!=="function") deny();
  const params=new URLSearchParams({fields:"account_id,date_start,date_stop,spend,impressions,clicks",level:"account",time_range:JSON.stringify({since:req.since,until:req.until}),limit:"1"});
  const response=await transport(`https://graph.facebook.com/${req.apiVersion}/${req.accountId}/insights?${params}`,{
   method:"GET",headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},signal:AbortSignal.timeout(8000),redirect:"error",cache:"no-store"
  });
  if (!response || response.ok!==true) deny();
  const body=await response.json() as Record<string,unknown>;
  if (!obj(body) || Object.hasOwn(body,"error") || !Array.isArray(body.data) || body.data.length>1 ||
   (Object.hasOwn(body,"paging") && (!obj(body.paging) || Object.hasOwn(body.paging,"next") || Object.hasOwn(body.paging,"previous") || Object.keys(body.paging).some(k=>k!=="cursors") || (Object.hasOwn(body.paging,"cursors") && (!obj(body.paging.cursors) || Object.keys(body.paging.cursors).some(k=>!["before","after"].includes(k)) || Object.values(body.paging.cursors).some(v=>typeof v!=="string")))))) deny();
  const rows=body.data as unknown[];
  if (rows.length===0) return Object.freeze({source:"META_GRAPH_API_UNATTESTED" as const,observedAt:req.observedAt,
   accountId:req.accountId,since:req.since,until:req.until,state:"NO_ROWS_NOT_ZERO" as const,spend:null,impressions:null,clicks:null,executionAllowed:false as const});
  const row=rows[0] as Record<string,unknown>;
  if (!obj(row) || row.account_id!==req.accountId.slice(4) || row.date_start!==req.since || row.date_stop!==req.until) deny();
  const spend=spendMetric(row.spend),impressions=metric(row.impressions),clicks=metric(row.clicks);
  if (!Number.isSafeInteger(impressions) || !Number.isSafeInteger(clicks) || !Number.isSafeInteger(Math.round(spend*100))) deny();
  return Object.freeze({source:"META_GRAPH_API_UNATTESTED" as const,observedAt:req.observedAt,
   accountId:req.accountId,since:req.since,until:req.until,state:"PROVIDER_ROW" as const,spend,impressions,clicks,executionAllowed:false as const});
 } catch {deny();}
}
