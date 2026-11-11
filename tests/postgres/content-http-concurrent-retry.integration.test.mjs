/** Disposable PostgreSQL concurrent HTTP retry acceptance. No live Neon access. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createContentCampaignDraftPost} from '../../lib/content/neon-content-campaign-draft-http.ts';

const url=process.env.CONTENT_ADMIN_DB_URL??'';
if(process.env.CONTENT_PG_INTEGRATION_CI!=='disposable_only'||
 !/^postgresql:\/\/postgres:[^@]+@127\.0\.0\.1:5432\/bros_intelligence_dev$/.test(url))
 throw Error('Refusing non-disposable PostgreSQL target');

const workspace='11111111-1111-4111-8111-111111111111';
const principal='22222222-2222-4222-8222-222222222222';
const key='parallel_http_retry_20261111';
const draft={product_service:'BROS SELL',audience:'Peniaga Malaysia',description:'',
 problem:'',objective:'',duration_days:7,platforms:['facebook']};
const request=()=>new Request('https://content.example.test/api/content/dev/workspaces/'+workspace+'/campaign-drafts',{
 method:'POST',headers:{'content-type':'application/json','origin':'https://content.example.test',
 'sec-fetch-site':'same-origin','idempotency-key':key},body:JSON.stringify(draft)});

test('disposable PostgreSQL: parallel authenticated HTTP retries yield one committed campaign',async()=>{
 const table='content_parallel_receipts_'+randomUUID().replaceAll('-','');
 const admin=new pg.Client({connectionString:url});
 const clients=[new pg.Client({connectionString:url}),new pg.Client({connectionString:url})];
 await admin.connect();
 try{
  await admin.query(`CREATE TABLE public.${table} (
   owner uuid NOT NULL, workspace uuid NOT NULL, retry_key text NOT NULL,
   payload jsonb NOT NULL, campaign_id uuid NOT NULL,
   PRIMARY KEY(owner,workspace,retry_key))`);
  await Promise.all(clients.map(c=>c.connect()));
  const makeWriter=(client)=>async(identity,scope,body,retryKey)=>{
   await client.query('BEGIN');
   try{
    // Serialize competing requests inside PostgreSQL, never a process-local mutex.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
     [identity.userId+':'+scope+':'+retryKey]);
    const id='55555555-5555-4555-8555-000000000001';
    const inserted=await client.query(
     `INSERT INTO public.${table}(owner,workspace,retry_key,payload,campaign_id)
      VALUES($1,$2,$3,$4::jsonb,$5)
      ON CONFLICT(owner,workspace,retry_key) DO NOTHING RETURNING campaign_id`,
     [identity.userId,scope,retryKey,JSON.stringify(body),id]);
    const row=await client.query(
     `SELECT campaign_id,payload FROM public.${table}
      WHERE owner=$1 AND workspace=$2 AND retry_key=$3`,
     [identity.userId,scope,retryKey]);
    assert.equal(row.rowCount,1);
    assert.deepEqual(row.rows[0].payload,body);
    await client.query('COMMIT');
    return {id:row.rows[0].campaign_id,status:'draft',replayed:inserted.rowCount===0};
   }catch(error){await client.query('ROLLBACK');throw error;}
  };
  const handlers=clients.map(c=>createContentCampaignDraftPost(
   async()=>({userId:principal,authenticated:true}),makeWriter(c)));
  const responses=await Promise.all(handlers.map(h=>h(request(),workspace)));
  assert.deepEqual(responses.map(r=>r.status),[201,201]);
  const acknowledgements=await Promise.all(responses.map(r=>r.json()));
  assert.deepEqual(acknowledgements.map(r=>r.data.replayed).sort(),[false,true]);
  const readback=await admin.query(`SELECT campaign_id,payload FROM public.${table}`);
  assert.equal(readback.rowCount,1);
  assert.deepEqual(readback.rows[0].payload,draft);
  assert.equal(acknowledgements[0].data.id,readback.rows[0].campaign_id);
  assert.equal(acknowledgements[1].data.id,readback.rows[0].campaign_id);
 }finally{
  await Promise.all(clients.map(c=>c.end().catch(()=>{})));
  await admin.query(`DROP TABLE IF EXISTS public.${table}`).catch(()=>{});
  await admin.end().catch(()=>{});
 }
});
