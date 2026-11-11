/** Disposable PostgreSQL-backed authenticated HTTP boundary acceptance.
 * Uses TEMP tables and an injected fixture adapter, NOT the restricted Neon writer.
 * No production role, grant, customer row, or generated-output table is touched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createContentCampaignDraftPost} from '../../lib/content/neon-content-campaign-draft-http.ts';

if (process.env.CONTENT_PG_INTEGRATION_CI !== 'disposable_only' ||
    !/^postgresql:\/\/postgres:[^@]+@127\.0\.0\.1:5432\/bros_intelligence_dev$/.test(process.env.CONTENT_ADMIN_DB_URL ?? '')) {
  throw Error('Refusing non-disposable PostgreSQL target');
}
const workspace='11111111-1111-4111-8111-111111111111';
const otherWorkspace='33333333-3333-4333-8333-333333333333';
const user='22222222-2222-4222-8222-222222222222';
const otherUser='44444444-4444-4444-8444-444444444444';
const key='durable_http_retry_key_20261111';
const draft={product_service:'BROS SELL',audience:'Peniaga Malaysia',description:'',problem:'',objective:'',duration_days:7,platforms:['facebook']};
const makeRequest=(scope=workspace,body=draft)=>new Request(
  'https://content.example.test/api/content/dev/workspaces/'+scope+'/campaign-drafts',{
    method:'POST',headers:{'content-type':'application/json','origin':'https://content.example.test',
      'sec-fetch-site':'same-origin','idempotency-key':key},body:JSON.stringify(body)
  });

test('real disposable PostgreSQL: HTTP lost acknowledgement, retry, payload and identity isolation, independent readback',async()=>{
 const client=new pg.Client({connectionString:process.env.CONTENT_ADMIN_DB_URL});
 await client.connect();
 try{
  await client.query(`CREATE TEMP TABLE http_draft_receipts (
    owner uuid NOT NULL, workspace uuid NOT NULL, retry_key text NOT NULL,
    payload jsonb NOT NULL, campaign_id uuid NOT NULL,
    PRIMARY KEY(owner,workspace,retry_key)
  ) ON COMMIT PRESERVE ROWS`);
  let inserts=0;
  const writer=async(principal,scope,body,retryKey)=>{
   await client.query('BEGIN');
   try{
    const payload=JSON.stringify(body);
    const existing=await client.query(
      'SELECT campaign_id,payload FROM http_draft_receipts WHERE owner=$1 AND workspace=$2 AND retry_key=$3',
      [principal.userId,scope,retryKey]);
    if(existing.rows.length){
      if(JSON.stringify(existing.rows[0].payload)!==JSON.stringify(JSON.parse(payload)))throw Error('payload_conflict');
      await client.query('COMMIT');
      return {id:existing.rows[0].campaign_id,status:'draft',replayed:true};
    }
    const id='55555555-5555-4555-8555-'+String(++inserts).padStart(12,'0');
    await client.query('INSERT INTO http_draft_receipts(owner,workspace,retry_key,payload,campaign_id) VALUES($1,$2,$3,$4::jsonb,$5)',
      [principal.userId,scope,retryKey,payload,id]);
    await client.query('COMMIT');
    return {id,status:'draft'};
   }catch(error){await client.query('ROLLBACK');throw error;}
  };
  const handler=createContentCampaignDraftPost(async()=>({userId:user,authenticated:true}),writer);
  const first=await handler(makeRequest(),workspace);
  assert.equal(first.status,201);
  // Simulate a lost acknowledgement: discard first response and retry unchanged.
  const retry=await handler(makeRequest(),workspace);
  assert.equal(retry.status,201);
  assert.equal((await retry.json()).data.replayed,true);
  assert.equal(inserts,1);
  const persisted=await client.query('SELECT campaign_id,payload FROM http_draft_receipts WHERE owner=$1 AND workspace=$2',[user,workspace]);
  assert.equal(persisted.rowCount,1);
  assert.equal(persisted.rows[0].campaign_id,'55555555-5555-4555-8555-000000000001');
  assert.deepEqual(persisted.rows[0].payload,draft);

  // Same key, changed payload must not overwrite the committed row.
  assert.equal((await handler(makeRequest(workspace,{...draft,audience:'Changed'}),workspace)).status,503);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM http_draft_receipts')).rows[0].n,1);

  // HTTP route mismatch must fail before the injected writer.
  assert.equal((await handler(makeRequest(otherWorkspace),workspace)).status,404);
  assert.equal(inserts,1);
  // A different authenticated principal must not receive the first user's receipt.
  const otherHandler=createContentCampaignDraftPost(async()=>({userId:otherUser,authenticated:true}),writer);
  assert.equal((await otherHandler(makeRequest(),workspace)).status,201);
  assert.equal(inserts,2);
  const isolation=await client.query('SELECT owner,count(*)::int AS n FROM http_draft_receipts GROUP BY owner ORDER BY owner');
  assert.deepEqual(isolation.rows.map(r=>r.n),[1,1]);
  assert.equal((await handler(makeRequest(),workspace)).status,201);
  assert.equal(inserts,2);
 }finally{
  await client.query('ROLLBACK').catch(()=>{});
  await client.end();
 }
});
