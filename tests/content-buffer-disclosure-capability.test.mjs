import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectContentBufferDisclosureCapability as inspect} from '../lib/content/buffer-disclosure-capability.mjs';
const base=()=>({schemaVersion:1,product:'content',tenantId:'tenant-1',
  instanceId:'pilot-1',planId:'content-plan-1',approvalRequestId:'content-review-1',
  channelService:'tiktok',assetTypes:['image','image'],
  aiDisclosure:'DECLARED_AI',
  caption:'Situasi rekaan untuk pembelajaran. Ilustrasi AI.'});
test('TikTok AI photo carousel: caption alone cannot imply native AI metadata is supported',()=>{
  const r=inspect(base());
  assert.equal(r.status,'CAPABILITY_REVIEW_REQUIRED');
  assert.equal(r.captionDeclaresAi,true);
  assert.equal(r.bufferCreatePostAiMetadataFieldExposed,false);
  assert.deepEqual(r.flags,['TIKTOK_PHOTO_AI_METADATA_NOT_SUPPORTED_IN_BUFFER_CREATE_POST']);
  for(const k of ['providerAccountCapabilityVerified','providerMetadataApplied',
    'platformDisclosureVerified','authenticatedApprovalVerified','providerSentVerified',
    'executionAllowed','customerSaasReady'])assert.equal(r[k],false,k);
  assert.equal(Object.hasOwn(r,'caption'),false);
  assert.equal(inspect(base()).capabilityPreflightId,r.capabilityPreflightId);
});
test('TikTok video and Instagram have schema field but no verified provider acceptance',()=>{
  const v=base();v.assetTypes=['video'];
  const video=inspect(v);
  assert.equal(video.bufferCreatePostAiMetadataFieldExposed,true);
  assert.equal(video.bufferCreatePostAiMetadataFieldScope,'TIKTOK_VIDEO_ONLY');
  assert.equal(video.status,'SCHEMA_PREFLIGHT_ONLY');
  assert.equal(video.executionAllowed,false);
  const ig=base();ig.channelService='instagram';
  assert.equal(inspect(ig).bufferCreatePostAiMetadataFieldScope,'INSTAGRAM');
  assert.equal(inspect(ig).providerMetadataApplied,false);
});
test('Facebook AI metadata is not exposed by connected Buffer create_post contract',()=>{
  const x=base();x.channelService='facebook';
  assert.deepEqual(inspect(x).flags,
    ['FACEBOOK_AI_METADATA_NOT_EXPOSED_IN_BUFFER_CREATE_POST']);
});
test('Missing caption disclosure and unknown AI provenance remain explicit review holds',()=>{
  const x=base();x.caption='Situasi rekaan untuk pembelajaran.';
  assert.deepEqual(inspect(x).flags,[
    'AI_CAPTION_DISCLOSURE_MISSING',
    'TIKTOK_PHOTO_AI_METADATA_NOT_SUPPORTED_IN_BUFFER_CREATE_POST']);
  const y=base();y.aiDisclosure='UNKNOWN';
  assert.deepEqual(inspect(y).flags,['AI_PROVENANCE_UNRESOLVED']);
});
test('Revision, media type and disclosure change deterministic identity without execution',()=>{
  const a=inspect(base()),b=base();b.approvalRequestId='content-review-2';
  assert.notEqual(inspect(b).capabilityPreflightId,a.capabilityPreflightId);
  const c=base();c.assetTypes=['video','video'];
  assert.notEqual(inspect(c).capabilityPreflightId,a.capabilityPreflightId);
  const d=base();d.aiDisclosure='DECLARED_NON_AI';
  assert.notEqual(inspect(d).capabilityPreflightId,a.capabilityPreflightId);
});
test('Forged authority, accessors, mixed assets, sparse arrays and unsafe scope fail closed',()=>{
  assert.throws(()=>inspect({...base(),executionAllowed:true}),/INVALID_CONTENT_BUFFER_CAPABILITY_INPUT/);
  const getter=base();Object.defineProperty(getter,'caption',{get(){throw Error('EXECUTED');}});
  assert.throws(()=>inspect(getter),/INVALID_CONTENT_BUFFER_CAPABILITY_INPUT/);
  const mixed=base();mixed.assetTypes=['image','video'];
  assert.throws(()=>inspect(mixed),/INVALID_CONTENT_BUFFER_MEDIA_TYPES/);
  const sparse=base();sparse.assetTypes=new Array(2);
  assert.throws(()=>inspect(sparse),/INVALID_CONTENT_BUFFER_MEDIA_TYPES/);
  const wrong=base();wrong.product='demand';
  assert.throws(()=>inspect(wrong),/INVALID_CONTENT_BUFFER_CAPABILITY_SCOPE/);
});
