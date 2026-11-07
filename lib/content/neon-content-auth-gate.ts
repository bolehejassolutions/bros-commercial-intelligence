/** BROS CONTENT's isolated Preview-only Neon Auth boundary.
 * BCI Supabase pages and production routes are never selected here.
 */
export type ContentAuthEnvironment = Readonly<{VERCEL_ENV?:string;CONTENT_DEV_API_ENABLED?:string}>;
export function isContentDevPreviewEnabled(env:ContentAuthEnvironment):boolean {
 return env.VERCEL_ENV==='preview' && env.CONTENT_DEV_API_ENABLED==='true';
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
