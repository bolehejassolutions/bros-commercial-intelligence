import test from 'node:test';
import assert from 'node:assert/strict';
import {
 isContentDevPreviewEnabled,isContentDevAuthApiPath,isContentDevScreenPath,
 requiresContentNeonMiddleware,
} from '../lib/content/neon-content-auth-gate.ts';

test('Neon SDK bridge cannot run outside explicitly enabled Preview',()=>{
 for(const env of [
  {},{VERCEL_ENV:'preview'},{VERCEL_ENV:'production',CONTENT_DEV_API_ENABLED:'true'},
  {VERCEL_ENV:'development',CONTENT_DEV_API_ENABLED:'true'},
  {VERCEL_ENV:'preview',CONTENT_DEV_API_ENABLED:'TRUE'},
 ])assert.equal(isContentDevPreviewEnabled(env),false);
 assert.equal(isContentDevPreviewEnabled({VERCEL_ENV:'preview',CONTENT_DEV_API_ENABLED:'true'}),true);
});

test('same-origin bridge only recognizes exact auth-api paths and two CONTENT screens',()=>{
 for(const path of [
  '/api/auth/get-session','/api/auth/sign-in/email',
  '/api/auth/callback/google','/api/auth/sign-out',
  '/content/dev','/content/dev/sign-in',
 ])assert.equal(requiresContentNeonMiddleware(path),true,path);
 for(const path of [
  '/api/auth','/api/auth/','/api/auth/callback/google/',
  '/api/auth/../../operator','/api/auth/%2e%2e/operator',
  '/api/auth/get-session?next=/operator','/api/auth//get-session',
  '/auth/callback','/login','/operator','/content/dev/',
  '/content/dev/credits','/content/dev/sign-up',
  '/api/content/dev/workspaces/11111111-1111-4111-8111-111111111111',
 ])assert.equal(requiresContentNeonMiddleware(path),false,path);
 assert.equal(isContentDevAuthApiPath('/content/dev'),false);
 assert.equal(isContentDevScreenPath('/api/auth/get-session'),false);
});

test('existing BCI routes do not accidentally enter the CONTENT SDK boundary',()=>{
 for(const path of ['/api/internal/neon-demand-case','/internal/neon-preview',
  '/api/operator','/api/internal/neon-content-review'])
  assert.equal(requiresContentNeonMiddleware(path),false,path);
});
