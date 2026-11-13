import 'server-only';
import {Pool} from 'pg';
import {contentReviewSources as sources,readContentCreativeOriginal} from './content-review-source.mjs';
import {createNeonAuthPrincipalVerifier} from '../bci/neon-auth-principal.ts';
import {createNeonDevMembershipLookup} from '../bci/neon-dev-membership-rows.ts';
import {createPgReadOnlyTransaction,parseNeonDevConnection} from '../bci/neon-readonly-transaction.ts';
import {isNeonPreviewEnabled} from '../bci/neon-preview-handler.ts';
import {createNeonDevContentIssuanceRuntime} from '../bci/neon-content-issuance-private-runtime.ts';
import {createContentCreativeReuseHandler,readCreativeReuseConfiguration} from './content-creative-reuse.ts';
import {createContentReviewReadHandler} from './content-review-http.ts';
import {isDemandCreativeReusePreviewEnabled} from '../demand/meta-preview-ui-gate.ts';
import {demandMetaPilotRuntime} from '../demand/meta-direct-runtime.ts';
const authBase='https://ep-fancy-queen-b30g0cjn.neonauth.c-4.ap-southeast-1.aws.neon.tech/bros_intelligence_dev/auth';
const verify=createNeonAuthPrincipalVerifier({issuer:new URL(authBase).origin,
  audience:new URL(authBase).origin,jwksUrl:authBase+'/.well-known/jwks.json',
  approvedOperator:{email:'rasymokh@gmail.com'}});
let memberships:ReturnType<typeof createNeonDevMembershipLookup>|undefined;
async function membershipFor<Product extends "content"|"demand">(principalId:string,product:Product){
  if(!memberships){
    const config=parseNeonDevConnection(process.env.BCI_NEON_DEV_MEMBERSHIP_DATABASE_URL,'bci_dev_membership_reader');
    const pool=new Pool({...config,max:1,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,
      query_timeout:7000,allowExitOnIdle:true});pool.on('error',()=>{});
    memberships=createNeonDevMembershipLookup(createPgReadOnlyTransaction(pool));
  }
  const rows=await memberships(principalId,product);
  if(rows.length!==1||rows[0].principalId!==principalId||rows[0].active!==true||rows[0].product!==product)throw Error();
  return Object.freeze({principalId,tenantId:rows[0].tenantId,product});
}
async function scopeFor(token:string){
  return membershipFor((await verify(token)).userId,'content');
}
export const issueReviewedContent=createNeonDevContentIssuanceRuntime((scope,id)=>sources.load(scope,id));
export const handleContentCreativeReuse=createContentCreativeReuseHandler({
  enabled:()=>isNeonPreviewEnabled(process.env)&&process.env.BCI_CONTENT_DEMAND_REUSE==='enabled',
  configuration:()=>readCreativeReuseConfiguration(process.env),
  authorize:async token=>{
    const principal=await verify(token);
    const content=await membershipFor(principal.userId,'content');
    const demand=await membershipFor(principal.userId,'demand');
    if(content.tenantId!==demand.tenantId)throw Error();
    return content;
  },
  readOriginal:readContentCreativeOriginal,
  now:Date.now,
});

/** Authenticated GET read surface for actual packaged originals, never an
 * approval, publication or public asset endpoint. No browser source upload.
 */
export const handleContentReviewRead=createContentReviewReadHandler({
  mode:()=>isNeonPreviewEnabled(process.env)?'content':
    isDemandCreativeReusePreviewEnabled(process.env)?'demand-reuse':null,
  authorize:async(token,mode)=>mode==='content'?scopeFor(token):
    {...await demandMetaPilotRuntime.authorizeContentDemand(token),product:'content'},
  sources,
  setup:mode=>{
    const registeredKeyIds=Object.keys(JSON.parse(process.env.BCI_NEON_DEV_CONTENT_REVIEW_PUBLIC_KEYS||'{}'));
    if(mode==='demand-reuse')return {ready:false,missing:[],registeredKeyIds,demandReuseAvailable:true};
    const missing=[
      ...(process.env.BCI_NEON_DEV_CONTENT_APPROVALS!=='enabled'?['APPROVAL_RUNTIME_NOT_ENABLED']:[]),
      ...(!process.env.BCI_NEON_DEV_CONTENT_ISSUER_DATABASE_URL?['RESTRICTED_ISSUER_CONNECTION_MISSING']:[]),
      ...(!process.env.BCI_NEON_DEV_CONTENT_REVIEW_PUBLIC_KEYS?['REVIEWER_PUBLIC_KEY_NOT_REGISTERED']:[])
    ];
    return {ready:missing.length===0,missing,registeredKeyIds,
      demandReuseAvailable:process.env.BCI_CONTENT_DEMAND_REUSE==='enabled'};
  },
});
