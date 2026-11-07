import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentWorkspaceIndexReader} from '../lib/content/neon-content-workspace-index.ts';
import {ContentReadDenied} from '../lib/content/neon-content-workspace-reader.ts';

const A='8ae086ff-3f10-4863-b5e7-4b67e062024d';
const B='11111111-1111-4111-8111-111111111111';
const W='22222222-2222-4222-8222-222222222222';
function fixture({role='content_dev_reader_v2',owner=A,postureOk=true}={}){
 const statements=[];
 const transaction=async operation=>operation(async(sql,params)=>{
  statements.push({sql,params});
  if(sql.includes('FROM pg_roles WHERE rolname=current_user'))
   return {rows:[{name:role,login:role,can_login:true,inherits:false,bypass:false,
    superuser:false,can_create_role:false,parents:0}]};
  if(sql.includes('current_database() AS db'))
   return {rows:[{db:'bros_intelligence_dev',forced:postureOk?1:0,
    membership:true,writes:false,credits:false,staging:false}]};
  if(sql.includes('set_config'))return {rows:[{principal_id:owner}]};
  if(sql.includes('FROM content_dev.workspaces'))
   return {rows:owner===A?[{id:W,name:'Original workspace'}]:[]};
  throw Error('Unexpected query');
 });
 return {reader:createContentWorkspaceIndexReader(transaction),statements};
}
test('owner-bound discovery uses verified principal and active CONTENT membership inside transaction',async()=>{
 const {reader,statements}=fixture();
 assert.deepEqual(await reader({userId:A,authenticated:true}),
  {workspaces:[{id:W,name:'Original workspace'}]});
 const sql=statements.map(x=>x.sql).join('\n');
 assert.match(sql,/m.product='content'/);
 assert.match(sql,/m.active IS TRUE/);
 assert.match(sql,/m.revoked_at IS NULL/);
 assert.match(sql,/w.owner_principal_id=\$1::uuid/);
 assert.match(sql,/set_config\('bci.principal_id'/);
 assert.equal(statements.at(-1).params[0],A);
});
test('foreign verified principal does not discover another owner workspace',async()=>{
 const {reader}=fixture({owner:B});
 assert.deepEqual(await reader({userId:B,authenticated:true}),{workspaces:[]});
});
test('wrong direct login, missing RLS or missing verified principal fails closed',async()=>{
 for(const config of [{role:'neondb_owner'},{role:'content_dev_draft_writer_v2'},{postureOk:false}]){
  const {reader}=fixture(config);
  await assert.rejects(reader({userId:A,authenticated:true}),ContentReadDenied);
 }
 const {reader}=fixture();
 for(const p of [null,{userId:'not-a-uuid',authenticated:true},{userId:A,authenticated:false}])
  await assert.rejects(reader(p),ContentReadDenied);
});
