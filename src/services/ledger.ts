// Coins and undos as a ledger, so they follow the player's account across
// devices. Every change becomes an entry with a unique id; the server sums the
// entries, keeping each id once, so retries never double-count. Purchases and
// one-time claim keys are unioned. Free of IndexedDB so the rules are tested.
import { MAX_UNDOS, START_UNDOS } from "./undos";
import type { Profile } from "./storage";
export type LedgerEvent = {
  id: string;
  kind: "coins" | "undos";
  delta: number;
  reason: string;
};
export type ServerState = {
  coins: number;
  undos: number;
  purchases: string[];
  claims: string[];
  version: number;
};
/** Coins spent in the shop (older profiles paid 100 per theme). */
export const spentOf = (p: Profile) => p.spent ?? p.purchases.length * 100;
/** Coins earned and spent beyond the 25 per cleared level. */
export const netCoins = (p: Profile) => (p.bonusCoins ?? 0) - spentOf(p);
const reasonKey = (reason: string) =>
  reason.toLowerCase().replace(/[^a-z0-9:_.-]/g, "-").slice(0, 64) || "other";
/** Ledger entries for whatever coins/undos changed between two profiles. */
export function ledgerChanges(
  prev: Profile,
  next: Profile,
  reason: string,
  newId: () => string,
): LedgerEvent[] {
  const out: LedgerEvent[] = [],
    coins = netCoins(next) - netCoins(prev),
    undos = next.undos - prev.undos;
  if (coins) out.push({ id: newId(), kind: "coins", delta: coins, reason: reasonKey(reason) });
  if (undos) out.push({ id: newId(), kind: "undos", delta: undos, reason: reasonKey(reason) });
  return out;
}
/**
 * One opening entry per device for what it held before the ledger existed,
 * with stable ids so posting it twice is harmless.
 */
export function openingEvents(p: Profile, deviceId: string): LedgerEvent[] {
  return ledgerChanges(
    { ...p, bonusCoins: 0, spent: 0, undos: START_UNDOS },
    p,
    "opening",
    (() => {
      let n = 0;
      return () => `init:${deviceId}:${n++}`;
    })(),
  );
}
const union = (a: string[] = [], b: string[] = []) => [...new Set([...a, ...b])];
/**
 * Claim keys to sync, including ones implied by claims made before keys
 * existed (the last gift date, today's claimed missions), so a reward claimed
 * on this device then can't be claimed again on another.
 */
export const claimsOf = (p: Profile) =>
  union(p.claims, [
    ...(p.login?.lastClaim ? [`gift:${p.login.lastClaim}`] : []),
    ...(p.today?.claimed ?? []).map((id) => `mission:${p.today!.day}:${id.toLowerCase()}`),
  ]);
/**
 * The profile as the account sees it: server totals plus this device's
 * entries the server hasn't acknowledged yet. Undos show clamped to 0–20.
 */
export function applyServerState(
  p: Profile,
  server: ServerState,
  pending: LedgerEvent[],
): Profile {
  const sum = (kind: LedgerEvent["kind"]) =>
      pending.filter((e) => e.kind === kind).reduce((n, e) => n + e.delta, 0),
    next: Profile = {
      ...p,
      purchases: union(p.purchases, server.purchases),
      claims: union(claimsOf(p), server.claims),
    };
  return {
    ...next,
    bonusCoins: server.coins + sum("coins") + spentOf(next),
    undos: Math.min(MAX_UNDOS, Math.max(0, START_UNDOS + server.undos + sum("undos"))),
  };
}
