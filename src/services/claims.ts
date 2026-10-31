// One-time claim keys (gift:<date>, mission:<date>:<id>, undomilestone:<n>).
// They sync as a set, so a reward claimed on one device can't be claimed again
// on another.
import type { Profile } from "./storage";
export const hasClaim = (p: Profile, key: string) => !!p.claims?.includes(key);
export const withClaim = (p: Profile, key: string): Profile =>
  hasClaim(p, key) ? p : { ...p, claims: [...(p.claims ?? []), key] };
