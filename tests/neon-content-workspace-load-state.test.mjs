import test from 'node:test';
import assert from 'node:assert/strict';
import {initialWorkspaceLoad,loadingWorkspace,loadedWorkspace,failedWorkspace} from '../lib/content/neon-content-workspace-load-state.ts';

test('pending workspace load is not confused with an empty workspace',()=>{
 const idle=initialWorkspaceLoad();
 const pending=loadingWorkspace();
 assert.equal(idle.status,'idle');
 assert.equal(pending.status,'loading');
 assert.equal(pending.data,null);
 assert.equal(pending.error,null);
});
test('successful zero-campaign workspace is explicitly ready, not a failed read',()=>{
 const data={workspace:{id:'workspace-1'},campaigns:[],contentItems:[],scenes:[]};
 const result=loadedWorkspace(data);
 assert.equal(result.status,'ready');
 assert.equal(result.data,data);
 assert.equal(result.data.campaigns.length,0);
 assert.equal(result.error,null);
});
test('failed workspace load never retains prior tenant data and can be retried',()=>{
 const prior=loadedWorkspace({campaigns:[{id:'secret'}]});
 const error=failedWorkspace('  Backend unavailable  ');
 assert.equal(prior.data.campaigns.length,1);
 assert.deepEqual(error,{status:'error',data:null,error:'Backend unavailable'});
 assert.deepEqual(loadingWorkspace(),{status:'loading',data:null,error:null});
});
test('empty backend error has a safe fallback',()=>{
 assert.equal(failedWorkspace('   ').error,'Workspace unavailable');
});
