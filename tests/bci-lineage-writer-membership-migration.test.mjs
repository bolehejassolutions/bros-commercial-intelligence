import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../neon/migrations/0020_dev_lineage_writer_membership_bound_rls.sql",import.meta.url),"utf8");
const executable=src.replace(/^\s*--[^\n]*$/gm,"");
test("DEV lineage migration grants only scoped membership columns, never mutation or production",()=>{
 assert.match(executable,/GRANT SELECT \(principal_id,tenant_id,product,active,revoked_at\)/);
 assert.doesNotMatch(executable,/GRANT\s+SELECT\s+ON\s+bci_dev\.tenant_memberships/i);
 assert.doesNotMatch(executable,/GRANT\s+(?:UPDATE|DELETE|ALL)\b/i);
 assert.doesNotMatch(executable,/\b(?:CREATE|ALTER)\s+ROLE\b/i);
 assert.doesNotMatch(executable,/\b(?:INSERT INTO|UPDATE bci_dev|DELETE FROM bci_dev)\b/i);
});
test("four writer lineage policies are tenant/product/principal AND active membership bound",()=>{
 const lines=[["nodes","select","USING"],["nodes","insert","WITH CHECK"],
              ["edges","select","USING"],["edges","insert","WITH CHECK"]];
 for(const [table,verb,clause] of lines){
  const start=`ALTER POLICY dev_writer_lineage_${table}_${verb}`;
  const block=src.split(start)[1]?.split(";")[0];
  assert.ok(block,"missing "+start);
  for(const token of [clause,"tenant_id","product","EXISTS","tenant_memberships",
    "bci.principal_id","active IS TRUE","revoked_at IS NULL"]){
    assert.ok(block.includes(token),start+" missing "+token);
  }
 }
 const member=src.split("CREATE POLICY dev_writer_lineage_membership_select")[1]?.split(";")[0];
 assert.ok(member);
 for(const token of ["bci.principal_id","bci.tenant_id","bci.product","active IS TRUE","revoked_at IS NULL"]){
  assert.ok(member.includes(token));
 }
 assert.equal((executable.match(/ALTER POLICY dev_writer_lineage_/g)||[]).length,4);
 assert.doesNotMatch(executable,/ALTER POLICY dev_runtime_/);
});
