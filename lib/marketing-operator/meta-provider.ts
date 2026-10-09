/** Never expose transport/JSON errors: these can include credential-bearing URLs or response text. */
export async function metaProviderRequest(url: string, init: RequestInit, transport: typeof fetch = fetch) {
  try {
    return await transport(url, { ...init, redirect: "error" });
  } catch {
    throw new Error("Meta provider request failed. Verify provider state before retry.");
  }
}
export async function metaProviderJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error("Meta provider returned an invalid response. Verify provider state before retry.");
  }
}
export function safeMetaProviderCode(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1000000 ? value : fallback;
}
