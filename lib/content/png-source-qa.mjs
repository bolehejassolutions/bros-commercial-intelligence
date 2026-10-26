// BROS CONTENT: offline source-byte PNG integrity gate; no provider or approval attestation.
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]),MAX_BYTES=12*1024*1024,MAX_PIXELS=12_000_000;
const CRC_TABLE=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=CRC_TABLE[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function fail(code){throw Error(`PNG_QA_${code}`);}
export function verifyPngSourceBytes(input,{expectedWidth=1080,expectedHeight=1350}={}){
  if(!Buffer.isBuffer(input)||input.length<57||input.length>MAX_BYTES)fail('INVALID_BYTES');
  if(!input.subarray(0,8).equals(SIGNATURE))fail('BAD_SIGNATURE');
  let offset=8,ihdr=null,seenIdat=false,seenIend=false,idatClosed=false;
  const data=[];
  while(offset<input.length){
    if(offset+12>input.length)fail('TRUNCATED_CHUNK');
    const len=input.readUInt32BE(offset),end=offset+12+len;
    if(len>MAX_BYTES||end>input.length)fail('TRUNCATED_CHUNK');
    const name=input.toString('ascii',offset+4,offset+8);
    const raw=input.subarray(offset+4,offset+8+len);
    if(crc32(raw)!==input.readUInt32BE(offset+8+len))fail('BAD_CRC');
    const bytes=input.subarray(offset+8,offset+8+len);
    if(!/^[A-Za-z]{4}$/.test(name))fail('INVALID_CHUNK_TYPE');
    if(ihdr===null&&name!=='IHDR')fail('MISSING_IHDR');
    if(name==='IHDR'){
      if(ihdr!==null||offset!==8||len!==13)fail('BAD_IHDR');
      const width=bytes.readUInt32BE(0),height=bytes.readUInt32BE(4);
      const depth=bytes[8],color=bytes[9],compression=bytes[10],filter=bytes[11],interlace=bytes[12];
      if(!width||!height||width*height>MAX_PIXELS)fail('PIXEL_LIMIT');
      if(width!==expectedWidth||height!==expectedHeight)fail('DIMENSION_MISMATCH');
      if(depth!==8||![2,6].includes(color)||compression!==0||filter!==0||interlace!==0)fail('UNSUPPORTED_PNG_FORMAT');
      ihdr={width,height,channels:color===6?4:3};
    }else if(name==='IDAT'){
      if(idatClosed)fail('NONCONTIGUOUS_IDAT');
      seenIdat=true;data.push(bytes);
    }else if(name==='IEND'){
      if(!seenIdat||len!==0||end!==input.length)fail('BAD_IEND');
      seenIend=true;
    }else if((name.charCodeAt(0)&32)===0)fail('UNKNOWN_CRITICAL_CHUNK');
    if(name!=='IDAT'&&seenIdat)idatClosed=true;
    offset=end;
    if(seenIend)break;
  }
  if(!seenIend||!seenIdat)fail('INCOMPLETE_IMAGE');
  const rowBytes=ihdr.width*ihdr.channels,expected=ihdr.height*(rowBytes+1);
  let inflated;
  try{inflated=inflateSync(Buffer.concat(data),{maxOutputLength:expected+1});}
  catch{fail('INVALID_COMPRESSED_PIXELS');}
  if(inflated.length!==expected)fail('INVALID_PIXEL_LENGTH');
  for(let y=0;y<ihdr.height;y++)if(inflated[y*(rowBytes+1)]>4)fail('INVALID_SCANLINE_FILTER');
  return Object.freeze({format:'PNG',width:ihdr.width,height:ihdr.height,bytes:input.length,sha256:createHash('sha256').update(input).digest('hex'),structuralIntegrity:'CRC_AND_DEFLATE_VALID',pixelSemanticsReviewed:false,providerByteIdentityVerified:false});
}
export function verifyDistinctPngSources(inputs,options={}){
  if(!Array.isArray(inputs)||inputs.length<2||inputs.length>20)fail('INVALID_ASSET_SET');
  const results=inputs.map(x=>verifyPngSourceBytes(x,options));
  if(new Set(results.map(x=>x.sha256)).size!==results.length)fail('DUPLICATE_BYTES');
  return Object.freeze({status:'SOURCE_BYTES_STRUCTURALLY_VERIFIED',images:results,distinctFileHashes:true,visualDistinctnessVerified:false,approvalVerified:false,publishedVerified:false});
}
