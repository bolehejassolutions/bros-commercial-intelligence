/** Actual restricted writer must reject a privileged disposable PostgreSQL login.
 * The injected transaction is real PostgreSQL, not a mocked SQL dispatcher.
 * No Neon or persistent database access.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createContentCampaignDraftPost} from '../../lib/content/neon-content-campaign-draft-http.ts';
import {createContentCampaignDraftWriter} from '../../lib/content/neon-content-campaign-draft-writer.ts';

const url=process.env.CONTENT_ADMIN_DB_URL??'';
if(process.env.CONTENT_PG_INTEGRATION_CI!=='disposable_only'||
 !/^postgresql:\/\/postgres:[^@]+@127\.0\.0\.1:5432\/bros_intelligence_dev$/.test(url))
 throw Error('Refusing non-disposable PostgreSQL target');

const principal='8ae086ff-3f10-4863-b5e7-4b67e062024d';
const workspace='22222222-2222-4222-8222-222222222222';
const draft={product_service:'BROS SELL',audience:'Peniaga Malaysia',
 description:'',problem:'',objective:'',duration_days:7,platforms:['facebook']};
const request=()=>new Request(
 'https://content.example.test/api/content/dev/workspaces/'+workspace+'/campaign-drafts',{
 method:'POST',headers:{'content-type':'application/json',
 origin:'https://content.example.test','sec-fetch-site':'same-origin',
 'idempotency-key':'actual_writer_denial_20261112'},body:JSON.stringify(draft)});

test('actual draft writer denies privileged PostgreSQL login before any campaign insert',async()=>{
 const admin=new pg.Client({connectionString:url});
 await admin.connect();
 try{
  const before=await admin.query('SELECT count(*)::int AS n FROM content_dev.campaigns');
  let queryCount=0;
  const transaction=async fn=>{
   await admin.query('BEGIN');
   try{
    const result=await fn(async(sql,params)=>{
     queryCount++;
     const response=await admin.query(sql,params);
     return {rows:response.rows};
    });
    await admin.query('COMMIT');
    return result;
   }catch(error){
    await admin.query('ROLLBACK');
    throw error;
   }
  };
  const writer=createContentCampaignDraftWriter(transaction);
  const handler=createContentCampaignDraftPost(
   async()=>({userId:principal,authenticated:true}),writer);
  const response=await handler(request(),workspace);
  assert.equal(response.status,404);
  assert.deepEqual(await response.json(),{error:'not_found'});
  assert.equal(queryCount,1,'role posture must fail before membership or write SQL');
  const after=await admin.query('SELECT count(*)::int AS n FROM content_dev.campaigns');
  assert.equal(after.rows[0].n,before.rows[0].n);
 }finally{await admin.end();}
});
