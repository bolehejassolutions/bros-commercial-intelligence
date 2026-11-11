/** Real restricted draft writer must reject transaction-local principal spoofing.
 * Disposable CI PostgreSQL only. Never targets live Neon.
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

const userId='8ae086ff-3f10-4863-b5e7-4b67e062024d';
const workspace='22222222-2222-4222-8222-222222222222';
const payload={product_service:'BROS SELL',audience:'Peniaga Malaysia',
 description:'',problem:'',objective:'',duration_days:7,platforms:['facebook']};

test('spoofed transaction-local BCI principal cannot bypass actual draft writer role gate',async()=>{
 const admin=new pg.Client({connectionString:url});
 await admin.connect();
 try{
  const before=await admin.query('SELECT count(*)::int AS n FROM content_dev.campaigns');
  let writerQueries=0;
  const transaction=async fn=>{
   await admin.query('BEGIN');
   try{
    // Simulates a privileged connection that preloads the identity GUC.
    await admin.query("SELECT set_config('bci.principal_id',$1,true)",[userId]);
    const result=await fn(async(sql,params)=>{
     writerQueries++;
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
  const handler=createContentCampaignDraftPost(
   async()=>({userId,authenticated:true}),
   createContentCampaignDraftWriter(transaction));
  const response=await handler(new Request(
   'https://content.example.test/api/content/dev/workspaces/'+workspace+'/campaign-drafts',{
    method:'POST',headers:{'content-type':'application/json',
     origin:'https://content.example.test','sec-fetch-site':'same-origin',
     'idempotency-key':'spoofed_principal_20261112'},
    body:JSON.stringify(payload)}),workspace);
  assert.equal(response.status,404);
  assert.deepEqual(await response.json(),{error:'not_found'});
  assert.equal(writerQueries,1,'role gate must precede membership and persistence');
  const after=await admin.query('SELECT count(*)::int AS n FROM content_dev.campaigns');
  assert.equal(after.rows[0].n,before.rows[0].n);
  const context=await admin.query("SELECT current_setting('bci.principal_id',true) AS principal");
  assert.notEqual(context.rows[0].principal,userId,'failed transaction must clear spoofed local identity');
 }finally{await admin.end();}
});
