import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {verifyPngSourceBytes as verify,verifyDistinctPngSources as set} from '../lib/content/png-source-qa.mjs';
const sig=Buffer.from([137,80,78,71,13,10,26,10]);
const table=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(b){let c=0xffffffff;for(const v of b)c=table[(c^v)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(type,data){const n=Buffer.alloc(4),sum=Buffer.alloc(4),body=Buffer.concat([Buffer.from(type),data]);n.writeUInt32BE(data.length);sum.writeUInt32BE(crc(body));return Buffer.concat([n,body,sum]);}
function png(pixel=10,opts={}){const w=opts.w??2,h=opts.h??2;const header=Buffer.alloc(13);header.writeUInt32BE(w,0);header.writeUInt32BE(h,4);header[8]=8;header[9]=2;header[12]=opts.interlace??0;const rows=Buffer.alloc(h*(1+w*3),pixel);for(let y=0;y<h;y++)rows[y*(1+w*3)]=0;return Buffer.concat([sig,chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}
const opts={expectedWidth:2,expectedHeight:2};
test('valid independent PNG source bytes return distinct hashes and bounded provenance',()=>{const r=set([png(10),png(20)],opts);assert.equal(r.images.length,2);assert.equal(r.distinctFileHashes,true);assert.equal(r.visualDistinctnessVerified,false);assert.equal(r.approvalVerified,false);assert.equal(r.images[0].structuralIntegrity,'CRC_AND_DEFLATE_VALID');});
test('duplicate source bytes fail closed',()=>assert.throws(()=>set([png(),png()],opts),/DUPLICATE_BYTES/));
test('rejects corrupt CRC, truncated file and trailing bytes',()=>{const a=png();const bad=Buffer.from(a);bad[29]^=1;for(const b of [bad,a.subarray(0,-2),Buffer.concat([a,Buffer.from([0])])])assert.throws(()=>verify(b,opts),/PNG_QA_/);});
test('rejects wrong dimensions, interlace, unsupported JPEG and excessive dimensions',()=>{assert.throws(()=>verify(png(),{expectedWidth:1080,expectedHeight:1350}),/DIMENSION_MISMATCH/);assert.throws(()=>verify(png(10,{interlace:1}),opts),/UNSUPPORTED_PNG_FORMAT/);assert.throws(()=>verify(Buffer.from([0xff,0xd8,0xff]),opts),/PNG_QA_/);assert.throws(()=>verify(png(10,{w:6000,h:3000}),{expectedWidth:6000,expectedHeight:3000}),/PIXEL_LIMIT/);});
test('rejects invalid scanline filter despite valid CRC and deflate',()=>{const h=Buffer.alloc(13);h.writeUInt32BE(2);h.writeUInt32BE(2,4);h[8]=8;h[9]=2;const rows=Buffer.alloc(14,1);rows[0]=5;rows[7]=0;const b=Buffer.concat([sig,chunk('IHDR',h),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);assert.throws(()=>verify(b,opts),/INVALID_SCANLINE_FILTER/);});
