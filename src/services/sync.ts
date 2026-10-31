import { api, request } from "./api";
import { db, type Profile } from "./storage";
import type { Progress } from "../../packages/contracts/src/api";
export function mergeProgress(profile: Profile, items: Progress[]): Profile {
  const completed = { ...profile.completed };
  for (const row of items) {
    const score = Number(row.best_score),
      time = Number(row.best_time_ms),
      stars = Number(row.stars);
    if (
      typeof row.level_id !== "string" ||
      ![score, time, stars].every(Number.isFinite) ||
      score < 0 ||
      time < 0 ||
      stars < 1 ||
      stars > 3
    )
      continue;
    const old = completed[row.level_id];
    completed[row.level_id] = {
      score: Math.max(old?.score ?? 0, score),
      time: Math.min(old?.time ?? Infinity, time),
      stars: Math.max(old?.stars ?? 0, stars),
    };
  }
  // Daily streak dates come from cleared daily puzzles, so they follow too.
  const dailyDates = [
    ...new Set([
      ...profile.dailyDates,
      ...Object.keys(completed)
        .filter((id) => /^daily-\d{4}-\d{2}-\d{2}$/.test(id))
        .map((id) => id.slice(6)),
    ]),
  ].sort();
  return { ...profile, completed, dailyDates };
}
type Completion = {
  id: string;
  type: "completion";
  payload: {
    puzzleId: string;
    score: number;
    elapsedMs: number;
    stars: number;
    casual: true;
  };
};
/**
 * Every level this device has cleared, as idempotent sync events. The event
 * id encodes the result, so resending is harmless (the server keeps each id
 * once) and an improved result goes up as a new event. This also uploads
 * progress made before signing in or whose outbox entry was lost.
 */
async function profileCompletions(): Promise<Completion[]> {
  const row = await db.meta.get("profile"),
    completed = (row?.value as Profile | undefined)?.completed ?? {};
  return Object.entries(completed).flatMap(([puzzleId, c]) => {
    const score = Math.min(7200, Math.max(0, Math.round(c.score))),
      elapsedMs = Math.min(86400000, Math.max(0, Math.round(c.time))),
      stars = Math.min(3, Math.max(1, Math.round(c.stars))),
      id = `p:${puzzleId}:${score}:${elapsedMs}:${stars}`;
    if (
      !/^[a-zA-Z0-9_-]{1,64}$/.test(puzzleId) ||
      !Number.isFinite(c.time) ||
      id.length > 128
    )
      return [];
    return [
      { id, type: "completion", payload: { puzzleId, score, elapsedMs, stars, casual: true } },
    ];
  });
}
export async function flushCompletions(): Promise<Progress[]> {
  const { user } = await api.me(),
    cacheKey = `syncedEvents:${user.id}`;
  const queued = (await db.outbox.toArray()).filter(
      (e) => e.type === "completion",
    ),
    // Results the server already acknowledged need not be sent again.
    sent = new Set(
      ((await db.meta.get(cacheKey))?.value as string[] | undefined) ?? [],
    ),
    events = [
      ...queued,
      ...(await profileCompletions()).filter((e) => !sent.has(e.id)),
    ];
  if (!events.length) return (await api.progress()).items;
  let items: Progress[] = [];
  for (let i = 0; i < events.length; i += 100) {
    const result = await request<{ acknowledged: string[]; items: Progress[] }>(
      "progress/sync",
      { events: events.slice(i, i + 100) },
    );
    await db.outbox.bulkDelete(result.acknowledged);
    for (const id of result.acknowledged) if (id.startsWith("p:")) sent.add(id);
    await db.meta.put({ id: cacheKey, value: [...sent] });
    items = result.items;
  }
  return items;
}
