import {createHash} from "node:crypto";
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
    if(u.protocol!=="https:"||u.username||u.password||u.port||![h,"www."+h].includes(u.hostname))return null;
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
function validAssetUrl(value){
  if(typeof value!=="string")return false;
  try{const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&!u.hash&&Boolean(u.hostname)&&!u.hostname.endsWith(".invalid");}
  catch{return false;}
}
export function projectBufferContentObservation(post,scope){
  if(!post||!scope||scope.product!=="content"||!id(scope.tenantId)||!id(scope.instanceId)||!id(scope.contentId)||!id(scope.channelId)||!id(post.id))throw Error("INVALID_TRUSTED_SCOPE");
  if(!Object.hasOwn(hosts,scope.channelService)||post.channelService!==scope.channelService||post.channelId!==scope.channelId)throw Error("CHANNEL_SCOPE_MISMATCH");
  if(!["draft","needs_approval","scheduled","sending","sent","error"].includes(post.status))throw Error("INVALID_PROVIDER_STATUS");
  if(!Number.isSafeInteger(scope.expectedAssetCount)||scope.expectedAssetCount<1||scope.expectedAssetCount>20)throw Error("INVALID_ASSET_EXPECTATION");
  const flags=[],assets=Array.isArray(post.assets)?post.assets:[];
  if(assets.length!==scope.expectedAssetCount||assets.some(a=>!a||!["image","video"].includes(a.type)||!validAssetUrl(a.source)))flags.push("ASSET_EVIDENCE_MISMATCH");
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
  // Deterministic evidence-linked proposal only; caller must authenticate Buffer separately.
  // Cumulative metrics are not causal evidence or a cross-channel winner.
  const evidence=measured.map(x=>({
    postId:x.postId,nativeUrl:x.nativeUrl,metricsUpdatedAt:x.metricsUpdatedAt,
    measurementAgeSeconds:x.measurementAgeSeconds,views:x.metrics?.views??null,
    reach:x.metrics?.reach??null,providerAttestedByModule:false
  })).sort((a,b)=>a.postId.localeCompare(b.postId));
  const nextAction=reason==="AI_DISCLOSURE_REVIEW"?"REVIEW_AI_DISCLOSURE":
    reason==="EVIDENCE_QA_REVIEW"?"REVIEW_PROVIDER_EVIDENCE":
    reason==="SAME_CHANNEL_CANDIDATES"?"REVIEW_COMPARABLE_POSTS":
    "COLLECT_COMPARABLE_SAME_CHANNEL_MEASUREMENT";
  return {status:"PROPOSED",executionAllowed:false,reason,causalLiftProven:false,
    evidenceStatus:"UNATTESTED_PROVIDER_PROJECTION",evidence,nextAction};
}


// CONTENT_SOURCE_TO_SENT_REFERENCE_GATE_20261027_0250: pure cross-check only; provider and source identities require independent authentication.
// Source QA is an externally supplied result of verifyDistinctPngSources; this function
// does NOT fetch or decode media bytes, attest Buffer, or grant publication approval.
export function inspectContentSourceToSentReferences(post,scope,sourceQa,sourceUrls){
  const observation=projectBufferContentObservation(post,scope);
  if(!sourceQa||sourceQa.status!=="SOURCE_BYTES_STRUCTURALLY_VERIFIED"||
     sourceQa.distinctFileHashes!==true||sourceQa.distinctPixelHashes!==true||
     !Array.isArray(sourceQa.images)||sourceQa.images.length<2||
     sourceQa.images.length>20||
     sourceQa.images.some(x=>!x||x.format!=="PNG"||
       x.structuralIntegrity!=="CRC_AND_DEFLATE_VALID"||
       !Number.isSafeInteger(x.width)||x.width<1||
       !Number.isSafeInteger(x.height)||x.height<1||
       !Number.isSafeInteger(x.bytes)||x.bytes<1||
       !/^[a-f0-9]{64}$/.test(x.sha256||"")||
       !/^[a-f0-9]{64}$/.test(x.pixelSha256||"")))
    throw Error("INVALID_SOURCE_QA_EVIDENCE");
  if(!Array.isArray(sourceUrls)||sourceUrls.length!==sourceQa.images.length||
     sourceUrls.some(u=>!validAssetUrl(u)))throw Error("INVALID_SOURCE_REFERENCE_MANIFEST");
  const flags=[...observation.flags];
  const assets=Array.isArray(post.assets)?post.assets:[];
  if(assets.length!==sourceUrls.length)flags.push("SOURCE_ASSET_COUNT_MISMATCH");
  for(let i=0;i<sourceUrls.length;i++){
    if(assets[i]?.type!=="image"||assets[i]?.source!==sourceUrls[i])
      flags.push("SOURCE_PROVIDER_REFERENCE_MISMATCH");
    // A provider JPEG with original PNG is not proof of corruption or equivalence:
    // platform-side transcoding may be legitimate, but bytes remain unverified.
    if(assets[i]?.mimeType!=="image/png")
      flags.push("PROVIDER_MEDIA_FORMAT_NOT_SOURCE_PNG");
  }
  const uniqueFlags=[...new Set(flags)];
  return Object.freeze({
    schemaVersion:1,tenantId:observation.tenantId,instanceId:observation.instanceId,
    contentId:observation.contentId,postId:observation.postId,
    status:observation.status==="NOT_SENT"?"NOT_SENT":
      uniqueFlags.length||observation.status==="REVIEW_REQUIRED"?"REVIEW_REQUIRED":
      "SOURCE_REFERENCES_MATCHED_UNATTESTED",
    flags:uniqueFlags,sourceFileSha256:sourceQa.images.map(x=>x.sha256),
    sourcePixelSha256:sourceQa.images.map(x=>x.pixelSha256),
    sourceBytesRevalidatedByModule:false,providerAttestedByModule:false,
    providerByteIdentityVerified:false,approvalVerified:false,
    executionAllowed:false
  });
}


// CONTENT_BCI_HANDOFF_V1_20261027: product-scoped, untrusted observation -> private BCI evidence contract.
// The caller must authenticate the principal, derive trustedScope server-side, and fetch
// the Buffer post with an independently authorised server credential. This pure function
// DOES NOT attest the provider, grant publication approval, or write the shared BCI audit.
export function buildContentBciEvidenceHandoff(observation,trustedScope,collectedAt){
  const o=observation,s=trustedScope;
  if(!o||!s||s.product!=="content"||o.product!=="content"||
    ![s.tenantId,s.instanceId,s.contentId,s.channelId,o.postId].every(id)||
    !Object.hasOwn(hosts,s.channelService)||
    o.tenantId!==s.tenantId||o.instanceId!==s.instanceId||
    o.contentId!==s.contentId||o.channelId!==s.channelId||
    o.channelService!==s.channelService||o.schemaVersion!==1||
    o.providerAttestedByModule!==false||
    !["MEASURED","SENT_UNMEASURED"].includes(o.status)||
    !["image","video","mixed"].includes(o.format)||
    !Number.isSafeInteger(o.assetCount)||o.assetCount<1||o.assetCount>20)
    throw Error("INVALID_CONTENT_EVIDENCE_SCOPE");
  const collected=utc(collectedAt),sent=utc(o.sentAt);
  const updated=o.metricsUpdatedAt===null?null:utc(o.metricsUpdatedAt);
  if(collected===null||sent===null||sent>collected||
    (o.metricsUpdatedAt!==null&&updated===null)||
    (updated!==null&&(updated<sent||updated>collected))||
    typeof o.nativeUrl!=="string"||nativeUrl(o.nativeUrl,o.channelService)!==o.nativeUrl)
    throw Error("INVALID_CONTENT_EVIDENCE_PROVENANCE");
  if(!Array.isArray(o.flags)||o.flags.some(f=>f!=="METRICS_UNAVAILABLE")||
    (o.status==="MEASURED"&&o.flags.length!==0)||
    !o.metrics||typeof o.metrics!=="object"||Array.isArray(o.metrics)||
    Object.keys(o.metrics).length!==counts.length||
    counts.some(k=>!Object.hasOwn(o.metrics,k)||
      (o.metrics[k]!==null&&(!Number.isSafeInteger(o.metrics[k])||o.metrics[k]<0))))
    throw Error("INVALID_CONTENT_EVIDENCE_METRICS");
  const measured=counts.some(k=>o.metrics[k]!==null);
  if((o.status==="MEASURED"&&(!measured||updated===null||
      o.measurementAgeSeconds!==Math.floor((updated-sent)/1000)))||
    (o.status==="SENT_UNMEASURED"&&measured))
    throw Error("INVALID_CONTENT_EVIDENCE_STATUS");
  const metrics=Object.fromEntries(counts.map(k=>[k,o.metrics[k]]));
  // Exact snapshot identity: identical replay => same ID; changed metric, timestamp
  // or collection event => different ID. Null and zero remain distinguishable.
  const snapshot=JSON.stringify([1,s.tenantId,s.instanceId,s.contentId,
    o.postId,s.channelService,s.channelId,o.format,o.assetCount,o.status,
    o.sentAt,o.metricsUpdatedAt,collectedAt,counts.map(k=>metrics[k])]);
  const evidenceId="content-buffer-"+createHash("sha256").update(snapshot).digest("hex");
  return Object.freeze({
    schemaVersion:1,tenantId:s.tenantId,product:"content",evidenceId,
    category:"content_post_observation",
    provenance:Object.freeze({
      provider:"buffer",providerObjectId:o.postId,collectedAt,
      observedAt:o.metricsUpdatedAt??o.sentAt,windowStart:o.sentAt,
      windowEnd:o.metricsUpdatedAt,sourceReference:o.nativeUrl,
      completeness:"unverified"
    }),
    metrics:Object.freeze(metrics),
    observedFacts:Object.freeze([
      "Buffer-shaped projection reports SENT; provider authentication is not attested by this module.",
      o.status==="MEASURED"?
        "A post-SENT metric snapshot is present but remains provider-unattested.":
        "No valid measured metric values are available."
    ]),
    unknowns:Object.freeze([
      "PROVIDER_AUTHENTICATION_UNVERIFIED",
      "PUBLICATION_APPROVAL_UNVERIFIED",
      "NATIVE_MEDIA_BYTES_UNVERIFIED",
      "SHARED_BCI_AUDIT_NOT_WRITTEN",
      ...(o.status==="SENT_UNMEASURED"?["MEASUREMENT_UNAVAILABLE"]:[])
    ])
  });
}
