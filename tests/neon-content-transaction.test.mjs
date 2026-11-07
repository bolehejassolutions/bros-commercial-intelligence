import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentTransaction} from '../lib/content/neon-content-transaction.ts';

function fixture({failOn}={}){
 const calls=[];let releases=0;
 const client={
  async query(sql,params=[]){calls.push({sql,params});if(sql===failOn)throw Error('database failure');return {rows:[{ok:true}]};},
  release(){releases++;}
 };
 return {transaction:createContentTransaction({connect:async()=>client}),calls,get releases(){return releases;}};
}
test('one transaction resets inherited principal, executes work, commits and releases',async()=>{
 const f=fixture();
 const result=await f.transaction(async query=>query('SELECT 1',[]));
 assert.deepEqual(result,{rows:[{ok:true}]});
 assert.deepEqual(f.calls.map(x=>x.sql),['BEGIN',"SELECT set_config('bci.principal_id','',true)",'SELECT 1','COMMIT']);
 assert.equal(f.releases,1);
});
test('operation failure rolls back and releases, never commits',async()=>{
 const f=fixture({failOn:'SELECT fail'});
 await assert.rejects(f.transaction(async query=>query('SELECT fail',[])),/database failure/);
 assert.deepEqual(f.calls.map(x=>x.sql).slice(-2),['SELECT fail','ROLLBACK']);
 assert.equal(f.releases,1);
});
test('failed BEGIN releases connection without invalid rollback',async()=>{
 const f=fixture({failOn:'BEGIN'});
 await assert.rejects(f.transaction(async()=>1),/database failure/);
 assert.deepEqual(f.calls.map(x=>x.sql),['BEGIN']);
 assert.equal(f.releases,1);
});
test('failed COMMIT attempts rollback and releases',async()=>{
 const f=fixture({failOn:'COMMIT'});
 await assert.rejects(f.transaction(async()=>1),/database failure/);
 assert.deepEqual(f.calls.map(x=>x.sql).slice(-2),['COMMIT','ROLLBACK']);
 assert.equal(f.releases,1);
});
