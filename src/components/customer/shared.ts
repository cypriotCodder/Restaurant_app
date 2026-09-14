import type { Locale } from "@/lib/i18n";

export const name = (o: { nameTr: string; nameEn: string }, l: Locale) => (l === "en" ? o.nameEn : o.nameTr);

export const statusTagClass: Record<string, string> = {
  received: "tag-accent",
  accepted: "tag-accent",
  preparing: "tag-accent",
  ready: "tag-outline",
  served: "tag-neutral",
  rejected: "tag-neutral",
  cancelled: "tag-neutral",
};

// A v4 uuid when the platform offers one, a good-enough random id otherwise.
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
