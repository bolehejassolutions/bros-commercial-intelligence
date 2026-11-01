import "server-only";
import { Pool } from "pg";
import { createNeonAuthPrincipalVerifier } from "./neon-auth-principal.ts";
import { createNeonDevMembershipLookup } from "./neon-dev-membership-rows.ts";
import { createAuthenticatedDemandReceiptCaseLink } from "./neon-demand-case-link.ts";
import { createPgDemandEvidenceAppendTransaction } from "./neon-demand-evidence-append.ts";
import { createDemandCaseLinkHttpHandler } from "./neon-demand-case-link-http.ts";
import { isNeonPreviewEnabled } from "./neon-preview-handler.ts";
import { createPgReadOnlyTransaction,parseNeonDevConnection,NeonPreviewDatabaseDenied } from "./neon-readonly-transaction.ts";
const authBase="https://ep-fancy-queen-b30g0cjn.neonauth.c-4.ap-southeast-1.aws.neon.tech/bros_intelligence_dev/auth";
const receipt="4b1d0b40-371f-4c82-aaa9-d77580f88fac";
const verify=createNeonAuthPrincipalVerifier({issuer:new URL(authBase).origin,
 audience:new URL(authBase).origin,jwksUrl:authBase+"/.well-known/jwks.json",
 approvedOperator:{email:"rasymokh@gmail.com"}});
let memberships:ReturnType<typeof createNeonDevMembershipLookup>|undefined;
let transaction:ReturnType<typeof createPgDemandEvidenceAppendTransaction>|undefined;
function poolFor(value:unknown,role:"bci_dev_membership_reader"|"bci_dev_evidence_writer_restricted"){
 const config=parseNeonDevConnection(value,role);
 const pool=new Pool({...config,max:1,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,
   allowExitOnIdle:true,query_timeout:7000,application_name:"bci-dev-demand-case-link"});
 pool.on("error",()=>{ /* Never log driver errors containing credentials. */ });
 return pool;
}
function lookup(){
 if(!isNeonPreviewEnabled(process.env))throw new NeonPreviewDatabaseDenied();
 memberships??=createNeonDevMembershipLookup(createPgReadOnlyTransaction(
   poolFor(process.env.BCI_NEON_DEV_MEMBERSHIP_DATABASE_URL,"bci_dev_membership_reader")));
 return memberships;
}
function writer(){
 if(!isNeonPreviewEnabled(process.env)||process.env.BCI_NEON_DEV_CASE_LINK_WRITES!=="enabled")
  throw new NeonPreviewDatabaseDenied();
 transaction??=createPgDemandEvidenceAppendTransaction(
  poolFor(process.env.BCI_NEON_DEV_EVIDENCE_WRITER_DATABASE_URL,"bci_dev_evidence_writer_restricted"));
 return transaction;
}
const handle=createDemandCaseLinkHttpHandler({env:()=>process.env,
 execute:async token=>createAuthenticatedDemandReceiptCaseLink({
  authenticate:()=>verify(token),
  membershipsFor:(id,product)=>lookup()(id,product),
  transaction:fn=>writer()(fn),
 })(receipt)});
export const handleDemandCaseLink=(request:Request)=>handle(request);
