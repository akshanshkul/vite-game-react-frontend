// ComboManager: consecutive matches within a play-time window.
import type { Rules, State } from "./types";
type ComboState = Pick<State, "combo" | "lastMatchMs" | "elapsedMs" | "rules">;
/** Combo after one more match now: continues inside the window, else restarts. */
export const nextCombo = (s: ComboState) =>
  s.lastMatchMs !== null && s.elapsedMs - s.lastMatchMs <= s.rules.comboWindowMs
    ? s.combo + 1
    : 1;
/** Combo shown right now: it lapses once the window passes without a match. */
export const liveCombo = (s: ComboState) =>
  s.lastMatchMs !== null && s.elapsedMs - s.lastMatchMs <= s.rules.comboWindowMs
    ? s.combo
    : 0;
export const comboReward = (rules: Rules, combo: number) =>
  rules.comboRewards.find(([n]) => combo >= n)?.[1] ?? 0;
