// TileGenerator: decides which category each face group wears on a board,
// which pairs become timed bonus pairs, and which picture each group shows.
// Everything is seeded by the puzzle id, so a saved board redraws identically.
import {
  assignBonuses,
  defaultBonusConfig,
  defaultRules,
  initial,
  prng,
  type BonusConfig,
  type Puzzle,
  type Rules,
  type State,
  type Tile,
} from "../../packages/engine/src/index";
import {
  classicFace,
  openPacks,
  type Category,
  type Face,
} from "./TileDefinitions";
import type { Settings } from "../services/storage";
export const multiplierSets: Record<Settings["multipliers"], number[]> = {
  gentle: [2, 2, 3],
  standard: [2, 3, 5],
  big: [3, 5, 10],
};
/**
 * Default category mix by campaign level. Bonus pairs are dealt on top of
 * this mix (a bonus tile wears a face from any category).
 */
export function levelMix(level: number | null): Record<Category, number> {
  if (level === null || level > 20)
    return { traditional: 0.45, programming: 0.25, animal: 0.2 };
  if (level > 10) return { traditional: 0.55, programming: 0.2, animal: 0.25 };
  if (level > 5) return { traditional: 0.75, programming: 0, animal: 0.25 };
  return { traditional: 1, programming: 0, animal: 0 };
}
/** The mix after the player's frequency settings, normalised to 1. */
export function mixFor(level: number | null, settings: Settings) {
  const base = levelMix(settings.progression ? level : null),
    programming = (base.programming * settings.programmingShare) / 0.25,
    animal = (base.animal * settings.animalShare) / 0.2,
    traditional = Math.max(0.15, base.traditional),
    sum = traditional + programming + animal;
  return {
    traditional: traditional / sum,
    programming: programming / sum,
    animal: animal / sum,
  };
}
export const rulesFor = (settings: Settings): Rules => ({
  ...defaultRules,
  comboRewards: settings.comboRewards ? defaultRules.comboRewards : [],
});
export const bonusConfigFor = (
  level: number | null,
  settings: Settings,
): BonusConfig => ({
  ...defaultBonusConfig,
  // The first two levels teach the tray before introducing timers.
  frequency:
    settings.progression && level !== null && level <= 2
      ? 0
      : settings.bonusFrequency,
  durationMs: settings.bonusSeconds * 1000,
  multipliers: multiplierSets[settings.multipliers],
});
const shuffled = <T>(xs: T[], random: () => number) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
/** Tag each face group with a category, capped by the pictures available. */
function assignTags(
  puzzle: Puzzle,
  level: number | null,
  settings: Settings,
): Tile[] {
  const random = prng(`tags-${puzzle.id}`),
    groups = shuffled([...new Set(puzzle.tiles.map((t) => t.matchGroup))].sort(), random),
    mix = mixFor(level, settings),
    open = openPacks(settings.progression ? level : null),
    room = (c: Category) =>
      open.filter((p) => p.category === c).reduce((n, p) => n + p.faces.length, 0),
    count = (c: "programming" | "animal") =>
      Math.min(room(c), Math.round(groups.length * mix[c])),
    programming = count("programming"),
    animal = count("animal"),
    tagOf = new Map(
      groups.map((g, i) => [
        g,
        i < programming
          ? "programming"
          : i < programming + animal
            ? "animal"
            : "traditional",
      ]),
    );
  return puzzle.tiles.map((t) => ({ ...t, tag: tagOf.get(t.matchGroup) }));
}
/** A fresh board for a puzzle: categories, bonus pairs and scoring rules. */
export function dealBoard(
  puzzle: Puzzle,
  level: number | null,
  settings: Settings,
): State {
  const tagged = assignTags(puzzle, level, settings),
    { tiles, bonuses } = assignBonuses(
      tagged,
      puzzle.solution,
      puzzle.id,
      bonusConfigFor(level, settings),
    );
  return initial(tiles, { bonuses, rules: rulesFor(settings) });
}
/**
 * The picture for every face group on this board. The newest open pack of a
 * category is featured first so freshly unlocked tiles show up right away.
 */
export function facesFor(
  tiles: Tile[],
  puzzleId: string,
  level: number | null,
  progression: boolean,
): Record<string, Face> {
  const random = prng(`faces-${puzzleId}`),
    open = openPacks(progression ? level : null),
    pool = (c: Category) => {
      const own = open.filter((p) => p.category === c),
        newest = own.at(-1);
      return [
        ...shuffled(newest?.faces ?? [], random),
        ...shuffled(own.slice(0, -1).flatMap((p) => p.faces), random),
      ];
    },
    pools = { programming: pool("programming"), animal: pool("animal") },
    out: Record<string, Face> = {};
  const groups = [...new Map(tiles.map((t) => [t.matchGroup, t])).values()].sort(
    (a, b) => a.matchGroup.localeCompare(b.matchGroup),
  );
  for (const t of groups) {
    const picture =
      t.tag === "programming" || t.tag === "animal"
        ? pools[t.tag].shift()
        : undefined;
    out[t.matchGroup] = picture ?? classicFace(t.matchGroup, t.suit);
  }
  return out;
}
