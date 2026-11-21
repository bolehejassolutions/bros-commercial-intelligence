import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const actions = readFileSync(resolve(root, "app/actions.ts"), "utf8");
const page = readFileSync(resolve(root, "app/cases/[id]/page.tsx"), "utf8");
const observed = actions.split("export async function createOutcome(")[1]?.split("export async function markImplementationCompleted(")[0] ?? "";
const completion = actions.split("export async function markImplementationCompleted(")[1]?.split("export async function createLearning(")[0] ?? "";

test("recorded observations never auto-complete technical actions", () => {
  assert.match(observed, /from\("outcomes"\)\.insert/);
  assert.doesNotMatch(observed, /from\("actions"\)\.update/);
  assert.doesNotMatch(observed, /completed_at\s*:/);
});

test("outcome action ID must belong to the submitted case", () => {
  assert.match(observed, /from\("actions"\)[\s\S]*?eq\("id", actionId\)/);
  assert.match(observed, /from\("decisions"\)[\s\S]*?eq\("case_id", caseId\)/);
});

test("implementation completion requires separate case-scoped server action", () => {
  assert.match(completion, /from\("actions"\)[\s\S]*?eq\("id", actionId\)/);
  assert.match(completion, /from\("decisions"\)[\s\S]*?eq\("case_id", caseId\)/);
  assert.match(completion, /update\(\{ status: "completed", completed_at:/);
});

test("operator UI exposes explicit self-reported completion, never outcome verification", () => {
  assert.match(page, /form action=\{markImplementationCompleted\}/);
  assert.match(page, /Mark implementation complete \(self-reported\)/);
  assert.match(page, /Record an observation; it does not complete the action or verify a business result/);
});

test("no automatic ad, publishing or payment writes introduced in these server actions", () => {
  assert.doesNotMatch(observed+completion, /meta_ads|buffer|hitpay|payment|campaign/gi);
});
