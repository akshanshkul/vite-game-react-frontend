// ScoringEngine: everything that happens when a pair is completed.
// All values live in the snapshot, so undo restores score, combo, bonuses
// and events together and points can never be counted twice.
import { bonusOf } from "./bonus";
import { comboReward, nextCombo } from "./combo";
import { startRush } from "./events";
import type { Snapshot, State, Tile } from "./types";
export function settlePair(
  s: State,
  a: Tile,
  b: Tile,
  next: Pick<State, "tiles" | "tray">,
): Partial<Snapshot> {
  const rules = s.rules,
    bonus = bonusOf(s, a),
    combo = nextCombo(s) + (bonus?.comboBoost ?? 0),
    rushMultiplier = s.rush && a.tag === s.rush.tag ? s.rush.multiplier : 1,
    multiplier = (bonus?.multiplier ?? 1) * rushMultiplier,
    labels: string[] = [];
  let points = rules.basePair * multiplier + (bonus?.flat ?? 0);
  if (bonus)
    labels.push(
      bonus.kind === "golden"
        ? "GOLDEN BONUS"
        : bonus.kind === "combo"
          ? "COMBO BONUS"
          : `${bonus.multiplier}× BONUS`,
    );
  if (rushMultiplier > 1) labels.push(`RUSH ${rushMultiplier}×`);
  const comboPoints = comboReward(rules, combo);
  if (comboPoints) {
    points += comboPoints;
    labels.push(`COMBO ×${combo}`);
  }
  const streak = s.streak + 1;
  if (streak % rules.streak.length === 0) {
    points += rules.streak.reward;
    labels.push("BAMBOO STREAK");
  }
  let runCount = a.tag === rules.run.tag ? s.runCount + 1 : 0;
  if (runCount >= rules.run.length) {
    points += rules.run.reward;
    labels.push("ANIMAL COMBO");
    runCount = 0;
  }
  const moves = s.moves + 1,
    bonuses = bonus
      ? s.bonuses.map((x) =>
          x.id === bonus.id ? { ...x, status: "claimed" as const } : x,
        )
      : s.bonuses;
  return {
    score: s.score + points,
    moves,
    combo,
    lastMatchMs: s.elapsedMs,
    streak,
    runCount,
    bonuses,
    rush: startRush({ ...s, ...next }, moves),
    lastAward: {
      seq: s.elapsedMs * 1000 + moves,
      tile: b.id,
      points,
      multiplier,
      combo,
      labels,
    },
  };
}
