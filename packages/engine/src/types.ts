export type Suit =
  | "bamboo"
  | "dots"
  | "characters"
  | "winds"
  | "dragons"
  | "flowers"
  | "seasons";
export type Slot = { id: string; x: number; y: number; z: number };
export type Tile = Slot & {
  suit: Suit;
  rank: string;
  matchGroup: string;
  removed: boolean;
  /** Set on both tiles of a bonus pair; they only match each other. */
  bonusId?: string;
  /** Visual category of the face (e.g. "traditional", "programming", "animal"). */
  tag?: string;
};
export type Pair = [string, string];
/** A timed special pair. One clock per pair keeps both tiles in sync. */
export type Bonus = {
  id: string;
  tiles: Pair;
  kind: "multiplier" | "golden" | "combo";
  multiplier: number;
  /** Extra flat points (golden bonus). */
  flat: number;
  /** Extra combo steps (combo bonus). */
  comboBoost: number;
  durationMs: number;
  remainingMs: number;
  status: "live" | "expired" | "claimed";
};
/** Timed event: pairs with this tag score extra while it lasts. */
export type Rush = {
  tag: string;
  multiplier: number;
  durationMs: number;
  remainingMs: number;
};
/** The last scoring event, for floating text and celebrations. */
export type Award = {
  seq: number;
  tile: string;
  points: number;
  multiplier: number;
  combo: number;
  labels: string[];
};
export type Rules = {
  basePair: number;
  comboWindowMs: number;
  /** [minimum combo, extra points], highest first; empty disables rewards. */
  comboRewards: [number, number][];
  rush: { every: number; multiplier: number; durationMs: number } | null;
  /** Pairs in a row without lifting a stray tile. */
  streak: { length: number; reward: number };
  /** Consecutive pairs of one tag (Animal Combo). */
  run: { tag: string; length: number; reward: number };
};
export type Snapshot = {
  tiles: Tile[];
  score: number;
  moves: number;
  hints: number;
  shuffles: number;
  selected: string | null;
  /** Tiles lifted off the board, waiting for their partner (max TRAY_SIZE). */
  tray: string[];
  bonuses: Bonus[];
  combo: number;
  /** Longest combo this run (missing on saves from before it existed). */
  maxCombo?: number;
  /** Play time of the last match; drives combo expiry. */
  lastMatchMs: number | null;
  streak: number;
  runCount: number;
  rush: Rush | null;
  lastAward: Award | null;
};
export type State = Snapshot & {
  history: Snapshot[];
  elapsedMs: number;
  status: "playing" | "paused" | "won" | "stuck" | "lost";
  rules: Rules;
  /** Tray slots on this board (4, or 5 after the extra-slot power-up).
   *  Lives outside snapshots so undo never takes a used power-up back. */
  traySize?: number;
  /** Freeze power-up: bonus and Rush timers are paused while this runs down. */
  freezeMs?: number;
};
export type Puzzle = {
  id: string;
  layoutId: string;
  seed: string;
  rulesVersion: string;
  layoutVersion: number;
  tiles: Tile[];
  solution: Pair[];
  metrics: { choices: number; forcedRatio: number; visited: number };
  difficulty: "gentle" | "balanced" | "challenging";
};
