import test from 'node:test';
import assert from 'node:assert/strict';
import {usesNeonPreviewAuthentication} from '../lib/bci/neon-preview-route-policy.ts';

const workspace='8ae086ff-3f10-4863-b5e7-4b67e062024d';
const route='/api/content/dev/workspaces/'+workspace;

test('CONTENT DEV workspace and campaign drafts bypass only BCI Supabase login',()=>{
 assert.equal(usesNeonPreviewAuthentication('/api/content/dev/workspaces'),true);
 for(const url of [route,route+'/campaign-drafts',route.toUpperCase()])
  assert.equal(usesNeonPreviewAuthentication(url),true,url);
});

test('CONTENT DEV proxy exception is exact and does not match neighboring or malformed paths',()=>{
 for(const url of [
  '/api/content/dev/workspaces/bogus',
  '/api/content/dev/workspaces/'+workspace+'/',
  route+'/campaign-drafts/',
  route+'/campaign-drafts/admin',
  route+'/generation-jobs',
  route+'/credits',
  '/api/content/production/workspaces/'+workspace,
  '/api/content/dev/workspaces/'+workspace+'?role=admin',
  '/api/content/dev/workspaces/'+workspace+'%2Fcampaign-drafts',
  '/api/content/dev/workspaces/11111111-1111-1111-1111-111111111111',
 ])
  assert.equal(usesNeonPreviewAuthentication(url),false,url);
});

test('existing BCI Neon preview boundary and Supabase routes are unchanged',()=>{
 assert.equal(usesNeonPreviewAuthentication('/api/internal/neon-demand-proposal'),true);
 for(const p of ['/','/operator','/api/operator','/login','/api/internal'])
  assert.equal(usesNeonPreviewAuthentication(p),false,p);
});
