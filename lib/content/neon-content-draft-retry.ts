/**
 * Browser-only draft retry identity. An uncertain network response must NOT
 * generate a second campaign when the user retries the same submitted draft.
 * Never persist draft payloads/keys in localStorage, cookies or query strings.
 */
export type ContentDraftAttempt=Readonly<{requestSignature:string;key:string}>;
const KEY=/^[A-Za-z0-9_-]{12,180}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function prepareContentDraftRetry(
 previous:ContentDraftAttempt|null,workspaceId:string,draft:unknown,
 createKey:()=>string
):ContentDraftAttempt {
 if(!UUID.test(workspaceId)||!draft||typeof draft!=='object'||Array.isArray(draft)||
    typeof createKey!=='function')throw new Error('Invalid draft retry state');
 const payload=JSON.stringify(draft);
 if(!payload||payload.length>18000)throw new Error('Invalid draft payload');
 const requestSignature=workspaceId+'\u0000'+payload;
 if(previous?.requestSignature===requestSignature&&KEY.test(previous.key))return previous;
 const key=createKey();
 if(!KEY.test(key))throw new Error('Invalid draft retry key');
 return Object.freeze({requestSignature,key});
}

/** Only the workspace that initiated a save may display its result. */
export function isContentDraftSaveFeedbackCurrent(submittedWorkspace:string,currentWorkspace:string):boolean {
 return UUID.test(submittedWorkspace)&&submittedWorkspace===currentWorkspace;
}

/** Only the exact in-flight attempt may clear the pending retry identity.
 * A later attempt must survive an older POST acknowledgement.
 */
export function shouldClearContentDraftAttempt(
 pending:ContentDraftAttempt|null,completed:ContentDraftAttempt
):boolean {
 return pending===completed;
}
