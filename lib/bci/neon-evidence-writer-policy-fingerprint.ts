/** BCI DEV policy drift guard for the dedicated restricted evidence writer.
 * SHA-256 fingerprints are independently read from real Neon DEV pg_policies
 * after migration 0019. Changing an RLS predicate requires an explicit
 * reviewed code+database reconciliation, never an automatic trust upgrade.
 * This is defense-in-depth, NOT proof of direct LOGIN, JWT or live provider data.
 */
type Row = Readonly<{tableName:string;policyName:string;cmd:string;
  permissive:string;roles:string;usingHash:string;checkHash:string}>;
type Query = (sql:string,params:readonly []) => Promise<Readonly<{rows:readonly unknown[]}>>;
const FIELDS = ["tableName","policyName","cmd","permissive","roles","usingHash","checkHash"] as const;
export const RESTRICTED_EVIDENCE_WRITER_POLICIES: readonly Row[] = Object.freeze([
  Object.freeze({tableName:"evidence",policyName:"bci_evidence_writer_demand_insert_v1",cmd:"INSERT",permissive:"PERMISSIVE",roles:"{bci_dev_evidence_writer_restricted}",usingHash:"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",checkHash:"643cbc427f6a7b6a637d73ac5c7ee6f78c7229ec69954e404a187e78bb8fc5af"}),
  Object.freeze({tableName:"evidence",policyName:"bci_evidence_writer_demand_select_v1",cmd:"SELECT",permissive:"PERMISSIVE",roles:"{bci_dev_evidence_writer_restricted}",usingHash:"56860e08f5b2ad81d64301011171b8c377500c7c12e36e86271c3b719b2d9f16",checkHash:"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}),
  Object.freeze({tableName:"tenant_memberships",policyName:"bci_evidence_writer_membership_select_v1",cmd:"SELECT",permissive:"PERMISSIVE",roles:"{bci_dev_evidence_writer_restricted}",usingHash:"85c4eae5511814b315c3e7d07f48d2daae009d71c5da9a54fffe6794b4467ac9",checkHash:"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}),
]);
export const RESTRICTED_EVIDENCE_WRITER_POLICY_SQL = `
SELECT tablename AS "tableName",policyname AS "policyName",cmd,permissive,
       roles::text AS "roles",
       encode(sha256(convert_to(coalesce(qual,''),'UTF8')),'hex') AS "usingHash",
       encode(sha256(convert_to(coalesce(with_check,''),'UTF8')),'hex') AS "checkHash"
FROM pg_policies
WHERE schemaname='bci_dev' AND tablename IN ('evidence','tenant_memberships')
  AND ('bci_dev_evidence_writer_restricted'=ANY(roles) OR 'public'=ANY(roles))
ORDER BY tablename,policyname`;
export class BciEvidenceWriterPolicyDriftDenied extends Error {
  constructor(){super("BCI restricted evidence writer RLS policy drift denied.");this.name="BciEvidenceWriterPolicyDriftDenied";}
}
/** Reject missing/changed policies, unexpected PUBLIC or additive permissive policies.
 * Counting expected names alone is insufficient: a changed USING/WITH CHECK
 * can silently widen authorization, especially while the evidence table is empty.
 */
export async function assertRestrictedEvidenceWriterPolicies(query:Query):Promise<void>{
  try {
    const result=await query(RESTRICTED_EVIDENCE_WRITER_POLICY_SQL,[]);
    if(!result||!Array.isArray(result.rows)||
       result.rows.length!==RESTRICTED_EVIDENCE_WRITER_POLICIES.length)throw Error();
    for(let i=0;i<result.rows.length;i++){
      const row=result.rows[i], expected=RESTRICTED_EVIDENCE_WRITER_POLICIES[i];
      if(!row||typeof row!=="object"||Array.isArray(row)||
         Reflect.ownKeys(row).length!==FIELDS.length||
         !FIELDS.every(field=>Object.getOwnPropertyDescriptor(row,field)?.value===expected[field]))throw Error();
    }
  } catch {throw new BciEvidenceWriterPolicyDriftDenied();}
}
