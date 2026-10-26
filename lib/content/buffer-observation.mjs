// BROS CONTENT product-layer observation gate. Pure, read-only and non-executing.
// Caller MUST authenticate, derive tenant scope server-side and fetch from Buffer.
// This module does not authenticate provider evidence or persist to shared BCI.
const hosts={facebook:"facebook.com",instagram:"instagram.com",tiktok:"tiktok.com"};
const counts=["impressions","reach","views","reactions","comments","shares","clicks","saves","follows"];
function utc(v){
  if(typeof v!=="string"||!/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/.test(v))return null;
  const t=Date.parse(v),d=new Date(t);
  return Number.isFinite(t)&&d.getUTCFullYear()===+v.slice(0,4)&&d.getUTCMonth()+1===+v.slice(5,7)&&d.getUTCDate()===+v.slice(8,10)&&d.getUTCHours()===+v.slice(11,13)&&d.getUTCMinutes()===+v.slice(14,16)&&d.getUTCSeconds()===+v.slice(17,19)?t:null;
}
function nativeUrl(value,platform){
  try{
    const u=new URL(value),h=hosts[platform];
    if(u.protocol!=="https:"||u.username||u.password||u.port||(u.hostname!==h&&!u.hostname.endsWith("."+h)))return null;
    // A homepage/profile/login link is not a native post permalink.
    // Pilot allowlist is intentionally narrow; unknown formats require review.
    const p=u.pathname;
    const valid=platform==="instagram"?/^\/(?:p|reel|tv)\/[A-Za-z0-9_-]{3,32}\/?$/.test(p):
      platform==="facebook"?/^\/[0-9]{5,25}\/posts\/[0-9]{5,25}\/?$/.test(p):
      platform==="tiktok"?/^\/@[A-Za-z0-9._-]{2,24}\/video\/[0-9]{12,25}\/?$/.test(p):false;
    // Strip tracking parameters and fragments from the canonical evidence link.
    return valid?u.origin+p:null;
  }catch{return null;}
}
function id(v){return typeof v==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9_.|:-]{1,127}$/.test(v);}
export function projectBufferContentObservation(post,scope){
  if(!post||!scope||scope.product!=="content"||!id(scope.tenantId)||!id(scope.instanceId)||!id(scope.contentId)||!id(post.id))throw Error("INVALID_TRUSTED_SCOPE");
  if(!Object.hasOwn(hosts,scope.channelService)||post.channelService!==scope.channelService||post.channelId!==scope.channelId)throw Error("CHANNEL_SCOPE_MISMATCH");
  if(!["draft","needs_approval","scheduled","sending","sent","error"].includes(post.status))throw Error("INVALID_PROVIDER_STATUS");
  if(!Number.isSafeInteger(scope.expectedAssetCount)||scope.expectedAssetCount<1||scope.expectedAssetCount>20)throw Error("INVALID_ASSET_EXPECTATION");
  const flags=[],assets=Array.isArray(post.assets)?post.assets:[];
  if(assets.length!==scope.expectedAssetCount||assets.some(a=>!a||!["image","video"].includes(a.type)||typeof a.source!=="string"||!a.source.startsWith("https://")))flags.push("ASSET_EVIDENCE_MISMATCH");
  if(/ilustrasi\s+AI|imej\s+AI|AI.generated|generated\s+by\s+AI/i.test(post.text||"")&&post.metadata?.isAiGenerated===false&&["tiktok","instagram"].includes(scope.channelService))flags.push("AI_DISCLOSURE_MISMATCH");
  const common={schemaVersion:1,tenantId:scope.tenantId,product:"content",instanceId:scope.instanceId,contentId:scope.contentId,postId:post.id,channelService:scope.channelService,channelId:post.channelId,format:assets.length&&assets.every(a=>a?.type==='image')?'image':assets.length&&assets.every(a=>a?.type==='video')?'video':'mixed',assetCount:assets.length,providerAttestedByModule:false};
  if(post.status!=="sent")return {...common,status:"NOT_SENT",sentAt:null,nativeUrl:null,metricsUpdatedAt:null,metrics:null,flags};
  const sent=utc(post.sentAt),url=nativeUrl(post.externalLink,scope.channelService);
  if(sent===null||url===null)flags.push("SENT_EVIDENCE_INCOMPLETE");
  const metrics=Object.fromEntries(counts.map(k=>[k,null])),updated=utc(post.metricsUpdatedAt);
  if(post.metricsUpdatedAt!=null&&updated===null)flags.push("INVALID_METRIC_TIMESTAMP");
  if(updated!==null&&sent!==null&&updated<sent)flags.push("METRICS_PRECEDE_SENT");
  // Optional trusted server fetch-time bound; this module cannot attest origin.
  if(scope.asOf!==undefined){
    const asOf=utc(scope.asOf);
    if(asOf===null)throw Error("INVALID_TRUSTED_OBSERVATION_TIME");
    if(sent!==null&&sent>asOf)flags.push("SENT_IN_FUTURE");
    if(updated!==null&&updated>asOf)flags.push("METRICS_IN_FUTURE");
  }
  if(updated!==null&&sent!==null&&updated>=sent&&!Array.isArray(post.metrics))flags.push("METRICS_UNAVAILABLE");
  if(updated!==null&&sent!==null&&updated>=sent&&Array.isArray(post.metrics)){
    const seen=new Set();
    for(const row of post.metrics){
      if(!row||!counts.includes(row.type))continue;
      if(seen.has(row.type)){flags.push("DUPLICATE_METRIC_TYPE");metrics[row.type]=null;continue;}
      seen.add(row.type);
      if(row.unit!=="count"||!Number.isSafeInteger(row.value)||row.value<0){flags.push("INVALID_METRIC_VALUE");continue;}
      metrics[row.type]=row.value;
    }
  }
  if(updated!==null&&sent!==null&&updated>=sent&&Array.isArray(post.metrics)&&!Object.values(metrics).some(Number.isSafeInteger))flags.push("METRICS_UNAVAILABLE");
  const blocked=flags.some(f=>f!=="METRICS_UNAVAILABLE");
  return {...common,status:blocked?"REVIEW_REQUIRED":(updated===null||flags.includes("METRICS_UNAVAILABLE"))?"SENT_UNMEASURED":"MEASURED",sentAt:post.sentAt??null,nativeUrl:url,metricsUpdatedAt:post.metricsUpdatedAt??null,measurementAgeSeconds:updated!==null&&sent!==null&&updated>=sent?Math.floor((updated-sent)/1000):null,metrics,flags};
}
// Advisory only: cumulative metrics require comparable post-age windows and formats.
export function proposeContentNextStep(items){
  if(!Array.isArray(items)||items.length===0)return {status:"PROPOSED",executionAllowed:false,reason:"NO_OBSERVATIONS"};
  const first=items[0],seen=new Set();
  for(const x of items){
    if(!x||x.product!=="content"||x.tenantId!==first.tenantId||x.instanceId!==first.instanceId)throw Error("CROSS_SCOPE_OBSERVATION");
    if(seen.has(x.postId))throw Error("DUPLICATE_POST");
    seen.add(x.postId);
  }
  const measured=items.filter(x=>x.status==="MEASURED");
  const sameChannel=measured.some((a,i)=>measured.slice(i+1).some(b=>a.channelService===b.channelService));
  const comparable=measured.some((a,i)=>measured.slice(i+1).some(b=>
    a.channelService===b.channelService&&a.channelId===b.channelId&&a.format===b.format&&a.assetCount===b.assetCount&&
    Number.isSafeInteger(a.measurementAgeSeconds)&&Number.isSafeInteger(b.measurementAgeSeconds)&&
    Math.abs(a.measurementAgeSeconds-b.measurementAgeSeconds)<=3600&&
    counts.some(k=>Number.isSafeInteger(a.metrics?.[k])&&Number.isSafeInteger(b.metrics?.[k]))
  ));
  const reason=items.some(x=>x.flags?.includes("AI_DISCLOSURE_MISMATCH"))?"AI_DISCLOSURE_REVIEW":
    items.some(x=>x.status==="REVIEW_REQUIRED")?"EVIDENCE_QA_REVIEW":
    measured.length<2?"INSUFFICIENT_MEASURED_POSTS":
    !sameChannel?"NO_SAME_CHANNEL_PAIR":
    !comparable?"NONCOMPARABLE_MEASUREMENT_WINDOWS_OR_FORMAT":"SAME_CHANNEL_CANDIDATES";
  return {status:"PROPOSED",executionAllowed:false,reason,causalLiftProven:false};
}
