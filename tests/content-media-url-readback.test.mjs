import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyContentSingleImageUrlReadback as verify} from '../lib/content/media-url-readback.mjs';

const original=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(64,42)]);
const digest=createHash('sha256').update(original).digest('hex');
const admission=()=>({
  product:'content',tenantId:'tenant-1',instanceId:'instance-1',
  status:'SINGLE_IMAGE_ORIGINAL_BYTES_RECHECKED_NONAUTHORIZING',
  originalMedia:{mediaSetId:'media-set-1',originalMediaSha256:digest,mediaCount:1},
  mediaBytes:Buffer.from(original),executionAllowed:false
});
const url='https://assets.example.com/published-proof.png?token=not-for-logs';
const opts=(fetchImpl)=>({allowedHosts:['assets.example.com'],fetchImpl,now:()=>1793411600000});
const ok=()=>new Response(original,{status:200,headers:{'content-type':'image/png','content-length':String(original.length)}});

test('exact original bytes read back over strict HTTPS without authorizing publishing',async()=>{
  let request;
  const result=await verify(admission(),url,opts(async (u,o)=>{request={u,o};return ok();}));
  assert.equal(request.u,url);
  assert.equal(request.o.redirect,'manual');
  assert.equal(request.o.credentials,'omit');
  assert.equal(request.o.cache,'no-store');
  assert.equal(result.originalMediaSha256,digest);
  assert.equal(result.originHttpReadbackVerified,true);
  for(const flag of ['providerFetchabilityVerified','durableHostingVerified',
    'reviewerAuthenticated','durableApprovalRecorded','atomicReservationVerified',
    'providerSentVerified','measurementVerified','sharedBciAuditVerified',
    'executionAllowed','customerSaasReady'])assert.equal(result[flag],false,flag);
  assert.equal(JSON.stringify(result).includes('token=not-for-logs'),false);
  const again=await verify(admission(),url,opts(async()=>ok()));
  assert.equal(result.deliveryCandidateId,again.deliveryCandidateId);
});

test('mismatched bytes, HTML and missing/false lengths fail closed',async()=>{
  for(const response of [
    new Response(Buffer.alloc(original.length,9),{headers:{'content-type':'image/png'}}),
    new Response('<html>login</html>',{headers:{'content-type':'text/html'}}),
    new Response(original,{headers:{'content-type':'image/png','content-length':'999'}}),
    new Response(original.subarray(0,40),{headers:{'content-type':'image/png'}})
  ])await assert.rejects(verify(admission(),url,opts(async()=>response)),/CONTENT_MEDIA_URL_READBACK_DENIED/);
});

test('redirects, non-HTTPS, credentials, IPs, unknown hosts and fragments denied',async()=>{
  const badUrls=[
    'http://assets.example.com/image.png',
    'https://user:pass@assets.example.com/image.png',
    'https://127.0.0.1/image.png',
    'https://assets.example.com.evil.test/image.png',
    'https://assets.example.com:8443/image.png',
    'https://assets.example.com/image.png#frag',
    'https://localhost/image.png'
  ];
  for(const bad of badUrls)await assert.rejects(verify(admission(),bad,opts(async()=>ok())),/CONTENT_MEDIA_URL_READBACK_DENIED/);
  await assert.rejects(verify(admission(),url,{fetchImpl:async()=>ok()}),/CONTENT_MEDIA_URL_READBACK_DENIED/);
  await assert.rejects(verify(admission(),url,opts(async()=>Response.redirect('https://other.example.com',302))),/CONTENT_MEDIA_URL_READBACK_DENIED/);
});

test('carousel, tampered admission, fake digest, oversized bytes and transport errors denied',async()=>{
  for(const mutate of [
    a=>{a.originalMedia.mediaCount=2;},
    a=>{a.mediaBytes[20]^=1;},
    a=>{a.originalMedia.originalMediaSha256='0'.repeat(64);},
    a=>{a.mediaBytes=Buffer.alloc(20*1024*1024+1);}
  ]){
    const a=admission();mutate(a);
    await assert.rejects(verify(a,url,opts(async()=>ok())),/CONTENT_MEDIA_URL_READBACK_DENIED/);
  }
  await assert.rejects(verify(admission(),url,opts(async()=>{throw Error('transport unavailable');})),/CONTENT_MEDIA_URL_READBACK_DENIED/);
});

test('streaming readback rejects excessive body before accepting response',async()=>{
  const response=new Response(new ReadableStream({
    start(controller){controller.enqueue(new Uint8Array(original.length+1));controller.close();}
  }),{headers:{'content-type':'image/png'}});
  await assert.rejects(verify(admission(),url,opts(async()=>response)),/CONTENT_MEDIA_URL_READBACK_DENIED/);
});

test('media identity survives URL token rotation and host changes but is scoped to tenant, instance and original bytes',async()=>{
  const hostOpts=(fetchImpl)=>({...opts(fetchImpl),allowedHosts:['assets.example.com','cdn.example.com']});
  const first=await verify(admission(),url,hostOpts(async()=>ok()));
  const rotated=await verify(admission(),'https://assets.example.com/published-proof.png?token=rotated',
    hostOpts(async()=>ok()));
  const relocated=await verify(admission(),'https://cdn.example.com/new-path.png?token=another',
    hostOpts(async()=>ok()));
  assert.equal(first.deliveryCandidateId,rotated.deliveryCandidateId);
  assert.equal(first.deliveryCandidateId,relocated.deliveryCandidateId);
  assert.equal(first.executionAllowed,false);
  for(const modify of [
    a=>{a.tenantId='tenant-2';},
    a=>{a.instanceId='instance-2';},
    a=>{a.originalMedia.mediaSetId='media-set-2';}
  ]){
    const a=admission();modify(a);
    const result=await verify(a,url,hostOpts(async()=>ok()));
    assert.notEqual(result.deliveryCandidateId,first.deliveryCandidateId);
  }
  const changed=admission();
  changed.mediaBytes[20]^=1;
  changed.originalMedia.originalMediaSha256=createHash('sha256').update(changed.mediaBytes).digest('hex');
  const changedResult=await verify(changed,url,hostOpts(async()=>new Response(changed.mediaBytes,{
    status:200,headers:{'content-type':'image/png','content-length':String(changed.mediaBytes.length)}
  })));
  assert.notEqual(changedResult.deliveryCandidateId,first.deliveryCandidateId);
  for(const missing of ['tenantId','instanceId']){
    const a=admission();delete a[missing];
    await assert.rejects(verify(a,url,hostOpts(async()=>ok())),/CONTENT_MEDIA_URL_READBACK_DENIED/);
  }
});


test('caller mutation across awaited fetch cannot rewrite verified media identity',async()=>{
  const mutable=admission();
  const baseline=await verify(admission(),url,opts(async()=>ok()));
  const result=await verify(mutable,url,opts(async()=>{
    mutable.tenantId='tenant-evil';mutable.instanceId='instance-evil';
    mutable.originalMedia.mediaSetId='media-evil';
    mutable.originalMedia.originalMediaSha256='0'.repeat(64);
    mutable.mediaBytes[20]^=1;
    return ok();
  }));
  assert.equal(result.deliveryCandidateId,baseline.deliveryCandidateId);
  assert.equal(result.originalMediaSha256,digest);
  assert.equal(result.mediaSetId,'media-set-1');
  assert.equal(result.byteLength,original.length);
  assert.equal(result.executionAllowed,false);
});

test('caller swapping media bytes during fetch cannot substitute downloaded image',async()=>{
  const mutable=admission();
  await assert.rejects(verify(mutable,url,opts(async()=>{
    mutable.mediaBytes=Buffer.from(original);
    mutable.mediaBytes[30]^=1;
    mutable.originalMedia.originalMediaSha256=createHash('sha256').update(mutable.mediaBytes).digest('hex');
    return new Response(mutable.mediaBytes,{headers:{'content-type':'image/png','content-length':String(mutable.mediaBytes.length)}});
  })),/CONTENT_MEDIA_URL_READBACK_DENIED/);
});

test('caller buffer mutation while streaming cannot rewrite pinned readback proof',async()=>{
  const mutable=admission();
  const result=await verify(mutable,url,opts(async()=>new Response(new ReadableStream({
    start(controller){
      controller.enqueue(original.subarray(0,16));
      mutable.mediaBytes[20]^=1;
      controller.enqueue(original.subarray(16));controller.close();
    }
  }),{headers:{'content-type':'image/png'}})));
  assert.equal(result.originalMediaSha256,digest);
  assert.equal(result.executionAllowed,false);
});
