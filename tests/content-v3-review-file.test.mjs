import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {renderContentV3ReviewFile} from '../scripts/content-v3-review-file.mjs';

test('offline V3 operator export rejects parent traversal before accessing originals',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'content-v3-review-'));
 try{
  const manifest=join(dir,'manifest.json'),out=join(dir,'review.html');
  await writeFile(manifest,JSON.stringify({envelope:{},mediaFiles:['../outside.png','second.png']}));
  await assert.rejects(renderContentV3ReviewFile({manifestPath:manifest,outputPath:out}),
    /CONTENT_REVIEW_MEDIA_PATH_DENIED/);
  await assert.rejects(readFile(out));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('offline V3 operator export refuses invalid evidence and does not create output',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'content-v3-review-'));
 try{
  const manifest=join(dir,'manifest.json'),out=join(dir,'review.html');
  await writeFile(join(dir,'a.png'),Buffer.alloc(30));
  await writeFile(join(dir,'b.png'),Buffer.alloc(30));
  await writeFile(manifest,JSON.stringify({envelope:{schemaVersion:3},mediaFiles:['a.png','b.png']}));
  await assert.rejects(renderContentV3ReviewFile({manifestPath:manifest,outputPath:out}),
    /CONTENT_V3_REVIEW_PACK_DENIED/);
  await assert.rejects(readFile(out));
 }finally{await rm(dir,{recursive:true,force:true});}
});
