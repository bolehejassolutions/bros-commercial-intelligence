/** BROS CONTENT's isolated Preview-only Neon Auth boundary.
 * BCI Supabase pages and production routes are never selected here.
 */
export function isContentDevPreviewEnabled(vercelEnv:string|undefined,enabled:string|undefined):boolean {
 return vercelEnv==='preview' && enabled==='true';
}
export function isContentDevAuthApiPath(pathname:string):boolean {
 return /^\/api\/auth\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/i.test(pathname);
}
export function isContentDevScreenPath(pathname:string):boolean {
 return pathname==='/content/dev'||pathname==='/content/dev/sign-in';
}
export function requiresContentNeonMiddleware(pathname:string):boolean {
 return isContentDevAuthApiPath(pathname)||isContentDevScreenPath(pathname);
}
