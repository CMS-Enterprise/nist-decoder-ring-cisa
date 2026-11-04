/** The load balancer's 429 is text; the app's own (the export build cap) is JSON. */
export const isRateLimited = (res: Response) =>
  res.status === 429 &&
  !res.headers.get("Content-Type")?.includes("application/json");

/** Raised by `rateLimitedFetch`, so a caller can tell the rate limit from a gateway error. */
export class RateLimited extends Error {
  constructor() {
    super("Too many requests. Try again in a few minutes.");
    this.name = "RateLimited";
  }
}

/**
 * tRPC's fetch: the load balancer's rate limit becomes `RateLimited` here, where tRPC
 * would otherwise fail to parse it, just as it fails on a 502 or 503 page.
 */
export const rateLimitedFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const res = await fetch(input, init);
  if (isRateLimited(res)) throw new RateLimited();
  return res;
};
