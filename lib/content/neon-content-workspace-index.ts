/** DEV-only owner workspace discovery, under an actual restricted reader login.
 * This is neither a tenant-wide list nor a public API: identity and RLS are mandatory.
 */
import {ContentReadDenied} from './neon-content-workspace-reader.ts';
type Row=Record<string,unknown>;
type Query=(sql:string,params:readonly string[])=>Promise<{rows:readonly Row[]}>;
type Transaction=<T>(fn:(query:Query)=>Promise<T>)=>Promise<T>;
type Principal=Readonly<{userId:string;authenticated:true}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=():never=>{throw new ContentReadDenied();};

export function createContentWorkspaceIndexReader(transaction:Transaction){
 if(typeof transaction!=='function')deny();
 return async(principal:Principal)=>{
  if(principal?.authenticated!==true||!UUID.test(principal.userId))deny();
  return transaction(async query=>{
   const role=(await query(`SELECT current_user AS name,session_user AS login,
      rolcanlogin AS can_login,rolinherit AS inherits,rolbypassrls AS bypass,
      rolsuper AS superuser,rolcreaterole AS can_create_role,
      (SELECT count(*)::int FROM pg_auth_members WHERE member=pg_roles.oid) AS parents
      FROM pg_roles WHERE rolname=current_user`,[])).rows;
   if(role.length!==1||role[0].name!=='content_dev_reader_v2'||
      role[0].login!=='content_dev_reader_v2'||role[0].can_login!==true||
      role[0].inherits!==false||role[0].bypass!==false||role[0].superuser!==false||
      role[0].can_create_role!==false||role[0].parents!==0)deny();
   const posture=(await query(`SELECT current_database() AS db,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='content_dev' AND c.relname='workspaces'
       AND c.relrowsecurity AND c.relforcerowsecurity) AS forced,
      has_table_privilege(current_user,'bci_dev.tenant_memberships','SELECT') AS membership,
      has_table_privilege(current_user,'content_dev.campaigns','INSERT') AS writes,
      has_table_privilege(current_user,'content_dev.credit_ledger','SELECT') AS credits,
      has_schema_privilege(current_user,'content_import_dev','USAGE') AS staging`,[])).rows;
   if(posture.length!==1||posture[0].db!=='bros_intelligence_dev'||
      posture[0].forced!==1||posture[0].membership!==true||
      posture[0].writes!==false||posture[0].credits!==false||posture[0].staging!==false)deny();
   const binding=(await query(`SELECT set_config('bci.principal_id',$1,true) AS principal_id`,
     [principal.userId])).rows;
   if(binding.length!==1||binding[0].principal_id!==principal.userId)deny();
   const workspaces=(await query(`SELECT w.id,w.name,w.updated_at
     FROM content_dev.workspaces w JOIN bci_dev.tenant_memberships m
      ON m.tenant_id=w.tenant_id AND m.principal_id=$1::uuid AND m.product='content'
      AND m.active IS TRUE AND m.revoked_at IS NULL
     WHERE w.owner_principal_id=$1::uuid ORDER BY w.updated_at DESC,w.id LIMIT 50`,
     [principal.userId])).rows;
   if(workspaces.some(w=>!UUID.test(String(w.id))||typeof w.name!=='string'))deny();
   return {workspaces};
  });
 };
}
