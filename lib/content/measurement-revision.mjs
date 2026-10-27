import {createHash} from 'node:crypto';
import {nativeUrl} from './buffer-observation.mjs';

// CONTENT product layer only. Inputs are provider-shaped observations, NOT authenticated evidence.
// No provider access, BCI write, approval, publication or causal inference occurs here.
const metricNames=['impressions','reach','views','reactions','comments','shares','clicks','saves','follows'];
const services=new Set(['facebook','instagram','tiktok']);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.|:-]{1,127}$/.test(value);
function utc(value){
  if(typeof value!=='string'||!/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/.test(value))return null;
  const t=Date.parse(value);
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,19)===value.slice(0,19)?t:null;
}
function snapshotHash(o){
  return 'content-measurement-'+createHash('sha256').update(JSON.stringify([
    1,o.tenantId,o.instanceId,o.contentId,o.postId,o.channelService,o.channelId,
    // Canonical UTC instants, not provider ISO formatting, define snapshot identity.
    o.nativeUrl,utc(o.sentAt),utc(o.metricsUpdatedAt),o.format,o.assetCount,
    metricNames.map(k=>o.metrics[k])
  ])).digest('hex');
}
function validate(o,scope,asOf){
  if(!o||o.schemaVersion!==1||o.product!=='content'||o.status!=='MEASURED'||
     o.providerAttestedByModule!==false||!Array.isArray(o.flags)||o.flags.length!==0||
     !['image','video','mixed'].includes(o.format)||
     !Number.isSafeInteger(o.assetCount)||o.assetCount<1||o.assetCount>20||
     !o.metrics||typeof o.metrics!=='object'||Array.isArray(o.metrics)||
     Object.keys(o.metrics).length!==metricNames.length||
     metricNames.some(k=>!Object.hasOwn(o.metrics,k)||
       (o.metrics[k]!==null&&(!Number.isSafeInteger(o.metrics[k])||o.metrics[k]<0)))||
     !metricNames.some(k=>o.metrics[k]!==null))throw Error('INVALID_MEASURED_OBSERVATION');
  for(const k of ['tenantId','instanceId','contentId','postId','channelService','channelId'])
    if(o[k]!==scope[k])throw Error('CROSS_SCOPE_MEASUREMENT');
  const sent=utc(o.sentAt),updated=utc(o.metricsUpdatedAt);
  if(sent===null||updated===null||updated<sent||updated>asOf||
     o.measurementAgeSeconds!==Math.floor((updated-sent)/1000))
    throw Error('INVALID_MEASUREMENT_TIMELINE');
  // Use the same strict native-post permalink allowlist as Buffer SENT projection.
  // A profile/login page or tracking-decorated URL is not measurement lineage.
  if(nativeUrl(o.nativeUrl,scope.channelService)!==o.nativeUrl)
    throw Error('INVALID_NATIVE_POST_REFERENCE');
  return updated;
}

// Compare two snapshots of the SAME post. This is not a cross-post experiment or verified learning.
export function proposeContentMeasurementRevision(previous,current,scope){
  if(!scope||scope.product!=='content'||
     !['tenantId','instanceId','contentId','postId','channelId'].every(k=>id(scope[k]))||
     !services.has(scope.channelService))throw Error('INVALID_TRUSTED_MEASUREMENT_SCOPE');
  const asOf=utc(scope.asOf);
  if(asOf===null)throw Error('INVALID_TRUSTED_MEASUREMENT_TIME');
  const oldTime=validate(previous,scope,asOf),newTime=validate(current,scope,asOf);
  if(utc(previous.sentAt)!==utc(current.sentAt)||previous.nativeUrl!==current.nativeUrl||
     previous.format!==current.format||previous.assetCount!==current.assetCount)
    throw Error('CONTENT_MEASUREMENT_LINEAGE_MISMATCH');
  if(newTime<oldTime)throw Error('OUT_OF_ORDER_MEASUREMENT');
  const oldKey=snapshotHash(previous),newKey=snapshotHash(current);
  if(newTime===oldTime&&oldKey!==newKey)throw Error('CONFLICTING_PROVIDER_SNAPSHOT');
  const noNewSnapshot=oldKey===newKey;
  const deltas=Object.fromEntries(metricNames.map(k=>[
    k,previous.metrics[k]===null||current.metrics[k]===null?null:current.metrics[k]-previous.metrics[k]
  ]));
  const regression=metricNames.some(k=>deltas[k]!==null&&deltas[k]<0);
  const lostCoverage=metricNames.some(k=>previous.metrics[k]!==null&&current.metrics[k]===null);
  const comparable=metricNames.some(k=>deltas[k]!==null);
  const changed=metricNames.some(k=>deltas[k]!==null&&deltas[k]>0);
  const status=noNewSnapshot?'NO_NEW_SNAPSHOT':regression||lostCoverage?'REVIEW_REQUIRED':
    !comparable?'INSUFFICIENT_COMPARABLE_METRICS':'CANDIDATE_UNATTESTED';
  const reason=noNewSnapshot?'IDENTICAL_PROVIDER_SNAPSHOT':regression?'COUNTER_REGRESSION_REVIEW':
    lostCoverage?'LOSS_OF_METRIC_COVERAGE':!comparable?'FIRST_MEASUREMENT_ONLY':
    changed?'NONCAUSAL_METRIC_CHANGE':'NO_OBSERVED_CHANGE';
  const candidateId='content-learning-'+createHash('sha256').update(JSON.stringify([1,oldKey,newKey])).digest('hex');
  return Object.freeze({schemaVersion:1,tenantId:scope.tenantId,product:'content',
    instanceId:scope.instanceId,contentId:scope.contentId,postId:scope.postId,
    candidateId,status,reason,previousSnapshotId:oldKey,currentSnapshotId:newKey,
    previousMetricsUpdatedAt:previous.metricsUpdatedAt,currentMetricsUpdatedAt:current.metricsUpdatedAt,
    observedDeltas:Object.freeze(deltas),
    nextAction:status==='REVIEW_REQUIRED'?'REVIEW_PROVIDER_METRICS':
      status==='CANDIDATE_UNATTESTED'&&changed?'REVIEW_CONTENT_HYPOTHESIS':
      'COLLECT_ANOTHER_PROVIDER_SNAPSHOT',
    providerAttested:false,approvalVerified:false,bciAuditWritten:false,
    learningVerified:false,causalLiftProven:false,executionAllowed:false});
}
