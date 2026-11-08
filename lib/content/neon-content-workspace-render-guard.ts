/** Prevent rendering a previous tenant's workspace while React effects catch up
 * after selection changes. Async cleanup alone is not a render-time boundary.
 */
import type {WorkspaceLoadState} from './neon-content-workspace-load-state.ts';

export function isContentWorkspaceDetailCurrent<T extends {workspace:{id:string}}>(
 selectedWorkspaceId:string,
 state:WorkspaceLoadState<T>,
):state is Readonly<{status:'ready';data:T;error:null}>{
 return Boolean(selectedWorkspaceId)&&state.status==='ready'&&
  state.data.workspace.id===selectedWorkspaceId;
}

/** A selection change can render before the effect clearing the prior draft.
 * Never expose or submit the previous tenant's form in that interim render.
 */
export function isContentDraftWorkspaceSettled(
 selectedWorkspaceId:string,
 lastResetWorkspaceId:string,
):boolean{
 return Boolean(selectedWorkspaceId)&&selectedWorkspaceId===lastResetWorkspaceId;
}
