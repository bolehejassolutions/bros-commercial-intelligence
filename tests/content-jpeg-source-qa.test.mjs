import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyJpegSourceBytes as verify,verifyDistinctJpegSources as set} from '../lib/content/jpeg-source-qa.mjs';
const seg=(marker,payload)=>{const b=Buffer.alloc(payload.length+4);b[0]=255;b[1]=marker;b.writeUInt16BE(payload.length+2,2);payload.copy(b,4);return b;};
function jpeg({width=2,height=2,sof=0xc0,app=null,entropy=Buffer.alloc(80,3),trailing=Buffer.alloc(0)}={}){
  const frame=Buffer.alloc(15);frame[0]=8;frame.writeUInt16BE(height,1);frame.writeUInt16BE(width,3);frame[5]=3;
  const scan=Buffer.from([3,1,0,2,0,3,0,0,63,0]);
  return Buffer.concat([Buffer.from([255,216]),...(app?[seg(app,Buffer.from([1,2,3]))]:[]),seg(0xdb,Buffer.from([0,1])),seg(sof,frame),seg(0xc4,Buffer.from([0,1])),seg(0xda,scan),entropy,Buffer.from([255,217]),trailing]);
}
const opts={expectedWidth:2,expectedHeight:2};
test('bounded JPEG structural marker QA never claims decoded pixels or provider identity',()=>{
  const a=verify(jpeg(),opts);assert.equal(a.format,'JPEG');assert.equal(a.width,2);assert.equal(a.height,2);
  assert.equal(a.structuralIntegrity,'JPEG_MARKER_BOUNDS_ONLY');assert.equal(a.decodedPixelIntegrityVerified,false);
  assert.equal(a.providerByteIdentityVerified,false);assert.equal(a.approvalVerified,false);
});
test('one JPEG source accepted structurally; duplicates and empty sets rejected',()=>{
  const a=jpeg();const r=set([a],opts);assert.equal(r.images.length,1);assert.equal(r.distinctPixelHashesVerified,false);
  assert.throws(()=>set([a,a],opts),/DUPLICATE_BYTES/);assert.throws(()=>set([],opts),/INVALID_ASSET_SET/);
});
test('rejects truncation, trailing bytes, invalid signature, dimensions, progressive, metadata',()=>{
  const a=jpeg();assert.throws(()=>verify(a.subarray(0,-2),opts),/MISSING_EOI/);
  assert.throws(()=>verify(jpeg({trailing:Buffer.from([0])}),opts),/TRAILING_BYTES/);
  const bad=Buffer.from(a);bad[0]=0;assert.throws(()=>verify(bad,opts),/BAD_SIGNATURE/);
  assert.throws(()=>verify(jpeg({width:3}),opts),/DIMENSION_MISMATCH/);
  assert.throws(()=>verify(jpeg({sof:0xc2}),opts),/UNSUPPORTED_FRAME_TYPE/);
  for(const app of [0xe1,0xe2,0xee])assert.throws(()=>verify(jpeg({app}),opts),/UNSUPPORTED_RENDERING_METADATA/);
});
test('rejects false EOI inside entropy and accepts byte-stuffed FF and restart markers',()=>{
  assert.throws(()=>verify(jpeg({entropy:Buffer.concat([Buffer.alloc(60,3),Buffer.from([255,217]),Buffer.alloc(20,3)])}),opts),/TRAILING_BYTES/);
  const entropy=Buffer.concat([Buffer.alloc(50,3),Buffer.from([255,0,255,208]),Buffer.alloc(30,4)]);
  assert.equal(verify(jpeg({entropy}),opts).format,'JPEG');
});
