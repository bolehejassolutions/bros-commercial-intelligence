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
  constructor(public readonly category: "provider" | "response" | "exception") {
    super("Neon Preview token unavailable.");
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
