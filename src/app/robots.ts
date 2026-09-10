import type { MetadataRoute } from "next";

// Nothing here benefits from being indexed: the staff surfaces are private and
// the customer pages are reachable only with a freshly-scanned table session,
// so a crawled /t/<code> would only ever serve the re-scan wall.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
