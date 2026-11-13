import "server-only";
import {createPublicKey} from "node:crypto";
import {Pool} from "pg";
import {createBciContentTrustedIssuer} from "./content-trusted-issuer.mjs";
import {createNeonAuthPrincipalVerifier} from "./neon-auth-principal.ts";
import {createNeonDevMembershipLookup} from "./neon-dev-membership-rows.ts";
import {createPgReadOnlyTransaction,parseNeonDevConnection} from "./neon-readonly-transaction.ts";
import {createPgContentReservationTransaction,createPgContentReservationReadTransaction} from "./neon-content-dispatch-atomic.ts";
import {isNeonPreviewEnabled} from "./neon-preview-handler.ts";
import {createNeonContentIssuanceService,type ContentIssuanceScope,type ContentIssuanceSource} from "./neon-content-issuance-service.ts";
const authBase="https://ep-fancy-queen-b30g0cjn.neonauth.c-4.ap-southeast-1.aws.neon.tech/bros_intelligence_dev/auth";
const verify=createNeonAuthPrincipalVerifier({issuer:new URL(authBase).origin,
  audience:new URL(authBase).origin,jwksUrl:authBase+"/.well-known/jwks.json",
  approvedOperator:{email:"rasymokh@gmail.com"}});
const deny=():never=>{throw Error("BCI_CONTENT_ISSUANCE_DENIED");};
function makePool(config:ReturnType<typeof parseNeonDevConnection>) {
  const pool=new Pool({...config,max:1,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,
    allowExitOnIdle:true,query_timeout:7000,application_name:"bci-content-v3-issuer-dev"});
  pool.on("error",()=>{/* Never log credentials or provider exception bodies. */});
  return pool;
}
/** The portfolio composition injects CONTENT's authoritative source loader.
 * It cannot be supplied through HTTP. No role, reviewer or key is provisioned
 * by this adapter; missing restricted setup denies before an approval append.
 */
export function createNeonDevContentIssuanceRuntime(loadSource:(scope:ContentIssuanceScope,
  proofId:string)=>Promise<ContentIssuanceSource>) {
  let readers:ReturnType<typeof createNeonDevMembershipLookup>|undefined;
  let issuerPool:Pool|undefined;
  const membershipsFor=async(id:string,product:"content")=>{
    readers??=createNeonDevMembershipLookup(createPgReadOnlyTransaction(makePool(
      parseNeonDevConnection(process.env.BCI_NEON_DEV_MEMBERSHIP_DATABASE_URL,"bci_dev_membership_reader"))));
    return readers(id,product);
  };
  const service=createNeonContentIssuanceService({
    authenticate:async token=>{
      if(!isNeonPreviewEnabled(process.env)||process.env.BCI_NEON_DEV_CONTENT_APPROVALS!=="enabled")return deny();
      return verify(token);
    },membershipsFor,loadSource,
    createIssuer:(scope,source,token)=>{
      const raw=process.env.BCI_NEON_DEV_CONTENT_REVIEW_PUBLIC_KEYS;
      if(!raw||raw.length>32768)return deny();
      const publicKeys=JSON.parse(raw);
      if(!publicKeys||typeof publicKeys!=="object"||Array.isArray(publicKeys)||
         Object.keys(publicKeys).length<1||Object.keys(publicKeys).length>8)return deny();
      const trustedPublicKeys=new Map(Object.entries(publicKeys).map(([keyId,pem])=>{
        if(!/^[A-Za-z0-9][A-Za-z0-9_.|:-]{1,63}$/.test(keyId)||typeof pem!=="string")return deny();
        const key=createPublicKey(pem);
        if(key.asymmetricKeyType!=="ed25519")return deny();
        return [keyId,key] as const;
      }));
      issuerPool??=makePool(parseNeonDevConnection(process.env.BCI_NEON_DEV_CONTENT_ISSUER_DATABASE_URL,
        "bci_dev_content_approval_issuer"));
      const writeTransaction=createPgContentReservationTransaction(issuerPool);
      const readTransaction=createPgContentReservationReadTransaction(issuerPool);
      return createBciContentTrustedIssuer({trustedPublicKeys,
        authenticateReviewer:async()=>{const p=await verify(token);return {userId:p.userId,authenticated:true};},
        readReviewerAuthority:async(id,product)=>{
          if(id!==scope.principalId||product!=="content")return deny();
          return readTransaction(async query=>{
            const identity=await query(`SELECT current_user AS role,session_user AS session_role,
              rolcanlogin,rolbypassrls,rolsuper,rolinherit,rolcreaterole,rolcreatedb,
              (SELECT count(*)::int FROM pg_auth_members WHERE member=pg_roles.oid) AS parents,
              current_database() AS db FROM pg_roles WHERE rolname=current_user`,[]);
            const p=identity.rows[0] as Record<string,unknown>|undefined;
            if(identity.rows.length!==1||p?.role!=="bci_dev_content_approval_issuer"||
               p.session_role!==p.role||p.rolcanlogin!==true||p.rolbypassrls!==false||
               p.rolsuper!==false||p.rolinherit!==false||p.rolcreaterole!==false||
               p.rolcreatedb!==false||p.parents!==0||p.db!=="bros_intelligence_dev")return deny();
            await query("SELECT set_config('bci.principal_id',$1,true),set_config('bci.tenant_id',$2,true),set_config('bci.product','content',true)",[id,scope.tenantId]);
            const auth=await query(`SELECT
              (SELECT count(*)::int FROM bci_dev.tenant_memberships WHERE principal_id=$1::uuid
               AND tenant_id=$2::uuid AND product='content' AND active IS TRUE AND revoked_at IS NULL) AS members,
              (SELECT count(*)::int FROM bci_dev.content_reviewer_authorizations WHERE principal_id=$1::uuid
               AND tenant_id=$2::uuid AND product='content' AND revoked_at IS NULL
               AND authorized_at<=clock_timestamp()) AS reviewers`,[id,scope.tenantId]);
            const a=auth.rows[0] as Record<string,unknown>|undefined;
            if(auth.rows.length!==1||a?.members!==1||a.reviewers!==1)return deny();
            return {principalId:id,tenantId:scope.tenantId,product:"content",
              memberActive:true,reviewerAuthorized:true,revokedAt:null};
          });
        },
        // The legacy image-only path is deliberately unavailable here.
        recomputeOriginalMedia:async()=>deny(),verifyContentSourceContext:async()=>deny(),
        verifyCompleteScriptSourceContext:source.verifyCompleteScriptSourceContext,
        writeTransaction,readTransaction,now:Date.now});
    }
  });
  return service;
}
