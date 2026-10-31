// Undo is a limited, saved resource: new players get 7, and every 10 levels
// cleared (campaign or endless, not dailies) pays 3 more, never above 20.
// Kept free of IndexedDB so the rules can be unit tested.
import type { Profile } from "./storage";
export const START_UNDOS = 7;
export const MAX_UNDOS = 20;
export const UNDOS_PER_MILESTONE = 3;
export const LEVELS_PER_MILESTONE = 10;
/** Completed campaign and endless levels (dailies don't count). */
export const levelsCleared = (p: Pick<Profile, "completed">) =>
  Object.keys(p.completed).filter((id) => !id.startsWith("daily-")).length;
/**
 * Pays out any 10-level milestones reached since the last payout. Replaying a
 * cleared level adds nothing (the count doesn't change), and a milestone is
 * spent even when the cap swallows it, so nothing is banked past 20.
 */
export function earnUndos(p: Profile): { profile: Profile; gained: number } {
  const reached = Math.floor(levelsCleared(p) / LEVELS_PER_MILESTONE),
    due = reached - p.undoMilestones;
  if (due <= 0) return { profile: p, gained: 0 };
  const undos = Math.min(MAX_UNDOS, p.undos + due * UNDOS_PER_MILESTONE);
  return {
    profile: { ...p, undos, undoMilestones: reached },
    gained: undos - p.undos,
  };
}
/** Spends one undo; returns the profile unchanged when none are left. */
export const spendUndo = (p: Profile): Profile =>
  p.undos > 0 ? { ...p, undos: p.undos - 1 } : p;
/**
 * Profiles saved before undos were limited get the starting 7 and have their
 * past milestones marked as paid, so nobody receives a sudden burst.
 */
export function migrateUndos(p: Profile): Profile {
  const undos = Number.isSafeInteger(p.undos)
      ? Math.min(MAX_UNDOS, Math.max(0, p.undos))
      : START_UNDOS,
    undoMilestones = Number.isSafeInteger(p.undoMilestones)
      ? p.undoMilestones
      : Math.floor(levelsCleared(p) / LEVELS_PER_MILESTONE);
  return { ...p, undos, undoMilestones };
}
