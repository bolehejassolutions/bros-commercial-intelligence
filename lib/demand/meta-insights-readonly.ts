/** Read-only, bounded Meta Insights observation. Caller must verify tenant and account authorization. */
export type InsightsTransport = (url: string, init: {method:"GET";headers:Record<string,string>;signal:AbortSignal;redirect:"error";cache:"no-store"}) => Promise<{ok:boolean;json():Promise<unknown>}>;
export type InsightsRequest = Readonly<{accountId:string;apiVersion:string;since:string;until:string;observedAt:string}>;
const deny = ():never => {throw Error("BROS_DEMAND_META_INSIGHTS_READ_FAILED");};
const obj = (x:unknown):x is Record<string,unknown> => !!x && typeof x==="object" && !Array.isArray(x);
const date = (x:unknown):x is string => typeof x==="string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x)) && new Date(Date.parse(x)).toISOString().slice(0,10)===x;
const metric = (x:unknown):number => typeof x==="string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(x) && Number.isFinite(Number(x)) ? Number(x) : deny();
export async function readDemandMetaAccountInsights(req:InsightsRequest,token:string,transport:InsightsTransport) {
 try {
  if (!obj(req) || typeof req.accountId!=="string" || !/^act_\d{5,30}$/.test(req.accountId) ||
   typeof req.apiVersion!=="string" || !/^v[1-9]\d?\.\d+$/.test(req.apiVersion) ||
   !date(req.since) || !date(req.until) || req.since>req.until ||
   (Date.parse(req.until)-Date.parse(req.since))/86400000>31 ||
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
   (obj(body.paging) && (body.paging.next!==undefined || body.paging.previous!==undefined))) deny();
  const rows=body.data as unknown[];
  if (rows.length===0) return Object.freeze({source:"META_GRAPH_API_UNATTESTED" as const,observedAt:req.observedAt,
   accountId:req.accountId,since:req.since,until:req.until,state:"NO_ROWS_NOT_ZERO" as const,spend:null,impressions:null,clicks:null,executionAllowed:false as const});
  const row=rows[0] as Record<string,unknown>;
  if (!obj(row) || row.account_id!==req.accountId.slice(4) || row.date_start!==req.since || row.date_stop!==req.until) deny();
  const spend=metric(row.spend),impressions=metric(row.impressions),clicks=metric(row.clicks);
  if (!Number.isSafeInteger(impressions) || !Number.isSafeInteger(clicks) || !Number.isSafeInteger(Math.round(spend*100)) || clicks>impressions) deny();
  return Object.freeze({source:"META_GRAPH_API_UNATTESTED" as const,observedAt:req.observedAt,
   accountId:req.accountId,since:req.since,until:req.until,state:"PROVIDER_ROW" as const,spend,impressions,clicks,executionAllowed:false as const});
 } catch {deny();}
}
