import "server-only";
/** DEV-only restricted existing evidence-writer role; no owner credentials or public writes. */
import {Pool} from "pg";
import {createNeonAuthPrincipalVerifier} from "./neon-auth-principal.ts";
import {createNeonDevMembershipLookup} from "./neon-dev-membership-rows.ts";
import {createPgReadOnlyTransaction,parseNeonDevConnection} from "./neon-readonly-transaction.ts";
import {createPgDemandEvidenceAppendTransaction} from "./neon-demand-evidence-append.ts";
import {createAuthenticatedDemandProposal,createDemandProposalHttpHandler}
 from "./neon-demand-proposal.ts";
const authBase="https://ep-fancy-queen-b30g0cjn.neonauth.c-4.ap-southeast-1.aws.neon.tech/bros_intelligence_dev/auth";
const verify=createNeonAuthPrincipalVerifier({issuer:new URL(authBase).origin,
 audience:new URL(authBase).origin,jwksUrl:authBase+"/.well-known/jwks.json",
 approvedOperator:{email:"rasymokh@gmail.com"}});
function poolFor(value:unknown,role:"bci_dev_membership_reader"|"bci_dev_evidence_writer_restricted"){
 const config=parseNeonDevConnection(value,role);
 const pool=new Pool({...config,max:1,connectionTimeoutMillis:5000,
  idleTimeoutMillis:10000,allowExitOnIdle:true,query_timeout:7000,
  application_name:"bci-dev-demand-proposal"});
 pool.on("error",()=>{/* Never log secrets or driver errors. */});
 return pool;
}
let deps:ReturnType<typeof createDeps>|undefined;
function createDeps(){
 const membershipPool=poolFor(process.env.BCI_NEON_DEV_MEMBERSHIP_DATABASE_URL,
  "bci_dev_membership_reader");
 const writerPool=poolFor(process.env.BCI_NEON_DEV_EVIDENCE_WRITER_DATABASE_URL,
  "bci_dev_evidence_writer_restricted");
 return {membershipsFor:createNeonDevMembershipLookup(createPgReadOnlyTransaction(membershipPool)),
  transaction:createPgDemandEvidenceAppendTransaction(writerPool)};
}
const handler=createDemandProposalHttpHandler({env:()=>process.env,
 execute:async(token,input)=>{
  const principal=await verify(token);
  deps??=createDeps();
  return createAuthenticatedDemandProposal({
   authenticate:async()=>principal,
   membershipsFor:async(id,product)=>{
    const grants=await deps!.membershipsFor(id,product);
    return grants.map(g=>({...g,product:"demand" as const}));
   },
   transaction:fn=>deps!.transaction(fn),
  })(input);
 }});
export const handleDemandProposal=(request:Request)=>handler(request);
