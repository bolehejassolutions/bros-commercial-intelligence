import { prepareContentDemandLink } from "./content-demand-lineage.mjs";

type Scope = Readonly<{ tenantId: string; principalId: string }>;
type Deps = Readonly<{
  enabled: () => boolean;
  authorize: (jwt: string) => Promise<Scope>;
}>;
const headers = {
  "Cache-Control":"private, no-store, max-age=0",
  "Vary":"Authorization",
  "X-Content-Type-Options":"nosniff",
};
const respond=(status:number,body:unknown,extra:Record<string,string>={})=>
  Response.json(body,{status,headers:{...headers,...extra}});
const deny=(status:number)=>respond(status,{error:"BROS DEMAND private attribution-link request denied."});
const fields=["contentPlanId","creativeSha256","channel","campaignKey","landingUrl"] as const;
const exact=(x:unknown):x is Record<typeof fields[number],unknown>=>{
  if(!x||typeof x!=="object"||Array.isArray(x))return false;
  const obj=x as Record<string,unknown>;
  return Object.keys(obj).length===fields.length&&fields.every(k=>Object.hasOwn(obj,k));
};

/** Authenticated Preview-only, candidate-link generation, no provider mutation. */
export function createContentDemandLinkHttpHandler(deps:Deps) {
  return async (request:Request):Promise<Response>=>{
    if(!deps.enabled())return deny(404);
    if(request.method!=="POST")
      return respond(405,{error:"Method not allowed."},{Allow:"POST"});
    let url:URL;
    try{url=new URL(request.url);}catch{return deny(400);}
    if(url.pathname!=="/api/internal/portfolio-lineage"||url.search||
       request.headers.get("origin")!==url.origin||
       request.headers.get("content-type")?.split(";")[0]?.trim()!=="application/json"||
       request.headers.has("transfer-encoding")||
       Number(request.headers.get("content-length")||0)>4096)return deny(400);
    const authorization=request.headers.get("authorization");
    if(!authorization||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization)||
       authorization.length>16007)return deny(401);
    try{
      const scope=await deps.authorize(authorization.slice(7));
      if(!scope||!scope.tenantId||!scope.principalId)return deny(403);
      const raw=await request.text();
      if(raw.length>4096||!raw)return deny(400);
      const body:unknown=JSON.parse(raw);
      if(!exact(body))return deny(400);
      const proposal=prepareContentDemandLink({
        schemaVersion:1,tenantId:scope.tenantId,
        contentPlanId:body.contentPlanId as string,
        creativeSha256:body.creativeSha256 as string,
        channel:body.channel as "facebook"|"instagram"|"tiktok",
        campaignKey:body.campaignKey as string,
        landingUrl:body.landingUrl as string,
      });
      // Never return identity, JWT, private provider data or a credential.
      return respond(200,{
        source:"BROS_PORTFOLIO_CONTENT_DEMAND_LINEAGE_V1",
        lineageKey:proposal.lineageKey,tracking:proposal.tracking,
        trackedLandingUrl:proposal.trackedLandingUrl,status:proposal.status,
        contentApprovalVerified:false,providerSentVerified:false,
        landingReceiptVerified:false,paidOrderVerified:false,
        attributedRevenueMYR:null,executionAllowed:false,
      });
    }catch{
      return deny(403);
    }
  };
}
