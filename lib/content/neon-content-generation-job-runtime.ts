/** DEV-only composition of authenticated CONTENT job flow with restricted PostgreSQL.
 * No HTTP route installation, scheduler, provider, grants, or production activation.
 * The trusted host MUST supply authenticated session verification, campaign authorization,
 * and three independent least-privilege connection pools.
 */
import {createContentDevJobFlow,createContentDevJobHttpHandler} from './neon-content-generation-job-flow.ts';
import {createRestrictedContentJobDb} from './neon-content-generation-job-restricted-db.ts';
import type {JobRow} from './neon-content-generation-job-lifecycle.ts';

type Principal=Readonly<{userId:string;authenticated:true}>;
type Scope=Readonly<{tenantId:string}>;
type Client={query:(sql:string,params?:readonly unknown[])=>Promise<{rows:any[];rowCount?:number|null}>;release:()=>void};
type Pool={connect:()=>Promise<Client>};
export type RestrictedContentJobRuntimeInput={
 verify:(request:Request)=>Promise<Principal|null>;
 authorize:(principal:Principal,workspaceId:string,campaignId:string)=>Promise<Scope|null>;
 pools:Readonly<{submit:Pool;history:Pool;worker:Pool}>;
 execute:(job:Readonly<JobRow>)=>Promise<void>;
};
export function createRestrictedContentJobRuntime(input:RestrictedContentJobRuntimeInput){
 if(!input||typeof input.verify!=='function'||typeof input.authorize!=='function'||
 typeof input.execute!=='function'||!input.pools||
 !input.pools.submit||!input.pools.history||!input.pools.worker||
 new Set([input.pools.submit,input.pools.history,input.pools.worker]).size!==3)
 throw new Error('Invalid restricted CONTENT runtime dependencies');
 const db={
  submitDb:async(principal:Principal,tenantId:string)=>createRestrictedContentJobDb({
   pool:input.pools.submit,purpose:'submit',tenantId,principal}),
  historyDb:async(principal:Principal,tenantId:string)=>createRestrictedContentJobDb({
   pool:input.pools.history,purpose:'history',tenantId,principal}),
  workerDb:async(tenantId:string)=>createRestrictedContentJobDb({
   pool:input.pools.worker,purpose:'worker',tenantId})
 };
 const deps={verify:input.verify,authorize:input.authorize,execute:input.execute,...db};
 return {http:createContentDevJobHttpHandler(deps),flow:createContentDevJobFlow(deps)};
}
