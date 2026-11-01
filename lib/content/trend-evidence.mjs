// BROS CONTENT product-only trend-evidence intake. Pure, nonexecuting and provider-neutral.
// A manually supplied URL/metric is NOT authenticated provider evidence or proof of virality.
// No scraping, publication, paid API calls, BCI writes or tenant authorization occurs here.
import {createHash} from 'node:crypto';
import {planContentJobCandidate, normalizeContentInstanceConfig} from './instance-plan.mjs';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const platforms=new Set(['instagram','tiktok','reddit']);
const metrics=['views','likes','comments','shares','saves'];
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.|:-]{1,127}$/.test(v);
function exact(v,keys,name){
  if(!v||typeof v!=='object'||Array.isArray(v)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(v))||
    Reflect.ownKeys(v).length!==keys.length||
    Reflect.ownKeys(v).some(k=>{
      if(typeof k!=='string'||!keys.includes(k))return true;
      const d=Object.getOwnPropertyDescriptor(v,k);
      return !d?.enumerable||!Object.hasOwn(d,'value');
    }))throw Error('INVALID_TREND_'+name);
}
function utc(s){
  if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s))return null;
  const n=Date.parse(s);
  return Number.isFinite(n)&&new Date(n).toISOString().slice(0,19)===s.slice(0,19)?n:null;
}
function publicationBounds(s){
  // Public indexes may expose only a calendar date without a timezone. Preserve
  // that precision; never invent an instant. Require the full day plus a +/-14h
  // timezone envelope to fit the window and precede observation.
  if(typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)){
    const start=utc(s+'T00:00:00Z');
    return start===null?null:[start-14*3600000,start+86400000+14*3600000-1];
  }
  const instant=utc(s);
  return instant===null?null:[instant,instant];
}
function text(v,name,max=240){
  if(typeof v!=='string'||v!==v.trim()||v.length<3||v.length>max||
    /[\u0000-\u001f\u007f]/u.test(v))throw Error('INVALID_TREND_'+name);
  return v.normalize('NFKC');
}
function sourceLocator(value,platform){
  if(typeof value!=='string'||value.length>350)throw Error('INVALID_TREND_SOURCE_URL');
  let u;try{u=new URL(value);}catch{throw Error('INVALID_TREND_SOURCE_URL');}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash)
    throw Error('INVALID_TREND_SOURCE_URL');
  const host=u.hostname.toLowerCase();
  const path=u.pathname;
  // Syntax/native identity only: no HTTP fetch or source authentication is implied.
  const match=platform==='instagram'
    ? ['instagram.com','www.instagram.com'].includes(host)&&/^\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)\/?$/.exec(path)
    :platform==='tiktok'
    ? ['tiktok.com','www.tiktok.com'].includes(host)&&/^\/@[A-Za-z0-9_.]+\/video\/(\d+)\/?$/.exec(path)
    :['reddit.com','www.reddit.com'].includes(host)&&
      /^\/(?:r\/[A-Za-z0-9_]+\/)?comments\/([A-Za-z0-9]+)(?:\/[A-Za-z0-9_-]+)?\/?$/.exec(path);
  if(!match)throw Error('TREND_PLATFORM_URL_MISMATCH');
  return {url:'https://'+host.replace(/^www\./,'')+path.replace(/\/$/,''),
    nativeKey:platform+':'+(platform==='reddit'?match[1].toLowerCase():match[1])};
}
function deepFreeze(value){
  if(value&&typeof value==='object'){
    for(const child of Object.values(value))deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function snapshotMatches(actual,expected){
  if(!expected||typeof expected!=='object')return actual===expected;
  if(Array.isArray(expected)){
    if(!Array.isArray(actual)||actual.length!==expected.length||
       Reflect.ownKeys(actual).length!==actual.length+1)return false;
    return expected.every((v,i)=>{
      const d=Object.getOwnPropertyDescriptor(actual,String(i));
      return d?.enumerable&&Object.hasOwn(d,'value')&&snapshotMatches(d.value,v);
    });
  }
  const keys=Object.keys(expected);
  try{exact(actual,keys,'SNAPSHOT');}catch{return false;}
  return keys.every(k=>snapshotMatches(Object.getOwnPropertyDescriptor(actual,k).value,expected[k]));
}
function recordsArray(a){
  if(!Array.isArray(a)||a.length<1||a.length>100||
    Reflect.ownKeys(a).length!==a.length+1||
    !Array.from({length:a.length},(_,i)=>i).every(i=>{
      const d=Object.getOwnPropertyDescriptor(a,String(i));
      return d?.enumerable&&Object.hasOwn(d,'value');
    }))throw Error('INVALID_TREND_RECORDS');
}
export function buildContentTrendResearchPacket(input){
  exact(input,['schemaVersion','product','tenantId','instanceId','asOf','windowDays','records'],'PACKET');
  if(input.schemaVersion!==1||input.product!=='content'||!id(input.tenantId)||
     !id(input.instanceId)||!Number.isSafeInteger(input.windowDays)||
     input.windowDays<1||input.windowDays>90)throw Error('INVALID_TREND_PACKET_SCOPE');
  const asOf=utc(input.asOf);
  if(asOf===null)throw Error('INVALID_TREND_AS_OF');
  recordsArray(input.records);
  const nativeKeys=new Set();
  const prepared=input.records.map(r=>{
    exact(r,['sourceId','platform','url','publishedAt','observedAt','topic','hookPattern','visualStyle','format','metrics'],'RECORD');
    if(!id(r.sourceId)||!platforms.has(r.platform))throw Error('INVALID_TREND_SOURCE');
    const published=publicationBounds(r.publishedAt),observed=utc(r.observedAt);
    if(published===null||observed===null||published[1]>observed||observed>asOf||
       published[0]<asOf-input.windowDays*86400000)
      throw Error('TREND_SOURCE_OUTSIDE_WINDOW');
    if(!['video','image','carousel','text'].includes(r.format))throw Error('INVALID_TREND_FORMAT');
    exact(r.metrics,metrics,'METRICS');
    const measured={};
    for(const key of metrics){
      const v=r.metrics[key];
      if(v!==null&&(!Number.isSafeInteger(v)||v<0||v>1e12))throw Error('INVALID_TREND_METRIC');
      measured[key]=v;
    }
    const locator=sourceLocator(r.url,r.platform);
    if(nativeKeys.has(locator.nativeKey))throw Error('DUPLICATE_TREND_SOURCE');
    nativeKeys.add(locator.nativeKey);
    return {
      sourceId:r.sourceId,platform:r.platform,
      url:locator.url,
      publishedAt:r.publishedAt,observedAt:r.observedAt,
      topic:text(r.topic,'TOPIC'),hookPattern:text(r.hookPattern,'HOOK_PATTERN'),
      visualStyle:text(r.visualStyle,'VISUAL_STYLE'),
      format:r.format,metrics:measured
    };
  });
  if(new Set(prepared.map(x=>x.platform+':'+x.sourceId)).size!==prepared.length||
     new Set(prepared.map(x=>x.url)).size!==prepared.length)
    throw Error('DUPLICATE_TREND_SOURCE');
  // Normalize order, never sum platform counters or suggest cross-platform KPI comparability.
  prepared.sort((a,b)=>a.url.localeCompare(b.url,'en'));
  const groups=new Map();
  for(const r of prepared){
    const key=r.topic.toLocaleLowerCase('en-US').replace(/\s+/gu,' ').trim();
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(r);
  }
  const candidates=[...groups.entries()].map(([key,rs])=>{
    const uniquePlatforms=[...new Set(rs.map(x=>x.platform))].sort();
    const hooks=[...new Set(rs.map(x=>x.hookPattern))].sort();
    const visuals=[...new Set(rs.map(x=>x.visualStyle))].sort();
    return {
      candidateId:'content-trend-candidate-'+hash([1,input.tenantId,input.instanceId,key,rs.map(x=>x.url)]),
      topic:rs[0].topic,
      observedSourceCount:rs.length,
      observedPlatformCount:uniquePlatforms.length,
      observedPlatforms:uniquePlatforms,
      sourceIds:rs.map(x=>x.sourceId).sort(),
      sourceUrls:rs.map(x=>x.url),
      observedHookPatterns:hooks,observedVisualStyles:visuals,
      evidenceClass:uniquePlatforms.length>=2?'CROSS_PLATFORM_RECURRING':'SINGLE_PLATFORM_HYPOTHESIS',
      performanceRankingVerified:false,marketDemandVerified:false,causalLiftProven:false
    };
  }).sort((a,b)=>b.observedPlatformCount-a.observedPlatformCount||
    b.observedSourceCount-a.observedSourceCount||a.topic.localeCompare(b.topic,'en'));
  const packetId='content-trend-research-'+hash([1,input.tenantId,input.instanceId,input.asOf,
    input.windowDays,prepared]);
  return deepFreeze({
    schemaVersion:1,product:'content',tenantId:input.tenantId,instanceId:input.instanceId,
    packetId,asOf:input.asOf,windowDays:input.windowDays,
    records:structuredClone(prepared),candidates:structuredClone(candidates.slice(0,5)),
    otherObservedTopicCount:Math.max(0,candidates.length-5),
    rankMeaning:'RECURRENCE_IN_SUPPLIED_SAMPLE_ONLY',
    status:'UNVERIFIED_RESEARCH_CANDIDATES',providerAuthenticated:false,
    exhaustivePlatformSearchVerified:false,viewMetricsComparableAcrossPlatforms:false,
    demandVerified:false,viralityVerified:false,approvalVerified:false,
    executionAllowed:false,customerSaasReady:false
  });
}
export function proposeContentBriefFromTrend(instanceConfig,packet,candidateId,channel,proposal){
  const cfg=normalizeContentInstanceConfig(instanceConfig);
  exact(packet,['schemaVersion','product','tenantId','instanceId','packetId','asOf',
    'windowDays','records','candidates','otherObservedTopicCount','rankMeaning','status',
    'providerAuthenticated','exhaustivePlatformSearchVerified',
    'viewMetricsComparableAcrossPlatforms','demandVerified','viralityVerified',
    'approvalVerified','executionAllowed','customerSaasReady'],'RESEARCH_PACKET');
  if(packet.schemaVersion!==1||packet.product!=='content'||
     packet.tenantId!==cfg.tenantId||packet.instanceId!==cfg.instanceId||
     packet.status!=='UNVERIFIED_RESEARCH_CANDIDATES'||packet.executionAllowed!==false||
     !Array.isArray(packet.candidates))throw Error('TREND_PACKET_SCOPE_MISMATCH');
  // Rebuild at the consumption boundary: freezing alone does not protect a JSON
  // roundtrip. This verifies consistency, not authorship, provider truth or approval.
  const rebuilt=buildContentTrendResearchPacket({schemaVersion:packet.schemaVersion,
    product:packet.product,tenantId:packet.tenantId,instanceId:packet.instanceId,
    asOf:packet.asOf,windowDays:packet.windowDays,records:packet.records});
  if(!snapshotMatches(packet,rebuilt))throw Error('TREND_PACKET_INTEGRITY_MISMATCH');
  exact(channel,['service','channelId'],'CHANNEL');
  exact(proposal,['briefId','revisionId','format','assetCount','hook','hypothesis','measurementQuestion'],'PROPOSAL');
  const candidate=rebuilt.candidates.find(x=>x.candidateId===candidateId);
  if(!candidate)throw Error('TREND_CANDIDATE_NOT_FOUND');
  const plan=planContentJobCandidate(instanceConfig,{
    briefId:proposal.briefId,revisionId:proposal.revisionId,
    channelService:channel.service,channelId:channel.channelId,
    format:proposal.format,assetCount:proposal.assetCount,
    topic:candidate.topic,hook:proposal.hook,hypothesis:proposal.hypothesis,
    measurementQuestion:proposal.measurementQuestion
  });
  return deepFreeze({...plan,sourcePacketId:rebuilt.packetId,
    sourceCandidateId:candidateId,sourceLinks:structuredClone(candidate.sourceUrls),
    status:'TREND_BRIEF_REVIEW_REQUIRED',trendProviderAuthenticated:false,
    trendEvidenceIndependentlyVerified:false,executionAllowed:false});
}


/**
 * Turn a source-bound, review-required CONTENT brief into a nonexecuting
 * short-form storyboard/script review packet. The caller supplies the script;
 * this module neither generates video nor grants editorial/publishing rights.
 * Recompute the research packet and brief at this boundary, not a caller-
 * supplied planId, to preserve scope and source provenance after JSON transit.
 */
export function proposeContentTrendHookScriptReview(instanceConfig,packet,candidateId,channel,proposal,script){
  const plan=proposeContentBriefFromTrend(instanceConfig,packet,candidateId,channel,proposal);
  exact(script,['scriptId','revisionId','openingHook','sellerSituation',
    'diagnosticQuestion','valueExplanation','sellerAction','closingLine','shots'],'SCRIPT');
  if(!id(script.scriptId)||!id(script.revisionId))throw Error('INVALID_TREND_SCRIPT_ID');
  if(!Array.isArray(script.shots)||script.shots.length<2||script.shots.length>6||
     Reflect.ownKeys(script.shots).length!==script.shots.length+1||
     !script.shots.every((_,i)=>{
       const d=Object.getOwnPropertyDescriptor(script.shots,String(i));
       return d?.enumerable&&Object.hasOwn(d,'value');
     }))throw Error('INVALID_TREND_SCRIPT_SHOTS');
  const draft={
    scriptId:script.scriptId,revisionId:script.revisionId,
    openingHook:text(script.openingHook,'SCRIPT_HOOK',400),
    sellerSituation:text(script.sellerSituation,'SCRIPT_SITUATION',600),
    diagnosticQuestion:text(script.diagnosticQuestion,'SCRIPT_DIAGNOSTIC',400),
    valueExplanation:text(script.valueExplanation,'SCRIPT_EXPLANATION',800),
    sellerAction:text(script.sellerAction,'SCRIPT_ACTION',500),
    closingLine:text(script.closingLine,'SCRIPT_CLOSING',400),
    shots:script.shots.map(x=>text(x,'SCRIPT_SHOT',320))
  };
  if(draft.openingHook!==plan.brief.hook)throw Error('TREND_SCRIPT_HOOK_BRIEF_MISMATCH');
  const scriptIntentId='content-trend-script-'+hash([1,plan.tenantId,plan.instanceId,
    plan.planId,plan.sourcePacketId,plan.sourceCandidateId,draft]);
  return deepFreeze({
    schemaVersion:1,product:'content',tenantId:plan.tenantId,instanceId:plan.instanceId,
    scriptIntentId,planId:plan.planId,sourcePacketId:plan.sourcePacketId,
    sourceCandidateId:plan.sourceCandidateId,sourceLinks:structuredClone(plan.sourceLinks),
    channelService:plan.brief.channelService,channelId:plan.brief.channelId,
    script:draft,status:'SHORT_FORM_SCRIPT_REVIEW_REQUIRED',
    intentKind:'STORYBOARD_AND_SCRIPT_ONLY',reviewRequired:true,
    providerTrendAuthenticated:false,sourceClaimsVerified:false,
    scriptEditoriallyApproved:false,independentMediaBytesVerified:false,
    videoRendered:false,providerCapabilityVerified:false,
    providerSentVerified:false,measurementVerified:false,
    sharedBciAuditVerified:false,executionAllowed:false,customerSaasReady:false
  });
}
