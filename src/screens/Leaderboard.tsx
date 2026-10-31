import { useEffect, useState } from "react";
import { request } from "../services/api";
import { levels } from "../services/content";
type Entry = {
  id: string;
  display_name: string;
  score: number;
  elapsed_ms: number;
  level_id: string;
};
type Standing = {
  rank: number;
  displayName: string;
  levels: number;
  stars: number;
  score: number;
  isMe: boolean;
};
const medal = (rank: number) => ["🥇", "🥈", "🥉"][rank - 1] ?? String(rank);
const levelName = (id: string) => {
  const l = levels.find((l) => l.puzzle.id === id);
  return l
    ? `Level ${l.number} · ${l.name}`
    : id.startsWith("daily-")
      ? `Daily ${id.slice(6)}`
      : id;
};
function Row({ s }: { s: Standing }) {
  return (
    <li className={`rank-row ${s.isMe ? "me" : ""} ${s.rank <= 3 ? "top" : ""}`}>
      <span className="rank-badge">{medal(s.rank)}</span>
      <span className="rank-name">
        {s.displayName}
        {s.isMe && <em> · you</em>}
      </span>
      <span className="rank-stats">
        <b>{s.levels}</b> {s.levels === 1 ? "level" : "levels"} ·{" "}
        <b>{s.stars}</b>★
      </span>
    </li>
  );
}
/** Player standings (synced campaign progress) and verified online runs. */
function Players({
  signedIn,
  onSignIn,
}: {
  signedIn: boolean;
  onSignIn: () => void;
}) {
  const [data, setData] = useState<{
    items: Standing[];
    me: Standing | null;
    players: number;
  } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    request<{ items: Standing[]; me: Standing | null; players: number }>(
      "rankings",
    )
      .then(setData)
      .catch(() => setError(true));
  }, []);
  if (error)
    return (
      <p className="muted">
        Rankings are unavailable offline. Your progress stays in Profile.
      </p>
    );
  if (!data) return <div className="spinner center" />;
  const meListed = data.items.some((s) => s.isMe);
  return (
    <>
      {!signedIn && (
        <div className="rank-cta">
          <p>Sign in to put your cleared levels on the board.</p>
          <button className="primary" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      )}
      {data.me && (
        <p className="rank-you">
          You are <b>#{data.me.rank}</b> of {data.players} players
        </p>
      )}
      {data.items.length ? (
        <ol className="ranks">
          {data.items.map((s) => (
            <Row key={`${s.rank}-${s.displayName}`} s={s} />
          ))}
          {data.me && !meListed && (
            <>
              <li className="rank-gap">⋯</li>
              <Row s={data.me} />
            </>
          )}
        </ol>
      ) : (
        <p className="muted">
          No ranked players yet. Clear a level while signed in to be first.
        </p>
      )}
      <p className="muted small">
        Ranked by levels cleared, then stars, then best scores.
      </p>
    </>
  );
}
function Runs() {
  const [items, setItems] = useState<Entry[]>([]),
    [message, setMessage] = useState("Loading verified online results…"),
    [board, setBoard] = useState(""),
    [cursor, setCursor] = useState<string | null>(null);
  async function load(next: string | null = null) {
    try {
      const query = new URLSearchParams();
      if (board) query.set("levelId", board);
      if (next) query.set("cursor", next);
      const result = await request<{
        items: Entry[];
        nextCursor: string | null;
      }>(`leaderboards?${query}`);
      setItems((old) => (next ? [...old, ...result.items] : result.items));
      setCursor(result.nextCursor);
      setMessage(
        result.items.length
          ? "Only server-replayed online runs are listed."
          : "No verified runs yet. Start one from your account.",
      );
    } catch {
      setMessage(
        "Online leaderboard is unavailable. Your local history remains in Profile.",
      );
    }
  }
  useEffect(() => {
    setItems([]);
    setCursor(null);
    void load();
  }, [board]);
  return (
    <>
      <label className="field">
        <span>Board</span>
        <select value={board} onChange={(e) => setBoard(e.target.value)}>
          <option value="">Overall</option>
          {levels.map((l) => (
            <option key={l.puzzle.id} value={l.puzzle.id}>
              Level {l.number} · {l.name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">{message}</p>
      <ol className="ranks">
        {items.map((i, n) => (
          <li key={i.id} className={`rank-row ${n < 3 ? "top" : ""}`}>
            <span className="rank-badge">{medal(n + 1)}</span>
            <span className="rank-name">
              {i.display_name}
              <small>{levelName(i.level_id)}</small>
            </span>
            <span className="rank-stats">
              <b>{i.score}</b> pts · {Math.round(i.elapsed_ms / 1000)}s
            </span>
          </li>
        ))}
      </ol>
      {cursor && (
        <button className="block" onClick={() => void load(cursor)}>
          Load more results
        </button>
      )}
      <p className="muted small">
        Automation and timing manipulation cannot be made perfectly cheat-proof
        in a browser game.
      </p>
    </>
  );
}
export default function Leaderboard({
  signedIn,
  onSignIn,
}: {
  signedIn: boolean;
  onSignIn: () => void;
}) {
  const [tab, setTab] = useState<"players" | "runs">("players");
  return (
    <section className="leaderboard">
      <div className="segmented" role="tablist" aria-label="Ranking type">
        {(
          [
            ["players", "Players"],
            ["runs", "Verified runs"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "players" ? (
        <Players signedIn={signedIn} onSignIn={onSignIn} />
      ) : (
        <Runs />
      )}
    </section>
  );
}
