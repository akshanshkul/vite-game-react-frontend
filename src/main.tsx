import "./polyfills";
import {
  type CSSProperties,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import {
  isTileFree,
  pick,
  trayHint,
  listLegalPairs,
  TRAY_SIZE,
  isBonusRunning,
  undo,
  applyAction,
  type State,
  type Puzzle,
  type Pair,
} from "../packages/engine/src/index";
import { levels, daily, unlocked } from "./services/content";
import {
  db,
  validState,
  complete,
  balance,
  streak,
  defaultProfile,
  type Profile,
  type Settings,
} from "./services/storage";
import { useSettings } from "./state/settingsStore";
import { copy } from "./services/i18n";
import { api, request } from "./services/api";
import type { RunTicket, User } from "../packages/contracts/src/api";
import { flushCompletions, mergeProgress } from "./services/sync";
import { configure, play, setAmbient, unlock, type Cue } from "./services/feedback";
import { Icon, type IconName } from "./ui/icons";
import {
  classicFace,
  packs,
  packsUnlockedBy,
  totalTypes,
  type Face,
} from "./game/TileDefinitions";
import { dealBoard, facesFor } from "./game/TileGenerator";
import { paintTile } from "./game/TileRenderer";
import "./style.css";
const Leaderboard = lazy(() => import("./screens/Leaderboard"));
const Account = lazy(() => import("./screens/Account"));
const Admin = lazy(() => import("./screens/Admin"));
const Board = lazy(() => import("./game/Board"));
type ScreenRect = import("./game/Board").ScreenRect;
/** A tile travelling from the board into the tray, drawn above everything. */
type Flight = {
  key: number;
  id: string;
  face: Face;
  from: ScreenRect;
  /** The tray slot it flies into (always its own slot). */
  target: string;
  /** Twin already waiting in the tray; set when this tile completes a pair. */
  partner: string | null;
  /** Sound to play when the pair merges, so audio matches the animation. */
  cue: Cue | null;
};
const TRAY_TILE = 40;
/** Flies a tile along a gentle arc into its tray slot, then reports landing. */
function FlyingTile({
  flight,
  onLand,
}: {
  flight: Flight;
  onLand: (f: Flight) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!,
      slot = document.querySelector<HTMLElement>(
        `.slot[data-id="${flight.target}"]`,
      );
    if (!slot) {
      onLand(flight);
      return;
    }
    const { from } = flight,
      to = slot.getBoundingClientRect(),
      dx = to.left + to.width / 2 - (from.left + from.width / 2),
      dy = to.top + to.height / 2 - (from.top + from.height / 2),
      k = TRAY_TILE / from.width,
      lift = Math.min(60, Math.abs(dy) * 0.35 + 20);
    const anim = el.animate(
      [
        { transform: "translate(0,0) scale(1)" },
        {
          transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(${(1 + k) / 2 + 0.08})`,
          offset: 0.55,
        },
        { transform: `translate(${dx}px, ${dy}px) scale(${k})` },
      ],
      { duration: 380, easing: "cubic-bezier(.45,.05,.35,1)", fill: "forwards" },
    );
    anim.onfinish = () => onLand(flight);
    return () => anim.cancel();
  }, []);
  return (
    <div
      ref={ref}
      className="flying-tile"
      style={{
        left: flight.from.left,
        top: flight.from.top,
        width: flight.from.width,
        height: flight.from.width * 1.17,
      }}
    >
      <TileCanvas face={flight.face} width={flight.from.width} />
    </div>
  );
}
type Screen =
  | "game"
  | "welcome"
  | "campaign"
  | "profile"
  | "shop"
  | "settings"
  | "help"
  | "privacy"
  | "account"
  | "admin"
  | "leaderboards";
type InstallPrompt = Event & { prompt: () => Promise<void> };
/** Board themes: status-bar colour for each (shop order). */
const themeColors: Record<Settings["theme"], string> = {
  jade: "#153f36",
  night: "#101d19",
  sand: "#4a3c29",
  ocean: "#10364a",
  sakura: "#5a2a3b",
  ember: "#3d1610",
  midnight: "#14163d",
  slate: "#1f262d",
};
const themeNames = Object.keys(themeColors) as Settings["theme"][];
const isIos =
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !("MSStream" in window);
const standalone =
  matchMedia("(display-mode: standalone)").matches ||
  (navigator as { standalone?: boolean }).standalone === true;
/** A tile drawn with the same painter as the board, crisp at device pixels. */
function TileCanvas({
  face,
  width,
  badge,
}: {
  face: Face;
  width: number;
  badge?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    height = width * 1.17,
    pad = Math.ceil(width * 0.12);
  useEffect(() => {
    const canvas = ref.current!,
      dpr = Math.min(devicePixelRatio || 1, 3),
      ctx = canvas.getContext("2d")!;
    canvas.width = Math.ceil((width + pad * 2) * dpr);
    canvas.height = Math.ceil((height + pad * 2) * dpr);
    ctx.scale(dpr, dpr);
    paintTile(ctx, face, "free", width, height, pad, badge);
  }, [face, width, height, pad, badge]);
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ width: width + pad * 2, height: height + pad * 2, margin: -pad }}
    />
  );
}
function App() {
  const [s, set] = useState(() =>
      dealBoard(levels[0].puzzle, 1, useSettings.getState().settings),
    ),
    [puzzle, setPuzzle] = useState<Puzzle>(levels[0].puzzle),
    [profile, setProfile] = useState<Profile>(defaultProfile),
    [loaded, setLoaded] = useState(false),
    [notice, setNotice] = useState(
      "Match two free tiles. Find your own rhythm.",
    ),
    [screen, setScreen] = useState<Screen>("game"),
    [busy, setBusy] = useState(false),
    [animating, setAnimating] = useState(false),
    [saveError, setSaveError] = useState(false),
    [updateReady, setUpdateReady] = useState(false);
  const [canSave, setCanSave] = useState(true);
  const [attemptId, setAttemptId] = useState<string>(() => crypto.randomUUID());
  const [online, setOnline] = useState<RunTicket | null>(null);
  const [moves, setMoves] = useState<[string, string][]>([]);
  const [user, setUser] = useState<User | null>(null);
  const userRef = useRef(user);
  userRef.current = user;
  /** Send finished levels to the account so they count in player rankings. */
  const syncProgress = useCallback(() => {
    void db.meta
      .put({ id: "syncEnabled", value: true })
      .then(() => flushCompletions())
      .then((items) => setProfile((p) => mergeProgress(p, items)))
      .catch(() => {
        /* Offline: the outbox keeps them and retries on reconnect. */
      });
  }, []);
  // Signing in also sends wins earned while playing as a guest.
  useEffect(() => {
    if (user) syncProgress();
  }, [user, syncProgress]);
  const [hint, setHint] = useState<Pair | null>(null);
  const [trayFlash, setTrayFlash] = useState(0);
  const [flights, setFlights] = useState<Flight[]>([]);
  /** Tray tiles already cleared by the engine but kept on screen until the
   *  flying partner reaches them. */
  const [held, setHeld] = useState<
    { id: string; index: number; popping: boolean }[]
  >([]);
  /** Pairs mid-merge: the arrived tile slides into its twin, then both pop. */
  const merge = useCallback((id: string, partner: string, cue: Cue | null) => {
    const mine = document.querySelector<HTMLElement>(`.slot[data-id="${id}"]`),
      twin = document.querySelector<HTMLElement>(`.slot[data-id="${partner}"]`),
      pop = () => {
        if (cue) play(cue);
        setTrayFlash(Date.now());
        setHeld((v) =>
          v.map((h) =>
            h.id === id || h.id === partner ? { ...h, popping: true } : h,
          ),
        );
        setTimeout(
          () => setHeld((v) => v.filter((h) => h.id !== id && h.id !== partner)),
          300,
        );
      };
    if (!mine || !twin) return pop();
    const a = mine.getBoundingClientRect(),
      b = twin.getBoundingClientRect(),
      slide = mine.animate(
        [
          { transform: "translate(0,0) scale(1)" },
          {
            transform: `translate(${(b.left - a.left) * 0.85}px, -6px) scale(1.06)`,
            offset: 0.7,
          },
          { transform: `translate(${b.left - a.left}px, 0) scale(1)` },
        ],
        { duration: 220, easing: "cubic-bezier(.5,0,.4,1)", fill: "forwards" },
      );
    slide.onfinish = pop;
  }, []);
  const facesRef = useRef<Record<string, Face>>({});
  /** Tray tiles that arrived by flight: they settle instead of sliding in. */
  const [landed, setLanded] = useState<string[]>([]);
  const locate = useRef<((id: string) => ScreenRect | null) | null>(null);
  const clearFlights = () => {
    setFlights([]);
    setHeld([]);
    setLanded([]);
  };
  const land = useCallback(
    (f: Flight) => {
      setFlights((v) => v.filter((x) => x.key !== f.key));
      setLanded((v) => [...v.slice(-8), f.target]);
      // Let the tile settle in its slot for a beat, then slide into its twin.
      if (f.partner) {
        const partner = f.partner;
        setTimeout(() => merge(f.id, partner, f.cue), 140);
      }
    },
    [merge],
  );
  useEffect(() => {
    if (!trayFlash) return;
    const t = setTimeout(() => setTrayFlash(0), 500);
    return () => clearTimeout(t);
  }, [trayFlash]);
  const [shake, setShake] = useState<{ id: string; key: number } | null>(null);
  const [installer, setInstaller] = useState<InstallPrompt | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const { settings, setSettings } = useSettings(),
    text = copy[settings.locale],
    worker = useRef<Worker | null>(null),
    updateSW = useRef<((reload?: boolean) => Promise<void>) | null>(null),
    current = useRef(s);
  current.current = s;
  const cue = (c: Cue) => play(c);
  useEffect(() => {
    let active = true;
    Promise.all([
      db.runs.get("active"),
      db.meta.get("profile"),
      db.meta.get("settings"),
      db.meta.get("tutorial"),
      db.meta.get("signedIn"),
    ])
      .then(async ([saved, p, config, tutorial, signedIn]) => {
        if (!active) return;
        if (p?.value && typeof p.value === "object")
          setProfile({ ...defaultProfile, ...p.value });
        if (config?.value && typeof config.value === "object")
          setSettings({ ...settings, ...config.value });
        if (saved) {
          let candidate: Puzzle | undefined;
          try {
            candidate =
              levels.find((l) => l.puzzle.id === saved.puzzleId)?.puzzle ??
              (typeof saved.puzzleId === "string" &&
              /^daily-\d{4}-\d{2}-\d{2}$/.test(saved.puzzleId)
                ? daily(saved.puzzleId.slice(6))
                : undefined);
          } catch {
            /* Preserve unknown daily versions. */
          }
          if (
            candidate &&
            saved.version === 3 &&
            validState(saved.state) &&
            saved.state.tiles.length === candidate.tiles.length &&
            saved.state.tiles.every((t) =>
              candidate!.tiles.some(
                (c) =>
                  c.id === t.id && c.x === t.x && c.y === t.y && c.z === t.z,
              ),
            )
          ) {
            set(saved.state);
            setPuzzle(candidate);
            if (typeof saved.attemptId === "string")
              setAttemptId(saved.attemptId);
          } else {
            await db.runs.put({
              ...saved,
              id: `archive-${crypto.randomUUID()}`,
            });
            setNotice(
              "An incompatible save was archived. Starting a fresh board.",
            );
          }
        }
        if (!tutorial) setScreen("welcome");
        // Only contact the account service for players who signed in before.
        if (signedIn?.value === true)
          api
            .me()
            .then((r) => active && setUser(r.user))
            .catch(() => {
              /* Offline or session expired: stay a guest. */
            });
      })
      .catch(() => {
        setSaveError(true);
        setCanSave(false);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
      worker.current?.terminate();
    };
  }, []);
  useEffect(() => {
    if (loaded && canSave)
      db.runs
        .put({
          id: "active",
          version: 3,
          attemptId,
          puzzleId: puzzle.id,
          state: s,
        })
        .catch(() => setSaveError(true));
  }, [s, loaded, puzzle.id, attemptId, canSave]);
  useEffect(() => {
    if (loaded)
      db.meta
        .put({ id: "profile", value: profile })
        .catch(() => setSaveError(true));
  }, [profile, loaded]);
  useEffect(() => {
    if (loaded)
      db.meta
        .put({ id: "settings", value: settings })
        .catch(() => setSaveError(true));
    configure({ sound: settings.sound, haptics: settings.haptics });
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.classList.toggle("contrast", settings.contrast);
    document.documentElement.classList.toggle(
      "reduce-motion",
      settings.reducedMotion,
    );
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", themeColors[settings.theme]);
  }, [settings, loaded]);
  useEffect(() => {
    if (
      !loaded ||
      s.status !== "playing" ||
      screen !== "game" ||
      busy ||
      document.hidden
    )
      return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now(),
        ms = now - last;
      last = now;
      if (!document.hidden) set((v) => applyAction(v, { type: "tick", ms }));
    }, 1000);
    return () => clearInterval(id);
  }, [s.status, screen, loaded, busy]);
  // A soft tick each second while a bonus is in its final three seconds.
  useEffect(() => {
    if (
      s.status === "playing" &&
      s.bonuses.some(
        (b) => b.remainingMs <= 3000 && b.remainingMs > 0 && isBonusRunning(s, b),
      )
    )
      play("tick");
  }, [s.elapsedMs]);
  useEffect(() => {
    if (s.status === "won" && loaded) {
      cue("win");
      setProfile((p) => complete(p, puzzle.id, s));
      if (online && s.shuffles === 0) {
        void request<{ score: number; verified: boolean }>(
          `runs/${online.runId}/complete`,
          { ticket: online.ticket, moves, score: s.moves * 100 },
        )
          .then(() => request("rewards/claim", { runId: online.runId }))
          .then(() =>
            setNotice("Online run verified. Server reward recorded once."),
          )
          .catch((e) => setNotice(String(e)));
      }
      db.outbox
        .put({
          id: `completion-${attemptId}`,
          type: "completion",
          payload: {
            puzzleId: puzzle.id,
            score: Math.min(7200, s.moves * 100),
            elapsedMs: s.elapsedMs,
            stars: Math.max(1, 3 - Math.min(2, s.hints + s.shuffles)),
            casual: true,
          },
        })
        .then(() => {
          if (userRef.current) syncProgress();
        })
        .catch(() => setSaveError(true));
    }
    if ((s.status === "stuck" || s.status === "lost") && loaded) cue("stuck");
  }, [s.status, puzzle.id, loaded]);
  useEffect(() => {
    updateSW.current = registerSW({
      onNeedRefresh() {
        setUpdateReady(true);
      },
      onOfflineReady() {
        setNotice((current) =>
          current === "Match two free tiles. Find your own rhythm."
            ? "Your garden is downloaded and ready for offline play."
            : current,
        );
      },
    });
    const prompt = (e: Event) => {
      e.preventDefault();
      setInstaller(e as InstallPrompt);
    };
    const installed = () => setInstaller(null);
    const net = () => setOffline(!navigator.onLine);
    window.addEventListener("beforeinstallprompt", prompt);
    window.addEventListener("appinstalled", installed);
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    return () => {
      window.removeEventListener("beforeinstallprompt", prompt);
      window.removeEventListener("appinstalled", installed);
      window.removeEventListener("online", net);
      window.removeEventListener("offline", net);
    };
  }, []);
  // App-wide button feedback: a soft tick + light haptic on every tap.
  // Buttons that play their own cue opt out with data-sfx.
  useEffect(() => {
    const first = () => unlock();
    const click = (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest?.("button,summary");
      if (b && !b.closest("[data-sfx]") && !(b as HTMLButtonElement).disabled)
        play("tap");
    };
    document.addEventListener("pointerdown", first, { once: true });
    document.addEventListener("click", click, true);
    return () => {
      document.removeEventListener("pointerdown", first);
      document.removeEventListener("click", click, true);
    };
  }, []);
  useEffect(() => {
    if (screen === "game") return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector("dialog");
    const controls = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select,textarea,summary,[tabindex="0"]',
        ) ?? [],
      );
    controls()[0]?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      if (e.key === "Tab") {
        const list = controls(),
          first = list[0],
          last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus({ preventScroll: true });
    };
  }, [screen]);
  useEffect(() => {
    const online = () => {
      void db.meta
        .get("syncEnabled")
        .then((flag) => {
          if (flag?.value === true)
            return flushCompletions().then((items) =>
              setProfile((p) => mergeProgress(p, items)),
            );
        })
        .catch(() => {
          /* Local progress and outbox remain intact for retry. */
        });
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  function setMusic(volume: number) {
    setAmbient(volume);
    setSettings({ ...settings, music: volume });
  }
  const select = useCallback(
    (id: string) => {
      const state = current.current;
      if (
        !loaded ||
        busy ||
        animating ||
        screen !== "game" ||
        state.status !== "playing"
      )
        return;
      setHint(null);
      if (!isTileFree(state, id)) {
        play("blocked");
        setShake({ id, key: Date.now() });
        setNotice("This tile is covered or blocked on both sides.");
        return;
      }
      const next = pick(state, id);
      if (next === state) return;
      const partner = state.tray.find((t) => !next.tray.includes(t));
      const from = settings.reducedMotion ? null : locate.current?.(id);
      const cue: Cue | null = partner
        ? next.status === "won"
          ? null
          : next.lastAward?.labels.length
            ? "bonus"
            : "match"
        : null;
      const flies = !!from && (!!partner || next.tray.includes(id));
      if (flies) {
        const t = state.tiles.find((t) => t.id === id)!;
        setFlights((v) => [
          ...v,
          {
            key: performance.now(),
            id,
            face:
              facesRef.current[t.matchGroup] ??
              classicFace(t.matchGroup, t.suit),
            from: from!,
            target: id,
            partner: partner ?? null,
            cue,
          },
        ]);
        // Keep the twin in place and give the arriving tile the next free
        // slot beside it; both leave the tray once they have merged.
        if (partner)
          setHeld((v) => [
            ...v,
            { id: partner, index: state.tray.indexOf(partner), popping: false },
            { id, index: TRAY_SIZE, popping: false },
          ]);
      }
      current.current = next;
      set(next);
      if (partner) {
        setMoves((v) => [...v, [partner, id]]);
        if (!settings.reducedMotion) {
          setAnimating(true);
          setTimeout(() => setAnimating(false), 180);
        }
        // With a flight, sound and flash wait for the merge (see `merge`).
        if (!flies) {
          setTrayFlash(Date.now());
          if (cue) play(cue);
        } else play("select");
        setNotice(
          next.status === "won"
            ? "Beautifully done. Your garden is clear."
            : "A pair! The tray has room again.",
        );
      } else if (next.status === "lost") {
        setNotice("The tray is full. Undo a move or start again.");
      } else {
        play("select");
        setNotice(
          next.tray.length === TRAY_SIZE - 1
            ? "Careful: one slot left in the tray."
            : "Find its partner to clear them both.",
        );
      }
    },
    [loaded, busy, animating, screen, settings.reducedMotion],
  );
  const search = useCallback(
    (kind: "hint" | "shuffle") => {
      if (kind === "shuffle") setOnline(null);
      if (busy || s.status === "paused" || s.status === "won") return;
      setHint(null);
      // Tray-aware hints: finish a waiting pair first; with a partly filled
      // tray, point at a free pair on the board instead of a full solve.
      if (kind === "hint" && s.tray.length) {
        const pair = trayHint(s) ?? listLegalPairs(s)[0] ?? null;
        if (pair) {
          play("hint");
          setHint(pair);
          set((v) => applyAction(v, { type: "hint", pair }));
          setNotice(
            s.tray.includes(pair[0])
              ? "Tap the glowing tile to complete your tray pair."
              : "These two glowing tiles make a pair.",
          );
        } else {
          play("stuck");
          setNotice("No free pairs right now. Try Undo or Shuffle.");
        }
        return;
      }
      setBusy(true);
      const w = new Worker(
        new URL("./game/search.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = w;
      const timeout = setTimeout(() => {
        w.terminate();
        setBusy(false);
        setNotice("Search took too long. Undo or restart to continue.");
      }, 3000);
      w.onmessage = (e) => {
        clearTimeout(timeout);
        w.terminate();
        worker.current = null;
        setBusy(false);
        if (e.data.error) {
          setNotice(e.data.error);
          return;
        }
        if (kind === "shuffle") {
          const next = e.data.state as State;
          set(next);
          if (next.shuffles > s.shuffles) play("shuffle");
          setNotice(
            next.shuffles > s.shuffles
              ? "A solvable fresh arrangement."
              : "Could not verify a shuffle. Try undo or restart.",
          );
        } else if (
          e.data.result.status === "solved" &&
          e.data.result.solution[0]
        ) {
          const pair = e.data.result.solution[0] as [string, string];
          play("hint");
          setHint(pair);
          set((v) => applyAction(v, { type: "hint", pair }));
          setNotice(
            `Match the highlighted tile with its free partner: ${s.tiles.find((t) => t.id === pair[0])!.matchGroup}.`,
          );
        } else {
          play("stuck");
          setNotice(
            e.data.result.status === "unsolved"
              ? "No winning continuation. Undo or shuffle."
              : "No winning continuation established within the hint budget.",
          );
        }
      };
      w.onerror = () => {
        clearTimeout(timeout);
        w.terminate();
        setBusy(false);
        setNotice("Search unavailable. You can still play, undo, or restart.");
      };
      w.postMessage({
        kind,
        state: s,
        seed: `${puzzle.seed}-shuffle-${s.shuffles}`,
      });
    },
    [busy, s, puzzle.seed],
  );
  const start = (p: Puzzle) => {
    setAttemptId(crypto.randomUUID());
    setOnline(null);
    setMoves([]);
    setHint(null);
    worker.current?.terminate();
    setBusy(false);
    clearFlights();
    setPuzzle(p);
    set(
      dealBoard(
        p,
        levels.find((l) => l.puzzle.id === p.id)?.number ?? null,
        settings,
      ),
    );
    setScreen("game");
    setNotice("A fresh garden. Take your time.");
  };
  const doUndo = () => {
    setOnline(null);
    setHint(null);
    play("undo");
    clearFlights();
    set((v) => undo(v));
  };
  const togglePause = () => {
    play("tap");
    set((v) =>
      applyAction(v, { type: v.status === "paused" ? "resume" : "pause" }),
    );
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        screen !== "game" ||
        busy ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      const key = e.key.toLowerCase();
      if (key === "h") {
        e.preventDefault();
        search("hint");
      }
      if (key === "u") {
        e.preventDefault();
        doUndo();
      }
      if (key === "p" || key === "escape") {
        e.preventDefault();
        togglePause();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [screen, busy, search]);
  const change = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings({ ...settings, [key]: value });
  const level = levels.find((l) => l.puzzle.id === puzzle.id),
    seconds = Math.floor(s.elapsedMs / 1000),
    stars = profile.completed[puzzle.id]?.stars ?? 0,
    left = s.tiles.filter((t) => !t.removed).length + s.tray.length,
    progress = 1 - left / s.tiles.length;
  // Faces follow each group's category tag, so a restored save redraws exactly.
  const tagKey = s.tiles.map((t) => t.tag ?? "").join(),
    faces = useMemo(
      () =>
        facesFor(s.tiles, puzzle.id, level?.number ?? null, settings.progression),
      [puzzle.id, level, settings.progression, tagKey],
    ),
    newPacks =
      level && s.status === "won" && settings.progression
        ? packsUnlockedBy(level.number)
        : [],
    runningBonuses = s.bonuses
      .filter((b) => s.status === "playing" && isBonusRunning(s, b))
      .sort((a, b) => a.remainingMs - b.remainingMs),
    combo = s.combo,
    clearedUpTo = Math.max(
      0,
      ...levels
        .filter((l) => l.puzzle.id in profile.completed)
        .map((l) => l.number),
    ),
    rushName = (tag: string) =>
      tag === "programming"
        ? "Code Rush"
        : tag === "animal"
          ? "Animal Rush"
          : "Bamboo Rush";
  function open(next: Screen) {
    play("open");
    setScreen(next);
  }
  function close() {
    play("close");
    setScreen("game");
    void db.meta
      .put({ id: "tutorial", value: true })
      .catch(() => setSaveError(true));
  }
  async function erase() {
    if (
      !confirm("Delete all local progress and settings? This cannot be undone.")
    )
      return;
    await db.delete();
    location.reload();
  }
  async function install() {
    if (!installer) return;
    await installer.prompt();
    setInstaller(null);
  }
  function exportData() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              version: 2,
              profile,
              settings,
              save: { puzzleId: puzzle.id, state: s },
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "zen-tiles-export.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  facesRef.current = faces;
  if (!loaded)
    return (
      <main className="splash" role="status">
        <img src="/icons/icon.svg" alt="" width="84" height="84" />
        <span>Preparing your garden…</span>
      </main>
    );
  const tabs: [Screen | "daily", IconName, string][] = [
    ["game", "play", text.play],
    ["campaign", "grid", text.campaign],
    ["daily", "calendar", text.dailyShort],
    ["leaderboards", "trophy", text.ranks],
    ["profile", "user", text.profile],
  ];
  const activeTab =
    screen === "game" || screen === "welcome"
      ? puzzle.id.startsWith("daily-")
        ? "daily"
        : "game"
      : screen === "account" || screen === "shop"
        ? "profile"
        : screen;
  const titles: Partial<Record<Screen, string>> = {
    help: text.how,
    privacy: "Privacy & data",
    leaderboards: "Verified online leaderboard",
    account: user ? "Your account" : "Sign in",
    admin: "Admin dashboard",
    campaign: text.campaign,
    profile: text.profile,
    shop: text.shop,
    settings: text.settings,
  };
  const welcome = screen === "welcome";
  const sheet = screen !== "game" && !welcome;
  return (
    <div className="app">
      <header className="topbar">
        <button
          className="level-title"
          onClick={() => open("campaign")}
          aria-label="Choose level"
        >
          <span className="eyebrow">
            {puzzle.id.startsWith("daily-")
              ? "DAILY · UTC"
              : `LEVEL ${level?.number ?? 1}`}
            <span>•</span>
            {puzzle.difficulty.toUpperCase()}
          </span>
          <h1>{level?.name ?? "Daily garden"}</h1>
        </button>
        <div className="top-actions">
          {offline && (
            <span className="chip offline" title="Offline — local play">
              <Icon name="wifiOff" size={14} />
            </span>
          )}
          {installer && (
            <button
              className="icon-btn accent"
              onClick={() => void install()}
              aria-label="Install app"
            >
              <Icon name="download" size={20} />
            </button>
          )}
          <button
            className="icon-btn"
            data-sfx
            disabled={busy || s.status === "won" || s.status === "stuck"}
            onClick={togglePause}
            aria-label={s.status === "paused" ? text.resume : text.pause}
          >
            <Icon name={s.status === "paused" ? "play" : "pause"} size={20} />
          </button>
          <button
            className="icon-btn"
            onClick={() => open("help")}
            aria-label={text.how}
          >
            <Icon name="help" size={20} />
          </button>
          <button
            className="icon-btn"
            onClick={() => open("settings")}
            aria-label={text.settings}
          >
            <Icon name="gear" size={20} />
          </button>
        </div>
      </header>
      <main className="stage">
        <div className="play">
        <div className="metrics">
          <div className="metric">
            <span className="mini">TILES LEFT</span>
            <strong>
              {left}
              <small> / {s.tiles.length}</small>
            </strong>
          </div>
          <div className="metric">
            <span className="mini">SCORE</span>
            <strong key={s.score} className="bump">
              {s.score.toLocaleString()}
            </strong>
          </div>
          <div className={`metric ${combo >= 2 ? "hot" : ""}`}>
            <span className="mini">COMBO</span>
            <strong key={combo} className={combo >= 2 ? "bump" : ""}>
              {combo >= 2 ? `×${combo}` : "–"}
            </strong>
          </div>
          {settings.timer && (
            <div className="metric">
              <span className="mini">TIME</span>
              <strong>
                {Math.floor(seconds / 60)}:
                {String(seconds % 60).padStart(2, "0")}
              </strong>
            </div>
          )}
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-label="Board cleared"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        {(s.rush || runningBonuses.length > 0) && s.status === "playing" && (
          <div className="live-strip" aria-live="polite">
            {s.rush && (
              <span className="chip rush">
                ⚡ {rushName(s.rush.tag)} {s.rush.multiplier}× ·{" "}
                {Math.ceil(s.rush.remainingMs / 1000)}s
              </span>
            )}
            {runningBonuses.slice(0, 3).map((b) => (
              <span
                key={b.id}
                className={`chip bonus ${b.remainingMs <= 3000 ? "warn" : ""}`}
              >
                ★{" "}
                {b.kind === "golden"
                  ? "Golden"
                  : b.kind === "combo"
                    ? "Combo"
                    : `${b.multiplier}×`}{" "}
                · {Math.ceil(b.remainingMs / 1000)}s
              </span>
            ))}
          </div>
        )}
        <div
          className={`tray ${trayFlash ? "flash" : ""} ${s.tray.length >= TRAY_SIZE - 1 ? "danger" : ""}`}
          aria-label={`Tray: ${s.tray.length} of ${TRAY_SIZE} slots used`}
        >
          {Array.from({ length: TRAY_SIZE }, (_, i) => {
            // Partners already cleared by the engine stay in place until
            // the flying tile reaches them.
            const shown = [...s.tray];
            for (const h of [...held].sort((a, b) => a.index - b.index))
              if (!shown.includes(h.id))
                shown.splice(Math.min(h.index, shown.length), 0, h.id);
            const id = shown[i],
              tile = id ? s.tiles.find((t) => t.id === id) : undefined,
              awaiting = flights.some((f) => f.target === id),
              popping = held.some((h) => h.id === id && h.popping);
            return (
              <span
                key={id ?? `empty-${i}`}
                data-id={id}
                className={`slot ${tile ? "filled" : ""} ${awaiting ? "awaiting" : landed.includes(id) ? "landed" : ""} ${popping ? "popping" : ""} ${id && hint?.includes(id) ? "hinted" : ""}`}
              >
                {tile && (
                  <TileCanvas
                    width={TRAY_TILE}
                    badge={
                      tile.bonusId &&
                      s.bonuses.some(
                        (b) => b.id === tile.bonusId && b.status === "live",
                      )
                        ? "★"
                        : undefined
                    }
                    face={
                      faces[tile.matchGroup] ?? classicFace(tile.matchGroup, tile.suit)
                    }
                  />
                )}
              </span>
            );
          })}
        </div>
        <section className="table" aria-busy={busy}>
          {s.status !== "paused" ? (
            <Suspense fallback={<div className="board-loading" />}>
              <Board
                state={s}
                onSelect={select}
                large={settings.large}
                faces={faces}
                reducedMotion={settings.reducedMotion}
                introKey={`${attemptId}-${s.shuffles}`}
                hint={hint}
                shake={shake}
                locate={locate}
                flying={flights.map((f) => f.id)}
              />
            </Suspense>
          ) : (
            <div className="paused">
              <div className="breath" aria-hidden="true" />
              <h2>A quiet pause.</h2>
              <button
                className="primary"
                data-sfx
                onClick={togglePause}
              >
                Return to the garden
              </button>
            </div>
          )}
          {s.status === "won" && (
            <div className="outcome">
              <div className="confetti" aria-hidden="true">
                {Array.from({ length: 18 }, (_, i) => (
                  <i key={i} style={{ "--i": i } as CSSProperties} />
                ))}
              </div>
              <div className="outcome-card">
                <h2>Garden complete</h2>
                <div className="stars" aria-label={`${stars} of 3 stars`}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} className={i < stars ? "on" : ""}>
                      <Icon name="star" size={34} fill />
                    </span>
                  ))}
                </div>
                <p>
                  {s.moves} pairs · {s.score.toLocaleString()} points · +25
                  garden coins on first completion
                </p>
                {level && level.number < 100 && (
                  <p className="unlock-chip">
                    <Icon name="star" size={14} fill /> Level{" "}
                    {level.number + 1} unlocked ·{" "}
                    {levels[level.number].puzzle.difficulty}
                  </p>
                )}
                {newPacks.map((pack) => (
                  <div key={pack.name} className="pack-unlock">
                    <strong>New tiles unlocked · {pack.name}</strong>
                    <span className="pack-faces">
                      {pack.faces.slice(0, 5).map((f, i) => (
                        <TileCanvas key={i} face={f} width={30} />
                      ))}
                    </span>
                  </div>
                ))}
                <div className="row">
                  <button onClick={() => start(puzzle)}>Play again</button>
                  {level && level.number < 100 && (
                    <button
                      className="primary"
                      onClick={() => start(levels[level.number].puzzle)}
                    >
                      {text.next}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {s.status === "lost" && (
            <div className="outcome">
              <div className="outcome-card lost">
                <h2>Tray full</h2>
                <p>Four different tiles filled the tray. Undo the last move or start the garden again.</p>
                <div className="row">
                  <button onClick={doUndo}>Undo</button>
                  <button className="primary" onClick={() => start(puzzle)}>
                    Try again
                  </button>
                </div>
              </div>
            </div>
          )}
          {s.status === "stuck" && (
            <p className="stuck" role="alert">
              No legal pairs remain. Undo, shuffle, or restart.
            </p>
          )}
        </section>
        <p className="notice" role="status">
          {busy ? "Finding a verified continuation…" : notice}
        </p>
        <div className="toolbar">
          <button
            data-sfx
            onClick={doUndo}
            disabled={!s.history.length || busy || s.status === "paused"}
          >
            <span className="tool-icon">
              <Icon name="undo" />
            </span>
            {text.undo}
          </button>
          <button
            data-sfx
            onClick={() => search("hint")}
            disabled={busy || s.status !== "playing"}
          >
            <span className="tool-icon">
              <Icon name="bulb" />
              {s.hints > 0 && <small className="badge">{s.hints}</small>}
            </span>
            {text.hint}
          </button>
          <button
            data-sfx
            onClick={() => search("shuffle")}
            disabled={busy || s.status === "won" || s.status === "paused"}
          >
            <span className="tool-icon">
              <Icon name="shuffle" />
            </span>
            {text.shuffle}
          </button>
          <button onClick={() => start(puzzle)} disabled={busy}>
            <span className="tool-icon">
              <Icon name="restart" />
            </span>
            {text.restart}
          </button>
        </div>
        </div>
        <details open={settings.large} className="a11y">
          <summary>Accessible tile controls</summary>
          <p>
            Use Tab and Enter. H: hint · U: undo · P: pause. {s.moves} pairs
            matched.
          </p>
          <div className="accessible">
            {s.status !== "paused" &&
              s.tiles
                .filter((t) => !t.removed)
                .map((t) => (
                  <button
                    key={t.id}
                    data-sfx
                    disabled={
                      !isTileFree(s, t.id) ||
                      s.status !== "playing" ||
                      busy ||
                      animating ||
                      screen !== "game"
                    }
                    aria-pressed={s.selected === t.id}
                    onClick={() => select(t.id)}
                  >
                    {t.suit} {t.rank} · {t.id} · layer {t.z + 1}
                  </button>
                ))}
          </div>
        </details>
        {saveError && (
          <p className="banner warn" role="alert">
            Storage is unavailable. You can play, but progress may not survive a
            reload.
          </p>
        )}
      </main>
      <nav className="tabbar" aria-label="Main navigation">
        {tabs.map(([key, icon, label]) => (
          <button
            key={key}
            className={activeTab === key ? "active" : ""}
            aria-current={activeTab === key ? "page" : undefined}
            onClick={() => {
              if (key === "daily") {
                play("open");
                start(daily());
              } else if (key === "game") {
                // From the daily puzzle, Play returns to the campaign.
                if (puzzle.id.startsWith("daily-"))
                  start(levels[Math.min(clearedUpTo, levels.length - 1)].puzzle);
                else setScreen("game");
              }
              else open(key);
            }}
          >
            <Icon name={icon} size={22} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {flights.map((f) => (
        <FlyingTile key={f.key} flight={f} onLand={land} />
      ))}
      {updateReady && (
        <div className="toast">
          <span>A new version is ready.</span>
          <button
            className="primary"
            onClick={() => void updateSW.current?.(true)}
          >
            Update
          </button>
          <button
            className="icon-btn"
            aria-label="Dismiss update"
            onClick={() => setUpdateReady(false)}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      {welcome && (
        <div className="modal-backdrop welcome-backdrop">
          <dialog
            open
            aria-modal="true"
            aria-labelledby="dialog-title"
            className="welcome"
          >
            <img
              className="welcome-logo"
              src="/icons/icon.svg"
              alt=""
              width="96"
              height="96"
            />
            <p className="eyebrow">A LITTLE ROOM FOR CALM</p>
            <h2 id="dialog-title">{text.title}</h2>
            <p className="lede">{text.intro}</p>
            <ol className="steps">
              <li>
                <b>1</b> Tap a free tile — it jumps into your tray.
              </li>
              <li>
                <b>2</b> Tap its twin and both vanish. A tile is free when a side
                is open and nothing covers it.
              </li>
              <li>
                <b>3</b> Four different tiles fill the tray — game over. Plan ahead!
              </li>
            </ol>
            <button className="primary block big" onClick={close}>
              Start playing
            </button>
            <div className="row">
              <button className="block" onClick={() => open("account")}>
                Sign in
              </button>
              <button className="block ghost" onClick={() => open("help")}>
                {text.how}
              </button>
            </div>
            <small className="hint-text">
              No account needed — progress is saved on this device.
            </small>
          </dialog>
        </div>
      )}
      {sheet && (
        <div
          className="modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          <dialog
            open
            aria-modal="true"
            aria-labelledby="dialog-title"
            className="sheet"
          >
            <div className="grabber" aria-hidden="true" />
            <div className="sheet-head">
              <h2 id="dialog-title">{titles[screen]}</h2>
              <button
                className="icon-btn close"
                data-sfx
                onClick={close}
                aria-label="Close dialog"
              >
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="sheet-body">
              {screen === "leaderboards" && (
                <Suspense fallback={<div className="spinner center" />}>
                  <Leaderboard
                    signedIn={!!user}
                    onSignIn={() => setScreen("account")}
                  />
                </Suspense>
              )}
              {screen === "account" && (
                <Suspense fallback={<div className="spinner center" />}>
                  <Account
                    profile={profile}
                    user={user}
                    onUser={setUser}
                    onMerge={setProfile}
                    onAdmin={() => setScreen("admin")}
                    onOnline={() => {
                      void api
                        .run(puzzle.id)
                        .then((ticket) => {
                          start(puzzle);
                          setOnline(ticket);
                          setNotice(
                            "Online run started. Undo, shuffle, reload, or a service failure keeps results casual.",
                          );
                        })
                        .catch((e) => setNotice(String(e)));
                    }}
                  />
                </Suspense>
              )}
              {screen === "admin" && (
                <Suspense fallback={<div className="spinner center" />}>
                  <Admin />
                </Suspense>
              )}
              {screen === "help" && (
                <>
                  <p>
                    Tap a free tile to move it into the tray above the board.
                    When its twin joins the tray, both disappear. If the
                    tray fills with four tiles that do not pair, the garden
                    is lost — undo a move or try again. Any flower matches
                    another flower; any season matches another season. New
                    tile packs unlock as you clear levels.
                  </p>
                  <p>
                    A tile is free when nothing covers it and its left or right
                    edge is open. Darkened tiles are blocked. Hint searches for
                    a winning continuation; shuffle verifies a new arrangement.
                    Both are always free.
                  </p>
                  <p>
                    Undo restores the exact prior board and score. Play time
                    never rewinds. Hints and shuffles lower your star rating,
                    not your ability to finish. Daily challenges use UTC dates.
                  </p>
                  <button className="primary block" onClick={close}>
                    Start playing
                  </button>
                </>
              )}
              {screen === "campaign" && (
                <>
                  <p className="muted">
                    100 gardens, each harder than the last. Clear a garden to
                    open the next · {Object.keys(profile.completed).length}{" "}
                    completed.
                  </p>
                  {(["gentle", "balanced", "challenging"] as const).map(
                    (band) => (
                      <section key={band} className="band">
                        <h3>{band}</h3>
                        <div className="levels">
                          {levels.map((l, index) => {
                            if (l.puzzle.difficulty !== band) return null;
                            const got =
                                profile.completed[l.puzzle.id]?.stars ?? 0,
                              open =
                                !settings.progression ||
                                unlocked(index, profile.completed);
                            return (
                              <button
                                key={l.number}
                                className={`${got ? "done" : ""} ${l.puzzle.id === puzzle.id ? "current" : ""} ${open ? "" : "locked"}`}
                                disabled={!open}
                                onClick={() => start(l.puzzle)}
                                aria-label={`Play level ${l.number}${open ? "" : " (locked)"}`}
                              >
                                <strong>{open ? l.number : "🔒"}</strong>
                                <span>{l.name}</span>
                                <small>
                                  {l.puzzle.tiles.length} tiles ·{" "}
                                  {[0, 1, 2].map((i) => (
                                    <i key={i} className={i < got ? "on" : ""}>
                                      ★
                                    </i>
                                  ))}
                                </small>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    ),
                  )}
                </>
              )}
              {screen === "profile" && (
                <>
                  <button
                    className="account-card as-button"
                    onClick={() => setScreen("account")}
                  >
                    <div className="avatar" aria-hidden="true">
                      {(user?.display_name ?? profile.name)
                        .slice(0, 1)
                        .toUpperCase()}
                    </div>
                    <div>
                      <strong>{user ? user.display_name : "Guest"}</strong>
                      <small>
                        {user
                          ? "Signed in · manage account"
                          : "Sign in or create an account to sync"}
                      </small>
                    </div>
                    <span className="chev" aria-hidden="true">
                      ›
                    </span>
                  </button>
                  <label className="field">
                    <span>Display name</span>
                    <input
                      maxLength={40}
                      value={profile.name}
                      onChange={(e) =>
                        setProfile({ ...profile, name: e.target.value })
                      }
                    />
                  </label>
                  <div className="stats">
                    <div>
                      <strong>{Object.keys(profile.completed).length}</strong>
                      <span>gardens completed</span>
                    </div>
                    <div>
                      <strong>{streak(profile.dailyDates)}</strong>
                      <span>day streak</span>
                    </div>
                    <div>
                      <span>
                        <strong>{balance(profile)}</strong> garden coins
                      </span>
                    </div>
                  </div>
                  <button
                    className="block"
                    onClick={() => setScreen("shop")}
                  >
                    <Icon name="palette" size={18} /> {text.shop}
                  </button>
                  <h3>Tile collection</h3>
                  <p className="muted">
                    {totalTypes(settings.progression ? clearedUpTo + 1 : null)}{" "}
                    tile types unlocked. Each pack opens after its level.
                  </p>
                  <ul className="packs">
                    <li className="open">
                      <strong>Classic</strong>
                      <span className="pack-faces">
                        {(
                          [
                            ["bamboo:1", "bamboo"],
                            ["characters:1", "characters"],
                            ["dots:2", "dots"],
                            ["winds:1", "winds"],
                            ["dragons:1", "dragons"],
                            ["flowers", "flowers"],
                          ] as const
                        ).map(([group, suit]) => (
                          <TileCanvas
                            key={group}
                            face={classicFace(group, suit)}
                            width={26}
                          />
                        ))}
                      </span>
                      <small>36 tiles · from the start</small>
                    </li>
                    {packs.map((p) => {
                      const open =
                        !settings.progression || clearedUpTo >= p.after;
                      return (
                        <li key={p.name} className={open ? "open" : ""}>
                          <strong>{p.name}</strong>
                          <span className="pack-faces">
                            {open
                              ? p.faces
                                  .slice(0, 6)
                                  .map((f, i) => (
                                    <TileCanvas key={i} face={f} width={26} />
                                  ))
                              : "🔒"}
                          </span>
                          <small>
                            {p.faces.length}{" "}
                            {p.category === "programming"
                              ? "logos"
                              : "animals"}{" "}
                            · after level {p.after}
                          </small>
                        </li>
                      );
                    })}
                  </ul>
                  <h3>Achievements</h3>
                  <ul className="achievements">
                    {(
                      [
                        [
                          Object.keys(profile.completed).length >= 1,
                          "First bloom",
                          "Finish one garden",
                        ],
                        [
                          Object.keys(profile.completed).length >= 10,
                          "Gardener",
                          "Finish ten gardens",
                        ],
                        [
                          profile.dailyDates.length >= 1,
                          "A daily moment",
                          "Complete a daily challenge",
                        ],
                        [
                          Object.values(profile.completed).some(
                            (c) => c.stars === 3,
                          ),
                          "Clear mind",
                          "Finish without hints or shuffles",
                        ],
                      ] as const
                    ).map(([done, name, desc]) => (
                      <li key={name} className={done ? "done" : ""}>
                        <span className="medal" aria-hidden="true">
                          {done ? "✓" : "○"}
                        </span>
                        <div>
                          <strong>{name}</strong>
                          <small>{desc}</small>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <h3>Personal history · casual / unverified</h3>
                  <p className="muted">
                    These local results are not competitive leaderboard
                    entries.
                  </p>
                  <ul className="history">
                    {Object.entries(profile.completed)
                      .slice(-20)
                      .reverse()
                      .map(([id, c]) => (
                        <li key={id}>
                          <span>{id}</span>
                          <span>
                            {c.score} pts · {"★".repeat(c.stars)}
                          </span>
                        </li>
                      ))}
                  </ul>
                </>
              )}
              {screen === "shop" && (
                <>
                  <p className="muted">
                    Cosmetics only. No ads or payments required. Balance:{" "}
                    {balance(profile)} garden coins.
                  </p>
                  <div className="themes">
                    {themeNames.map((theme) => {
                      const owned =
                        theme === "jade" || profile.purchases.includes(theme);
                      return (
                        <button
                          key={theme}
                          className={`theme-card t-${theme} ${settings.theme === theme ? "active" : ""}`}
                          disabled={!owned && balance(profile) < 100}
                          onClick={() => {
                            if (!owned)
                              setProfile({
                                ...profile,
                                purchases: [...profile.purchases, theme],
                              });
                            change("theme", theme);
                          }}
                        >
                          <span className="swatch" aria-hidden="true" />
                          <strong>{theme}</strong>
                          <small>
                            {owned ? "Use theme" : "100 garden coins"}
                            {settings.theme === theme ? " ✓" : ""}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {screen === "settings" && (
                <div className="settings">
                  <h3>Sound & feel</h3>
                  <label className="field row-field">
                    <span>Sound effects</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={settings.sound}
                      onChange={(e) => change("sound", Number(e.target.value))}
                      onPointerUp={() => play("match")}
                    />
                  </label>
                  <label className="field row-field">
                    <span>Ambient tone</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={settings.music}
                      onChange={(e) => setMusic(Number(e.target.value))}
                    />
                  </label>
                  <label className="switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={settings.haptics}
                      onChange={(e) => {
                        change("haptics", e.target.checked);
                        if (e.target.checked) navigator.vibrate?.(20);
                      }}
                    />
                    <span>Vibration</span>
                  </label>
                  <h3>Bonus & scoring</h3>
                  <p className="muted">
                    Applies from the next board you start.
                  </p>
                  <label className="field row-field">
                    <span>
                      Bonus tiles · {Math.round(settings.bonusFrequency * 100)}%
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="0.3"
                      step="0.05"
                      value={settings.bonusFrequency}
                      onChange={(e) =>
                        change("bonusFrequency", Number(e.target.value))
                      }
                    />
                  </label>
                  <label className="field row-field">
                    <span>Bonus timer · {settings.bonusSeconds}s</span>
                    <input
                      type="range"
                      min="8"
                      max="30"
                      step="1"
                      value={settings.bonusSeconds}
                      onChange={(e) =>
                        change("bonusSeconds", Number(e.target.value))
                      }
                    />
                  </label>
                  <label className="field row-field">
                    <span>Multipliers</span>
                    <select
                      value={settings.multipliers}
                      onChange={(e) =>
                        change(
                          "multipliers",
                          e.target.value as Settings["multipliers"],
                        )
                      }
                    >
                      <option value="gentle">Gentle · 2× 3×</option>
                      <option value="standard">Standard · 2× 3× 5×</option>
                      <option value="big">Big · 3× 5× 10×</option>
                    </select>
                  </label>
                  <label className="field row-field">
                    <span>
                      Programming tiles ·{" "}
                      {Math.round(settings.programmingShare * 100)}%
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="0.4"
                      step="0.05"
                      value={settings.programmingShare}
                      onChange={(e) =>
                        change("programmingShare", Number(e.target.value))
                      }
                    />
                  </label>
                  <label className="field row-field">
                    <span>
                      Animal tiles · {Math.round(settings.animalShare * 100)}%
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="0.4"
                      step="0.05"
                      value={settings.animalShare}
                      onChange={(e) =>
                        change("animalShare", Number(e.target.value))
                      }
                    />
                  </label>
                  <label className="switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={settings.comboRewards}
                      onChange={(e) => change("comboRewards", e.target.checked)}
                    />
                    <span>Combo rewards</span>
                  </label>
                  <label className="switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={settings.progression}
                      onChange={(e) => change("progression", e.target.checked)}
                    />
                    <span>Unlock levels and tiles step by step</span>
                  </label>
                  <h3>Gameplay & accessibility</h3>
                  {(
                    ["timer", "large", "contrast", "reducedMotion"] as const
                  ).map((key, i) => (
                    <label key={key} className="switch">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={settings[key]}
                        onChange={(e) => change(key, e.target.checked)}
                      />
                      <span>
                        {
                          [
                            "Show timer",
                            "Large tile controls",
                            "High contrast",
                            "Reduce motion",
                          ][i]
                        }
                      </span>
                    </label>
                  ))}
                  <label className="field row-field">
                    <span>Language</span>
                    <select
                      value={settings.locale}
                      onChange={(e) =>
                        change("locale", e.target.value as "en" | "hi")
                      }
                    >
                      <option value="en">English</option>
                      <option value="hi">हिन्दी</option>
                    </select>
                  </label>
                  <h3>App</h3>
                  {installer ? (
                    <button
                      className="primary block"
                      onClick={() => void install()}
                    >
                      <Icon name="download" size={18} /> Install app
                    </button>
                  ) : (
                    !standalone &&
                    isIos && (
                      <p className="muted">
                        To install on iPhone or iPad, tap Share, then “Add to
                        Home Screen”.
                      </p>
                    )
                  )}
                  <button className="block" onClick={exportData}>
                    Export my data
                  </button>
                  <button
                    className="block"
                    onClick={() => setScreen("privacy")}
                  >
                    Privacy & data
                  </button>
                  <button
                    className="block danger-button"
                    onClick={() => void erase()}
                  >
                    Delete local data
                  </button>
                </div>
              )}
              {screen === "privacy" && (
                <>
                  <p>
                    Game progress and settings stay in this browser's
                    IndexedDB. No analytics, ads, or purchases are active.
                    Online services are not contacted by gameplay. Hosting
                    providers may keep access logs under their own policies.
                  </p>
                  <p>
                    Export or erase your local data in Settings. Clearing
                    browser storage also removes progress. No personal account
                    is required. A region-specific legal review is required
                    before a commercial launch.
                  </p>
                  <button
                    className="block"
                    onClick={() => setScreen("settings")}
                  >
                    Back to settings
                  </button>
                </>
              )}
            </div>
          </dialog>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
