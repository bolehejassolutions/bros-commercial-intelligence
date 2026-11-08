import test from 'node:test';
import assert from 'node:assert/strict';
import {contentWorkspaceReadError} from '../lib/content/neon-content-workspace-http-error.ts';
test('session failure gives sign-in guidance',()=>assert.match(contentWorkspaceReadError(401),/log masuk/));
test('foreign and missing workspaces use indistinguishable messages',()=>assert.equal(contentWorkspaceReadError(403),contentWorkspaceReadError(404)));
test('incomplete workspace is not presented as missing',()=>assert.notEqual(contentWorkspaceReadError(503),contentWorkspaceReadError(404)));
test('unrecognized errors are sanitized',()=>assert.equal(contentWorkspaceReadError(500),'Data kempen belum dapat dibaca. Cuba semula.'));
