// Star chests and power-up inventory. Only newly earned stars count (a first
// clear, or more stars than before on a level); every 15 fill a chest.
// Chests pay from a fixed table in order: no randomness, nothing to buy.
// Free of IndexedDB so the rules are unit tested.
import type { Profile } from "./storage";
export type PowerUp = "slot" | "magnet" | "freeze";
export const POWER_UPS: { id: PowerUp; name: string; help: string }[] = [
  { id: "magnet", name: "Magnet", help: "Pulls a tray tile's partner in, or clears a free pair" },
  { id: "slot", name: "Extra slot", help: "5 tray slots for this board" },
  { id: "freeze", name: "Freeze", help: "Stops bonus timers for 10 seconds" },
];
export const STARS_PER_CHEST = 15;
export type ChestReward = { coins: number } & Partial<Record<PowerUp, number>>;
/** Opened in this order, then repeating. */
export const CHEST_REWARDS: ChestReward[] = [
  { coins: 50 },
  { coins: 0, magnet: 1 },
  { coins: 0, slot: 1 },
  { coins: 75 },
  { coins: 0, freeze: 1 },
  { coins: 0, magnet: 1, slot: 1 },
];
export const powerUps = (p: Profile): Record<PowerUp, number> => ({
  slot: p.powerUps?.slot ?? 0,
  magnet: p.powerUps?.magnet ?? 0,
  freeze: p.powerUps?.freeze ?? 0,
});
/** New stars from a clear: a first clear or an improvement only. */
export const starsGained = (before: number | undefined, after: number) =>
  Math.max(0, after - (before ?? 0));
/** Adds stars toward chests; every 15 fills one. */
export function addStars(p: Profile, stars: number): Profile {
  if (stars <= 0) return p;
  const total = (p.chestStars ?? 0) + stars;
  return {
    ...p,
    chestStars: total % STARS_PER_CHEST,
    chests: (p.chests ?? 0) + Math.floor(total / STARS_PER_CHEST),
  };
}
/** Opens one chest, if there is one, paying the next reward in the table. */
export function openChest(p: Profile): { profile: Profile; reward: ChestReward } | null {
  if (!p.chests) return null;
  const opened = p.chestsOpened ?? 0,
    reward = CHEST_REWARDS[opened % CHEST_REWARDS.length],
    have = powerUps(p);
  return {
    reward,
    profile: {
      ...p,
      chests: p.chests - 1,
      chestsOpened: opened + 1,
      bonusCoins: (p.bonusCoins ?? 0) + reward.coins,
      powerUps: {
        slot: have.slot + (reward.slot ?? 0),
        magnet: have.magnet + (reward.magnet ?? 0),
        freeze: have.freeze + (reward.freeze ?? 0),
      },
    },
  };
}
/** Spends one power-up; null when none are left. */
export function spendPowerUp(p: Profile, kind: PowerUp): Profile | null {
  const have = powerUps(p);
  if (have[kind] <= 0) return null;
  return { ...p, powerUps: { ...have, [kind]: have[kind] - 1 } };
}
export const rewardLabel = (r: ChestReward) =>
  [
    r.coins && `${r.coins} coins`,
    ...POWER_UPS.filter((u) => r[u.id]).map((u) => `${u.name}${r[u.id]! > 1 ? ` ×${r[u.id]}` : ""}`),
  ]
    .filter(Boolean)
    .join(" + ");
