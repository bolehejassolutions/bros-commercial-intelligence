import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';

const preflight=await readFile(new URL('../../docs/sql-proposals/CONTENT_DEV_IMPORT_LINEAGE_PREFLIGHT.sql',import.meta.url),'utf8');
const url=new URL(process.env.CONTENT_ADMIN_DB_URL);
assert.ok(process.env.CONTENT_PG_INTEGRATION_CI==='disposable_only' && url.protocol==='postgresql:' &&
 url.hostname==='127.0.0.1' && url.port==='5432' && url.pathname==='/bros_intelligence_dev' &&
 url.username==='postgres' && !url.search && !url.hash,'Refusing non-disposable CONTENT database');

test('read-only staging preflight separates verified lineage, ambiguous identities, revoked access and missing parents',async()=>{
 const client=new pg.Client({connectionString:url.href});
 await client.connect();
 try {
  await client.query('BEGIN');
  // These private staging and identity tables exist only inside this local fixture transaction.
  await client.query(`CREATE SCHEMA neon_auth;
   CREATE TABLE neon_auth."user"(id uuid,email text,"emailVerified" boolean,banned boolean);
   CREATE TABLE content_import_dev.legacy_rows(source_table text,source_pk text,source_user_id uuid,payload jsonb,
    PRIMARY KEY(source_table,source_pk));
   CREATE TABLE content_import_dev.identity_links(source_user_id uuid PRIMARY KEY,neon_principal_id uuid UNIQUE,tenant_id uuid,evidence text);`);
  const stage=(kind,id,owner,payload)=>client.query('INSERT INTO content_import_dev.legacy_rows VALUES ($1,$2,$3,$4::jsonb)',
   [kind,id,owner,JSON.stringify(payload)]);
  async function owner() {
   const source=randomUUID(),principal=randomUUID(),tenant=randomUUID(),email=source+'@fixture.invalid';
   await stage('auth_user_identity',source,source,{email,email_confirmed_at:'2026-11-07'});
   await client.query('INSERT INTO neon_auth."user" VALUES ($1,$2,true,false)',[principal,email]);
   await client.query("INSERT INTO bci_dev.tenant_memberships(tenant_id,principal_id,product) VALUES($1,$2,'content')",[tenant,principal]);
   await client.query("INSERT INTO content_import_dev.identity_links VALUES ($1,$2,$3,'verified_email_both_and_active_content_membership')",
    [source,principal,tenant]);
   return {source,principal,tenant,email};
  }
  async function dna(o,materialize) {
   const id=randomUUID();
   await stage('business_dna',id,o.source,{id,user_id:o.source});
   if(materialize) await client.query("INSERT INTO content_dev.workspaces(id,tenant_id,owner_principal_id,name) VALUES($1,$2,$3,'Test')",
    [id,o.tenant,o.principal]);
   return id;
  }
  const a=await owner(),b=await owner(),unlinked=await owner(),stale=await owner(),ambiguous=await owner();
  const wa=await dna(a,true),wb=await dna(b,true);
  await client.query('DELETE FROM content_import_dev.identity_links WHERE source_user_id=$1',[unlinked.source]);
  await client.query('UPDATE content_import_dev.identity_links SET tenant_id=$1 WHERE source_user_id=$2',[randomUUID(),stale.source]);
  await client.query("INSERT INTO bci_dev.tenant_memberships(tenant_id,principal_id,product) VALUES($1,$2,'content')",[randomUUID(),ambiguous.principal]);
  const collision=await owner(),duplicateSource=randomUUID();
  await stage('auth_user_identity',duplicateSource,duplicateSource,{email:collision.email.toUpperCase(),email_confirmed_at:'2026-11-08'});
  const ca=randomUUID(),liveCa=randomUUID(),item=randomUUID(),liveItem=randomUUID(),scene=randomUUID();
  await stage('campaigns',ca,a.source,{id:ca,user_id:a.source,project_id:null});
  await client.query(`INSERT INTO content_dev.campaigns(id,tenant_id,workspace_id,owner_principal_id,product_service,audience,duration_days,legacy_supabase_id)
   VALUES ($1,$2,$3,$4,'Test','Test',7,$5)`,[liveCa,a.tenant,wa,a.principal,ca]);
  await stage('content_items',item,null,{campaign_id:ca});
  await client.query(`INSERT INTO content_dev.content_items(id,tenant_id,campaign_id,type,legacy_supabase_id)
   VALUES($1,$2,$3,'video_scenes',$4)`,[liveItem,a.tenant,liveCa,item]);
  await stage('scenes',scene,null,{content_item_id:item});
  await client.query(`INSERT INTO content_dev.scenes(tenant_id,content_item_id,scene_number,legacy_supabase_id)
   VALUES($1,$2,1,$3)`,[a.tenant,liveItem,scene]);
  // Missing and contradictory evidence, plus an existing target linked to the wrong tenant.
  const futureCampaign=randomUUID(),foreignKey=randomUUID(),projectCampaign=randomUUID();
  await stage('campaigns',futureCampaign,a.source,{});
  await stage('campaigns',projectCampaign,a.source,{project_id:randomUUID()});
  await stage('campaigns',foreignKey,a.source,{});
  await client.query(`INSERT INTO content_dev.campaigns(tenant_id,workspace_id,owner_principal_id,product_service,audience,duration_days,legacy_supabase_id)
   VALUES ($1,$2,$3,'Foreign','Test',7,$4)`,[b.tenant,wb,b.principal,foreignKey]);
  await stage('content_items',randomUUID(),null,{campaign_id:futureCampaign});
  await stage('content_items',randomUUID(),null,{campaign_id:randomUUID()});
  await stage('content_items',randomUUID(),b.source,{campaign_id:ca});
  await stage('scenes',randomUUID(),null,{content_item_id:item,user_id:b.source});
  await stage('content_items',randomUUID(),null,{campaign_id:foreignKey});
  await stage('content_items',randomUUID(),null,{campaign_id:ca});
  await stage('scenes',randomUUID(),null,{content_item_id:item});
  // Owner B has two source DNA records. An unqualified campaign cannot pick either.
  await dna(b,false);
  await stage('campaigns',randomUUID(),b.source,{});
  await stage('campaigns',randomUUID(),b.source,{business_dna_id:wb});

  async function counts(){
   const {fields,rows}=await client.query(preflight);
   assert.deepEqual(fields.map(f=>f.name),['entity','state','rows']);
   return Object.fromEntries(rows.map(row=>[row.entity+'/'+row.state,Number(row.rows)]));
  }
  await client.query('SAVEPOINT before_read_only_snapshot');
  await client.query('SET LOCAL transaction_read_only=on');
  const first=await counts();
  assert.deepEqual(first,{
   'identity/verified':2,'identity/missing_identity_link':1,'identity/stale_identity_link':1,
   'identity/ambiguous_membership':1,'identity/ambiguous_identity':2,
   'business_dna/already_materialized':2,'business_dna/eligible':1,
   'campaigns/already_materialized':1,'campaigns/eligible':2,'campaigns/unverified_project':1,
   'campaigns/target_parent_or_owner_mismatch':1,'campaigns/ambiguous_workspace':1,
   'content_items/already_materialized':1,'content_items/eligible':1,'content_items/missing_materialized_parent':1,
   'content_items/missing_source_parent':1,'content_items/source_parent_mismatch':1,'content_items/target_parent_or_owner_mismatch':1,
   'scenes/already_materialized':1,'scenes/eligible':1,'scenes/source_parent_mismatch':1,
  });
  // A later snapshot from the same synthetic database detects changed access.
  await client.query('ROLLBACK TO SAVEPOINT before_read_only_snapshot');
  await client.query('UPDATE bci_dev.tenant_memberships SET active=false,revoked_at=now() WHERE principal_id=$1',[a.principal]);
  await client.query('SET LOCAL transaction_read_only=on');
  const second=await counts();
  assert.equal(second['identity/revoked_membership'],1);
  assert.equal(second['business_dna/revoked_membership'],1);
  assert.equal(second['scenes/revoked_membership'],2);
  assert.equal(second['scenes/already_materialized'],undefined);
 } finally {
  await client.query('ROLLBACK');
  await client.end();
 }
});
