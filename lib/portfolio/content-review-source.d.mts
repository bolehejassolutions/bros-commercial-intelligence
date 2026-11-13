import type {ContentIssuanceScope,ContentIssuanceSource} from '../bci/neon-content-issuance-service.ts';
export function createContentReviewSourceStore(root?:string):Readonly<{
  list:(scope:ContentIssuanceScope)=>Promise<{proofEnvelopeId:string;title:string}[]>;
  load:(scope:ContentIssuanceScope,id:string)=>Promise<ContentIssuanceSource&{
    handoff:Record<string,unknown>;title:string}>;
}>;
