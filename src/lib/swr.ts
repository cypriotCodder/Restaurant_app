// Shared SWR wiring for the admin and customer clients.
//
// Every panel used to own a `load()` callback plus a mount effect, which meant
// two panels asking for the same endpoint (VenuePanel and BridgeKeyPanel both
// read /api/admin/venue) issued two requests, and every mutation had to
// remember to call its own reload. Keying on the URL hands both problems to
// SWR: requests in flight for the same key are deduped, and a mutation
// revalidates by key rather than by reaching for a sibling's callback.

/** Throws on a non-2xx so SWR surfaces it as `error` rather than as data. */
export async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Request failed: ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

/**
 * Defaults for the in-venue screens. Staff leave these tabs open on a shared
 * terminal for a whole shift, so refocusing should show current numbers, but
 * the aggressive default retry would hammer the box during a backend blip.
 */
export const swrDefaults = {
  fetcher: jsonFetcher,
  revalidateOnFocus: true,
  errorRetryInterval: 10000,
  errorRetryCount: 3,
  // A 401 here means the session is gone, not that the network flaked. Retrying
  // it just burns requests against an endpoint that will keep saying no.
  shouldRetryOnError: (err: unknown) => {
    const status = (err as { status?: number })?.status;
    return status !== 401 && status !== 403;
  },
} as const;
