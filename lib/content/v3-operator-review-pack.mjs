// Offline operator review surface for CONTENT V3. This is evidence for a human,
// never a signed review, BCI issuance, reservation or permission to publish.
import {createHash} from 'node:crypto';
const deny=()=>{throw Error('CONTENT_V3_REVIEW_PACK_DENIED');};
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sha=b=>createHash('sha256').update(b).digest('hex');
const png=b=>b instanceof Uint8Array&&b.length>=24&&
  Buffer.from(b.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&
  Buffer.from(b).readUInt32BE(16)>0&&Buffer.from(b).readUInt32BE(20)>0;
export function createContentV3OperatorReviewHtml({envelope,mediaBytes}){
  try{
    if(!envelope||envelope.schemaVersion!==3||envelope.product!=='content'||
      envelope.executionAllowed!==false||!Array.isArray(mediaBytes)||
      mediaBytes.length<2||mediaBytes.length>6||
      !Array.isArray(envelope.shotMediaBindings)||
      envelope.shotMediaBindings.length!==mediaBytes.length||
      !Array.isArray(envelope.orderedMediaDigests)||
      envelope.orderedMediaDigests.length!==mediaBytes.length||
      !mediaBytes.every(png)||!envelope.script||!envelope.copy||
      !envelope.destination||!envelope.proofEnvelopeId)deny();
    const bytes=mediaBytes.map(x=>Buffer.from(x));
    const shots=bytes.map((b,i)=>{
      const item=envelope.shotMediaBindings[i],digest=envelope.orderedMediaDigests[i];
      if(item.shotIndex!==i+1||item.sourceSha256!==sha(b)||
        digest.sourceSha256!==sha(b)||item.mediaSlot!==digest.slot||
        item.shot!==envelope.script.shots?.[i])deny();
      return '<figure><img alt="Original PNG shot '+(i+1)+'" src="data:image/png;base64,'+
        b.toString('base64')+'"><figcaption>Shot '+(i+1)+': '+esc(item.shot)+
        '<br>Original SHA-256: <code>'+sha(b)+'</code></figcaption></figure>';
    });
    const fields=Object.entries(envelope.script).filter(([k])=>k!=='shots')
      .map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('');
    const copy=esc(JSON.stringify(envelope.copy,null,2));
    const dest=esc(JSON.stringify(envelope.destination,null,2));
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'">'+
      '<title>CONTENT V3 Original Pack — Human Review Required</title>'+
      '<style>body{font:16px system-ui;max-width:850px;margin:2rem auto;padding:0 1rem;line-height:1.5}'+
      'figure{margin:2rem 0;padding:1rem;border:1px solid #ccc}img{max-width:100%;height:auto}'+
      'dt{font-weight:bold;margin-top:1rem}dd{margin:0}code{overflow-wrap:anywhere}pre{white-space:pre-wrap}</style>'+
      '<h1>CONTENT V3 — Original Media &amp; Script Review</h1>'+
      '<p><strong>NOT APPROVED. NOT AUTHORIZED TO PUBLISH.</strong> This offline pack contains no human signature.</p>'+
      '<p>Proof envelope: <code>'+esc(envelope.proofEnvelopeId)+'</code></p>'+
      '<h2>Script</h2><dl>'+fields+'</dl><h2>Ordered original PNG media</h2>'+
      shots.join('')+'<h2>Proposed copy</h2><pre>'+copy+
      '</pre><h2>Destination (not dispatched)</h2><pre>'+dest+
      '</pre><p>Human reviewer must independently check semantic accuracy, rights, claims, copy and destination in the authenticated BCI review flow.</p></html>';
  }catch{return deny();}
}
