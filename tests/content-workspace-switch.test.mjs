import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldResetContentDraftOnWorkspaceSwitch} from '../lib/content/neon-content-workspace-switch.ts';

test('switching from workspace A to B requires clearing unsaved draft',()=>{
 assert.equal(shouldResetContentDraftOnWorkspaceSwitch('workspace-a','workspace-b'),true);
});
test('reselecting same workspace preserves draft',()=>{
 assert.equal(shouldResetContentDraftOnWorkspaceSwitch('workspace-a','workspace-a'),false);
});
test('first workspace selection resets any orphaned draft',()=>{
 assert.equal(shouldResetContentDraftOnWorkspaceSwitch('','workspace-a'),true);
});
