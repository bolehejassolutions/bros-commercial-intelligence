/** Request-local composition of authenticated CONTENT review and the existing
 * restricted V3 issuer. Callers submit a proof ID and signed receipts only;
 * original bytes and source context always come from a server-owned loader.
 */
export type ContentIssuanceInput = Readonly<{proofEnvelopeId: string; receipt: unknown}>;
export type ContentIssuanceScope = Readonly<{principalId: string; tenantId: string; product: "content"}>;
export type ContentIssuanceResult = Readonly<{status: "BCI_CONTENT_V3_APPROVAL_COMMITTED";
  approvalId: string; committedReadback: true; providerSent: false; executionAllowed: false}>;
export type ContentIssuanceSource = Readonly<{
  envelope: Readonly<Record<string, unknown>>;
  mediaBytes: readonly Uint8Array[];
  verifyCompleteScriptSourceContext: (...args: unknown[]) => Promise<boolean>;
}>;
type Dependencies = Readonly<{
  authenticate: (token: string) => Promise<Readonly<{userId: string}>>;
  membershipsFor: (id: string, product: "content") => Promise<readonly Readonly<{
    principalId: string; tenantId: string; product: "content" | "demand"; active: boolean}>[]>;
  loadSource: (scope: ContentIssuanceScope, proofId: string) => Promise<ContentIssuanceSource>;
  createIssuer: (scope: ContentIssuanceScope, source: ContentIssuanceSource, token: string) =>
    Readonly<{issueScript: (request: unknown) => Promise<ContentIssuanceResult>}>;
}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROOF=/^content-instance-script-proof-[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const deny=():never=>{throw Error("BCI_CONTENT_ISSUANCE_DENIED");};
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==="object"&&!Array.isArray(x);

export function createNeonContentIssuanceService(deps: Dependencies) {
  async function scopeFor(token:string):Promise<ContentIssuanceScope> {
    const principal=await deps.authenticate(token);
    if(!UUID.test(principal.userId))return deny();
    const rows=await deps.membershipsFor(principal.userId,"content");
    if(rows.length!==1||rows[0].principalId!==principal.userId||rows[0].product!=="content"||
       rows[0].active!==true||!UUID.test(rows[0].tenantId))return deny();
    return Object.freeze({principalId:principal.userId,tenantId:rows[0].tenantId,product:"content"});
  }
  return async(token:string,input:ContentIssuanceInput):Promise<ContentIssuanceResult>=>{
    try {
      if(!object(input)||Reflect.ownKeys(input).length!==2||
         !Object.hasOwn(input,"proofEnvelopeId")||!Object.hasOwn(input,"receipt")||
         typeof input.proofEnvelopeId!=="string"||!PROOF.test(input.proofEnvelopeId))return deny();
      const pinned=structuredClone(input);
      const scope=await scopeFor(token);
      const source=await deps.loadSource(scope,pinned.proofEnvelopeId);
      if(source.envelope.tenantId!==scope.tenantId||source.envelope.product!=="content"||
         source.envelope.schemaVersion!==3||source.envelope.proofEnvelopeId!==pinned.proofEnvelopeId||
         !Array.isArray(source.mediaBytes)||source.mediaBytes.length<2||source.mediaBytes.length>6||
         source.mediaBytes.some(x=>!(x instanceof Uint8Array))||
         typeof source.verifyCompleteScriptSourceContext!=="function")return deny();
      if(!object(pinned.receipt)||Reflect.ownKeys(pinned.receipt).length!==3)return deny();
      for(const name of ["editorial","script","dispatch"]) {
        const signed=pinned.receipt[name];
        if(!object(signed)||!object(signed.payload)||
           signed.payload.reviewerSubject!==scope.principalId||
           signed.payload.tenantId!==scope.tenantId||signed.payload.product!=="content")return deny();
      }
      const issuer=deps.createIssuer(scope,source,token);
      const result=await issuer.issueScript({envelope:structuredClone(source.envelope),
        mediaBytes:source.mediaBytes.map(x=>Buffer.from(x)),receipt:pinned.receipt});
      // A successful storage callback is insufficient if the session or product
      // membership was revoked while source verification/commit was running.
      const current=await scopeFor(token);
      if(current.principalId!==scope.principalId||current.tenantId!==scope.tenantId||
         !object(result)||Reflect.ownKeys(result).length!==5||
         result.status!=="BCI_CONTENT_V3_APPROVAL_COMMITTED"||!ID.test(result.approvalId)||
         result.committedReadback!==true||result.providerSent!==false||
         result.executionAllowed!==false)return deny();
      return Object.freeze({...result});
    } catch {return deny();}
  };
}
