import 'server-only';
import {Pool} from 'pg';
import {createContentReviewSourceStore} from './content-review-source.mjs';
import {createNeonAuthPrincipalVerifier} from '../bci/neon-auth-principal.ts';
import {createNeonDevMembershipLookup} from '../bci/neon-dev-membership-rows.ts';
import {createPgReadOnlyTransaction,parseNeonDevConnection} from '../bci/neon-readonly-transaction.ts';
import {isNeonPreviewEnabled} from '../bci/neon-preview-handler.ts';
import {createNeonDevContentIssuanceRuntime} from '../bci/neon-content-issuance-private-runtime.ts';
const authBase='https://ep-fancy-queen-b30g0cjn.neonauth.c-4.ap-southeast-1.aws.neon.tech/bros_intelligence_dev/auth';
const verify=createNeonAuthPrincipalVerifier({issuer:new URL(authBase).origin,
  audience:new URL(authBase).origin,jwksUrl:authBase+'/.well-known/jwks.json',
  approvedOperator:{email:'rasymokh@gmail.com'}});
const sources=createContentReviewSourceStore();
const privateHeaders={'Cache-Control':'private, no-store, max-age=0',Pragma:'no-cache',
  Vary:'Authorization','X-Content-Type-Options':'nosniff'};
const response=(body:unknown,status:number)=>Response.json(body,{status,headers:privateHeaders});
let memberships:ReturnType<typeof createNeonDevMembershipLookup>|undefined;
async function scopeFor(token:string){
  const principal=await verify(token);
  if(!memberships){
    const config=parseNeonDevConnection(process.env.BCI_NEON_DEV_MEMBERSHIP_DATABASE_URL,'bci_dev_membership_reader');
    const pool=new Pool({...config,max:1,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,
      query_timeout:7000,allowExitOnIdle:true});pool.on('error',()=>{});
    memberships=createNeonDevMembershipLookup(createPgReadOnlyTransaction(pool));
  }
  const rows=await memberships(principal.userId,'content');
  if(rows.length!==1||rows[0].principalId!==principal.userId||rows[0].active!==true||rows[0].product!=='content')throw Error();
  return Object.freeze({principalId:principal.userId,tenantId:rows[0].tenantId,product:'content' as const});
}
export const issueReviewedContent=createNeonDevContentIssuanceRuntime((scope,id)=>sources.load(scope,id));

/** Authenticated GET read surface for actual packaged originals, never an
 * approval, publication or public asset endpoint. No browser source upload.
 */
export async function handleContentReviewRead(request:Request){
  if(!isNeonPreviewEnabled(process.env))return response({error:'Unavailable.'},404);
  if(request.method!=='GET')return response({error:'Method not allowed.'},405);
  try{
    const url=new URL(request.url);
    if(url.pathname!=='/api/internal/neon-content-review'||
       [...url.searchParams.keys()].some(k=>k!=='proof')||url.searchParams.getAll('proof').length>1||
       ['x-tenant-id','x-user-id','x-role','x-admin','x-product','x-principal-id','x-bci-tenant-id']
         .some(k=>request.headers.has(k)))return response({error:'Invalid request.'},400);
    const auth=request.headers.get('authorization');
    if(!auth||auth.length>16007||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth))return response({error:'Sign in to review content.'},401);
    const scope=await scopeFor(auth.slice(7));
    const missing=[
      ...(process.env.BCI_NEON_DEV_CONTENT_APPROVALS!=='enabled'?['APPROVAL_RUNTIME_NOT_ENABLED']:[]),
      ...(!process.env.BCI_NEON_DEV_CONTENT_ISSUER_DATABASE_URL?['RESTRICTED_ISSUER_CONNECTION_MISSING']:[]),
      ...(!process.env.BCI_NEON_DEV_CONTENT_REVIEW_PUBLIC_KEYS?['REVIEWER_PUBLIC_KEY_NOT_REGISTERED']:[])
    ];
    const registeredKeyIds=Object.keys(JSON.parse(process.env.BCI_NEON_DEV_CONTENT_REVIEW_PUBLIC_KEYS||'{}'));
    const proof=url.searchParams.get('proof');
    if(!proof)return response({sources:await sources.list(scope),reviewerSubject:scope.principalId,
      setup:{ready:missing.length===0,missing,registeredKeyIds},providerSent:false},200);
    if(!/^content-instance-script-proof-[a-f0-9]{64}$/.test(proof))return response({error:'Invalid proof.'},400);
    const source=await sources.load(scope,proof);
    const current=await scopeFor(auth.slice(7));
    if(current.principalId!==scope.principalId||current.tenantId!==scope.tenantId)throw Error();
    return response({title:source.title,envelope:source.envelope,handoff:source.handoff,
      images:source.mediaBytes.map(x=>'data:image/png;base64,'+Buffer.from(x).toString('base64')),
      reviewerSubject:scope.principalId,setup:{ready:missing.length===0,missing,registeredKeyIds},providerSent:false},200);
  }catch{return response({error:'Content review could not be confirmed. Sign in and try again.'},403);}
}
