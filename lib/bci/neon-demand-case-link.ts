/** BCI DEV restricted, server-owned receipt -> REVIEW case -> immutable link.
 * Not a public route. Does not infer diagnosis, verified sales, actions or outcomes.
 */
type Value=string|number|boolean|null;
type Query=(sql:string,params:readonly Value[])=>Promise<{rows:readonly unknown[]}>;
export type CaseLinkTransaction=<T>(fn:(query:Query)=>Promise<T>)=>Promise<T>;
type Principal=Readonly<{userId:string;authenticated:true}>;
type Grant=Readonly<{principalId:string;tenantId:string;product:"demand";active:true}>;
type Deps=Readonly<{authenticate:()=>Promise<Principal|null>;
 membershipsFor:(id:string,product:"demand")=>Promise<readonly Grant[]>;
 transaction:CaseLinkTransaction}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const obj=(x:unknown):x is Record<string,unknown>=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const exact=(x:unknown,keys:readonly string[])=>obj(x)&&Reflect.ownKeys(x).length===keys.length&&
 Reflect.ownKeys(x).every(k=>typeof k==="string"&&keys.includes(k)&&
 Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(x,k),"value"));
export class BciCaseLinkDenied extends Error{
 constructor(){super("BCI private case link denied.");this.name="BciCaseLinkDenied";}
}
const deny=():never=>{throw new BciCaseLinkDenied();};
const title="Historical Meta evidence — review required";
const question="Which observations are supported by this persisted Meta snapshot?";
const membership=(g:readonly Grant[],id:string)=>{
 if(!Array.isArray(g)||g.length!==1||!exact(g[0],["principalId","tenantId","product","active"])||
  g[0].principalId!==id||g[0].product!=="demand"||g[0].active!==true||
  !UUID.test(g[0].tenantId))deny();
 return g[0].tenantId.toLowerCase();
};
export function createAuthenticatedDemandReceiptCaseLink(deps:Deps){
 if(!deps||typeof deps.authenticate!=="function"||
  typeof deps.membershipsFor!=="function"||typeof deps.transaction!=="function")deny();
 return async(receiptId:unknown):Promise<Readonly<{caseId:string;receiptId:string;
  status:"inserted"|"replayed";reviewOnly:true;providerAttested:false}>>=>{
  if(typeof receiptId!=="string"||!UUID.test(receiptId)) throw new BciCaseLinkDenied();
  const receipt=receiptId.toLowerCase();
  try{
   const p=await deps.authenticate();
   if(!exact(p,["userId","authenticated"])||p!.authenticated!==true||!UUID.test(p!.userId))deny();
   const principal=p!.userId.toLowerCase();
   const tenant=membership(await deps.membershipsFor(principal,"demand"),principal);
   const key="demand:meta-receipt:"+receipt;
   return await deps.transaction(async query=>{
    const identity=await query(`SELECT current_user AS "roleName",session_user AS "sessionRoleName",
      rolcanlogin AS "canLogin",rolbypassrls AS "bypassRls",rolsuper AS "superuser",
      rolinherit AS "inherits",(SELECT count(*)::integer FROM pg_auth_members
        WHERE member=pg_roles.oid) AS "parentRoles"
      FROM pg_roles WHERE rolname=current_user`,[]);
    const r=identity.rows[0];
    if(identity.rows.length!==1||!obj(r)||
      r.roleName!=="bci_dev_evidence_writer_restricted"||
      r.sessionRoleName!=="bci_dev_evidence_writer_restricted"||
      r.canLogin!==true||r.bypassRls!==false||r.superuser!==false||
      r.inherits!==false||r.parentRoles!==0)deny();
    const posture=await query(`SELECT current_database() AS "databaseName",
      bool_and(c.relrowsecurity AND c.relforcerowsecurity) AS "forcedRls",
      bool_and(has_table_privilege(current_user,c.oid,'SELECT') AND
        has_table_privilege(current_user,c.oid,'INSERT') AND
        NOT has_table_privilege(current_user,c.oid,
          'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')) AS "appendOnly",
      NOT has_schema_privilege(current_user,'bci_dev','CREATE') AS "noSchemaCreate",
      NOT has_database_privilege(current_user,current_database(),'CREATE') AS "noDbCreate",
      NOT has_table_privilege(current_user,'bci_dev.lineage_nodes','SELECT,INSERT,UPDATE,DELETE') AS "noLineage",
      NOT has_table_privilege(current_user,'bci_dev.content_dispatch_approvals','SELECT,INSERT,UPDATE,DELETE') AS "noApprovals",
      (SELECT count(*)::integer FROM pg_policies p WHERE p.schemaname='bci_dev'
        AND p.policyname IN ('bci_evidence_writer_demand_cases_select_v1',
          'bci_evidence_writer_demand_cases_insert_v1',
          'bci_evidence_writer_demand_link_select_v1',
          'bci_evidence_writer_demand_link_insert_v1')
        AND 'bci_dev_evidence_writer_restricted'=ANY(p.roles)) AS "policyCount",
      (SELECT count(*)::integer FROM pg_policies p WHERE p.schemaname='bci_dev'
        AND p.policyname IN ('bci_evidence_writer_demand_cases_select_v1',
          'bci_evidence_writer_demand_cases_insert_v1',
          'bci_evidence_writer_demand_link_select_v1',
          'bci_evidence_writer_demand_link_insert_v1')
        AND position('tenant_memberships' in coalesce(p.qual,'')||coalesce(p.with_check,''))>0
        AND position('revoked_at' in coalesce(p.qual,'')||coalesce(p.with_check,''))>0) AS "boundPolicyCount"
      FROM pg_class c WHERE c.oid IN ('bci_dev.cases'::regclass,
        'bci_dev.case_evidence'::regclass) HAVING count(*)=2`,[]);
    const s=posture.rows[0];
    if(posture.rows.length!==1||!obj(s)||s.databaseName!=="bros_intelligence_dev"||
      s.forcedRls!==true||s.appendOnly!==true||s.noSchemaCreate!==true||
      s.noDbCreate!==true||s.noLineage!==true||s.noApprovals!==true||
      s.policyCount!==4||s.boundPolicyCount!==4)deny();
    await query("SELECT set_config('bci.tenant_id',$1,true),set_config('bci.product','demand',true),set_config('bci.principal_id',$2,true)",[tenant,principal]);
    const recheck=async()=>{
     const m=await query(`SELECT count(*)::integer AS "activeCount" FROM bci_dev.tenant_memberships
       WHERE tenant_id=$1::uuid AND principal_id=$2::uuid AND product='demand'
         AND active IS TRUE AND revoked_at IS NULL`,[tenant,principal]);
     if(m.rows.length!==1||!obj(m.rows[0])||m.rows[0].activeCount!==1)deny();
    };
    await recheck();
    const evidence=await query(`SELECT id::text AS "id",completeness,provider
      FROM bci_dev.evidence WHERE id=$1::uuid AND tenant_id=$2::uuid
        AND product='demand' AND provider='meta_ads' LIMIT 2`,[receipt,tenant]);
    if(evidence.rows.length!==1||!obj(evidence.rows[0])||
      evidence.rows[0].id!==receipt||evidence.rows[0].completeness!=="unverified"||
      evidence.rows[0].provider!=="meta_ads")deny();
    const inserted=await query(`INSERT INTO bci_dev.cases
      (tenant_id,product,case_key,title,question,status)
      VALUES ($1::uuid,'demand',$2,$3,$4,'REVIEW')
      ON CONFLICT (tenant_id,product,case_key) DO NOTHING RETURNING id::text AS "id"`,
      [tenant,key,title,question]);
    if(inserted.rows.length>1)deny();
    const found=await query(`SELECT id::text AS "id",title,question,status
      FROM bci_dev.cases WHERE tenant_id=$1::uuid AND product='demand'
        AND case_key=$2 LIMIT 2`,[tenant,key]);
    const c=found.rows[0];
    if(found.rows.length!==1||!obj(c)||typeof c.id!=="string"||!UUID.test(c.id)||
      c.title!==title||c.question!==question||c.status!=="REVIEW") throw new BciCaseLinkDenied();
    await query(`INSERT INTO bci_dev.case_evidence(case_id,evidence_id,tenant_id,product)
      VALUES ($1::uuid,$2::uuid,$3::uuid,'demand')
      ON CONFLICT (case_id,evidence_id) DO NOTHING`,[c.id,receipt,tenant]);
    const linked=await query(`SELECT count(*)::integer AS "linkCount"
      FROM bci_dev.case_evidence WHERE case_id=$1::uuid AND evidence_id=$2::uuid
        AND tenant_id=$3::uuid AND product='demand'`,[c.id,receipt,tenant]);
    if(linked.rows.length!==1||!obj(linked.rows[0])||linked.rows[0].linkCount!==1)deny();
    await recheck();
    if(membership(await deps.membershipsFor(principal,"demand"),principal)!==tenant)deny();
    return Object.freeze({caseId:c.id,receiptId:receipt,
      status:inserted.rows.length===1?"inserted" as const:"replayed" as const,
      reviewOnly:true as const,providerAttested:false as const});
   });
  }catch{return deny();}
 };
}
