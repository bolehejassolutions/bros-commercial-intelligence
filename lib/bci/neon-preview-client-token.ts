type TokenClient = Readonly<{
  token: (options: { fetchOptions: { headers: Record<string, string> } }) =>
    Promise<Readonly<{ data: unknown; error: unknown }>>;
}>;

/**
 * Neon Auth 0.7.0-beta aliases /token and /get-session in its response cache.
 * Bypass that cache through the SDK's supported force-fetch hook so a cached
 * session object cannot be mistaken for the token endpoint's { token } result.
 * The SDK removes this control header before making the provider request.
 */
export class NeonPreviewTokenUnavailable extends Error {
  readonly category: "provider" | "response" | "exception";
  constructor(category: "provider" | "response" | "exception") {
    super("Neon Preview token unavailable.");
    this.category = category;
  }
}

export async function requestNeonPreviewToken(client: TokenClient): Promise<string> {
  try {
    const { data, error } = await client.token({ fetchOptions: { headers: { "X-Force-Fetch": "true" } } });
    if (error) throw new NeonPreviewTokenUnavailable("provider");
    if (data === null || typeof data !== "object" || !("token" in data) ||
        typeof data.token !== "string" || !data.token || data.token.length > 16000) {
      throw new NeonPreviewTokenUnavailable("response");
    }
    return data.token;
  } catch (error) {
    if (error instanceof NeonPreviewTokenUnavailable) throw error;
    throw new NeonPreviewTokenUnavailable("exception");
  }
}

type SessionClient = Readonly<{
  getSession: (options: { fetchOptions: {
    headers: Record<string, string>; credentials: "include"; cache: "no-store"; signal: AbortSignal;
  } }) => Promise<Readonly<{ data: unknown; error: unknown }>>;
}>;

export class NeonPreviewSessionUnavailable extends Error {
  constructor() { super("Neon Preview session could not be checked."); }
}

/** Revalidate with the provider; a cached UI session is not current authority. */
export async function requestNeonPreviewSession(client: SessionClient, approvedEmail: string): Promise<boolean> {
  try {
    const { data, error } = await client.getSession({ fetchOptions: {
      headers: { "X-Force-Fetch": "true" }, credentials: "include", cache: "no-store",
      signal: AbortSignal.timeout(15000),
    } });
    if (error) throw new NeonPreviewSessionUnavailable();
    if (data === null) return false;
    if (typeof data !== "object" || Array.isArray(data) || !("session" in data) || !("user" in data))
      throw new NeonPreviewSessionUnavailable();
    if (data.session === null || data.user === null) return false;
    if (typeof data.session !== "object" || typeof data.user !== "object" ||
        !("expiresAt" in data.session) || !("email" in data.user) || !("emailVerified" in data.user))
      throw new NeonPreviewSessionUnavailable();
    const expiry = data.session.expiresAt;
    const expiresAt = expiry instanceof Date ? expiry.getTime()
      : typeof expiry === "string" ? Date.parse(expiry) : NaN;
    if (!Number.isFinite(expiresAt)) throw new NeonPreviewSessionUnavailable();
    return expiresAt > Date.now() && data.user.email === approvedEmail && data.user.emailVerified === true;
  } catch {
    // Never surface provider bodies, cookie values, identifiers or SDK exceptions.
    throw new NeonPreviewSessionUnavailable();
  }
}
