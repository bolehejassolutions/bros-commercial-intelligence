// BROS CONTENT: offline source-byte PNG integrity and decoded-pixel identity gate.
// Does not attest approval, editorial suitability, or provider-hosted media bytes.
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]),MAX_BYTES=12*1024*1024,MAX_PIXELS=12_000_000;
const CRC_TABLE=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=CRC_TABLE[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function fail(code){throw Error(`PNG_QA_${code}`);}
function paeth(a,b,c){const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c;}
function decodedPixelHash(inflated,width,height,channels){
  const stride=width*channels,hash=createHash('sha256');
  const header=Buffer.alloc(9);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=channels;
  hash.update(header);
  let previous=Buffer.alloc(stride);
  for(let y=0;y<height;y++){
    const start=y*(stride+1),filter=inflated[start],current=Buffer.allocUnsafe(stride);
    if(filter>4)fail('INVALID_SCANLINE_FILTER');
    for(let x=0;x<stride;x++){
      const raw=inflated[start+1+x],left=x>=channels?current[x-channels]:0,up=previous[x],upperLeft=x>=channels?previous[x-channels]:0;
      const predictor=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,upperLeft);
      current[x]=(raw+predictor)&255;
    }
    hash.update(current);
    previous=current;
  }
  return hash.digest('hex');
}
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
    // A source declared as a static PNG must not silently contain animation frames.
    // RGB tRNS changes rendered transparency but is absent from the raw RGB pixel hash.
    // Fail closed until an animation/alpha-aware decoder is explicitly supported.
    if(['acTL','fcTL','fdAT'].includes(name))fail('UNSUPPORTED_ANIMATED_PNG');
    if(name==='tRNS')fail('UNSUPPORTED_COLOR_KEY_TRANSPARENCY');
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
  const pixelSha256=decodedPixelHash(inflated,ihdr.width,ihdr.height,ihdr.channels);
  return Object.freeze({format:'PNG',width:ihdr.width,height:ihdr.height,bytes:input.length,sha256:createHash('sha256').update(input).digest('hex'),pixelSha256,structuralIntegrity:'CRC_AND_DEFLATE_VALID',pixelSemanticsReviewed:false,providerByteIdentityVerified:false});
}
export function verifyDistinctPngSources(inputs,options={}){
  if(!Array.isArray(inputs)||inputs.length<2||inputs.length>20)fail('INVALID_ASSET_SET');
  const results=inputs.map(x=>verifyPngSourceBytes(x,options));
  if(new Set(results.map(x=>x.sha256)).size!==results.length)fail('DUPLICATE_BYTES');
  if(new Set(results.map(x=>x.pixelSha256)).size!==results.length)fail('DUPLICATE_PIXELS');
  return Object.freeze({status:'SOURCE_BYTES_STRUCTURALLY_VERIFIED',images:results,distinctFileHashes:true,distinctPixelHashes:true,visualDistinctnessVerified:false,approvalVerified:false,publishedVerified:false});
}
