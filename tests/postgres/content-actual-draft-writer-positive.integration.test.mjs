import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createContentCampaignDraftPost} from '../../lib/content/neon-content-campaign-draft-http.ts';
import {createContentCampaignDraftWriter} from '../../lib/content/neon-content-campaign-draft-writer.ts';

const adminUrl=process.env.CONTENT_ADMIN_DB_URL??'';
const writerUrl=process.env.CONTENT_DRAFT_DB_URL??'';
if(process.env.CONTENT_PG_INTEGRATION_CI!=='disposable_only' ||
 !/^postgresql:\/\/postgres:[^@]+@127\.0\.0\.1:5432\/bros_intelligence_dev$/.test(adminUrl) ||
 !/^postgresql:\/\/content_dev_draft_writer_v2:[^@]+@127\.0\.0\.1:5432\/bros_intelligence_dev$/.test(writerUrl))
 throw Error('Refusing non-disposable PostgreSQL target');

const userId='8ae086ff-3f10-4863-b5e7-4b67e062024d';
const workspace='22222222-2222-4222-8222-222222222222';
const payload={product_service:'BROS SELL',audience:'Peniaga Malaysia',description:'',
 problem:'',objective:'',duration_days:7,platforms:['facebook']};

test('actual restricted writer persists HTTP draft, replays and rejects changed payload; independent admin readback',async()=>{
 const writer=new pg.Client({connectionString:writerUrl});
 const admin=new pg.Client({connectionString:adminUrl});
 await writer.connect(); await admin.connect();
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
  const stored=await admin.query('SELECT id,tenant_id,workspace_id,owner_principal_id,audience FROM content_dev.campaigns WHERE id=$1',[saved.id]);
  assert.equal(stored.rowCount,1);
  assert.equal(stored.rows[0].audience,payload.audience);
  assert.equal(stored.rows[0].workspace_id,workspace);
  assert.equal(stored.rows[0].owner_principal_id,userId);
  const requests=await admin.query('SELECT count(*)::int AS n FROM content_dev.campaign_draft_requests WHERE campaign_id=$1',[saved.id]);
  assert.equal(requests.rows[0].n,1);
 }finally{await writer.end();await admin.end();}
});
