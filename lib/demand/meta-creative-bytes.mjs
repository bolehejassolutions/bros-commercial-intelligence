/** Server-side byte gate for CONTENT -> DEMAND handoff. No provider writes. */
import { createHash } from 'node:crypto';
import { prepareDemandCreativeIntake } from './meta-creative-intake.mjs';
const reject = () => { throw new Error('DEMAND_CREATIVE_BYTES_UNVERIFIED'); };
const hex = /^[a-f0-9]{64}$/;
const isBytes = v => Buffer.isBuffer(v) || v instanceof Uint8Array;
export function verifyDemandCreativeBytes(input, scope, bytes) {
  // The caller must retrieve bytes from its authorized tenant-scoped asset store.
  // Never accept client-supplied bytes as proof of asset ownership or editorial approval.
  if (!isBytes(bytes)) reject();
  const prepared = prepareDemandCreativeIntake(input, scope);
  if (bytes.byteLength !== prepared.mediaBytes || bytes.byteLength > 100000000) reject();
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (!hex.test(prepared.mediaSha256) || digest !== prepared.mediaSha256) reject();
  // Minimal file signatures; metadata alone must not establish a media type.
  const b = bytes;
  const png = b.length >= 8 && [137,80,78,71,13,10,26,10].every((x,i)=>b[i]===x);
  const jpg = b.length >= 4 && b[0]===255 && b[1]===216 && b[2]===255;
  const mp4 = b.length >= 12 && String.fromCharCode(...b.subarray(4,8))==='ftyp';
  if (!((prepared.mediaMime==='image/png'&&png)||(prepared.mediaMime==='image/jpeg'&&jpg)||(prepared.mediaMime==='video/mp4'&&mp4))) reject();
  return Object.freeze({...prepared, byteDigestVerified:true, providerMediaVerified:false, metaWriteAllowed:false, spendApproved:false});
}
