import test from 'node:test';
import assert from 'node:assert/strict';
import {initialWorkspaceLoad,loadingWorkspace,loadedWorkspace,failedWorkspace} from '../lib/content/neon-content-workspace-load-state.ts';
import {isContentWorkspaceDetailCurrent,isContentDraftWorkspaceSettled,isContentWorkspaceIndexReady} from '../lib/content/neon-content-workspace-render-guard.ts';

const a={workspace:{id:'tenant-a-workspace'},campaigns:[{id:'a-private-campaign'}]};
const b={workspace:{id:'tenant-b-workspace'},campaigns:[]};

test('same workspace may display its verified loaded campaign rows',()=>{
 assert.equal(isContentWorkspaceDetailCurrent('tenant-a-workspace',loadedWorkspace(a)),true);
 assert.equal(isContentWorkspaceDetailCurrent('tenant-b-workspace',loadedWorkspace(b)),true);
});
test('switching tenants immediately hides prior tenant campaign rows before effects execute',()=>{
 const previousRender=loadedWorkspace(a);
 assert.equal(isContentWorkspaceDetailCurrent('tenant-b-workspace',previousRender),false);
 assert.equal(isContentWorkspaceDetailCurrent('tenant-a-workspace',previousRender),true);
});
test('revoked or empty selection cannot render cached workspace',()=>{
 assert.equal(isContentWorkspaceDetailCurrent('',loadedWorkspace(a)),false);
});
test('pending, failed and initial reads cannot be mistaken for a valid tenant detail',()=>{
 assert.equal(isContentWorkspaceDetailCurrent('tenant-a-workspace',initialWorkspaceLoad()),false);
 assert.equal(isContentWorkspaceDetailCurrent('tenant-a-workspace',loadingWorkspace()),false);
 assert.equal(isContentWorkspaceDetailCurrent('tenant-a-workspace',failedWorkspace('unavailable')),false);
});

test('draft form is hidden during A-to-B selection before reset effect',()=>{
 assert.equal(isContentDraftWorkspaceSettled('workspace-b','workspace-a'),false);
});
test('draft form available only after B reset effect',()=>{
 assert.equal(isContentDraftWorkspaceSettled('workspace-b','workspace-b'),true);
});
test('draft form unavailable after membership revocation',()=>{
 assert.equal(isContentDraftWorkspaceSettled('','workspace-a'),false);
});
test('draft form stays available for unchanged workspace',()=>{
 assert.equal(isContentDraftWorkspaceSettled('workspace-a','workspace-a'),true);
});

test('verified index membership allows selected workspace',()=>{
 assert.equal(isContentWorkspaceIndexReady(false,'','workspace-a',['workspace-a','workspace-b']),true);
});
test('membership refresh hides cached tenant view until fresh index succeeds',()=>{
 assert.equal(isContentWorkspaceIndexReady(true,'','workspace-a',['workspace-a']),false);
});
test('failed membership refresh hides cached tenant view and draft submission',()=>{
 assert.equal(isContentWorkspaceIndexReady(false,'Senarai workspace belum dapat dibaca.','workspace-a',['workspace-a']),false);
});
test('revoked selection fails closed even if stale detail remains loaded',()=>{
 assert.equal(isContentWorkspaceIndexReady(false,'','workspace-a',['workspace-b']),false);
 assert.equal(isContentWorkspaceIndexReady(false,'','', ['workspace-a']),false);
});
