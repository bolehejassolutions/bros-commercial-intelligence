import {createHash} from "node:crypto";
// CONTENT-only universal instance configuration + plan candidate.
// Pure draft contract: no identity/provider authentication, media generation,
// publication permission, shared BCI storage, or tenant-safe SaaS attestation.
const services=new Set(["facebook","instagram","tiktok"]);
const sha=x=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
function object(value,keys,label){
  if(!value||typeof value!=="object"||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw Error("INVALID_"+label);
  const own=Reflect.ownKeys(value);
  if(own.length!==keys.length||own.some(k=>typeof k!=="string"||!keys.includes(k)))
    throw Error("INVALID_"+label+"_FIELDS");
}
function identifier(value,label){
  if(typeof value!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_.|:-]{1,127}$/.test(value))
    throw Error("INVALID_"+label);
  return value;
}
function words(value,label,max=400){
  if(typeof value!=="string"||value!==value.trim()||value.length<2||
    value.length>max||/[\u0000-\u001f\u007f]/.test(value))
    throw Error("INVALID_"+label);
  return value;
}
function array(value,label,min,max,normalize){
  if(!Array.isArray(value)||value.length<min||value.length>max||
    Reflect.ownKeys(value).length!==value.length+1||
    !Array.from({length:value.length},(_,i)=>i).every(i=>Object.hasOwn(value,i)))
    throw Error("INVALID_"+label);
  const items=value.map(normalize);
  const keys=items.map(x=>typeof x==="string"?x:JSON.stringify(x));
  if(new Set(keys).size!==keys.length)throw Error("DUPLICATE_"+label);
  return items.sort((a,b)=>(typeof a==="string"?a:JSON.stringify(a))
    .localeCompare(typeof b==="string"?b:JSON.stringify(b)));
}
export function normalizeContentInstanceConfig(input){
  object(input,["schemaVersion","product","tenantId","instanceId","brand",
    "audience","goals","channels","policy"],"CONTENT_CONFIG");
  if(input.schemaVersion!==1||input.product!=="content")throw Error("INVALID_CONTENT_CONFIG_VERSION");
  object(input.brand,["displayName","voice","locale","claimCandidates","blockedClaims"],"CONTENT_BRAND");
  object(input.audience,["segment","needs"],"CONTENT_AUDIENCE");
  object(input.policy,["requiresContentApproval","requiresIndependentMediaQa",
    "requiresEvidenceForClaims"],"CONTENT_POLICY");
  if(input.policy.requiresContentApproval!==true||
    input.policy.requiresIndependentMediaQa!==true||
    input.policy.requiresEvidenceForClaims!==true)
    throw Error("CONTENT_SAFETY_POLICY_REQUIRED");
  const locale=words(input.brand.locale,"CONTENT_LOCALE",35);
  if(!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(locale))
    throw Error("INVALID_CONTENT_LOCALE");
  const channels=array(input.channels,"CONTENT_CHANNELS",1,10,x=>{
    object(x,["service","channelId"],"CONTENT_CHANNEL");
    if(typeof x.service!=="string"||!services.has(x.service))
      throw Error("UNSUPPORTED_CONTENT_CHANNEL");
    return {service:x.service,channelId:identifier(x.channelId,"CONTENT_CHANNEL_ID")};
  });
  const canonical={
    schemaVersion:1,product:"content",
    tenantId:identifier(input.tenantId,"CONTENT_TENANT_ID"),
    instanceId:identifier(input.instanceId,"CONTENT_INSTANCE_ID"),
    brand:{
      displayName:words(input.brand.displayName,"CONTENT_BRAND_NAME",120),
      voice:words(input.brand.voice,"CONTENT_VOICE"),
      locale,
      claimCandidates:array(input.brand.claimCandidates,"CONTENT_CLAIMS",0,30,x=>words(x,"CONTENT_CLAIM")),
      blockedClaims:array(input.brand.blockedClaims,"CONTENT_BLOCKED_CLAIMS",0,30,x=>words(x,"CONTENT_BLOCKED_CLAIM"))
    },
    audience:{
      segment:words(input.audience.segment,"CONTENT_SEGMENT"),
      needs:array(input.audience.needs,"CONTENT_NEEDS",1,20,x=>words(x,"CONTENT_NEED"))
    },
    goals:array(input.goals,"CONTENT_GOALS",1,15,x=>words(x,"CONTENT_GOAL")),
    channels,
    policy:{requiresContentApproval:true,requiresIndependentMediaQa:true,
      requiresEvidenceForClaims:true}
  };
  return Object.freeze({schemaVersion:1,product:"content",tenantId:canonical.tenantId,
    instanceId:canonical.instanceId,configSha256:sha(canonical),
    config:structuredClone(canonical),configAuthenticated:false,
    claimEvidenceVerified:false,providerCapabilityVerified:false,
    customerSaasReady:false});
}
export function planContentJobCandidate(instanceConfig,brief){
  const instance=normalizeContentInstanceConfig(instanceConfig);
  object(brief,["briefId","revisionId","channelService","channelId","format",
    "assetCount","topic","hypothesis","hook","measurementQuestion"],"CONTENT_BRIEF");
  const service=brief.channelService;
  if(typeof service!=="string"||!services.has(service)||
    !instance.config.channels.some(x=>x.service===service&&x.channelId===brief.channelId))
    throw Error("CONTENT_CHANNEL_NOT_CONFIGURED");
  if(!["single_image","carousel"].includes(brief.format)||
    !Number.isSafeInteger(brief.assetCount)||
    (brief.format==="single_image"&&brief.assetCount!==1)||
    (brief.format==="carousel"&&(brief.assetCount<2||brief.assetCount>20)))
    throw Error("INVALID_CONTENT_MEDIA_PLAN");
  const job={
    briefId:identifier(brief.briefId,"CONTENT_BRIEF_ID"),
    revisionId:identifier(brief.revisionId,"CONTENT_REVISION_ID"),
    channelService:service,
    channelId:identifier(brief.channelId,"CONTENT_CHANNEL_ID"),
    format:brief.format,assetCount:brief.assetCount,
    topic:words(brief.topic,"CONTENT_TOPIC"),
    hypothesis:words(brief.hypothesis,"CONTENT_HYPOTHESIS"),
    hook:words(brief.hook,"CONTENT_HOOK"),
    measurementQuestion:words(brief.measurementQuestion,"CONTENT_MEASUREMENT_QUESTION")
  };
  const planId="content-plan-"+sha([1,instance.tenantId,instance.instanceId,
    instance.configSha256,job]);
  return Object.freeze({schemaVersion:1,product:"content",tenantId:instance.tenantId,
    instanceId:instance.instanceId,instanceConfigSha256:instance.configSha256,
    planId,brief:structuredClone(job),status:"PLANNED_ONLY",
    independentImagesRequired:job.assetCount,sourceBytesVerified:false,
    visualQaVerified:false,claimEvidenceVerified:false,approvalVerified:false,
    providerCapabilityVerified:false,providerSentVerified:false,
    measurementVerified:false,sharedBciAuditVerified:false,
    executionAllowed:false,customerSaasReady:false});
}
