import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentWorkspaceReader} from '../lib/content/neon-content-workspace-reader.ts';

const principal='11111111-1111-4111-8111-111111111111';
const workspace='33333333-3333-4333-8333-333333333333';
const tenant='44444444-4444-4444-8444-444444444444';
const uuid=(n:number)=>`55555555-5555-4555-8555-${n.toString(16).padStart(12,'0')}`;
const campaigns=Array.from({length:101},(_,i)=>uuid(i+1));

function reader(duplicateSentinel=false) {
 const childCampaigns:string[]=[];
 const read=createContentWorkspaceReader(async fn=>fn(async(sql,params)=>{
  if(sql.includes('FROM pg_roles'))return {rows:[{name:'content_dev_reader_v2',login:'content_dev_reader_v2',can_login:true,inherits:false,bypass:false,superuser:false,can_create_role:false,parents:0}]};
  if(sql.includes('current_database()'))return {rows:[{db:'bros_intelligence_dev',forced:4,staging:false,credits:false,writes:false,membership:true}]};
  if(sql.includes("set_config('bci.principal_id'"))return {rows:[{principal_id:principal}]};
  if(sql.includes('FROM content_dev.workspaces'))return {rows:[{id:workspace,tenant_id:tenant}]};
  if(sql.includes('FROM content_dev.campaigns'))return {rows:(duplicateSentinel?[...campaigns.slice(0,100),campaigns[0]]:campaigns).map(id=>({id}))};
  if(sql.includes('FROM content_dev.content_items')){childCampaigns.push(String(params[1]));return {rows:[]};}
  throw new Error('Unexpected query: '+sql.slice(0,60));
 }));
 return {read,childCampaigns};
}

test('101st campaign is a pagination sentinel, not exposed or expanded',async()=>{
 const {read,childCampaigns}=reader();
 const result=await read({userId:principal,authenticated:true},workspace);
 assert.equal(result.campaigns.length,100);
 assert.equal(result.nextCursor,campaigns[99]);
 assert.deepEqual(childCampaigns,campaigns.slice(0,100));
 assert.equal(result.campaigns.some(c=>c.id===campaigns[100]),false);
});

test('duplicate 101st sentinel ID fails closed before any child read',async()=>{
 const {read,childCampaigns}=reader(true);
 await assert.rejects(read({userId:principal,authenticated:true},workspace),/CONTENT access denied/);
 assert.equal(childCampaigns.length,0);
});
