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
  return { ...profile, completed };
}
export async function flushCompletions(): Promise<Progress[]> {
  await api.me();
  const events = (await db.outbox.toArray()).filter(
    (e) => e.type === "completion",
  );
  if (!events.length) return (await api.progress()).items;
  let items: Progress[] = [];
  for (let i = 0; i < events.length; i += 100) {
    const result = await request<{ acknowledged: string[]; items: Progress[] }>(
      "progress/sync",
      { events: events.slice(i, i + 100) },
    );
    await db.outbox.bulkDelete(result.acknowledged);
    items = result.items;
  }
  return items;
}
