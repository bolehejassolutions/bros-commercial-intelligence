/** BCI DEV-only signed, restricted PROPOSED append for an existing REVIEW case.
 * DEMAND owns hypothesis/action/metric text. No approval, execution or outcome.
 * PostgreSQL GUCs filter RLS but are never treated as authentication.
 */
import {createHash} from "node:crypto";
import type {CaseLinkTransaction} from "./neon-demand-case-link.ts";
import {isNeonPreviewEnabled, type NeonPreviewEnvironment} from "./neon-preview-handler.ts";

const CASE_ID="a474cd88-76a3-4c96-8cde-4fcfea45be83";
const RECEIPT_ID="4b1d0b40-371f-4c82-aaa9-d77580f88fac";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const obj=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const exact=(v:unknown,keys:readonly string[])=>obj(v)&&Reflect.ownKeys(v).length===keys.length&&
 Reflect.ownKeys(v).every(k=>typeof k==="string"&&keys.includes(k));
export class BciDemandProposalDenied extends Error {
 constructor(){super("BCI DEV proposal append denied.");this.name="BciDemandProposalDenied";}
}
const deny=():never=>{throw new BciDemandProposalDenied();};
export type ProposalInput=Readonly<{hypothesis:string;proposedAction:string;
 proposedSuccessMetric:string;confidence:"low"|"medium"|"high"}>;
type Principal=Readonly<{userId:string;authenticated:true}>;
type Grant=Readonly<{principalId:string;tenantId:string;product:"demand";active:true}>;
type Deps=Readonly<{authenticate:()=>Promise<Principal|null>;
 membershipsFor:(id:string,product:"demand")=>Promise<readonly Grant[]>;
 transaction:CaseLinkTransaction}>;
export type ProposalResult=Readonly<{caseId:string;proposalId:string;
 status:"inserted"|"replayed";reviewOnly:true;executionAuthorized:false;
 providerAttested:false;outcomeRecorded:false}>;

function normalize(input:unknown):ProposalInput {
 if(!exact(input,["hypothesis","proposedAction","proposedSuccessMetric","confidence"]))deny();
 const v=input as Record<string,unknown>;
 const text=(s:unknown):string=>{
  if(typeof s!=="string")return deny();
  const x=s.trim();
  if(x.length<5||x.length>600||/[\u0000-\u001f\u007f\u202a-\u202e]/.test(x))deny();
  return x;
 };
 if(v.confidence!=="low"&&v.confidence!=="medium"&&v.confidence!=="high")return deny();
 const confidence=v.confidence as ProposalInput["confidence"];
 return Object.freeze({hypothesis:text(v.hypothesis),proposedAction:text(v.proposedAction),
  proposedSuccessMetric:text(v.proposedSuccessMetric),confidence});
}
function stableId(tenant:string,v:ProposalInput):string {
 const h=createHash("sha256").update(JSON.stringify(["bci-demand-proposal:v1",tenant,CASE_ID,
  v.hypothesis,v.proposedAction,v.proposedSuccessMetric,v.confidence])).digest("hex");
 const b=Buffer.from(h.slice(0,32),"hex");
 b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
 const x=b.toString("hex");
 return x.slice(0,8)+"-"+x.slice(8,12)+"-"+x.slice(12,16)+"-"+x.slice(16,20)+"-"+x.slice(20);
}
export function createAuthenticatedDemandProposal(deps:Deps){
 if(!deps||typeof deps.authenticate!=="function"||typeof deps.membershipsFor!=="function"||
  typeof deps.transaction!=="function")deny();
 return async(raw:unknown):Promise<ProposalResult>=>{
  const v=normalize(raw);
  let stage="identity";
  try{
   const p=await deps.authenticate();
   if(!exact(p,["userId","authenticated"])||p!.authenticated!==true||
     !UUID.test(p!.userId))deny();
   const principal=p!.userId.toLowerCase();
   stage="membership";
   const grants=await deps.membershipsFor(principal,"demand");
   if(!Array.isArray(grants)||grants.length!==1||!exact(grants[0],
     ["principalId","tenantId","product","active"])||
     grants[0].principalId!==principal||grants[0].product!=="demand"||
     grants[0].active!==true||!UUID.test(grants[0].tenantId))deny();
   const tenant=grants[0].tenantId.toLowerCase();
   const id=stableId(tenant,v);
   stage="db-connect";
   return await deps.transaction(async query=>{
    stage="role";
    const identity=await query("SELECT current_user AS \"roleName\",session_user AS \"sessionRoleName\","+
      "rolcanlogin AS \"canLogin\",rolbypassrls AS \"bypassRls\",rolsuper AS \"superuser\","+
      "rolinherit AS \"inherits\",(SELECT count(*)::integer FROM pg_auth_members"+
      " WHERE member=pg_roles.oid) AS \"parentRoles\" FROM pg_roles WHERE rolname=current_user",[]);
    const r=identity.rows[0];
    if(identity.rows.length!==1||!obj(r)||r.roleName!=="bci_dev_evidence_writer_restricted"||
      r.sessionRoleName!==r.roleName||r.canLogin!==true||r.bypassRls!==false||
      r.superuser!==false||r.inherits!==false||r.parentRoles!==0)deny();
    stage="posture";
    const posture=await query("SELECT current_database() AS \"databaseName\","+
      "c.relrowsecurity AND c.relforcerowsecurity AS \"forcedRls\","+
      "has_table_privilege(current_user,c.oid,'SELECT') AS \"canSelect\","+
      "has_table_privilege(current_user,c.oid,'INSERT') AS \"canInsert\","+
      "NOT has_table_privilege(current_user,c.oid,"+
      "'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS \"noMutation\","+
      "NOT has_table_privilege(current_user,'bci_dev.content_dispatch_approvals',"+
      "'SELECT,INSERT,UPDATE,DELETE') AS \"noApprovals\","+
      "NOT has_table_privilege(current_user,'bci_dev.lineage_nodes',"+
      "'SELECT,INSERT,UPDATE,DELETE') AS \"noLineage\","+
      "NOT has_schema_privilege(current_user,'bci_dev','CREATE') AS \"noSchemaCreate\","+
      "(SELECT count(*)::integer FROM pg_policies p WHERE p.schemaname='bci_dev'"+
      " AND p.tablename='proposals' AND p.policyname IN ("+
      "'bci_evidence_writer_demand_proposals_select_v1',"+
      "'bci_evidence_writer_demand_proposals_insert_v1')"+
      " AND 'bci_dev_evidence_writer_restricted'=ANY(p.roles)"+
      " AND position('tenant_memberships' in coalesce(p.qual,'')||coalesce(p.with_check,''))>0)"+
      " AS \"boundPolicies\" FROM pg_class c WHERE c.oid='bci_dev.proposals'::regclass",[]);
    const s=posture.rows[0];
    if(posture.rows.length!==1||!obj(s)||s.databaseName!=="bros_intelligence_dev"||
      s.forcedRls!==true||s.canSelect!==true||s.canInsert!==true||
      s.noMutation!==true||s.noApprovals!==true||s.noLineage!==true||
      s.noSchemaCreate!==true||s.boundPolicies!==2)deny();
    await query("SELECT set_config('bci.tenant_id',$1,true),"+
      "set_config('bci.product','demand',true),set_config('bci.principal_id',$2,true)",
      [tenant,principal]);
    const recheck=async()=>{
     const m=await query("SELECT count(*)::integer AS \"activeCount\""+
      " FROM bci_dev.tenant_memberships WHERE tenant_id=$1::uuid"+
      " AND principal_id=$2::uuid AND product='demand' AND active IS TRUE"+
      " AND revoked_at IS NULL",[tenant,principal]);
     if(m.rows.length!==1||!obj(m.rows[0])||m.rows[0].activeCount!==1)deny();
    };
    stage="membership-check";
    await recheck();
    stage="case";
    const c=await query("SELECT id::text AS \"id\" FROM bci_dev.cases"+
     " WHERE id=$1::uuid AND tenant_id=$2::uuid AND product='demand'"+
     " AND status='REVIEW' LIMIT 2",[CASE_ID,tenant]);
    if(c.rows.length!==1||!obj(c.rows[0])||c.rows[0].id!==CASE_ID)deny();
    stage="receipt-link";
    const link=await query("SELECT count(*)::integer AS \"linkCount\""+
     " FROM bci_dev.case_evidence l JOIN bci_dev.evidence e"+
     " ON e.id=l.evidence_id AND e.tenant_id=l.tenant_id AND e.product=l.product"+
     " WHERE l.case_id=$1::uuid AND l.evidence_id=$2::uuid"+
     " AND l.tenant_id=$3::uuid AND l.product='demand'"+
     " AND e.provider='meta_ads' AND e.completeness='unverified'",
     [CASE_ID,RECEIPT_ID,tenant]);
    if(link.rows.length!==1||!obj(link.rows[0])||link.rows[0].linkCount!==1)deny();
    stage="insert";
    const inserted=await query("INSERT INTO bci_dev.proposals"+
     " (id,case_id,tenant_id,product,hypothesis,proposed_action,"+
     "proposed_success_metric,status,confidence) VALUES"+
     " ($1::uuid,$2::uuid,$3::uuid,'demand',$4,$5,$6,'PROPOSED',$7)"+
     " ON CONFLICT (id) DO NOTHING RETURNING id::text AS \"id\"",
     [id,CASE_ID,tenant,v.hypothesis,v.proposedAction,v.proposedSuccessMetric,v.confidence]);
    if(inserted.rows.length>1||(inserted.rows.length===1&&
      (!obj(inserted.rows[0])||inserted.rows[0].id!==id)))deny();
    stage="readback";
    const found=await query("SELECT id::text AS \"id\",hypothesis,"+
     "proposed_action AS \"proposedAction\","+
     "proposed_success_metric AS \"proposedSuccessMetric\",status,confidence"+
     " FROM bci_dev.proposals WHERE id=$1::uuid AND case_id=$2::uuid"+
     " AND tenant_id=$3::uuid AND product='demand' LIMIT 2",[id,CASE_ID,tenant]);
    const f=found.rows[0];
    if(found.rows.length!==1||!obj(f)||f.id!==id||f.hypothesis!==v.hypothesis||
      f.proposedAction!==v.proposedAction||f.proposedSuccessMetric!==v.proposedSuccessMetric||
      f.confidence!==v.confidence||f.status!=="PROPOSED")deny();
    stage="membership-recheck";
    await recheck();
    stage="commit";
    return Object.freeze({caseId:CASE_ID,proposalId:id,
      status:inserted.rows.length===1?"inserted" as const:"replayed" as const,
      reviewOnly:true as const,executionAuthorized:false as const,
      providerAttested:false as const,outcomeRecorded:false as const});
   });
  }catch{
   // Fixed stage label only: never log JWTs, identities, SQL, parameters or driver errors.
   console.warn("bci_dev_proposal_denied",stage);
   return deny();
  }
 };
}

type HttpDeps=Readonly<{env:()=>NeonPreviewEnvironment;
 execute:(jwt:string,input:ProposalInput)=>Promise<ProposalResult>}>;
const headers={"Cache-Control":"private, no-store, max-age=0","Pragma":"no-cache",
 "Vary":"Authorization","X-Content-Type-Options":"nosniff"};
const response=(value:unknown,status:number)=>Response.json(value,{status,headers});
export function createDemandProposalHttpHandler(deps:HttpDeps){
 return async(request:Request):Promise<Response>=>{
  const env=deps.env();
  if(!isNeonPreviewEnabled(env)||env.BCI_NEON_DEV_PROPOSAL_WRITES!=="enabled")
   return response({error:"BCI DEV proposal unavailable."},404);
  if(request.method!=="POST")return response({error:"Method not allowed."},405);
  let url:URL;try{url=new URL(request.url);}catch{return response({error:"Denied."},400);}
  if(url.pathname!=="/api/internal/neon-demand-proposal"||url.search||url.hash||
    request.headers.get("content-type")!=="application/json"||
    Number(request.headers.get("content-length")||0)>2500||
    ["x-tenant-id","x-principal-id","x-user-id","x-role","x-admin","x-product","x-case-id"]
      .some(k=>request.headers.has(k)))return response({error:"Denied."},400);
  if(request.headers.get("origin")!==url.origin||
    (request.headers.has("sec-fetch-site")&&
      request.headers.get("sec-fetch-site")!=="same-origin"))
   return response({error:"Denied."},403);
  const auth=request.headers.get("authorization");
  if(!auth||auth.length>16007||
    !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth))
   return response({error:"Unauthorized."},401);
  try{
   const body=request.body;
   if(body===null)return deny();
   const reader=body.getReader();
   const parts:Uint8Array[]=[];let length=0;
   while(true){
    const next=await reader.read();
    if(next.done)break;
    length+=next.value.byteLength;
    if(length>2500){await reader.cancel();deny();}
    parts.push(next.value);
   }
   if(length===0)deny();
   const bytes=new Uint8Array(length);let offset=0;
   for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   const raw=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
   const input=normalize(raw);
   const result=await deps.execute(auth.slice(7),input);
   if(!result||result.caseId!==CASE_ID||!UUID.test(result.proposalId)||
     !["inserted","replayed"].includes(result.status)||
     result.reviewOnly!==true||result.executionAuthorized!==false||
     result.providerAttested!==false||result.outcomeRecorded!==false)deny();
   return response(result,200);
  }catch{return response({error:"BCI DEV proposal denied."},403);}
 };
}
