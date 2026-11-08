/** Reset unsaved tenant-scoped campaign input only on an actual workspace change. */
export function shouldResetContentDraftOnWorkspaceSwitch(currentWorkspaceId:string,nextWorkspaceId:string):boolean{
 return currentWorkspaceId!==nextWorkspaceId;
}
