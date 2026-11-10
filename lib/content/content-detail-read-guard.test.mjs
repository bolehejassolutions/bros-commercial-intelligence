import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentDetailReadGuard} from './content-detail-read-guard.js';

test('late GET success cannot overwrite a verified draft', async () => {
  const guard=createContentDetailReadGuard();
  const beforeSave=guard.beginRead();
  guard.supersedeWithVerifiedDraft();
  assert.equal(guard.isCurrent(beforeSave),false);
  const afterSave=guard.beginRead();
  assert.equal(guard.isCurrent(afterSave),true);
});
test('late GET error cannot replace a verified draft with stale error', () => {
  const guard=createContentDetailReadGuard();
  const old=guard.beginRead();
  guard.supersedeWithVerifiedDraft();
  assert.equal(guard.isCurrent(old),false);
});
test('newer GET wins over an older GET regardless of completion order', () => {
  const guard=createContentDetailReadGuard();
  const first=guard.beginRead(),second=guard.beginRead();
  assert.equal(guard.isCurrent(first),false);
  assert.equal(guard.isCurrent(second),true);
});
test('invalid tokens cannot authorize state changes', () => {
  const guard=createContentDetailReadGuard();
  guard.beginRead();
  for(const token of [0,-1,NaN,Infinity,1.5,undefined,'1']) assert.equal(guard.isCurrent(token),false);
});

test('verified draft readback does not trigger a second campaign GET', async () => {
  // Source integration contract: the independently verified response is the
  // authoritative snapshot; an extra refresh would re-enter loading/error.
  const {readFileSync}=await import('node:fs');
  const {fileURLToPath}=await import('node:url');
  const {resolve,dirname}=await import('node:path');
  const source=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),'../../app/content/dev/content-workspace-client.tsx'),'utf8');
  const save=source.slice(source.indexOf('async function saveDraft('),source.indexOf('return <main',source.indexOf('async function saveDraft(')));
  assert.match(save,/setDetailLoad\(loadedWorkspace\(verified\)\)/);
  assert.doesNotMatch(save,/setRefresh\s*\(/);
});
