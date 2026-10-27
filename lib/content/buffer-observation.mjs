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
export function nativeUrl(value,platform){
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
// CONTENT_DRIVE_SOURCE_REFERENCE_EQUIVALENCE_20261028
// Google Drive /uc download query order is not part of source-file identity.
// Only canonicalise an exact, parameter-allowlisted Drive download reference;
// other hosts and extra parameters retain exact-string comparison (review hold).
function canonicalAssetSourceRef(value){
  if(!validAssetUrl(value))return null;
  try{
    const u=new URL(value);
    if(u.hostname!=="drive.google.com")return value;
    const keys=[...u.searchParams.keys()];
    const fileId=u.searchParams.get("id");
    const validId=typeof fileId==="string"&&/^[A-Za-z0-9_-]{10,128}$/.test(fileId);
    if(u.pathname==="/uc"&&keys.length===2&&
       keys.includes("id")&&keys.includes("export")&&
       u.searchParams.get("export")==="download"&&validId)
      return "gdrive-file:"+fileId;
    // CONTENT_DRIVE_VIEW_DOWNLOAD_ALIAS_GATE_20261028
    // Exact Drive file-view/preview and open links identify the same file as
    // the download URL. Reject query-bearing/unknown variants from equivalence.
    if(u.pathname==="/open"&&keys.length===1&&keys[0]==="id"&&validId)
      return "gdrive-file:"+fileId;
    const view=/^\/file\/d\/([A-Za-z0-9_-]{10,128})\/(?:view|preview)\/?$/.exec(u.pathname);
    if(view&&keys.length===0)return "gdrive-file:"+view[1];
    return value;
  }catch{return null;}
}
export function projectBufferContentObservation(post,scope){
  if(!post||!scope||scope.product!=="content"||!id(scope.tenantId)||!id(scope.instanceId)||!id(scope.contentId)||!id(scope.channelId)||!id(post.id))throw Error("INVALID_TRUSTED_SCOPE");
  if(!Object.hasOwn(hosts,scope.channelService)||post.channelService!==scope.channelService||post.channelId!==scope.channelId)throw Error("CHANNEL_SCOPE_MISMATCH");
  if(!["draft","needs_approval","scheduled","sending","sent","error"].includes(post.status))throw Error("INVALID_PROVIDER_STATUS");
  if(!Number.isSafeInteger(scope.expectedAssetCount)||scope.expectedAssetCount<1||scope.expectedAssetCount>20)throw Error("INVALID_ASSET_EXPECTATION");
  const flags=[],assets=Array.isArray(post.assets)?post.assets:[];
  if(assets.length!==scope.expectedAssetCount||assets.some(a=>!a||!["image","video"].includes(a.type)||!validAssetUrl(a.source)))flags.push("ASSET_EVIDENCE_MISMATCH");
  // Distinct asset count alone does not prove distinct media: two carousel
  // slots can point to the same source or reuse one provider asset identity.
  // This is a review hold, NOT an independent byte or pixel identity check.
  const sources=assets.filter(a=>a&&typeof a.source==="string").map(a=>canonicalAssetSourceRef(a.source));
  if(new Set(sources).size!==sources.length)flags.push("DUPLICATE_ASSET_SOURCE");
  const providerIds=assets.map(a=>a?.id).filter(x=>typeof x==="string"&&x.length>0);
  if(new Set(providerIds).size!==providerIds.length)flags.push("DUPLICATE_PROVIDER_ASSET_ID");
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
// CONTENT_MEASURED_NEXT_STEP_PROVENANCE_GUARD_20261027_1350
// A caller can submit provider-shaped objects directly; never treat a forged
// MEASURED label as comparable performance evidence. This is still NOT provider
// authentication, approval or learning attestation.
function validMeasuredNextStepEvidence(x){
  const sent=utc(x.sentAt),updated=utc(x.metricsUpdatedAt);
  return x.providerAttestedByModule===false&&
    Array.isArray(x.flags)&&x.flags.length===0&&
    ["image","video","mixed"].includes(x.format)&&
    Number.isSafeInteger(x.assetCount)&&x.assetCount>=1&&x.assetCount<=20&&
    typeof x.nativeUrl==="string"&&nativeUrl(x.nativeUrl,x.channelService)===x.nativeUrl&&
    sent!==null&&updated!==null&&updated>=sent&&
    x.measurementAgeSeconds===Math.floor((updated-sent)/1000)&&
    x.metrics&&typeof x.metrics==="object"&&!Array.isArray(x.metrics)&&
    Object.keys(x.metrics).length===counts.length&&
    counts.every(k=>Object.hasOwn(x.metrics,k)&&
      (x.metrics[k]===null||(Number.isSafeInteger(x.metrics[k])&&x.metrics[k]>=0)))&&
    counts.some(k=>x.metrics[k]!==null);
}
// Advisory only: cumulative metrics require comparable post-age windows and formats.
export function proposeContentNextStep(items){
  if(!Array.isArray(items)||items.length===0)return {status:"PROPOSED",executionAllowed:false,reason:"NO_OBSERVATIONS"};
  const first=items[0],seen=new Set();
  if(!first||!id(first.tenantId)||!id(first.instanceId))throw Error("INVALID_NEXT_STEP_SCOPE");
  for(const x of items){
    if(!x||x.product!=="content"||x.tenantId!==first.tenantId||x.instanceId!==first.instanceId)throw Error("CROSS_SCOPE_OBSERVATION");
    if(!id(x.postId))throw Error("INVALID_NEXT_STEP_POST_ID");
    if(x.status==="MEASURED"&&!validMeasuredNextStepEvidence(x))throw Error("INVALID_MEASURED_NEXT_STEP_EVIDENCE");
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
  // PNG decoded-pixel QA and JPEG marker-only QA are different assurance levels.
  // This function accepts externally supplied QA summaries but NEVER revalidates
  // bytes, authenticates Buffer or promotes JPEG structure into pixel integrity.
  const png=sourceQa?.status==="SOURCE_BYTES_STRUCTURALLY_VERIFIED"&&
    sourceQa.distinctPixelHashes===true;
  const jpeg=sourceQa?.status==="JPEG_SOURCE_STRUCTURE_VERIFIED_ONLY"&&
    sourceQa.distinctPixelHashesVerified===false&&
    sourceQa.visualDistinctnessVerified===false&&
    sourceQa.approvalVerified===false&&sourceQa.publishedVerified===false;
  if(!sourceQa||(!png&&!jpeg)||sourceQa.distinctFileHashes!==true||
     !Array.isArray(sourceQa.images)||sourceQa.images.length<1||
     sourceQa.images.length>20||
     sourceQa.images.some(x=>!x||
       !Number.isSafeInteger(x.width)||x.width<1||
       !Number.isSafeInteger(x.height)||x.height<1||
       !Number.isSafeInteger(x.bytes)||x.bytes<1||
       !/^[a-f0-9]{64}$/.test(x.sha256||"")||
       (png?(x.format!=="PNG"||
         x.structuralIntegrity!=="CRC_AND_DEFLATE_VALID"||
         !/^[a-f0-9]{64}$/.test(x.pixelSha256||"")):
         (x.format!=="JPEG"||
         x.structuralIntegrity!=="JPEG_MARKER_BOUNDS_ONLY"||
         x.decodedPixelIntegrityVerified!==false||
         x.providerByteIdentityVerified!==false||
         x.approvalVerified!==false||
         Object.hasOwn(x,"pixelSha256"))))||
     new Set(sourceQa.images.map(x=>x.sha256)).size!==sourceQa.images.length||
     (png&&new Set(sourceQa.images.map(x=>x.pixelSha256)).size!==sourceQa.images.length))
    throw Error("INVALID_SOURCE_QA_EVIDENCE");
  if(!Array.isArray(sourceUrls)||sourceUrls.length!==sourceQa.images.length||
     sourceUrls.some(u=>!validAssetUrl(u))||
     // One source URL cannot attest two distinct original image byte streams.
     // Reject ambiguous many-to-one media lineage before comparing SENT assets.
     new Set(sourceUrls.map(canonicalAssetSourceRef)).size!==sourceUrls.length)
    throw Error("INVALID_SOURCE_REFERENCE_MANIFEST");
  const flags=[...observation.flags];
  // JPEG marker integrity alone is insufficient for decoded pixels or visual
  // uniqueness. Always require review even when source references match.
  if(jpeg)flags.push("JPEG_PIXEL_DECODE_NOT_ATTESTED");
  const assets=Array.isArray(post.assets)?post.assets:[];
  if(assets.length!==sourceUrls.length)flags.push("SOURCE_ASSET_COUNT_MISMATCH");
  for(let i=0;i<sourceUrls.length;i++){
    if(assets[i]?.type!=="image"||canonicalAssetSourceRef(assets[i]?.source)!==canonicalAssetSourceRef(sourceUrls[i]))
      flags.push("SOURCE_PROVIDER_REFERENCE_MISMATCH");
    // A provider JPEG with original PNG is not proof of corruption or equivalence:
    // platform-side transcoding may be legitimate, but bytes remain unverified.
    if(png&&assets[i]?.mimeType!=="image/png")
      flags.push("PROVIDER_MEDIA_FORMAT_NOT_SOURCE_PNG");
    if(jpeg&&assets[i]?.mimeType!=="image/jpeg")
      flags.push("PROVIDER_MEDIA_FORMAT_NOT_SOURCE_JPEG");
  }
  const uniqueFlags=[...new Set(flags)];
  return Object.freeze({
    schemaVersion:1,tenantId:observation.tenantId,instanceId:observation.instanceId,
    contentId:observation.contentId,postId:observation.postId,
    status:observation.status==="NOT_SENT"?"NOT_SENT":
      uniqueFlags.length||observation.status==="REVIEW_REQUIRED"?"REVIEW_REQUIRED":
      "SOURCE_REFERENCES_MATCHED_UNATTESTED",
    flags:uniqueFlags,sourceFileSha256:sourceQa.images.map(x=>x.sha256),
    sourcePixelSha256:sourceQa.images.map(x=>png?x.pixelSha256:null),
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
  // Provider-snapshot identity: repeated reads reuse the ID even if collectedAt changes.
  // Changed provider metrics, snapshot timestamp or native permalink create a new ID.
  // Collection time remains in provenance, not the idempotency key. Null != zero.
  const snapshot=JSON.stringify([1,s.tenantId,s.instanceId,s.contentId,
    o.postId,s.channelService,s.channelId,o.format,o.assetCount,o.status,
    // Canonical UTC instants prevent Z vs .000Z from creating duplicate BCI evidence.
    // Preserve original provider timestamp strings in provenance for inspection.
    o.nativeUrl,sent,updated,counts.map(k=>metrics[k])]);
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


// CONTENT_APPROVAL_BINDING_CANDIDATE_20261027_0748
// Classification only. Caller-supplied records and digests are NOT authenticated approvals.
// Never use this output to authorize publishing or grant a provider/BCI attestation.
export function classifyContentApprovalProvenance(record, trustedScope, sourceManifest){
  const s=trustedScope,m=sourceManifest;
  const digest=x=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
  if(!s||s.product!=="content"||![s.tenantId,s.instanceId,s.contentId,
      s.contentVersionId,s.channelId].every(id)||
    !m||!digest(m.contentSha256)||!Array.isArray(m.assetSha256)||
    m.assetSha256.length<1||m.assetSha256.length>20||
    !m.assetSha256.every(digest)||new Set(m.assetSha256).size!==m.assetSha256.length)
    throw Error("INVALID_CONTENT_APPROVAL_BINDING_SCOPE");
  const base={schemaVersion:1,tenantId:s.tenantId,instanceId:s.instanceId,
    contentId:s.contentId,contentVersionId:s.contentVersionId,channelId:s.channelId,
    approvalVerified:false,executionAllowed:false,providerAttested:false};
  if(record===null||record===undefined)
    return Object.freeze({...base,status:"NO_APPROVAL_EVENT",reason:"AUTHENTICATED_APPROVAL_EVENT_MISSING"});
  if(!record||typeof record!=="object"||Array.isArray(record))
    throw Error("INVALID_CONTENT_APPROVAL_RECORD");
  if(record.authorityType==="owner_conditional_policy"){
    // Existing BROS SELL owner policy is NOT content/version/media-bound approval.
    return Object.freeze({...base,status:"POLICY_ONLY",reason:"CONDITIONAL_POLICY_NOT_CONTENT_APPROVAL"});
  }
  const keys=["schemaVersion","authorityType","eventId","decision","reviewerPrincipalId",
    "tenantId","instanceId","contentId","contentVersionId","channelId",
    "contentSha256","assetSha256","approvedAt","recordedAt","auditRef"];
  if(Object.keys(record).length!==keys.length||
    Object.keys(record).some(k=>!keys.includes(k))||
    record.schemaVersion!==1||record.authorityType!=="content_specific"||
    record.decision!=="approved"||!id(record.eventId)||!id(record.reviewerPrincipalId)||
    !id(record.auditRef)||!Array.isArray(record.assetSha256)||
    record.assetSha256.length!==m.assetSha256.length||
    record.assetSha256.some((x,i)=>x!==m.assetSha256[i])||
    record.contentSha256!==m.contentSha256)
    throw Error("INVALID_CONTENT_APPROVAL_RECORD");
  for(const k of ["tenantId","instanceId","contentId","contentVersionId","channelId"])
    if(record[k]!==s[k])throw Error("CONTENT_APPROVAL_SCOPE_MISMATCH");
  const approved=utc(record.approvedAt),recorded=utc(record.recordedAt);
  if(approved===null||recorded===null||recorded<approved)
    throw Error("INVALID_CONTENT_APPROVAL_TIMELINE");
  if(s.asOf!==undefined){
    const asOf=utc(s.asOf);
    if(asOf===null||approved>asOf||recorded>asOf)
      throw Error("INVALID_CONTENT_APPROVAL_TIMELINE");
  }
  const stable=JSON.stringify([1,s.tenantId,s.instanceId,s.contentId,
    s.contentVersionId,s.channelId,record.eventId,record.reviewerPrincipalId,
    // Approval event identity is an instant, not a textual UTC precision variant.
    // Keep provider-authentication/approval flags false; this is candidate-only.
    record.auditRef,approved,recorded,m.contentSha256,m.assetSha256]);
  return Object.freeze({...base,status:"CONTENT_BOUND_CANDIDATE_UNATTESTED",
    candidateId:"content-approval-"+createHash("sha256").update(stable).digest("hex"),
    reason:"SERVER_AUTHENTICATED_APPROVAL_ATTESTATION_REQUIRED"});
}


// CONTENT_BUFFER_LIST_DETAIL_HYDRATION_GATE_20261027_1200
// Buffer list_posts can omit native permalink, disclosure metadata and metrics.
// A matching get_post detail is required before the CONTENT observation projection.
// Pure contract only: this does not fetch/authenticate Buffer or authorize publishing.
export function reconcileBufferListAndDetail(summary,detail,scope){
  if(!summary||!detail||typeof summary!=="object"||typeof detail!=="object"||
     Array.isArray(summary)||Array.isArray(detail)||!scope||scope.product!=="content")
    throw Error("INVALID_BUFFER_DETAIL_HANDOFF");
  for(const field of ["id","channelId","channelService","status","sentAt"]){
    if(typeof summary[field]!=="string"||!summary[field]||summary[field]!==detail[field])
      throw Error("BUFFER_LIST_DETAIL_IDENTITY_DRIFT");
  }
  if(summary.dueAt!=null&&summary.dueAt!==detail.dueAt)
    throw Error("BUFFER_LIST_DETAIL_IDENTITY_DRIFT");
  if(typeof summary.text!=="string"||summary.text!==detail.text)
    throw Error("BUFFER_LIST_DETAIL_CONTENT_DRIFT");
  if(summary.externalLink!=null&&summary.externalLink!==detail.externalLink)
    throw Error("BUFFER_LIST_DETAIL_PERMALINK_DRIFT");
  if(!Array.isArray(summary.assets)||!Array.isArray(detail.assets)||
     summary.assets.length!==detail.assets.length||
     summary.assets.some((asset,index)=>{
       const actual=detail.assets[index];
       return !asset||!actual||asset.type!==actual.type||
         asset.source!==actual.source||asset.mimeType!==actual.mimeType||
         (asset.id!=null&&asset.id!==actual.id);
     }))throw Error("BUFFER_LIST_DETAIL_ASSET_DRIFT");
  // CONTENT_BUFFER_DETAIL_METRIC_MONOTONICITY_20261027_V1
  // A list snapshot can report a newer provider metric revision than get_post.
  // In that case the detailed post is stale: never silently downgrade a measured
  // SENT observation or treat the older detail as the current provider state.
  // This compares provider-shaped timestamps only; it is NOT provider attestation.
  if(summary.status==="sent"&&summary.metricsUpdatedAt!=null){
    const listMetricsTime=utc(summary.metricsUpdatedAt);
    const detailMetricsTime=utc(detail.metricsUpdatedAt);
    if(listMetricsTime===null)throw Error("BUFFER_LIST_METRIC_TIMESTAMP_INVALID");
    if(detailMetricsTime===null||detailMetricsTime<listMetricsTime)
      throw Error("BUFFER_DETAIL_METRICS_STALE");
  }
  // CONTENT_BUFFER_EQUIVALENT_UTC_METRIC_REVISION_20261027_V1
  // Compare parsed UTC instants, not textual timestamp spelling: 'Z' and
  // '.000Z' can denote the same revision. Never bypass disagreement checks.
  // CONTENT_BUFFER_SAME_REVISION_METRIC_CONSISTENCY_20261027_V1
  // When list_posts and get_post claim the same provider metric revision,
  // conflicting overlapping count values are ambiguous. Fail closed rather
  // than silently selecting a convenient value. A partial list is allowed;
  // absent list metrics do not imply zero. Older list revisions remain stale.
  // This is shape consistency only, NOT authenticated provider evidence.
  if(summary.status==="sent"&&summary.metricsUpdatedAt!=null&&
     utc(summary.metricsUpdatedAt)===utc(detail.metricsUpdatedAt)&&
     Array.isArray(summary.metrics)){
    const detailCounts=new Map();
    if(Array.isArray(detail.metrics)){
      for(const row of detail.metrics){
        if(!row||!counts.includes(row.type))continue;
        if(detailCounts.has(row.type))throw Error("BUFFER_DETAIL_METRIC_CONFLICT");
        detailCounts.set(row.type,row);
      }
    }
    const listSeen=new Set();
    for(const row of summary.metrics){
      if(!row||!counts.includes(row.type))continue;
      if(listSeen.has(row.type)||row.unit!=="count"||
         !Number.isSafeInteger(row.value)||row.value<0)
        throw Error("BUFFER_LIST_METRIC_CONFLICT");
      listSeen.add(row.type);
      const detailRow=detailCounts.get(row.type);
      if(!detailRow||detailRow.unit!=="count"||
         !Number.isSafeInteger(detailRow.value)||detailRow.value!==row.value)
        throw Error("BUFFER_LIST_DETAIL_METRIC_CONFLICT");
    }
  }
  // Never substitute stale list metrics for detail metrics; the detailed post
  // is still provider-shaped, not authenticated or independently attested.
  const observation=projectBufferContentObservation(detail,scope);
  return Object.freeze({schemaVersion:1,postId:detail.id,
    status:observation.status,detailFetched:true,listOnlySufficient:false,
    providerAttestedByModule:false,approvalVerified:false,executionAllowed:false,
    observation});
}
