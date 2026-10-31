// BROS CONTENT: bounded offline JPEG source-byte structural QA.
// This does NOT decode DCT pixels, prove editorial uniqueness, approval, or provider media identity.
import {createHash} from 'node:crypto';
const MAX_BYTES=12*1024*1024,MAX_PIXELS=12_000_000;
function fail(code){throw Error(`JPEG_QA_${code}`);}
const isSof=m=>[0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(m);
export function verifyJpegSourceBytes(input,{expectedWidth=1080,expectedHeight=1350}={}){
  if(!Buffer.isBuffer(input)||input.length<64||input.length>MAX_BYTES)fail('INVALID_BYTES');
  if(input[0]!==0xff||input[1]!==0xd8)fail('BAD_SIGNATURE');
  let at=2,frame=null,seenQuant=false,seenHuffman=false,seenScan=false,seenEnd=false,scanCount=0;
  while(at<input.length){
    if(input[at]!==0xff)fail('INVALID_MARKER_BOUNDARY');
    while(at<input.length&&input[at]===0xff)at++;
    if(at>=input.length)fail('TRUNCATED_MARKER');
    const marker=input[at++];
    if(marker===0xd9){
      if(!seenScan)fail('MISSING_SCAN');
      if(at!==input.length)fail('TRAILING_BYTES');
      seenEnd=true;break;
    }
    if(marker===0xd8||marker===0x00||marker===0x01||(marker>=0xd0&&marker<=0xd7))fail('UNEXPECTED_MARKER');
    if(at+2>input.length)fail('TRUNCATED_SEGMENT');
    const length=input.readUInt16BE(at),end=at+length;
    if(length<2||end>input.length)fail('TRUNCATED_SEGMENT');
    const payload=at+2;
    if(marker===0xe1||marker===0xe2||marker===0xee)fail('UNSUPPORTED_RENDERING_METADATA');
    if(isSof(marker)){
      if(marker!==0xc0)fail('UNSUPPORTED_FRAME_TYPE');
      if(frame||length!==17||input[payload]!==8||input[payload+5]!==3)fail('UNSUPPORTED_FRAME_FORMAT');
      const height=input.readUInt16BE(payload+1),width=input.readUInt16BE(payload+3);
      if(!width||!height||width*height>MAX_PIXELS)fail('PIXEL_LIMIT');
      if(width!==expectedWidth||height!==expectedHeight)fail('DIMENSION_MISMATCH');
      frame={width,height};
    }
    if(marker===0xdb)seenQuant=true;
    if(marker===0xc4)seenHuffman=true;
    if(marker===0xda){
      if(!frame||!seenQuant||!seenHuffman)fail('MISSING_DECODER_TABLES_OR_FRAME');
      if(seenScan||length!==12||input[payload]!==3)fail('UNSUPPORTED_SCAN_FORMAT');
      seenScan=true;scanCount++;
      at=end;
      let found=false;
      while(at<input.length-1){
        if(input[at]!==0xff){at++;continue;}
        const next=input[at+1];
        if(next===0x00||(next>=0xd0&&next<=0xd7)){at+=2;continue;}
        if(next===0xff){at++;continue;}
        found=true;break;
      }
      if(!found)fail('MISSING_EOI');
      continue;
    }
    at=end;
  }
  if(!seenEnd||!frame||!seenQuant||!seenHuffman||scanCount!==1)fail('INCOMPLETE_JPEG');
  return Object.freeze({format:'JPEG',width:frame.width,height:frame.height,bytes:input.length,
    sha256:createHash('sha256').update(input).digest('hex'),
    structuralIntegrity:'JPEG_MARKER_BOUNDS_ONLY',decodedPixelIntegrityVerified:false,
    visualDistinctnessVerified:false,approvalVerified:false,providerByteIdentityVerified:false});
}
export function verifyDistinctJpegSources(inputs,options={}){
  if(!Array.isArray(inputs)||inputs.length<1||inputs.length>20)fail('INVALID_ASSET_SET');
  const images=inputs.map(x=>verifyJpegSourceBytes(x,options));
  if(new Set(images.map(x=>x.sha256)).size!==images.length)fail('DUPLICATE_BYTES');
  return Object.freeze({status:'JPEG_SOURCE_STRUCTURE_VERIFIED_ONLY',images,distinctFileHashes:true,
    distinctPixelHashesVerified:false,visualDistinctnessVerified:false,approvalVerified:false,publishedVerified:false});
}
