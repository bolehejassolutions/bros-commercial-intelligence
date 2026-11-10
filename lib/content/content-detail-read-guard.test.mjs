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
