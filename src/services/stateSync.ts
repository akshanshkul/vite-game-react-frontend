// Device side of the coins/undos/themes/claims sync: ledger entries wait in
// the IndexedDB outbox (type "ledger") until the account acknowledges them.
// Guests keep them locally; they upload on the first sign-in.
import { request } from "./api";
import { db, type Profile } from "./storage";
import {
  applyServerState,
  claimsOf,
  openingEvents,
  type LedgerEvent,
  type ServerState,
} from "./ledger";
const KEY = /^[a-z0-9:_.-]{1,64}$/;
export const queueLedger = (events: LedgerEvent[]) =>
  events.length
    ? db.outbox.bulkPut(events.map((e) => ({ id: e.id, type: "ledger", payload: e })))
    : Promise.resolve();
const pendingLedger = async () =>
  (await db.outbox.toArray())
    .filter((e) => e.type === "ledger")
    .map((e) => e.payload as LedgerEvent);
/**
 * Once per device: an opening entry for what it held before the ledger
 * existed. Runs at load, before any new entry is queued, so nothing counts
 * twice.
 */
export async function ensureOpening(p: Profile) {
  if (await db.meta.get("ledgerInit")) return;
  const deviceId = crypto.randomUUID();
  await queueLedger(openingEvents(p, deviceId));
  await db.meta.put({ id: "ledgerInit", value: { deviceId } });
}
/**
 * Sends unsent entries plus purchases and claim keys. Returns a function that
 * merges the account's totals into the latest profile, so anything earned or
 * spent while the request was in flight is kept.
 */
export async function syncState(
  p: Profile,
): Promise<(latest: Profile) => Profile> {
  const events = await pendingLedger(),
    purchases = p.purchases.filter((x) => KEY.test(x)).slice(0, 64),
    claims = claimsOf(p).filter((x) => KEY.test(x));
  let server: ServerState | null = null;
  for (let i = 0; i === 0 || i < events.length; i += 200) {
    const result = await request<ServerState & { acknowledged: string[] }>(
      "me/state/sync",
      {
        events: events.slice(i, i + 200),
        ...(i === 0 ? { purchases, claims: claims.slice(-500) } : {}),
      },
    );
    await db.outbox.bulkDelete(result.acknowledged);
    server = result;
  }
  const pending = await pendingLedger();
  return (latest) => applyServerState(latest, server!, pending);
}
