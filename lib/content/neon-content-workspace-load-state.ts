/** Distinguish a successfully loaded empty workspace from failed/incomplete reads.
 * UI must never claim there are zero campaigns when the backend is unavailable.
 */
export type WorkspaceLoadState<T> =
 | Readonly<{status:'idle'|'loading';data:null;error:null}>
 | Readonly<{status:'ready';data:T;error:null}>
 | Readonly<{status:'error';data:null;error:string}>;

export const initialWorkspaceLoad=<T>():WorkspaceLoadState<T>=>({status:'idle',data:null,error:null});
export const loadingWorkspace=<T>():WorkspaceLoadState<T>=>({status:'loading',data:null,error:null});
export const loadedWorkspace=<T>(data:T):WorkspaceLoadState<T>=>({status:'ready',data,error:null});
export const failedWorkspace=<T>(error:string):WorkspaceLoadState<T>=>({
 status:'error',data:null,error:error.trim()||'Workspace unavailable'
});
