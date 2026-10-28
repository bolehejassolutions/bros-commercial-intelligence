import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {projectBufferContentObservation} from '../lib/content/buffer-observation.mjs';

// CONTENT-only offline provider-response readback. No network, provider authentication,
// tenant authority, approval, publishing, BCI write or learning is performed here.
// Never send raw post text, author data, media URLs or tenant IDs to stdout.
const metricNames=['impressions','reach','views','reactions','comments','shares','clicks','saves','follows'];
export function summarizeBufferReadback(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
     !input.post||!input.scope||typeof input.scope.asOf!=='string')
    throw Error('INVALID_READBACK_ENVELOPE');
  const o=projectBufferContentObservation(input.post,input.scope);
  const counts=Object.fromEntries(metricNames.map(k=>[k,o.metrics?.[k]??null]));
  const fingerprint='content-buffer-readback-'+createHash('sha256').update(JSON.stringify([
    1,o.tenantId,o.instanceId,o.contentId,o.postId,o.channelId,o.channelService,
    o.status,o.sentAt,o.metricsUpdatedAt,o.format,o.assetCount,counts,o.flags
  ])).digest('hex');
  return Object.freeze({
    schemaVersion:1,sourceTrust:'UNATTESTED_CONNECTOR_RESPONSE',
    snapshotFingerprint:fingerprint,channelService:o.channelService,
    status:o.status,format:o.format,assetCount:o.assetCount,
    sentAt:o.sentAt,metricsUpdatedAt:o.metricsUpdatedAt,
    measurementAgeSeconds:o.measurementAgeSeconds??null,
    metrics:counts,flags:[...o.flags],
    providerAuthenticated:false,mediaBytesVerified:false,
    approvalVerified:false,contentPublisherVerified:false,
    learningVerified:false,bciAuditWritten:false,executionAllowed:false
  });
}

async function main(){
  let raw='',size=0;
  for await(const chunk of process.stdin){
    size+=Buffer.byteLength(chunk);
    if(size>1024*1024)throw Error('READBACK_INPUT_TOO_LARGE');
    raw+=chunk.toString();
  }
  let input;
  try{input=JSON.parse(raw);}catch{throw Error('INVALID_READBACK_JSON');}
  process.stdout.write(JSON.stringify(summarizeBufferReadback(input))+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(()=>{process.stderr.write('CONTENT_BUFFER_READBACK_FAILED\n');process.exitCode=1;});
}
