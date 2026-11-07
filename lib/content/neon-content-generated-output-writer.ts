/**
 * BROS CONTENT: atomic GENERATED-OUTPUT persistence adapter (not activated).
 *
 * No HTTP route or DB connection is provided here. A separately approved
 * content_dev_generated_writer_v1 direct-login role, new table/policies, an
 * authenticated server principal and one real PostgreSQL transaction are ALL
 * required. The current draft writer must never execute these statements.
 *
 * The adapter does not call AI, charge/refund credits, enqueue jobs, publish,
 * or read legacy Supabase staging. All writes are new DEV-only draft records.
 */
import {ContentReadDenied} from './neon-content-workspace-reader.ts';
import {compileContentPersistenceBundle} from './neon-content-persistence-bundle.ts';
import type {
 CampaignInput,CampaignPlan,QualityReview
} from './neon-content-generation-contract.ts';

type Row=Record<string,unknown>;
type Query=(sql:string,params:readonly unknown[])=>Promise<{rows:readonly Row[]}>;
type Transaction=<T>(operation:(query:Query)=>Promise<T>)=>Promise<T>;
type Principal=Readonly<{userId:string;authenticated:true}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY=/^[A-Za-z0-9_-]{12,180}$/;
const ROLE='content_dev_generated_writer_v1';
const deny=():never=>{throw new ContentReadDenied();};
function rowId(value:unknown):string {
 if(typeof value!=='string'||!UUID.test(value))return deny();
 return value;
}
function rowsOne(rows:readonly Row[]):Row{
 if(rows.length!==1)return deny();
 return rows[0];
}

/**
 * This exported function is intentionally **not** included in the production
 * adapter factory. Activation requires explicit Neon role/permission approval.
 * The caller must use createContentTransaction(pool) connected DIRECTLY as ROLE.
 */
export function createContentGeneratedOutputWriter(transaction:Transaction) {
 if(typeof transaction!=='function')deny();
 return async function write(
  principal:Principal,workspaceId:string,idempotencyKey:string,
  rawInput:CampaignInput,rawPlan:CampaignPlan,rawReview:QualityReview
 ) {
  if(principal?.authenticated!==true||!UUID.test(principal.userId)||
     !UUID.test(workspaceId)||!KEY.test(idempotencyKey))deny();
  // Compile and validate untrusted AI output BEFORE acquiring a connection.
  // The caller cannot pass a forged "verifiedQc" flag or tenant ID.
  const bundle=compileContentPersistenceBundle(rawInput,rawPlan,rawReview);
  const principalId=principal.userId;
  const fingerprint=bundle.fingerprint;
  const expectedItems=bundle.items.length;
  const expectedScenes=bundle.scenes.length;

  return transaction(async query=>{
   const role=rowsOne((await query(`SELECT current_user AS name,
      session_user AS login, rolcanlogin AS can_login, rolinherit AS inherits,
      rolbypassrls AS bypass, rolsuper AS superuser,
      rolcreaterole AS can_create_role,
      (SELECT count(*)::int FROM pg_auth_members
       WHERE member=pg_roles.oid) AS parents
      FROM pg_roles WHERE rolname=current_user`,[])).rows);
   if(role.name!==ROLE||role.login!==ROLE||role.can_login!==true||
      role.inherits!==false||role.bypass!==false||role.superuser!==false||
      role.can_create_role!==false||role.parents!==0)deny();

   const posture=rowsOne((await query(`SELECT current_database() AS db,
      (SELECT count(*)::int FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='content_dev'
       AND c.relname IN
       ('workspaces','campaigns','content_items','scenes','generated_output_requests')
       AND c.relrowsecurity AND c.relforcerowsecurity) AS forced,
      to_regclass('content_dev.generated_output_requests')::text AS request_table,
      has_table_privilege(current_user,'bci_dev.tenant_memberships','SELECT') AS membership,
      has_table_privilege(current_user,'content_dev.workspaces','SELECT') AS workspace_read,
      has_table_privilege(current_user,'content_dev.campaigns','INSERT') AS campaigns_insert,
      has_table_privilege(current_user,'content_dev.campaigns','UPDATE') AS campaigns_update,
      has_table_privilege(current_user,'content_dev.content_items','INSERT') AS items_insert,
      has_table_privilege(current_user,'content_dev.scenes','INSERT') AS scenes_insert,
      has_table_privilege(current_user,'content_dev.generated_output_requests','INSERT') AS request_insert,
      has_table_privilege(current_user,'content_dev.generated_output_requests','SELECT') AS request_read,
      has_column_privilege(current_user,'content_dev.generated_output_requests','campaign_id','UPDATE') AS request_update,
      has_column_privilege(current_user,'content_dev.generated_output_requests','fingerprint','UPDATE') AS fingerprint_update,
      has_table_privilege(current_user,'content_dev.generation_jobs','INSERT') AS jobs_insert,
      has_table_privilege(current_user,'content_dev.credit_ledger','INSERT') AS credits_insert,
      has_schema_privilege(current_user,'content_import_dev','USAGE') AS staging`,[])).rows);
   if(posture.db!=='bros_intelligence_dev'||posture.forced!==5||
      posture.request_table!=='content_dev.generated_output_requests'||
      posture.membership!==true||posture.workspace_read!==true||
      posture.campaigns_insert!==true||posture.campaigns_update!==false||
      posture.items_insert!==true||posture.scenes_insert!==true||
      posture.request_insert!==true||posture.request_read!==true||
      posture.request_update!==true||posture.fingerprint_update!==false||
      posture.jobs_insert!==false||
      posture.credits_insert!==false||posture.staging!==false)deny();

   const bound=rowsOne((await query(
    `SELECT set_config('bci.principal_id',$1,true) AS principal_id`,
    [principalId])).rows);
   if(bound.principal_id!==principalId)deny();
   const workspace=rowsOne((await query(
    `SELECT w.tenant_id FROM content_dev.workspaces w
     JOIN bci_dev.tenant_memberships m ON m.tenant_id=w.tenant_id
      AND m.principal_id=$1::uuid AND m.product='content'
      AND m.active IS TRUE AND m.revoked_at IS NULL
     WHERE w.id=$2::uuid AND w.owner_principal_id=$1::uuid LIMIT 1`,
    [principalId,workspaceId])).rows);
   const tenantId=rowId(workspace.tenant_id);

   // Transaction-level lock + database UNIQUE(tenant, principal, key)
   // protects concurrent requests across different app instances.
   rowsOne((await query(`SELECT pg_advisory_xact_lock(
     hashtextextended($1::text,0)) AS lock_result`,
     [tenantId+':'+principalId+':'+idempotencyKey])).rows);

   const current=async()=>{
    const existing=(await query(`SELECT r.workspace_id,r.fingerprint,
      r.campaign_id,r.expected_items,r.expected_scenes,
      c.status,c.tenant_id,c.owner_principal_id
      FROM content_dev.generated_output_requests r
      LEFT JOIN content_dev.campaigns c
       ON c.id=r.campaign_id AND c.tenant_id=r.tenant_id
      WHERE r.tenant_id=$1::uuid AND r.owner_principal_id=$2::uuid
       AND r.idempotency_key=$3 LIMIT 2`,
      [tenantId,principalId,idempotencyKey])).rows;
    if(existing.length>1)deny();
    if(existing.length===0)return null;
    const r=existing[0];
    if(r.workspace_id!==workspaceId||r.fingerprint!==fingerprint||
       r.expected_items!==expectedItems||r.expected_scenes!==expectedScenes||
       r.status!=='draft'||r.tenant_id!==tenantId||
       r.owner_principal_id!==principalId)deny();
    const id=rowId(r.campaign_id);
    const count=rowsOne((await query(`SELECT
      (SELECT count(*)::int FROM content_dev.content_items
       WHERE tenant_id=$1::uuid AND campaign_id=$2::uuid) AS items,
      (SELECT count(*)::int FROM content_dev.scenes s
       JOIN content_dev.content_items i
        ON i.id=s.content_item_id AND i.tenant_id=s.tenant_id
       WHERE s.tenant_id=$1::uuid AND i.campaign_id=$2::uuid) AS scenes`,
      [tenantId,id])).rows);
    if(count.items!==expectedItems||count.scenes!==expectedScenes)deny();
    return {id,status:'draft' as const,replayed:true as const};
   };
   const replay=await current();
   if(replay)return replay;

   const reservation=(await query(
    `INSERT INTO content_dev.generated_output_requests
      (tenant_id,owner_principal_id,workspace_id,idempotency_key,
       fingerprint,expected_items,expected_scenes,quality_score)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8)
      ON CONFLICT (tenant_id,owner_principal_id,idempotency_key)
      DO NOTHING RETURNING idempotency_key`,
    [tenantId,principalId,workspaceId,idempotencyKey,fingerprint,
     expectedItems,expectedScenes,rawReview.score])).rows;
   if(reservation.length>1)deny();
   if(reservation.length===0){
    // A concurrently committed request may have won before our lock.
    const won=await current();
    if(!won)deny();
    return won;
   }
   if(reservation[0].idempotency_key!==idempotencyKey)deny();

   const campaign=bundle.campaign;
   const created=rowsOne((await query(
    `INSERT INTO content_dev.campaigns
      (tenant_id,workspace_id,owner_principal_id,product_service,
       description,audience,problem,objective,duration_days,platforms,
       status,strategy,angles,captions,publish_plan)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10::text[],
       'draft',$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb) RETURNING id`,
    [tenantId,workspaceId,principalId,campaign.product_service,
     campaign.description,campaign.audience,campaign.problem,campaign.objective,
     campaign.duration_days,campaign.platforms,JSON.stringify(campaign.strategy),
     JSON.stringify(campaign.angles),JSON.stringify(campaign.captions),
     JSON.stringify(campaign.publish_plan)])).rows);
   const campaignId=rowId(created.id);
   const refs=new Map<string,string>();
   for(const item of bundle.items){
    if(refs.has(item.ref))deny();
    const createdItem=rowsOne((await query(
     `INSERT INTO content_dev.content_items
      (tenant_id,campaign_id,type,title,body,sort_order,version)
      VALUES ($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6,$7) RETURNING id`,
     [tenantId,campaignId,item.type,item.title,JSON.stringify(item.body),
      item.sort_order,item.version])).rows);
    refs.set(item.ref,rowId(createdItem.id));
   }
   for(const scene of bundle.scenes){
    const itemId=refs.get(scene.content_item_ref);
    if(!itemId)deny();
    const saved=rowsOne((await query(
     `INSERT INTO content_dev.scenes
       (tenant_id,content_item_id,scene_number,duration_seconds,
        narration,dialogue,visual_prompt,motion_prompt,continuity_lock)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9::jsonb)
       RETURNING id`,
     [tenantId,itemId,scene.scene_number,scene.duration_seconds,
      scene.narration,scene.dialogue,scene.visual_prompt,scene.motion_prompt,
      JSON.stringify(scene.continuity_lock)])).rows);
    rowId(saved.id);
   }

   const link=rowsOne((await query(
    `UPDATE content_dev.generated_output_requests
      SET campaign_id=$4::uuid
      WHERE tenant_id=$1::uuid AND owner_principal_id=$2::uuid
       AND idempotency_key=$3 AND campaign_id IS NULL
      RETURNING campaign_id`,
    [tenantId,principalId,idempotencyKey,campaignId])).rows);
   if(link.campaign_id!==campaignId)deny();

   const count=rowsOne((await query(`SELECT
      (SELECT count(*)::int FROM content_dev.content_items
       WHERE tenant_id=$1::uuid AND campaign_id=$2::uuid) AS items,
      (SELECT count(*)::int FROM content_dev.scenes s
       JOIN content_dev.content_items i
        ON i.id=s.content_item_id AND i.tenant_id=s.tenant_id
       WHERE s.tenant_id=$1::uuid AND i.campaign_id=$2::uuid) AS scenes`,
      [tenantId,campaignId])).rows);
   if(count.items!==expectedItems||count.scenes!==expectedScenes)deny();

   return {id:campaignId,status:'draft' as const,replayed:false as const};
  });
 };
}
