/** Reset unsaved tenant-scoped campaign input only on an actual workspace change. */
export function shouldResetContentDraftOnWorkspaceSwitch(currentWorkspaceId:string,nextWorkspaceId:string):boolean{
 return currentWorkspaceId!==nextWorkspaceId;
}

/** Keep the selected workspace only while its membership remains in the fresh index. */
export function reconcileContentWorkspaceSelection(
 currentWorkspaceId:string,
 availableWorkspaceIds:readonly string[],
):string{
 return availableWorkspaceIds.includes(currentWorkspaceId)
  ?currentWorkspaceId
  :(availableWorkspaceIds[0]??'');
}
