#!/usr/bin/env node
// Offline operator review artifact from a server-exported V3 envelope and original PNG files.
// No reviewer signature, BCI approval, reservation, or publishing is performed.
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {createContentV3OperatorReviewHtml} from '../lib/content/v3-operator-review-pack.mjs';

export async function renderContentV3ReviewFile({manifestPath,outputPath}){
  if(typeof manifestPath!=='string'||typeof outputPath!=='string')throw Error('CONTENT_REVIEW_INPUT_REQUIRED');
  const manifestFile=await realpath(resolve(manifestPath));
  const base=dirname(manifestFile);
  const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
  if(!manifest||Object.keys(manifest).sort().join(',')!=='envelope,mediaFiles'||
     !Array.isArray(manifest.mediaFiles)||manifest.mediaFiles.length<2||
     manifest.mediaFiles.length>6)throw Error('CONTENT_REVIEW_MANIFEST_DENIED');
  const media=[];
  for(const file of manifest.mediaFiles){
    if(typeof file!=='string'||!file.endsWith('.png')||isAbsolute(file)||
       file.includes('\\')||file.split('/').includes('..'))throw Error('CONTENT_REVIEW_MEDIA_PATH_DENIED');
    const path=await realpath(resolve(base,file));
    const rel=relative(base,path);
    if(rel.startsWith('..')||isAbsolute(rel))throw Error('CONTENT_REVIEW_MEDIA_PATH_DENIED');
    const bytes=await readFile(path);
    if(bytes.length>10*1024*1024)throw Error('CONTENT_REVIEW_MEDIA_TOO_LARGE');
    media.push(bytes);
  }
  const html=createContentV3OperatorReviewHtml({envelope:manifest.envelope,mediaBytes:media});
  await writeFile(resolve(outputPath),html,{flag:'wx',mode:0o600});
  return {outputPath:resolve(outputPath),mediaCount:media.length};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
  if(process.argv.length!==4){
    process.stderr.write('Usage: node scripts/content-v3-review-file.mjs manifest.json output.html\\n');
    process.exitCode=2;
  }else{
    renderContentV3ReviewFile({manifestPath:process.argv[2],outputPath:process.argv[3]})
      .then(x=>process.stdout.write('Created offline review: '+x.outputPath+' ('+x.mediaCount+' originals)\\n'))
      .catch(e=>{process.stderr.write(e.message+'\\n');process.exitCode=1;});
  }
}
