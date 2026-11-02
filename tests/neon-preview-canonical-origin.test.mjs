import test from "node:test";
import assert from "node:assert/strict";
import { 
  BCI_NEON_PREVIEW_CANONICAL_ORIGIN,
  BCI_NEON_PREVIEW_CANONICAL_SIGNIN,
  neonPreviewCanonicalRedirect,
} from "../lib/bci/neon-preview-canonical-origin.ts";

const alias="bros-commercial-intelligence-git-4a0d3f-bolehejassolutions-8492.vercel.app";
test("existing Neon trusted branch alias is the sole sign-in origin",()=>{
  assert.equal(BCI_NEON_PREVIEW_CANONICAL_ORIGIN,`https://${alias}`);
  assert.equal(BCI_NEON_PREVIEW_CANONICAL_SIGNIN,
    `https://${alias}/internal/neon-preview`);
  assert.equal(neonPreviewCanonicalRedirect(alias),null);
});

test("rotating Preview hosts redirect to a fixed trusted origin, never a supplied destination",()=>{
  const hosts=[
    "bros-commercial-intelligence-i2hhm49n6-bolehejassolutions-8492.vercel.app",
    "bros-commercial-intelligence-g3oz6f2i2-bolehejassolutions-8492.vercel.app",
    "bros-commercial-intelligence.vercel.app",
    "evil.example", "localhost:3000", "",
    `${alias}.evil.example`, `evil.example@${alias}`,
    `${alias}:443`, `${alias.toUpperCase()}`, null, undefined, 1,
  ];
  for(const host of hosts){
    assert.equal(neonPreviewCanonicalRedirect(host),BCI_NEON_PREVIEW_CANONICAL_SIGNIN);
  }
});

test("redirect cannot be converted into an open redirect through header/query injection",()=>{
  for(const host of [
    `${alias}/?next=https://attacker.test`,
    `https://${alias}`,
    `${alias}\nLocation: https://attacker.test`,
    {host:alias}, ["evil.example"], 
  ]) {
    assert.equal(neonPreviewCanonicalRedirect(host),BCI_NEON_PREVIEW_CANONICAL_SIGNIN);
  }
});
