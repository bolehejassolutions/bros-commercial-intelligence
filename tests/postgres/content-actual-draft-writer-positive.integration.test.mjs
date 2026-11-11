import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createContentCampaignDraftPost} from '../../lib/content/neon-content-campaign-draft-http.ts';
import {createContentCampaignDraftWriter} from '../../lib/content/neon-content-campaign-draft-writer.ts';

const adminUrl=process.env.CONTENT_ADMIN_DB_URL??'';
const writerUrl=process.env.CONTENT_DRAFT_DB_URL??'';
const readerUrl=process.env.CONTENT_READER_DB_URL??'';
if(process.env.CONTENT_PG_INTEGRATION_CI!=='disposable_only' ||
 !/^postgresql:\/\/postgres:[^@]+@127\.0\.0\.1:5432\/bros_intelligence_dev$/.test(adminUrl) ||
 !/^postgresql:\/\/content_dev_draft_writer_v2:[^@]+@127\.0\.0\.1:5432\/bros_intelligence_dev$/.test(writerUrl) ||
 !/^postgresql:\/\/content_dev_reader_v2:[^@]+@127\.0\.0\.1:5432\/bros_intelligence_dev$/.test(readerUrl))
 throw Error('Refusing non-disposable PostgreSQL target');

const userId='8ae086ff-3f10-4863-b5e7-4b67e062024d';
const workspace='22222222-2222-4222-8222-222222222222';
const payload={product_service:'BROS SELL',audience:'Peniaga Malaysia',description:'',
 problem:'',objective:'',duration_days:7,platforms:['facebook']};

test('actual restricted writer persists HTTP draft, replays and rejects changed payload; independent admin readback',async()=>{
 const writer=new pg.Client({connectionString:writerUrl});
 const admin=new pg.Client({connectionString:adminUrl});
 const reader=new pg.Client({connectionString:readerUrl});
 await writer.connect(); await admin.connect(); await reader.connect();
 const transaction=async fn=>{
  await writer.query('BEGIN');
  try {
   const result=await fn(async(sql,params)=>{
    const response=await writer.query(sql,params);
    return {rows:response.rows};
   });
   await writer.query('COMMIT');return result;
  }catch(error){await writer.query('ROLLBACK');throw error;}
 };
 const handler=createContentCampaignDraftPost(async()=>({userId,authenticated:true}),
  createContentCampaignDraftWriter(transaction));
 const request=(body)=>new Request('https://content.example.test/api/content/dev/workspaces/'+workspace+'/campaign-drafts',{
  method:'POST',headers:{'content-type':'application/json',origin:'https://content.example.test',
   'sec-fetch-site':'same-origin','idempotency-key':'actual_writer_positive_20261112'},
  body:JSON.stringify(body)});
 try {
  const first=await handler(request(payload),workspace);
  assert.equal(first.status,201); 
  const {data:saved}=await first.json();
  assert.match(saved.id,/^[0-9a-f-]{36}$/i);
  const replay=await handler(request(payload),workspace);
  assert.equal(replay.status,201);
  const {data:repeated}=await replay.json();
  assert.equal(repeated.id,saved.id);
  const changed=await handler(request({...payload,audience:'Changed'}),workspace);
  assert.equal(changed.status,404);
  // The actual HTTP boundary must reject a route/workspace mismatch before
  // touching the restricted writer, even when the caller has a valid session.
  const otherWorkspace='33333333-3333-4333-8333-333333333333';
  const wrongScope=await handler(request(payload),otherWorkspace);
  assert.equal(wrongScope.status,404);
  assert.equal((await wrongScope.json()).error,'not_found');
  // Cross-site writes must be rejected independently of session validity.
  const crossSite=new Request('https://content.example.test/api/content/dev/workspaces/'+workspace+'/campaign-drafts',{
   method:'POST',headers:{'content-type':'application/json',origin:'https://external.example.test',
    'sec-fetch-site':'cross-site','idempotency-key':'actual_writer_crosssite_20261112'},
   body:JSON.stringify(payload)});
  const forbidden=await handler(crossSite,workspace);
  assert.equal(forbidden.status,403);
  assert.equal((await forbidden.json()).error,'forbidden_origin');
  // An invalid draft must not reserve an idempotency key or persist a campaign.
  const malformed=await handler(request({...payload,platforms:['facebook','facebook']}),workspace);
  assert.equal(malformed.status,400);
  assert.equal((await malformed.json()).error,'invalid_draft');
  const stored=await admin.query('SELECT id,tenant_id,workspace_id,owner_principal_id,audience FROM content_dev.campaigns WHERE id=$1',[saved.id]);
  assert.equal(stored.rowCount,1);
  assert.equal(stored.rows[0].audience,payload.audience);
  assert.equal(stored.rows[0].workspace_id,workspace);
  assert.equal(stored.rows[0].owner_principal_id,userId);
  const requests=await admin.query('SELECT count(*)::int AS n FROM content_dev.campaign_draft_requests WHERE campaign_id=$1',[saved.id]);
  assert.equal(requests.rows[0].n,1);
  // Read committed data from the actual least-privilege reader, not the admin.
  await reader.query('BEGIN');
  await reader.query("SELECT set_config('bci.principal_id',$1,true)",[userId]);
  const visible=await reader.query('SELECT id,workspace_id,audience FROM content_dev.campaigns WHERE id=$1',[saved.id]);
  assert.equal(visible.rowCount,1);
  assert.equal(visible.rows[0].workspace_id,workspace);
  assert.equal(visible.rows[0].audience,payload.audience);
  await reader.query('ROLLBACK');
  // A different authenticated principal must not observe the same campaign.
  await reader.query('BEGIN');
  await reader.query("SELECT set_config('bci.principal_id',$1,true)",['11111111-1111-4111-8111-111111111111']);
  const denied=await reader.query('SELECT id FROM content_dev.campaigns WHERE id=$1',[saved.id]);
  assert.equal(denied.rowCount,0);
  await reader.query('ROLLBACK');
 }finally{await reader.query('ROLLBACK').catch(()=>{});await reader.end();await writer.end();await admin.end();}
});
