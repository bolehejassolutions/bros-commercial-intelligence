/** Independent-connection durability acceptance in CI's disposable PostgreSQL only.
 * Uses an ephemeral table with guaranteed cleanup; not the restricted Neon writer.
 */
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
const key='independent_readback_20261111';
const draft={product_service:'BROS SELL',audience:'Peniaga Malaysia',description:'',
 problem:'',objective:'',duration_days:7,platforms:['facebook']};
const request=()=>new Request('https://content.example.test/api/content/dev/workspaces/'+workspace+'/campaign-drafts',{
 method:'POST',headers:{'content-type':'application/json','origin':'https://content.example.test',
 'sec-fetch-site':'same-origin','idempotency-key':key},body:JSON.stringify(draft)});

test('disposable PostgreSQL: committed HTTP draft survives a separate connection and retry',async()=>{
 const table='content_http_receipts_'+randomUUID().replaceAll('-','');
 const writerClient=new pg.Client({connectionString:url});
 const readerClient=new pg.Client({connectionString:url});
 await writerClient.connect();
 try{
  await writerClient.query(`CREATE TABLE public.${table} (
   owner uuid NOT NULL, workspace uuid NOT NULL, retry_key text NOT NULL,
   payload jsonb NOT NULL, campaign_id uuid NOT NULL,
   PRIMARY KEY(owner,workspace,retry_key))`);
  await readerClient.connect();
  let inserts=0;
  const writer=async(identity,scope,body,retryKey)=>{
   await writerClient.query('BEGIN');
   try{
    const existing=await writerClient.query(
     `SELECT campaign_id,payload FROM public.${table} WHERE owner=$1 AND workspace=$2 AND retry_key=$3 FOR UPDATE`,
     [identity.userId,scope,retryKey]);
    if(existing.rowCount){
     assert.deepEqual(existing.rows[0].payload,body);
     await writerClient.query('COMMIT');
     return {id:existing.rows[0].campaign_id,status:'draft',replayed:true};
    }
    const id='55555555-5555-4555-8555-000000000001';
    await writerClient.query(
     `INSERT INTO public.${table}(owner,workspace,retry_key,payload,campaign_id)
      VALUES($1,$2,$3,$4::jsonb,$5)`,
     [identity.userId,scope,retryKey,JSON.stringify(body),id]);
    inserts++;
    await writerClient.query('COMMIT');
    return {id,status:'draft'};
   }catch(error){await writerClient.query('ROLLBACK');throw error;}
  };
  const handler=createContentCampaignDraftPost(async()=>({userId:principal,authenticated:true}),writer);
  assert.equal((await handler(request(),workspace)).status,201);
  // The first HTTP response is deliberately discarded (lost acknowledgement).
  const before=await readerClient.query(`SELECT campaign_id,payload FROM public.${table}`);
  assert.equal(before.rowCount,1);
  assert.deepEqual(before.rows[0].payload,draft);
  const retry=await handler(request(),workspace);
  assert.equal(retry.status,201);
  assert.equal((await retry.json()).data.replayed,true);
  assert.equal(inserts,1);
  const after=await readerClient.query(`SELECT count(*)::int AS n FROM public.${table}`);
  assert.equal(after.rows[0].n,1);
 }finally{
  await readerClient.end().catch(()=>{});
  await writerClient.query('ROLLBACK').catch(()=>{});
  await writerClient.query(`DROP TABLE IF EXISTS public.${table}`).catch(()=>{});
  await writerClient.end().catch(()=>{});
 }
});
