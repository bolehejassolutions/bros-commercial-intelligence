import { readDemandOperatorSnapshot, type VerifiedDemandScope } from "./meta-operator-snapshot.ts";
import type { InsightsTransport } from "./meta-insights-readonly.ts";
import { diagnoseDemandMetaError } from "./meta-provider-diagnosis.mjs";
import { demandMetaReportingDate } from "./meta-reporting-date.ts";

type Deps = Readonly<{
 enabled:()=>boolean;
 accountId:string; campaignId:string; adsetId?:string; adId?:string; apiVersion:string;
 authorize:(jwt:string)=>Promise<{tenantId:string;principalId:string}>;
 readToken:()=>string|null;
 now:()=>Date;
 transport:InsightsTransport;
}>;
const headers={"Cache-Control":"private, no-store, max-age=0","Pragma":"no-cache","Vary":"Authorization","X-Content-Type-Options":"nosniff"};
const reply=(status:number,body:unknown)=>Response.json(body,{status,headers});
/** Independently gated GET-only DEMAND operator status/Insights endpoint. Never accepts caller account, object IDs or credentials. */
export function createDemandOperatorStatusHandler(deps:Deps) {
 let inFlight=0;
 const objectIds = [deps.campaignId, deps.adsetId, deps.adId].filter(id => id !== undefined);
 const validScope = /^act_\d{5,30}$/.test(deps.accountId) && /^v[1-9]\d?\.\d+$/.test(deps.apiVersion) &&
  objectIds.every(id => /^\d{5,30}$/.test(id)) && new Set(objectIds).size === objectIds.length &&
  (deps.adId === undefined || deps.adsetId !== undefined);
 return async(request:Request):Promise<Response>=>{
  if(!deps.enabled())return reply(404,{error:"DEMAND_STATUS_DISABLED"});
  if(request.method!=="GET")return reply(405,{error:"METHOD_NOT_ALLOWED"});
  if(request.url.length>2048||request.headers.has("transfer-encoding")||
     Number(request.headers.get("content-length")||0)!==0||
     ["x-tenant-id","x-user-id","x-role","x-admin","x-meta-token","x-account-id"].some(x=>request.headers.has(x)))return reply(400,{error:"INVALID_REQUEST"});
  let url:URL;
  try{url=new URL(request.url);}catch{return reply(400,{error:"INVALID_REQUEST"});}
  const statusView = url.pathname === "/api/internal/demand-meta" &&
    url.searchParams.getAll("view").length === 1 && url.searchParams.get("view") === "status";
  if ((!statusView && url.pathname !== "/api/internal/demand-meta-status") ||
     url.searchParams.size !== (statusView ? 3 : 2) ||
     url.searchParams.getAll("since").length!==1||
     url.searchParams.getAll("until").length!==1)return reply(400,{error:"INVALID_REQUEST"});
  // Reject malformed or oversized reporting windows before membership/provider work.
  const validDay=(value:string|null)=>typeof value==="string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
  const since=url.searchParams.get("since"),until=url.searchParams.get("until");
  // Inclusive 31-calendar-day ceiling; never request future or pre-epoch reporting.
  // Use the server clock rather than caller headers to prevent time-window spoofing.
  const today = demandMetaReportingDate(deps.now());
  if(!validDay(since)||!validDay(until)||since!>until!||
    since!<"2000-01-01"||until!>today||
    (Date.parse(until!)-Date.parse(since!))/86400000>=31)return reply(400,{error:"INVALID_REPORTING_WINDOW"});
  const auth=request.headers.get("authorization");
  if(!auth||auth.length>16007||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth))return reply(401,{error:"UNAUTHORIZED"});
  // Bound concurrent read-only observations per handler instance; never queue or retry provider reads.
  if(inFlight>=2)return reply(429,{error:"DEMAND_STATUS_BUSY"});
  inFlight++;
  let providerError: string | null = null;
  let invalidScope = false, tokenMissing=false, providerReads=0, revalidationAttempted=false, scopeChecks=0;
  const deadline = AbortSignal.any([AbortSignal.timeout(25000), request.signal]);
  try{
   const resolveScope=async():Promise<VerifiedDemandScope>=>{
    if(++scopeChecks>1)revalidationAttempted=true;
    const scope=await deps.authorize(auth.slice(7));
    if (!validScope) {
     invalidScope = true;
     throw Error("INVALID_SERVER_SCOPE");
    }
    return {principalId:scope.principalId,tenantId:scope.tenantId,accountId:deps.accountId,
      permission:"DEMAND_META_READ",verifiedAt:deps.now().toISOString()};
   };
   const result=await readDemandOperatorSnapshot({
    accountId:deps.accountId,apiVersion:deps.apiVersion,
    since:since!,until:until!,
    objects:[{kind:"campaign" as const,objectId:deps.campaignId},
      ...(deps.adsetId?[{kind:"adset" as const,objectId:deps.adsetId}]:[]),
      ...(deps.adId?[{kind:"ad" as const,objectId:deps.adId}]:[])]
   },resolveScope,async()=>{
    const token=deps.readToken();
    // Reject missing, malformed or oversized server credentials before any provider request.
    // Meta access tokens are opaque ASCII non-whitespace strings; never trim or repair them.
    if(typeof token!=="string"||token.length<20||token.length>4096||!/^[\x21-\x7e]+$/.test(token)){
     tokenMissing=true;throw Error("INVALID_SERVER_TOKEN");
    }
    return token;
   }, async (url, init) => {
    providerReads++;
    const signal = AbortSignal.any([init.signal, deadline]);
    try {
     signal.throwIfAborted();
     const response = await deps.transport(url, { ...init, signal });
     const body: unknown = await response.json().catch(() => null);
     signal.throwIfAborted();
     const diagnostic = diagnoseDemandMetaError(body).state;
     if (response.status === 429 || diagnostic === "RATE_LIMITED") {
      providerError = "DEMAND_META_PROVIDER_RATE_LIMITED";
     } else if (diagnostic === "TOKEN_INVALID_OR_EXPIRED") {
      providerError = "DEMAND_META_PROVIDER_TOKEN_REJECTED";
     } else if (diagnostic === "PERMISSION_DENIED") {
      providerError = "DEMAND_META_PROVIDER_PERMISSION_DENIED";
     } else if (diagnostic === "INVALID_REQUEST") {
      providerError = "DEMAND_META_PROVIDER_REQUEST_REJECTED";
     }
     if (providerError || !response.ok || body === null) throw Error();
     return { ok: true, json: async () => body };
    } catch {
     providerError ??= signal.aborted ? "DEMAND_META_PROVIDER_TIMEOUT" : "DEMAND_META_PROVIDER_UNAVAILABLE";
     throw Error("META_PROVIDER_READ_FAILED");
    }
   }, deps.now);
   return reply(200,{source:"META_GRAPH_API_UNATTESTED",observedAt:result.observedAt,
    collectedAt:result.collectedAt,account:result.account,insights:result.insights,status:result.status,verifiedPaidOrders:null,
    executionAllowed:false,providerAuthorizationIndependentlyAttested:false});
  }catch{
   if(invalidScope)return reply(503,{error:"DEMAND_META_SCOPE_UNAVAILABLE"});
   if(tokenMissing)return reply(503,{error:"DEMAND_META_CREDENTIAL_UNAVAILABLE"});
   // After a provider read, schema/semantic parse failures are provider failures too.
   // A subsequent tenant revalidation denial must remain an authorization failure.
   if(providerError === "DEMAND_META_PROVIDER_RATE_LIMITED")return reply(503,{error:providerError});
   if(providerError === "DEMAND_META_PROVIDER_TIMEOUT")return reply(504,{error:providerError});
   if(providerError || (providerReads>0&&!revalidationAttempted))return reply(502,{error:providerError ?? "DEMAND_META_PROVIDER_UNAVAILABLE"});
   return reply(403,{error:"DEMAND_STATUS_DENIED"});
  }
  finally{inFlight--;}
 };
}
