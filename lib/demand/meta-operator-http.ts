import { readDemandOperatorSnapshot, type VerifiedDemandScope } from "./meta-operator-snapshot.ts";
import type { InsightsTransport } from "./meta-insights-readonly.ts";

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
 return async(request:Request):Promise<Response>=>{
  if(!deps.enabled())return reply(404,{error:"DEMAND_STATUS_DISABLED"});
  if(request.method!=="GET")return reply(405,{error:"METHOD_NOT_ALLOWED"});
  if(request.url.length>2048||request.headers.has("transfer-encoding")||
     Number(request.headers.get("content-length")||0)!==0||
     ["x-tenant-id","x-user-id","x-role","x-admin","x-meta-token","x-account-id"].some(x=>request.headers.has(x)))return reply(400,{error:"INVALID_REQUEST"});
  let url:URL;
  try{url=new URL(request.url);}catch{return reply(400,{error:"INVALID_REQUEST"});}
  if(url.pathname!=="/api/internal/demand-meta-status"||
     url.searchParams.size!==2||
     url.searchParams.getAll("since").length!==1||
     url.searchParams.getAll("until").length!==1)return reply(400,{error:"INVALID_REQUEST"});
  // Reject malformed or oversized reporting windows before membership/provider work.
  const validDay=(value:string|null)=>typeof value==="string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
  const since=url.searchParams.get("since"),until=url.searchParams.get("until");
  // Inclusive 31-calendar-day ceiling; never request future or pre-epoch reporting.
  // Use the server clock rather than caller headers to prevent time-window spoofing.
  const today=deps.now().toISOString().slice(0,10);
  if(!validDay(since)||!validDay(until)||since!>until!||
    since!<"2000-01-01"||until!>today||
    (Date.parse(until!)-Date.parse(since!))/86400000>=31)return reply(400,{error:"INVALID_REPORTING_WINDOW"});
  const auth=request.headers.get("authorization");
  if(!auth||auth.length>16007||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth))return reply(401,{error:"UNAUTHORIZED"});
  // Bound concurrent read-only observations per handler instance; never queue or retry provider reads.
  if(inFlight>=2)return reply(429,{error:"DEMAND_STATUS_BUSY"});
  inFlight++;
  let providerFailed=false, providerRateLimited=false, tokenMissing=false, providerReads=0, revalidationAttempted=false, scopeChecks=0;
  try{
   const resolveScope=async():Promise<VerifiedDemandScope>=>{
    if(++scopeChecks>1)revalidationAttempted=true;
    const scope=await deps.authorize(auth.slice(7));
    return {principalId:scope.principalId,tenantId:scope.tenantId,accountId:deps.accountId,
      permission:"DEMAND_META_READ",verifiedAt:deps.now().toISOString()};
   };
   const result=await readDemandOperatorSnapshot({
    accountId:deps.accountId,apiVersion:deps.apiVersion,
    since:url.searchParams.get("since")??"",until:url.searchParams.get("until")??"",
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
   },async(url,init)=>{try{providerReads++;
    const response=await deps.transport(url,init);
    // Meta non-2xx responses are provider failures, not tenant authorization denials.
    // Never parse or return provider error bodies, which can contain sensitive details.
    if(!response||response.ok!==true){providerFailed=true;providerRateLimited=!!response && "status" in response && response.status===429;throw Error("META_PROVIDER_HTTP_FAILURE");}
    // A successful HTTP status with an unreadable JSON body is still a provider failure.
    return {ok:true,json:async()=>{try{return await response.json();}catch{providerFailed=true;throw Error("META_PROVIDER_INVALID_JSON");}}};
   }catch{providerFailed=true;throw Error("META_PROVIDER_TRANSPORT_FAILURE");}},deps.now);
   return reply(200,{source:"META_GRAPH_API_UNATTESTED",observedAt:result.observedAt,
    insights:result.insights,status:result.status,verifiedPaidOrders:null,
    executionAllowed:false,providerAuthorizationIndependentlyAttested:false});
  }catch{
   if(tokenMissing)return reply(503,{error:"DEMAND_META_CREDENTIAL_UNAVAILABLE"});
   // After a provider read, schema/semantic parse failures are provider failures too.
   // A subsequent tenant revalidation denial must remain an authorization failure.
   if(providerRateLimited)return reply(503,{error:"DEMAND_META_PROVIDER_RATE_LIMITED"});
   if(providerFailed||(providerReads>0&&!revalidationAttempted))return reply(502,{error:"DEMAND_META_PROVIDER_UNAVAILABLE"});
   return reply(403,{error:"DEMAND_STATUS_DENIED"});
  }
  finally{inFlight--;}
 };
}
