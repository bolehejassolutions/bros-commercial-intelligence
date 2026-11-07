import test from "node:test";
import assert from "node:assert/strict";
import { usesNeonPreviewAuthentication } from "../lib/bci/neon-preview-route-policy.ts";

test("proposal POST reaches its own Neon boundary instead of the Supabase login redirect",()=>{
  assert.equal(usesNeonPreviewAuthentication("/api/internal/neon-demand-proposal"),true);
});

test("existing Neon evidence, case, lineage and sign-in routes retain their own boundary",()=>{
  for(const pathname of ["/api/internal/neon-evidence","/api/internal/neon-demand-case",
    "/api/internal/neon-lineage-receipt","/api/internal/neon-content-reservation","/internal/neon-preview"])
    assert.equal(usesNeonPreviewAuthentication(pathname),true,pathname);
});

test("other and lookalike routes retain Supabase authentication",()=>{
  for(const pathname of ["/","/operator","/api/operator","/api/internal",
    "/api/internal/neon-demand-proposal/","/api/internal/neon-demand-proposal/admin",
    "/api/internal/neon-demand-proposals","/api/internal/neon-demand-proposal-attacker",
    "/api/internal/neon-demand-proposal?product=demand",
    "/internal/neon-preview/other","/api/internal/neon-evidence-other"])
    assert.equal(usesNeonPreviewAuthentication(pathname),false,pathname);
});

