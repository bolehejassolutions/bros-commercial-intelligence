/** Original CONTENT packs are build-owned files outside public/. The browser
 * selects a known proof ID; it cannot choose a path, URL, tenant or QA result.
 */
import {readFile,realpath} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {prepareContentInstanceScriptProofEnvelope} from '../content/instance-editorial-script-proof.mjs';
import {prepareLocalContentEditorialHandoff} from '../content/local-render-editorial-handoff.mjs';
const deny=()=>{throw Error('CONTENT_REVIEW_SOURCE_UNAVAILABLE');};
const hash=x=>createHash('sha256').update(x).digest('hex');
const PROOF=/^content-instance-script-proof-[a-f0-9]{64}$/;
const FILE=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/;
export function createContentReviewSourceStore(root=resolve(process.cwd(),'content-review-sources')) {
  async function registry(){
    const home=await realpath(root);
    const raw=await readFile(join(home,'index.json'),'utf8');
    if(Buffer.byteLength(raw)>65536)deny();
    const index=JSON.parse(raw);
    if(index.schemaVersion!==1||!Array.isArray(index.sources)||index.sources.length>50)deny();
    return {home,items:index.sources};
  }
  async function load(scope,proofId){
    if(scope?.product!=='content'||typeof scope.tenantId!=='string'||!PROOF.test(proofId))deny();
    const {home,items}=await registry();
    const matches=items.filter(x=>x.proofEnvelopeId===proofId&&x.tenantId===scope.tenantId);
    if(matches.length!==1)deny();
    const entry=matches[0];
    if(!FILE.test(entry.directory)||!/^[a-f0-9]{64}$/.test(entry.sourceSha256))deny();
    const directory=await realpath(join(home,entry.directory));
    if(!directory.startsWith(home+sep))deny();
    const sourceBytes=await readFile(join(directory,'source.json'));
    if(sourceBytes.length>131072||hash(sourceBytes)!==entry.sourceSha256)deny();
    const source=JSON.parse(sourceBytes.toString('utf8'));
    if(source.schemaVersion!==1||source.instanceConfig?.tenantId!==scope.tenantId||
       !Array.isArray(source.mediaFilenames)||source.mediaFilenames.length<2||
       source.mediaFilenames.length>6||!source.mediaFilenames.every(x=>FILE.test(x)&&x.endsWith('.png')))deny();
    const originals=[];
    for(const name of source.mediaFilenames){
      const path=await realpath(join(directory,name));
      if(!path.startsWith(directory+sep))deny();
      const bytes=await readFile(path);if(bytes.length>12*1024*1024)deny();originals.push(bytes);
    }
    // Reuse CONTENT's full independent CRC/deflate/pixel/copy/plan gates.
    const rebuild=bytes=>prepareContentInstanceScriptProofEnvelope(source.instanceConfig,
      source.brief,source.script,source.resourceMapping,bytes,source.proposedCopy);
    const envelope=rebuild(originals);
    const handoff=prepareLocalContentEditorialHandoff(source.instanceConfig,source.brief,
      source.rendererManifest,originals,source.proposedCopy);
    if(envelope.schemaVersion!==3||envelope.proofEnvelopeId!==proofId||
       envelope.automatedReviewFlags.length!==0||handoff.automatedReviewFlags.length!==0)deny();
    return Object.freeze({envelope,mediaBytes:originals.map(x=>Buffer.from(x)),handoff,
      title:entry.title,
      verifyCompleteScriptSourceContext:async(pinned,bytes)=>{
        try{
          if(!Array.isArray(bytes)||bytes.length!==originals.length||
             bytes.some((x,i)=>!Buffer.from(x).equals(originals[i]))||
             !isDeepStrictEqual(pinned.envelope,envelope)||
             !isDeepStrictEqual(rebuild(bytes),envelope))return false;
          const editorial=pinned.receipt?.editorial?.payload;
          return editorial?.handoffId===handoff.handoffId&&
            isDeepStrictEqual(editorial.checkResults,
              handoff.requiredHumanChecks.map(check=>({check,passed:true})));
        }catch{return false;}
      }});
  }
  return Object.freeze({load,
    list:async scope=>{
      if(scope?.product!=='content')deny();
      const {items}=await registry();
      return items.filter(x=>x.tenantId===scope.tenantId).map(x=>{
        if(!PROOF.test(x.proofEnvelopeId)||typeof x.title!=='string'||x.title.length>160)deny();
        return {proofEnvelopeId:x.proofEnvelopeId,title:x.title};
      });
    }});
}
