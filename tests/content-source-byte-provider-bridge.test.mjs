import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {inspectContentFetchedSourceBytes as inspect} from '../lib/content/source-byte-provider-bridge.mjs';

// Synthetic image bytes. No Buffer, platform or approval credentials are used.
const sig=Buffer.from([137,80,78,71,13,10,26,10]);
const table=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(b){let c=0xffffffff;for(const v of b)c=table[(c^v)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(type,data){
  const n=Buffer.alloc(4),sum=Buffer.alloc(4),body=Buffer.concat([Buffer.from(type),data]);
  n.writeUInt32BE(data.length);sum.writeUInt32BE(crc(body));
  return Buffer.concat([n,body,sum]);
}
function png(pixel=10,level=6){
  const h=Buffer.alloc(13);h.writeUInt32BE(2,0);h.writeUInt32BE(2,4);h[8]=8;h[9]=2;
  const rows=Buffer.alloc(14,pixel);rows[0]=0;rows[7]=0;
  return Buffer.concat([sig,chunk('IHDR',h),chunk('IDAT',deflateSync(rows,{level})),chunk('IEND',Buffer.alloc(0))]);
}
const seg=(marker,payload)=>{
  const b=Buffer.alloc(payload.length+4);b[0]=255;b[1]=marker;
  b.writeUInt16BE(payload.length+2,2);payload.copy(b,4);return b;
};
function jpeg(){
  const frame=Buffer.alloc(15);frame[0]=8;frame.writeUInt16BE(2,1);frame.writeUInt16BE(2,3);frame[5]=3;
  return Buffer.concat([Buffer.from([255,216]),seg(0xdb,Buffer.from([0,1])),
    seg(0xc0,frame),seg(0xc4,Buffer.from([0,1])),
    seg(0xda,Buffer.from([3,1,0,2,0,3,0,0,63,0])),
    Buffer.alloc(80,3),Buffer.from([255,217])]);
}
const urls=['https://drive.google.com/uc?id=content-01','https://drive.google.com/uc?id=content-02'];
const scope={tenantId:'tenant-A',product:'content',instanceId:'internal-sell',
  contentId:'post-brief-01',channelService:'instagram',channelId:'ig123',
  expectedAssetCount:2};
const post={id:'post123',status:'sent',channelService:'instagram',channelId:'ig123',
  sentAt:'2026-10-27T01:00:00.000Z',externalLink:'https://www.instagram.com/p/ABC/',
  assets:urls.map(source=>({type:'image',source,mimeType:'image/png'})),
  text:'Contoh penerangan jualan',metadata:{isAiGenerated:false},
  metricsUpdatedAt:null,metrics:null};
const src=(bytes,url,mimeType='image/png')=>({bytes,url,mimeType});
const options={expectedWidth:2,expectedHeight:2};

test('actual independent PNG bytes are decoded and matched without inventing provider approval',()=>{
  const r=inspect(post,scope,[src(png(10),urls[0]),src(png(20),urls[1])],options);
  assert.equal(r.status,'SOURCE_REFERENCES_MATCHED_UNATTESTED');
  assert.equal(r.sourceBytesRevalidatedByModule,true);
  assert.equal(r.sourcePixelIntegrityVerified,true);
  assert.equal(r.sourceIntegrityLevel,'PNG_DECODED_PIXEL_HASH');
  assert.notEqual(r.sourcePixelSha256[0],r.sourcePixelSha256[1]);
  assert.equal(r.providerByteIdentityVerified,false);
  assert.equal(r.providerAttestedByModule,false);
  assert.equal(r.approvalVerified,false);
  assert.equal(r.executionAllowed,false);
});
test('reordered provider asset references cannot inherit original source-byte QA',()=>{
  const reversed={...post,assets:[...post.assets].reverse()};
  const r=inspect(reversed,scope,[src(png(10),urls[0]),src(png(20),urls[1])],options);
  assert.equal(r.status,'REVIEW_REQUIRED');
  assert.ok(r.flags.includes('SOURCE_PROVIDER_REFERENCE_MISMATCH'));
  assert.equal(r.providerByteIdentityVerified,false);
});
test('CRC-corrupt, mislabeled, duplicate-pixel and empty image bytes fail closed',()=>{
  const damaged=Buffer.from(png(10));damaged[29]^=1;
  for(const bytes of [damaged,jpeg()])
    assert.throws(()=>inspect(post,scope,[src(bytes,urls[0]),src(png(20),urls[1])],options),/PNG_QA_/);
  assert.throws(()=>inspect(post,scope,[src(png(10,1),urls[0]),src(png(10,9),urls[1])],options),
    /PNG_QA_DUPLICATE_(BYTES|PIXELS)/);
  assert.throws(()=>inspect(post,scope,[src(Buffer.alloc(0),urls[0])],options),/FETCHED_SOURCE_BYTES_LIMIT/);
});
test('JPEG marker QA is explicitly weaker and cannot claim decoded-pixel identity',()=>{
  const singleScope={...scope,expectedAssetCount:1};
  const singlePost={...post,assets:[{type:'image',source:urls[0],mimeType:'image/jpeg'}]};
  const r=inspect(singlePost,singleScope,[src(jpeg(),urls[0],'image/jpeg')],options);
  assert.equal(r.status,'REVIEW_REQUIRED');
  assert.ok(r.flags.includes('JPEG_PIXEL_DECODE_NOT_ATTESTED'));
  assert.equal(r.sourceBytesRevalidatedByModule,true);
  assert.equal(r.sourceIntegrityLevel,'JPEG_MARKER_BOUNDS_ONLY');
  assert.equal(r.sourcePixelIntegrityVerified,false);
  assert.equal(r.providerByteIdentityVerified,false);
});
test('scheduled post remains NOT_SENT even with independently valid source bytes',()=>{
  const r=inspect({...post,status:'scheduled'},scope,
    [src(png(10),urls[0]),src(png(20),urls[1])],options);
  assert.equal(r.status,'NOT_SENT');
  assert.equal(r.executionAllowed,false);
});
test('unsupported mixed formats and caller-forged QA summaries cannot bypass raw-byte input',()=>{
  assert.throws(()=>inspect(post,scope,[src(png(10),urls[0]),src(jpeg(),urls[1],'image/jpeg')],options),
    /MIXED_SOURCE_FORMAT_NOT_SUPPORTED/);
  assert.throws(()=>inspect(post,scope,[{bytes:{sha256:'a'.repeat(64)},url:urls[0],mimeType:'image/png'}],options),
    /INVALID_FETCHED_SOURCE/);
  assert.throws(()=>inspect(post,scope,[],options),/INVALID_FETCHED_SOURCE_SET/);
});

test('distinct image bytes cannot be matched to a repeated source URL',()=>{
  const duplicatedUrls=[urls[0],urls[0]];
  const duplicatedPost={...post,assets:duplicatedUrls.map(source=>({
    type:'image',source,mimeType:'image/png'
  }))};
  assert.throws(()=>inspect(duplicatedPost,scope,[
    src(png(10),duplicatedUrls[0]),src(png(20),duplicatedUrls[1])
  ],options),/INVALID_SOURCE_REFERENCE_MANIFEST/);
});
