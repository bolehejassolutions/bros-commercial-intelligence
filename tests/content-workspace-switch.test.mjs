import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldResetContentDraftOnWorkspaceSwitch,reconcileContentWorkspaceSelection} from '../lib/content/neon-content-workspace-switch.ts';

test('switching from workspace A to B requires clearing unsaved draft',()=>{
 assert.equal(shouldResetContentDraftOnWorkspaceSwitch('workspace-a','workspace-b'),true);
});
test('reselecting same workspace preserves draft',()=>{
 assert.equal(shouldResetContentDraftOnWorkspaceSwitch('workspace-a','workspace-a'),false);
});
test('first workspace selection resets any orphaned draft',()=>{
 assert.equal(shouldResetContentDraftOnWorkspaceSwitch('','workspace-a'),true);
});

test('index refresh retains membership and does not trigger draft reset',()=>{
 const next=reconcileContentWorkspaceSelection('workspace-b',['workspace-a','workspace-b']);
 assert.equal(next,'workspace-b');
 assert.equal(shouldResetContentDraftOnWorkspaceSwitch('workspace-b',next),false);
});
test('revoked workspace membership falls back and requires draft reset',()=>{
 const next=reconcileContentWorkspaceSelection('workspace-b',['workspace-a']);
 assert.equal(next,'workspace-a');
 assert.equal(shouldResetContentDraftOnWorkspaceSwitch('workspace-b',next),true);
});
test('empty membership index clears selection and requires draft reset',()=>{
 const next=reconcileContentWorkspaceSelection('workspace-b',[]);
 assert.equal(next,'');
 assert.equal(shouldResetContentDraftOnWorkspaceSwitch('workspace-b',next),true);
});
test('first index selection resolves to first permitted workspace',()=>{
 assert.equal(reconcileContentWorkspaceSelection('',['workspace-a','workspace-b']),'workspace-a');
});
