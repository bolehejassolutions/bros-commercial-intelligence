// CONTENT product-layer verification of a single original PNG at a public HTTPS URL.
// Proves one bounded HTTP byte readback, NOT hosting durability, provider fetch,
// human approval, BCI reservation, publishing authority, SENT, or measurement.
// Server-owned exact host allowlists are mandatory. Redirects are never followed.
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';

const MAX_BYTES=20*1024*1024;
const PNG_SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const deny=()=>{throw Error('CONTENT_MEDIA_URL_READBACK_DENIED');};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const isDigest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export async function verifyContentSingleImageUrlReadback(admission,assetUrl,{
  allowedHosts=[],fetchImpl=globalThis.fetch,timeoutMs=10000,now=Date.now
}={}){
  let controller;
  try{
    if(admission?.product!=='content'||
      admission?.status!=='SINGLE_IMAGE_ORIGINAL_BYTES_RECHECKED_NONAUTHORIZING'||
      admission?.originalMedia?.mediaCount!==1||
      !isDigest(admission.originalMedia.originalMediaSha256)||
      typeof admission.originalMedia.mediaSetId!=='string'||
      typeof admission.tenantId!=='string'||
      !/^[A-Za-z0-9][A-Za-z0-9_.|:-]{1,127}$/.test(admission.tenantId)||
      typeof admission.instanceId!=='string'||
      !/^[A-Za-z0-9][A-Za-z0-9_.|:-]{1,127}$/.test(admission.instanceId)||
      !Buffer.isBuffer(admission.mediaBytes)||
      admission.mediaBytes.length<32||admission.mediaBytes.length>MAX_BYTES||
      !admission.mediaBytes.subarray(0,8).equals(PNG_SIGNATURE)||
      sha256(admission.mediaBytes)!==admission.originalMedia.originalMediaSha256||
      !Array.isArray(allowedHosts)||allowedHosts.length===0||
      typeof fetchImpl!=='function'||typeof now!=='function'||
      !Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)deny();

    const url=new URL(assetUrl);
    const hostname=url.hostname.toLowerCase();
    if(url.protocol!=='https:'||url.username||url.password||url.hash||
      (url.port&&url.port!=='443')||isIP(hostname)||
      hostname==='localhost'||hostname.endsWith('.localhost')||
      hostname.endsWith('.local')||hostname.endsWith('.internal')||
      !allowedHosts.some(host=>typeof host==='string'&&host.toLowerCase()===hostname))deny();

    controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetchImpl(url.href,{
        method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',
        signal:controller.signal,headers:{Accept:'image/png, application/octet-stream'}
      });
      if(response?.status!==200||!response.body||
        typeof response.body.getReader!=='function')deny();
      const contentType=(response.headers?.get('content-type')||'').split(';')[0].trim().toLowerCase();
      if(contentType!=='image/png'&&contentType!=='application/octet-stream')deny();
      const headerLength=response.headers?.get('content-length');
      if(headerLength!==null&&headerLength!==undefined&&
        (!/^(0|[1-9][0-9]*)$/.test(headerLength)||
         Number(headerLength)!==admission.mediaBytes.length))deny();
      const reader=response.body.getReader();
      const chunks=[];let total=0;
      try{
        while(true){
          const {done,value}=await reader.read();
          if(done)break;
          if(!(value instanceof Uint8Array)||value.length===0)deny();
          total+=value.length;
          if(total>MAX_BYTES||total>admission.mediaBytes.length)deny();
          chunks.push(Buffer.from(value));
        }
      }finally{reader.releaseLock();}
      const downloaded=Buffer.concat(chunks,total);
      if(total!==admission.mediaBytes.length||
        sha256(downloaded)!==admission.originalMedia.originalMediaSha256||
        !downloaded.equals(admission.mediaBytes))deny();
    }finally{clearTimeout(timer);}

    return Object.freeze({
      schemaVersion:1,product:'content',mediaSetId:admission.originalMedia.mediaSetId,
      originalMediaSha256:admission.originalMedia.originalMediaSha256,
      mediaCount:1,byteLength:admission.mediaBytes.length,
      // Stable CONTENT media identity, NOT a dispatch idempotency or approval key.
      // Token rotation or moving the same approved bytes between allowed hosts
      // must not create a second media candidate. BCI owns dispatchIntentId.
      deliveryCandidateId:sha256(Buffer.from('CONTENT_MEDIA_IDENTITY_V2\n'+
        JSON.stringify([admission.tenantId,admission.instanceId,
          admission.originalMedia.mediaSetId,
          admission.originalMedia.originalMediaSha256]))),
      readbackAt:new Date(now()).toISOString(),
      status:'PUBLIC_HTTPS_ORIGINAL_BYTES_READBACK_NONAUTHORIZING',
      originHttpReadbackVerified:true,providerFetchabilityVerified:false,
      durableHostingVerified:false,reviewerAuthenticated:false,
      durableApprovalRecorded:false,atomicReservationVerified:false,
      providerSentVerified:false,measurementVerified:false,
      sharedBciAuditVerified:false,executionAllowed:false,customerSaasReady:false
    });
  }catch{deny();}
  finally{controller?.abort();}
}
