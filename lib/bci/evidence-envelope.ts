/** Evidence ingestion contract shared by CONTENT and DEMAND.
 * Only trusted adapters can attach verification; this parser never promotes it.
 * No provider credentials, DB writes, publication, ad spending or HTTP routes.
 */
export type IngestProduct = "content" | "demand";
export type EvidenceEnvelope = Readonly<{
  tenantId: string;
  product: IngestProduct;
  provider: string;
  providerRecordKey: string;
  observedAt: string;
  environment: "test" | "live" | "unknown";
  provenance: "synthetic" | "provider_reported" | "provider_verified";
  metrics: Readonly<Record<string, number | null>>;
}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const deny=():never=>{throw new Error("Invalid evidence envelope");};
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
export function normalizeEvidenceEnvelope(input:unknown):EvidenceEnvelope {
  if(!object(input)||typeof input.tenantId!=="string"||!UUID.test(input.tenantId)||
     (input.product!=="content"&&input.product!=="demand")||
     typeof input.provider!=="string"||!input.provider.trim()||input.provider.length>80||
     typeof input.providerRecordKey!=="string"||!input.providerRecordKey.trim()||input.providerRecordKey.length>256||
     typeof input.observedAt!=="string"||!UTC.test(input.observedAt)||
     !Number.isFinite(Date.parse(input.observedAt))||
     !["test","live","unknown"].includes(String(input.environment))||
     !["synthetic","provider_reported","provider_verified"].includes(String(input.provenance))||
     !object(input.metrics)||Object.keys(input.metrics).length>100) deny();
  if (!object(input)) deny();
  // A synthetic fixture can never be labelled as live provider evidence.
  if(input.provenance==="synthetic"&&input.environment==="live") deny();
  const metrics:Record<string,number|null>={};
  for(const [key,value] of Object.entries(input.metrics)){
    if(!/^[a-z][a-z0-9_]{0,63}$/.test(key)||
       (value!==null&&(typeof value!=="number"||!Number.isFinite(value)))) deny();
    metrics[key]=value as number|null;
  }
  return Object.freeze({
    tenantId:input.tenantId as string,product:input.product as IngestProduct,
    provider:input.provider as string,providerRecordKey:input.providerRecordKey as string,
    observedAt:input.observedAt as string,environment:input.environment as EvidenceEnvelope["environment"],
    provenance:input.provenance as EvidenceEnvelope["provenance"],metrics:Object.freeze(metrics),
  });
}
