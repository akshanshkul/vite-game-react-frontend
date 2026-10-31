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
  type State,
  type Tile,
} from "../../packages/engine/src/index";
import {
  classicFace,
  faceKey,
  openPacks,
  type Category,
  type Face,
} from "./TileDefinitions";
/** Picture categories and how much of the picture share each one gets. */
const pictureWeights: Partial<Record<Category, number>> = {
  programming: 0.25,
  animal: 0.2,
  fruit: 0.12,
  icon: 0.12,
  social: 0.12,
  india: 0.12,
};
/**
 * Category mix by level, the same for every player: a traditional share that
 * shrinks as levels go on, the rest split by weight between the picture
 * categories whose packs are open. Bonus pairs are dealt on top of this mix.
 * Daily puzzles (level null) use the full late-game mix.
 */
export function levelMix(level: number | null): Record<string, number> {
  const traditional =
      level === null || level > 20 ? 0.5 : level > 10 ? 0.55 : level > 5 ? 0.75 : 1,
    openCats = new Set(openPacks(level).map((p) => p.category)),
    open = (Object.keys(pictureWeights) as Category[]).filter((c) =>
      openCats.has(c),
    ),
    total = open.reduce((n, c) => n + (pictureWeights[c] ?? 0), 0),
    mix: Record<string, number> = { traditional };
  for (const c of open)
    mix[c] = total ? ((1 - traditional) * (pictureWeights[c] ?? 0)) / total : 0;
  return mix;
}
/**
 * Bonus pairs by level: none while players learn the tray (levels 1–5), then
 * a share that rises gently, with timers easing from 20 s to 12 s.
 */
export function bonusConfigFor(level: number | null): BonusConfig {
  const n = level ?? 60;
  return {
    ...defaultBonusConfig,
    frequency: level === null ? 0.1 : n <= 5 ? 0 : Math.min(0.15, 0.04 + n * 0.001),
    durationMs: Math.round(20 - 8 * Math.min(1, (n - 1) / 100)) * 1000,
    multipliers: [2, 3, 5],
  };
}
const shuffled = <T>(xs: T[], random: () => number) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
/** Tag each face group with a category, capped by the pictures available. */
function assignTags(puzzle: Puzzle, level: number | null): Tile[] {
  const random = prng(`tags-${puzzle.id}`),
    groups = shuffled([...new Set(puzzle.tiles.map((t) => t.matchGroup))].sort(), random),
    mix = levelMix(level),
    open = openPacks(level),
    room = (c: Category) =>
      open.filter((p) => p.category === c).reduce((n, p) => n + p.faces.length, 0),
    tagOf = new Map<string, string>();
  let next = 0;
  for (const [c, share] of Object.entries(mix)) {
    if (c === "traditional") continue;
    const n = Math.min(room(c as Category), Math.round(groups.length * share));
    for (let i = 0; i < n && next < groups.length; i++) tagOf.set(groups[next++], c);
  }
  for (; next < groups.length; next++) tagOf.set(groups[next], "traditional");
  return puzzle.tiles.map((t) => ({ ...t, tag: tagOf.get(t.matchGroup) }));
}
/** A fresh board for a puzzle: categories, bonus pairs and scoring rules. */
export function dealBoard(puzzle: Puzzle, level: number | null): State {
  const { tiles, bonuses } = assignBonuses(
    assignTags(puzzle, level),
    puzzle.solution,
    puzzle.id,
    bonusConfigFor(level),
  );
  return initial(tiles, { bonuses, rules: defaultRules });
}
/**
 * The picture for every face group on this board. The player's own tiles take
 * the first groups (traditional ones first, picked by the puzzle seed); the
 * newest open pack of each category is featured next so freshly unlocked
 * tiles show up right away. No two groups ever share a face.
 */
export function facesFor(
  tiles: Tile[],
  puzzleId: string,
  level: number | null,
  custom: Face[] = [],
): Record<string, Face> {
  const random = prng(`faces-${puzzleId}`),
    open = openPacks(level),
    taken = new Set(custom.map(faceKey)),
    pool = (c: Category) => {
      const own = open.filter((p) => p.category === c),
        newest = own.at(-1);
      return [
        ...shuffled(newest?.faces ?? [], random),
        ...shuffled(own.slice(0, -1).flatMap((p) => p.faces), random),
      ].filter((f) => !taken.has(faceKey(f)));
    },
    // Built up front in a fixed order so the seeded shuffle, and with it every
    // saved board's pictures, stays the same as categories are added.
    pools = new Map<string, Face[]>(
      (Object.keys(pictureWeights) as Category[]).map((c) => [c, pool(c)]),
    ),
    /** Next face of a category not already used on this board. */
    take = (c: string) => {
      const list = pools.get(c) ?? [];
      let f: Face | undefined;
      while ((f = list.shift()) && taken.has(faceKey(f)));
      if (f) taken.add(faceKey(f));
      return f;
    },
    out: Record<string, Face> = {};
  const groups = [...new Map(tiles.map((t) => [t.matchGroup, t])).values()].sort(
      (a, b) => a.matchGroup.localeCompare(b.matchGroup),
    ),
    mine = shuffled(groups, random)
      .sort((a, b) => Number(a.tag !== "traditional") - Number(b.tag !== "traditional"))
      .slice(0, custom.length);
  mine.forEach((t, i) => (out[t.matchGroup] = custom[i]));
  for (const t of groups) {
    if (out[t.matchGroup]) continue;
    const picture =
      t.tag && t.tag !== "traditional" ? take(t.tag) : undefined;
    out[t.matchGroup] = picture ?? classicFace(t.matchGroup, t.suit);
  }
  return out;
}
