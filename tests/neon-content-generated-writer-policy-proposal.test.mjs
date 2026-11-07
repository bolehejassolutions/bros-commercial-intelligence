import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const path=new URL('../docs/sql-proposals/CONTENT_DEV_GENERATED_OUTPUT_WRITER_V1_NOT_APPLIED.sql',import.meta.url);
const sql=readFileSync(path,'utf8');
const role='content_dev_generated_writer_v1';

test('permission proposal is outside live migrations and explicitly requires approval',()=>{
 assert.match(path.pathname,/docs\/sql-proposals\//);
 assert.match(path.pathname,/NOT_APPLIED\.sql$/);
 assert.match(sql,/NEVER AUTO-APPLY/);
 assert.match(sql,/Requires explicit owner permission/);
 assert.match(sql,/Precondition: provision a fresh restricted/);
 assert.match(sql,/current_database\(\) <> 'bros_intelligence_dev'/);
 assert.match(sql,/NOT rolinherit AND NOT rolbypassrls/);
 assert.match(sql,/NOT rolsuper AND NOT rolcreaterole/);
 assert.equal(sql.includes('PASSWORD '),false,'Do not store or generate database passwords in GitHub');
});

test('request idempotency is database-enforced and requires forced RLS',()=>{
 assert.match(sql,/CREATE TABLE content_dev\.generated_output_requests/);
 assert.match(sql,/PRIMARY KEY\(tenant_id,owner_principal_id,idempotency_key\)/);
 assert.match(sql,/fingerprint ~ '\^\[0-9a-f\]\{64\}\$'/);
 assert.match(sql,/ALTER TABLE content_dev\.generated_output_requests ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/ALTER TABLE content_dev\.generated_output_requests FORCE ROW LEVEL SECURITY/);
 assert.match(sql,/FOREIGN KEY\(tenant_id,workspace_id\)/);
 assert.match(sql,/FOREIGN KEY\(tenant_id,campaign_id\)/);
});

test('new login role is granted scoped inserts and only campaign_id link updates',()=>{
 assert.match(sql,new RegExp('TO '+role));
 assert.match(sql,/GRANT INSERT ON content_dev\.campaigns,\s*content_dev\.content_items,\s*content_dev\.scenes,\s*content_dev\.generated_output_requests/);
 assert.match(sql,/GRANT UPDATE\(campaign_id\) ON content_dev\.generated_output_requests/);
 assert.match(sql,/NO: UPDATE\/DELETE on campaigns\/items\/scenes/);
 for(const bad of [
  /GRANT ALL/i,/GRANT INSERT ON content_dev\.credit_ledger/i,
  /GRANT INSERT ON content_dev\.generation_jobs/i,
  /GRANT USAGE ON SCHEMA content_import_dev/i,
  /SECURITY DEFINER/i,/DROP TABLE/i
 ])assert.doesNotMatch(sql,bad);
});

test('every writable table is restricted to verified CONTENT membership and principal',()=>{
 for(const entity of ['membership_select','workspace_select','campaign_select',
  'campaign_insert','item_select','item_insert','scene_select','scene_insert',
  'request_select','request_insert','request_update']){
  assert.match(sql,new RegExp('CREATE POLICY generated_writer_'+entity+'_v1'));
 }
 assert.match(sql,/m\.product='content' AND m\.active IS TRUE AND m\.revoked_at IS NULL/);
 assert.match(sql,/NULLIF\(current_setting\('bci\.principal_id',true\),''\)::uuid/);
 assert.match(sql,/status='draft'/);
 assert.match(sql,/campaign_id IS NULL/);
 assert.match(sql,/campaign_id IS NOT NULL/);
 assert.match(sql,/legacy_supabase_id IS NULL/);
});
