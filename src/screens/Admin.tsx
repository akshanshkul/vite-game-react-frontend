import { useState, useRef, useEffect } from "react";
import { request } from "../services/api";
import { layouts } from "../../packages/content/layouts";
import { initial, type Puzzle } from "../../packages/engine/src/index";
import Board from "../game/Board";
export default function Admin() {
  const [previewPuzzle, setPreviewPuzzle] = useState<Puzzle | null>(null),
    [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const [geometry, setGeometry] = useState(
      JSON.stringify(layouts[0].slots, null, 2),
    ),
    [json, setJson] = useState(""),
    [id, setId] = useState("custom-garden-101"),
    [number, setNumber] = useState(101),
    [message, setMessage] = useState(
      "Server authorization is required for every operation.",
    ),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [levelId, setLevelId] = useState("level-001"),
    [userId, setUserId] = useState("");
  async function call(path: string, body?: unknown) {
    try {
      const data = await request(path, body);
      setMessage(JSON.stringify(data));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed");
    }
  }
  function preview() {
    try {
      const slots = JSON.parse(geometry);
      worker.current?.terminate();
      setBusy(true);
      const w = new Worker(
        new URL("../game/generate.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = w;
      const timer = setTimeout(() => {
        w.terminate();
        setBusy(false);
        setMessage("Generation budget exhausted. Adjust the layout.");
      }, 4000);
      w.onmessage = (e) => {
        clearTimeout(timer);
        w.terminate();
        setBusy(false);
        if (e.data.error) {
          setMessage(e.data.error);
          return;
        }
        setPreviewPuzzle(e.data.puzzle);
        setJson(JSON.stringify(e.data.puzzle, null, 2));
        setMessage(
          "Solver-verified preview. The server independently validates every witness before publication.",
        );
      };
      w.onerror = () => {
        clearTimeout(timer);
        setBusy(false);
        setMessage("Generation failed.");
      };
      w.postMessage({ slots, seed: `admin-${id}`, id });
    } catch (e) {
      setBusy(false);
      setMessage(String(e));
    }
  }
  return (
    <section>
      <p role="status">{message}</p>
      <button onClick={() => void call("admin/metrics")}>Load metrics</button>
      <button onClick={() => void call("admin/levels")}>List levels</button>
      <label>
        Stable new puzzle ID
        <input value={id} onChange={(e) => setId(e.target.value)} />
      </label>
      <label>
        Level number
        <input
          type="number"
          min="101"
          value={number}
          onChange={(e) => setNumber(Number(e.target.value))}
        />
      </label>
      <label>
        Layout geometry (JSON)
        <textarea
          rows={8}
          value={geometry}
          onChange={(e) => setGeometry(e.target.value)}
        />
      </label>
      <button disabled={busy} onClick={() => void preview()}>
        Generate & validate preview
      </button>
      {previewPuzzle && (
        <div className="table">
          <Board
            state={initial(previewPuzzle.tiles)}
            onSelect={() => {}}
            large={false}
            faces={{}}
            reducedMotion={true}
            introKey={previewPuzzle.id}
            hint={null}
            shake={null}
          />
        </div>
      )}
      <label>
        Verified puzzle JSON
        <textarea
          rows={8}
          value={json}
          onChange={(e) => setJson(e.target.value)}
        />
      </label>
      <button
        disabled={!json}
        onClick={() => {
          try {
            void call("admin/levels", {
              id,
              levelNumber: number,
              puzzle: JSON.parse(json),
              publish: true,
            });
          } catch {
            setMessage("Invalid JSON");
          }
        }}
      >
        Publish new level
      </button>
      <button
        disabled={!json}
        onClick={() => {
          try {
            void call("admin/layouts", {
              id: `layout-${id}`,
              puzzle: JSON.parse(json),
            });
          } catch {
            setMessage("Invalid JSON");
          }
        }}
      >
        Publish layout
      </button>
      <h3>Schedule daily challenge · UTC</h3>
      <label>
        Date
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <label>
        Published level ID
        <input value={levelId} onChange={(e) => setLevelId(e.target.value)} />
      </label>
      <button
        onClick={() =>
          void call("admin/daily", { id: `daily-${date}`, date, levelId })
        }
      >
        Publish schedule
      </button>
      <h3>Moderation</h3>
      <label>
        User ID
        <input value={userId} onChange={(e) => setUserId(e.target.value)} />
      </label>
      <button
        disabled={!userId}
        onClick={() =>
          void call(`admin/users/${encodeURIComponent(userId)}/moderate`, {
            status: "suspended",
          })
        }
      >
        Suspend user
      </button>
      <button
        disabled={!userId}
        onClick={() =>
          void call(`admin/users/${encodeURIComponent(userId)}/moderate`, {
            status: "active",
          })
        }
      >
        Restore user
      </button>
    </section>
  );
}
