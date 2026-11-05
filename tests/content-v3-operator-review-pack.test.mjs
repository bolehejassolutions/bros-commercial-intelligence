import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentV3OperatorReviewHtml} from '../lib/content/v3-operator-review-pack.mjs';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const png=()=>{const b=Buffer.alloc(32);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(1,16);b.writeUInt32BE(1,20);return b;};
function fixture(){
 const mediaBytes=[png(),png()];
 const envelope={schemaVersion:3,product:'content',executionAllowed:false,
  proofEnvelopeId:'proof-1',script:{openingHook:'Explain <why>',shots:['First','Second']},
  copy:{caption:'Safe & clear'},destination:{channelService:'facebook',channelId:'page-1'},
  shotMediaBindings:mediaBytes.map((b,i)=>({shotIndex:i+1,shot:['First','Second'][i],mediaSlot:i+1,sourceSha256:sha(b)})),
  orderedMediaDigests:mediaBytes.map((b,i)=>({slot:i+1,sourceSha256:sha(b)}))};
 return {envelope,mediaBytes};
}
test('operator pack renders original ordered bytes, escaped script and no authorization',()=>{
 const f=fixture(),html=createContentV3OperatorReviewHtml(f);
 assert.match(html,/NOT APPROVED\. NOT AUTHORIZED TO PUBLISH/);
 assert.match(html,/Explain &lt;why&gt;/);
 assert.doesNotMatch(html,/Explain <why>/);
 assert.equal((html.match(/data:image\/png;base64,/g)||[]).length,2);
 assert.match(html,new RegExp(sha(f.mediaBytes[0])));
 assert.match(html,/Content-Security-Policy/);
});
test('source-byte mismatch fails closed',()=>{
 const f=fixture();f.mediaBytes[1][24]=1;
 assert.throws(()=>createContentV3OperatorReviewHtml(f),/CONTENT_V3_REVIEW_PACK_DENIED/);
});
test('ordered shot substitution fails closed',()=>{
 const f=fixture();f.envelope.shotMediaBindings[0].shot='Substituted';
 assert.throws(()=>createContentV3OperatorReviewHtml(f),/CONTENT_V3_REVIEW_PACK_DENIED/);
});
test('never renders approved/dispatchable envelope',()=>{
 const f=fixture();f.envelope.executionAllowed=true;
 assert.throws(()=>createContentV3OperatorReviewHtml(f),/CONTENT_V3_REVIEW_PACK_DENIED/);
});
