import { readDemandMetaAccountInsights, type InsightsRequest, type InsightsTransport } from "./meta-insights-readonly.ts";
import { readDemandMetaStatusSnapshot, type MetaStatusBinding, type MetaStatusTransport } from "./meta-status-readonly.ts";

/** Server-only composition; HTTP authentication and membership resolution are external prerequisites. */
export type VerifiedDemandScope = Readonly<{principalId:string;tenantId:string;accountId:string;permission:"DEMAND_META_READ";verifiedAt:string}>;
export type DemandOperatorRead = Readonly<{accountId:string;apiVersion:string;since:string;until:string;objects:readonly Readonly<{objectId:string;kind:"campaign"|"adset"|"ad"}>[]}>;
const fail=():never=>{throw Error("BROS_DEMAND_OPERATOR_READ_DENIED");};
const validId=(x:unknown):x is string=>typeof x==="string" && /^[a-zA-Z0-9_-]{8,128}$/.test(x);
const ownKeys=(value:object,expected:readonly string[])=>{
 const keys=Object.keys(value);
 return keys.length===expected.length && keys.every(k=>expected.includes(k));
};
const validDate=(value:unknown):value is string=>
 typeof value==="string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
 Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;

/** resolveScope must independently authenticate the principal and freshly verify tenant membership.
 * Never pass caller-supplied scope or browser credentials as trusted server authority. */
export async function readDemandOperatorSnapshot(
 request:DemandOperatorRead,resolveScope:()=>Promise<VerifiedDemandScope|null>,
 getServerToken:(scope:VerifiedDemandScope)=>Promise<string>,
 transport:InsightsTransport & MetaStatusTransport,now:()=>Date=()=>new Date()
){
 try {
  if(!request||typeof request!=="object"||Array.isArray(request)||
    !ownKeys(request,["accountId","apiVersion","since","until","objects"])||
    typeof resolveScope!=="function"||typeof getServerToken!=="function"||
    typeof transport!=="function"||typeof now!=="function")fail();
  const scope=await resolveScope();
  const timestamp=now();
  if(!scope||!validId(scope.principalId)||!validId(scope.tenantId)||
    scope.permission!=="DEMAND_META_READ"||scope.accountId!==request.accountId||
    !(timestamp instanceof Date)||!Number.isFinite(timestamp.getTime())||
    typeof scope.verifiedAt!=="string"||!Number.isFinite(Date.parse(scope.verifiedAt))||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(scope.verifiedAt)||
    timestamp.getTime()-Date.parse(scope.verifiedAt)>60000||
    Date.parse(scope.verifiedAt)>timestamp.getTime()+5000)fail();
  if(!validDate(request.since)||!validDate(request.until)||request.since>request.until||
    (Date.parse(request.until)-Date.parse(request.since))/86400000>31||
    !Array.isArray(request.objects)||request.objects.length<1||request.objects.length>20||
    typeof request.apiVersion!=="string"||typeof request.since!=="string"||
    typeof request.until!=="string")fail();
  const observedAt=timestamp.toISOString();
  if(request.objects.some(item=>!item||typeof item!=="object"||Array.isArray(item)||
    !ownKeys(item,["objectId","kind"])))fail();
  const bindings:MetaStatusBinding[]=request.objects.map(item=>({
    accountId:scope.accountId,apiVersion:request.apiVersion,objectId:item?.objectId,kind:item?.kind
  }));
  const ids=new Set<string>();
  if(!/^act_\d{5,30}$/.test(scope.accountId)||!/^v[1-9]\d?\.\d+$/.test(request.apiVersion)||
    bindings.some(b=>typeof b.objectId!=="string"||!/^\d{5,30}$/.test(b.objectId)||
      !["campaign","adset","ad"].includes(b.kind)))fail();
  for(const b of bindings){if(ids.has(b.objectId))fail();ids.add(b.objectId);}
  const token=await getServerToken(scope);
  const insightsRequest:InsightsRequest={accountId:scope.accountId,apiVersion:request.apiVersion,
    since:request.since,until:request.until,observedAt};
  const insights=await readDemandMetaAccountInsights(insightsRequest,token,transport);
  const status=await readDemandMetaStatusSnapshot(bindings,token,observedAt,transport);
  return Object.freeze({tenantId:scope.tenantId,accountId:scope.accountId,
    observedAt,insights,status,executionAllowed:false as const});
 }catch{fail();}
}