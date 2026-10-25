import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inspectContentSourceImage } from '../lib/content/source-image-attestation.ts';

// Synthetic container fixtures only; not actual Drive or Buffer media.
function png(width=1080,height=1350) {
  const b=Buffer.alloc(45);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(b,0);
  b.writeUInt32BE(13,8);b.write('IHDR',12);
  b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);
  b[24]=8;b[25]=2;b.write('IEND',37);
  return b;
}
function jpeg(width=1080,height=1920) {
  return Buffer.from([255,216,255,192,0,11,8,height>>8,height&255,width>>8,width&255,3,1,17,0,255,217]);
}
const denied=/Invalid or unsupported CONTENT source image/;
test('PNG source is identified by bytes and hash, not provider MIME',()=>{
  const b=png();const r=inspectContentSourceImage(b,{declaredSourceMime:'image/png',providerReportedMime:'image/jpeg'});
  assert.equal(r.detectedMime,'image/png');assert.equal(r.width,1080);assert.equal(r.height,1350);
  assert.equal(r.sha256,createHash('sha256').update(b).digest('hex'));
  assert.deepEqual(r.warnings,['provider_mime_differs_from_source']);
  assert.equal(r.verification,'source_container_only');assert.equal(r.publishedBytesVerified,false);
});
test('JPEG source recognized without falsely claiming full decode',()=>{
  const r=inspectContentSourceImage(jpeg(),{declaredSourceMime:'image/jpeg',providerReportedMime:'image/jpeg'});
  assert.equal(r.detectedMime,'image/jpeg');assert.equal(r.width,1080);assert.equal(r.height,1920);
  assert.deepEqual(r.warnings,[]);assert.equal(r.publishedBytesVerified,false);
});
test('missing metadata is unknown, not a successful provider match',()=>{
  const r=inspectContentSourceImage(png());
  assert.equal(r.sourceMimeMatches,null);assert.equal(r.providerMimeMatchesSource,null);
});
test('source metadata mismatch is distinguished from provider mismatch',()=>{
  const r=inspectContentSourceImage(png(),{declaredSourceMime:'image/jpeg'});
  assert.deepEqual(r.warnings,['source_mime_mismatch']);
});
test('rejects fake, truncated and impossible PNG containers',()=>{
  for(const b of [Buffer.alloc(45),png(0,10),png(20000,10),png().subarray(0,33),
    Buffer.from(png()).fill(0,37,45)]) assert.throws(()=>inspectContentSourceImage(b),denied);
});
test('rejects fake, truncated and impossible JPEG containers',()=>{
  for(const b of [Buffer.from([255,216,255,192,0,11,8,0,0,0,0,3,1,17,0,255,217]),
    jpeg().subarray(0,15),Buffer.from(jpeg()).fill(0,15,17),
    Buffer.from([255,216,255,192,0,255,8,0,1,0,1,3,1,17,0,255,217])])
    assert.throws(()=>inspectContentSourceImage(b),denied);
});
test('rejects oversized source and invalid metadata',()=>{
  assert.throws(()=>inspectContentSourceImage(new Uint8Array(20*1024*1024+1)),denied);
  assert.throws(()=>inspectContentSourceImage(png(),{providerReportedMime:42}),denied);
});
