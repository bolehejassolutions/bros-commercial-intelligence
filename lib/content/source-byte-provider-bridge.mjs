// CONTENT_SOURCE_BYTES_TO_SENT_BRIDGE_20261027_1948
// Offline CONTENT product-layer adapter: validate supplied original image bytes
// before comparing their source references to a provider-shaped SENT record.
// Caller must independently authenticate, fetch bytes safely, derive tenant scope,
// and attest provider origin. This function performs NONE of those actions.
import {verifyDistinctPngSources} from './png-source-qa.mjs';
import {verifyDistinctJpegSources} from './jpeg-source-qa.mjs';
import {inspectContentSourceToSentReferences} from './buffer-observation.mjs';

const MAX_TOTAL_SOURCE_BYTES=80*1024*1024;
export function inspectContentFetchedSourceBytes(post,scope,sources,options={}){
  if(!Array.isArray(sources)||sources.length<1||sources.length>20)
    throw Error('INVALID_FETCHED_SOURCE_SET');
  if(!options||typeof options!=='object'||Array.isArray(options))
    throw Error('INVALID_SOURCE_QA_OPTIONS');
  let total=0;
  for(const source of sources){
    if(!source||typeof source!=='object'||!Buffer.isBuffer(source.bytes)||
       typeof source.url!=='string'||
       !['image/png','image/jpeg'].includes(source.mimeType))
      throw Error('INVALID_FETCHED_SOURCE');
    total+=source.bytes.length;
    if(!source.bytes.length||total>MAX_TOTAL_SOURCE_BYTES)
      throw Error('FETCHED_SOURCE_BYTES_LIMIT');
  }
  const mimeType=sources[0].mimeType;
  if(sources.some(source=>source.mimeType!==mimeType))
    throw Error('MIXED_SOURCE_FORMAT_NOT_SUPPORTED');
  // The decoder selects format by actual magic/structure, not caller MIME alone.
  const buffers=sources.map(source=>source.bytes);
  const qa=mimeType==='image/png'?
    verifyDistinctPngSources(buffers,options):
    verifyDistinctJpegSources(buffers,options);
  const references=sources.map(source=>source.url);
  const match=inspectContentSourceToSentReferences(post,scope,qa,references);
  const decoded=mimeType==='image/png';
  return Object.freeze({...match,
    sourceBytesRevalidatedByModule:true,
    sourceIntegrityLevel:decoded?'PNG_DECODED_PIXEL_HASH':'JPEG_MARKER_BOUNDS_ONLY',
    sourcePixelIntegrityVerified:decoded,
    visualDistinctnessVerified:false,
    providerByteIdentityVerified:false,
    approvalVerified:false,
    providerAttestedByModule:false,
    executionAllowed:false});
}
