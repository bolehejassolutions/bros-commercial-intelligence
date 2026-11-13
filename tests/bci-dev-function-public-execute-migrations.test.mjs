import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// DEV migration static gate. PostgreSQL provider ACL readback is still required
// after applying migrations; this is NOT a substitute for restricted LOGIN,
// signed JWT, tenant isolation or authenticated end-to-end evidence.
function assertNoImplicitPublicFunctionExecute(sql, label) {
  // Existing BCI migrations use standalone CREATE FUNCTION statements. Strip
  // comment-only lines so commented REVOKEs cannot satisfy the gate.
  const source = sql.replace(/^\s*--[^\n]*$/gm, "");
  const declarations = [...source.matchAll(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b([^\n]*)/gmi)];
  for (let i = 0; i < declarations.length; i++) {
    const declaration = declarations[i];
    const signature = declaration[1].trim();
    const match = /^bci_dev\.([a-z_][a-z0-9_]*)\(\s*\)\s*$/i.exec(signature);
    assert.ok(match, `${label}: unreviewed CREATE FUNCTION signature ${signature}`);
    const fn = match[1];
    const end = i + 1 < declarations.length ? declarations[i + 1].index : source.length;
    const section = source.slice(declaration.index, end);
    const revoke = new RegExp(
      `^\\s*REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+bci_dev\\.${fn}\\(\\s*\\)\\s+FROM\\s+PUBLIC\\s*;\\s*$`,
      "im",
    );
    const revocation = revoke.exec(section);
    assert.ok(revocation, `${label}: ${fn} must explicitly REVOKE ALL EXECUTE FROM PUBLIC`);
    // Require the function body to close before revocation; a REVOKE-like
    // line inside a PL/pgSQL dollar-quoted body is not an ACL operation.
    const beforeRevoke = section.slice(0, revocation.index);
    const body = /\bAS\s+(\$[a-z0-9_]*\$)/i.exec(beforeRevoke);
    assert.ok(body, `${label}: ${fn} function body not recognized`);
    const terminator = body[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(beforeRevoke.slice(body.index + body[0].length),
      new RegExp(`(?:^|\\n)\\s*${terminator}\\s*;`, "m"),
      `${label}: ${fn} body must close before ACL revocation`);
    assert.doesNotMatch(section, /^\s*GRANT\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION\b[^\n]*\bTO\s+PUBLIC\s*;/im,
      `${label}: explicit PUBLIC function grant is forbidden`);
  }
  return declarations.length;
}

test("all versioned BCI DEV CREATE FUNCTION migrations revoke implicit PUBLIC EXECUTE", () => {
  const directory = fileURLToPath(new URL("../neon/migrations/", import.meta.url));
  const files = readdirSync(directory).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
  assert.ok(files.length >= 19, "expected existing DEV migration history");
  let checked = 0;
  for (const file of files) {
    checked += assertNoImplicitPublicFunctionExecute(
      readFileSync(new URL(`../neon/migrations/${file}`, import.meta.url), "utf8"), file);
  }
  assert.ok(checked >= 4, "must inspect the four existing BCI trigger functions");
});

test("migration ACL guard fails closed for missing, commented or pre-body REVOKE", () => {
  const prefix = "CREATE FUNCTION bci_dev.example()\nRETURNS trigger LANGUAGE plpgsql AS $fn$\nBEGIN\nRETURN NEW;\nEND;\n$fn$;\n";
  const revoke = "REVOKE ALL ON FUNCTION bci_dev.example() FROM PUBLIC;\n";
  assert.equal(assertNoImplicitPublicFunctionExecute(prefix + revoke, "positive"), 1);
  assert.throws(() => assertNoImplicitPublicFunctionExecute(prefix, "missing"));
  assert.throws(() => assertNoImplicitPublicFunctionExecute(prefix + "-- " + revoke, "commented"));
  assert.throws(() => assertNoImplicitPublicFunctionExecute(
    prefix.replace("$fn$;\n", revoke + "$fn$;\n"), "inside body"));
  assert.throws(() => assertNoImplicitPublicFunctionExecute(
    prefix.replace("bci_dev.example()", "public.example()") + revoke, "wrong schema"));
});
