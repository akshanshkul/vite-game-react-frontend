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
  trayCap,
  isBonusRunning,
  undo,
  applyAction,
  type State,
  type Puzzle,
  type Pair,
} from "../packages/engine/src/index";
import {
  levels,
  daily,
  isUnlocked,
  levelNumberOf,
  levelName,
  isEndless,
  highestCleared,
  endlessCleared,
  endlessUnlockedUpTo,
  nextBatchIn,
  nextPlayable,
  chapterOf,
  chapterTheme,
  customTileSlots,
  nextCustomSlotAt,
  CAMPAIGN_SIZE,
  ENDLESS_BATCH,
} from "./services/content";
import {
  LOGIN_REWARDS,
  canClaimLogin,
  claimLogin,
  claimMission,
  hasClaimable,
  localDay,
  loginDayFor,
  missionDone,
  missionsFor,
  recordPair,
  recordWin,
  todayStats,
  type Reward,
} from "./services/daily";
import {
  CHEST_REWARDS,
  POWER_UPS,
  STARS_PER_CHEST,
  addStars,
  openChest,
  powerUps,
  rewardLabel,
  spendPowerUp,
  starsGained,
  type PowerUp,
} from "./services/chests";
import { ledgerChanges } from "./services/ledger";
import {
  EVENT_BOARDS,
  awardBadge,
  daysUntilFestival,
  eventBoardOpen,
  eventCleared,
  eventPuzzle,
  eventPuzzleId,
  packForWeek,
  parseEventId,
  weekendEvent,
} from "./services/weekend";
import { ensureOpening, queueLedger, syncState } from "./services/stateSync";
import {
  earnUndos,
  migrateUndos,
  spendUndo,
  MAX_UNDOS,
} from "./services/undos";
import {
  customFace,
  loadCustomTiles,
  photoToDataUrl,
  saveCustomTiles,
  validEmoji,
  type CustomTile,
} from "./services/customTiles";
import {
  db,
  validState,
  complete,
  balance,
  buyTheme,
  themePrices,
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
import { isPhotoReady, paintTile, preloadPhoto } from "./game/TileRenderer";
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
  /** Combo after this pair, so the merge sound climbs with the streak. */
  streak: number;
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
const endlessCache = new Map<number, Promise<Puzzle>>();
/** Generates (once) and returns endless level `n`, off the UI thread. */
function endlessPuzzle(n: number): Promise<Puzzle> {
  let job = endlessCache.get(n);
  if (!job) {
    job = new Promise<Puzzle>((resolve, reject) => {
      const w = new Worker(new URL("./game/endless.worker.ts", import.meta.url), {
          type: "module",
        }),
        stop = (fn: () => void) => {
          clearTimeout(timer);
          w.terminate();
          fn();
        },
        timer = setTimeout(
          () => stop(() => reject(Error("Growing this garden took too long."))),
          30000,
        );
      w.onmessage = (e) =>
        stop(() =>
          e.data.puzzle ? resolve(e.data.puzzle) : reject(Error(e.data.error)),
        );
      w.onerror = () =>
        stop(() => reject(Error("The level generator is unavailable.")));
      w.postMessage({ n });
    });
    job.catch(() => endlessCache.delete(n));
    endlessCache.set(n, job);
  }
  return job;
}
const ENDLESS_PAGE = 30;
const formatTime = (ms: number) => {
  const sec = Math.floor(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};
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
  | "leaderboards"
  | "today";
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
    pad = Math.ceil(width * 0.12),
    [photoTick, setPhotoTick] = useState(0);
  // A photo tile still loading repaints once its picture arrives.
  useEffect(() => {
    if (face.kind !== "photo" || isPhotoReady(face.id)) return;
    const ready = () => setPhotoTick((t) => t + 1);
    window.addEventListener("tile-photo-ready", ready);
    return () => window.removeEventListener("tile-photo-ready", ready);
  }, [face]);
  useEffect(() => {
    const canvas = ref.current!,
      dpr = Math.min(devicePixelRatio || 1, 3),
      ctx = canvas.getContext("2d")!;
    canvas.width = Math.ceil((width + pad * 2) * dpr);
    canvas.height = Math.ceil((height + pad * 2) * dpr);
    ctx.scale(dpr, dpr);
    paintTile(ctx, face, "free", width, height, pad, badge);
  }, [face, width, height, pad, badge, photoTick]);
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
      dealBoard(levels[0].puzzle, 1),
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
  const [customTiles, setCustomTiles] = useState<CustomTile[]>([]);
  const [tileError, setTileError] = useState("");
  const [emojiDraft, setEmojiDraft] = useState("");
  /** First level shown in the endless grid page; null = page with next level. */
  const [endlessPage, setEndlessPage] = useState<number | null>(null);
  /** Endless level being generated, shown over the board meanwhile. */
  const [growing, setGrowing] = useState<number | null>(null);
  const userRef = useRef(user);
  userRef.current = user;
  /** Live profile for handlers that outlive a render (keyboard, win effect). */
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const showProfile = (next: Profile) => {
    profileRef.current = next;
    setProfile(next);
  };
  /**
   * The one way to change the profile: any change in coins or undos also goes
   * into the ledger outbox (with its reason) so it follows the account.
   */
  const commit = (next: Profile, reason: string) => {
    const events = ledgerChanges(profileRef.current, next, reason, () =>
      crypto.randomUUID(),
    );
    showProfile(next);
    void queueLedger(events).catch(() => setSaveError(true));
  };
  /**
   * Sends finished levels (for rankings) and the coins/undos/themes/claims
   * ledger to the account, then shows the account's totals.
   */
  const syncProgress = useCallback(() => {
    void db.meta
      .put({ id: "syncEnabled", value: true })
      .then(() => flushCompletions())
      .then((items) => {
        showProfile(mergeProgress(profileRef.current, items));
        return syncState(profileRef.current);
      })
      .then((apply) => showProfile(apply(profileRef.current)))
      .catch(() => {
        /* Offline: both outboxes keep their entries and retry on reconnect. */
      });
  }, []);
  // Signing in also sends wins earned while playing as a guest.
  useEffect(() => {
    if (user) syncProgress();
  }, [user, syncProgress]);
  const [hint, setHint] = useState<Pair | null>(null);
  const [trayFlash, setTrayFlash] = useState(0);
  /** Undo used during this attempt (a perfect clear needs none). */
  const usedUndo = useRef(false);
  /** Facts for the level-complete card, captured at the moment of winning. */
  const [winStats, setWinStats] = useState<{
    time: number;
    bestBefore: number | null;
    scoreBefore: number | null;
    maxCombo: number;
    perfect: boolean;
    /** Stars this clear added toward the next chest. */
    newStars: number;
  } | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  /** Tray tiles already cleared by the engine but kept on screen until the
   *  flying partner reaches them. */
  const [held, setHeld] = useState<
    { id: string; index: number; popping: boolean }[]
  >([]);
  /** Pairs mid-merge: the arrived tile slides into its twin, then both pop. */
  const merge = useCallback(
    (id: string, partner: string, cue: Cue | null, streak = 0) => {
    const mine = document.querySelector<HTMLElement>(`.slot[data-id="${id}"]`),
      twin = document.querySelector<HTMLElement>(`.slot[data-id="${partner}"]`),
      pop = () => {
        if (cue) play(cue, streak);
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
    },
    [],
  );
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
        setTimeout(() => merge(f.id, partner, f.cue, f.streak), 140);
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
      loadCustomTiles()
        .then((tiles) => {
          // Photos load in the background; boards redraw when they arrive.
          for (const t of tiles)
            if (t.kind === "photo") preloadPhoto(t.id, t.value).catch(() => {});
          return tiles;
        })
        .catch(() => [] as CustomTile[]),
    ])
      .then(async ([saved, p, config, tutorial, signedIn, mine]) => {
        if (!active) return;
        setCustomTiles(mine);
        const restored =
          p?.value && typeof p.value === "object"
            ? migrateUndos({
                ...defaultProfile,
                ...p.value,
                undos: (p.value as Partial<Profile>).undos as number,
                undoMilestones: (p.value as Partial<Profile>)
                  .undoMilestones as number,
              })
            : defaultProfile;
        if (restored !== defaultProfile) setProfile(restored);
        // What this device held before coins/undos synced counts once.
        await ensureOpening(restored);
        if (config?.value && typeof config.value === "object")
          setSettings({
            ...settings,
            ...Object.fromEntries(
              Object.entries(config.value).filter(([k]) => k in settings),
            ),
          });
        if (saved) {
          let candidate: Puzzle | undefined;
          try {
            const n =
              typeof saved.puzzleId === "string"
                ? levelNumberOf(saved.puzzleId)
                : null;
            candidate =
              n !== null && isEndless(n)
                ? await endlessPuzzle(n)
                : typeof saved.puzzleId === "string" && parseEventId(saved.puzzleId)
                  ? eventPuzzle(
                      parseEventId(saved.puzzleId)!.key,
                      parseEventId(saved.puzzleId)!.board,
                    )
                  : (levels.find((l) => l.puzzle.id === saved.puzzleId)?.puzzle ??
                  (typeof saved.puzzleId === "string" &&
                  /^daily-\d{4}-\d{2}-\d{2}$/.test(saved.puzzleId)
                    ? daily(saved.puzzleId.slice(6))
                    : undefined));
          } catch {
            /* Preserve unknown daily versions and failed generations. */
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
      const before = profileRef.current.completed[puzzle.id],
        perfect = !usedUndo.current && s.hints === 0 && s.shuffles === 0;
      setWinStats({
        time: s.elapsedMs,
        bestBefore: before?.time ?? null,
        scoreBefore: before?.score ?? null,
        maxCombo: s.maxCombo ?? 0,
        perfect,
        newStars: 0,
      });
      cue(perfect ? "perfect" : "win");
      const earned = earnUndos(complete(profileRef.current, puzzle.id, s));
      const recorded = recordWin(earned.profile, localDay(), {
        usedUndo: usedUndo.current,
        perfect,
        daily: puzzle.id.startsWith("daily-"),
        maxCombo: s.maxCombo ?? 0,
        score: s.score,
      });
      const newStars = starsGained(
          before?.stars,
          recorded.completed[puzzle.id]?.stars ?? 0,
        ),
        withStars = addStars(recorded, newStars);
      setWinStats((w) => (w ? { ...w, newStars } : w));
      const festival = parseEventId(puzzle.id),
        badged = festival ? awardBadge(withStars, festival.key) : withStars;
      commit(badged, "undo:milestone");
      if (badged !== withStars)
        setNotice("Weekend champion! You cleared all 10 festival boards.");
      if (earned.gained)
        setNotice(
          `+${earned.gained} undos (${earned.profile.undos}/${MAX_UNDOS}) for clearing ten more gardens.`,
        );
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
      if (!puzzle.id.startsWith("endless-"))
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
          if (flag?.value === true) syncProgress();
        })
        .catch(() => {
          /* Local progress and outbox remain intact for retry. */
        });
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [syncProgress]);
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
            streak: next.combo,
          },
        ]);
        // Keep the twin in place and give the arriving tile the next free
        // slot beside it; both leave the tray once they have merged.
        if (partner)
          setHeld((v) => [
            ...v,
            { id: partner, index: state.tray.indexOf(partner), popping: false },
            { id, index: 99, popping: false },
          ]);
      }
      current.current = next;
      set(next);
      if (partner) {
        setMoves((v) => [...v, [partner, id]]);
        const tracked = recordPair(profileRef.current, localDay(), {
          bonus: !!next.lastAward?.labels.some((l) => l.endsWith("BONUS")),
          combo: next.combo,
        });
        if (tracked !== profileRef.current) commit(tracked, "pair");
        if (!settings.reducedMotion) {
          setAnimating(true);
          setTimeout(() => setAnimating(false), 180);
        }
        // With a flight, sound and flash wait for the merge (see `merge`).
        if (!flies) {
          setTrayFlash(Date.now());
          if (cue) play(cue, next.combo);
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
          next.tray.length === trayCap(next) - 1
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
    usedUndo.current = false;
    setWinStats(null);
    setAttemptId(crypto.randomUUID());
    setOnline(null);
    setMoves([]);
    setHint(null);
    worker.current?.terminate();
    setBusy(false);
    clearFlights();
    setPuzzle(p);
    set(dealBoard(p, levelNumberOf(p.id)));
    setScreen("game");
    setNotice(
      p.id.startsWith("endless-")
        ? "A freshly grown garden. Generated levels are casual play."
        : "A fresh garden. Take your time.",
    );
  };
  /** Starts campaign or endless level `n` (endless boards are generated). */
  /** Shares the result with the system share sheet, or copies it. */
  const shareWin = async () => {
    const where = festivalBoard
        ? `festival board ${festivalBoard.board}`
        : level
          ? `level ${level.number} (${level.name})`
          : "today's daily puzzle",
      text = `I cleared ${where} on Zen Tiles in ${formatTime(s.elapsedMs)} with ${s.score.toLocaleString()} points!`;
    try {
      if (navigator.share) await navigator.share({ title: "Zen Tiles", text, url: location.origin });
      else {
        await navigator.clipboard.writeText(`${text} ${location.origin}`);
        setNotice("Result copied — paste it anywhere to share.");
      }
    } catch {
      /* The share sheet was dismissed. */
    }
  };
  const startFestival = (key: string, board: number) => {
    try {
      start(eventPuzzle(key, board));
    } catch {
      setNotice("This festival board couldn't be grown. Try again.");
    }
  };
  const startLevel = (n: number) => {
    if (!isEndless(n)) return start(levels[n - 1].puzzle);
    setScreen("game");
    setGrowing(n);
    endlessPuzzle(n)
      .then(start)
      .catch((e) => setNotice(e instanceof Error ? e.message : String(e)))
      .finally(() => setGrowing(null));
  };
  const doUndo = () => {
    const state = current.current;
    if (
      !state.history.length ||
      state.status === "paused" ||
      profileRef.current.undos <= 0
    )
      return;
    const next = spendUndo(profileRef.current);
    usedUndo.current = true;
    commit(next, "undo:spend");
    setOnline(null);
    setHint(null);
    play("undo");
    clearFlights();
    set((v) => undo(v));
    if (next.undos === 0)
      setNotice("That was your last undo. Clear ten gardens to earn 3 more.");
  };
  /** Uses one power-up if it changes the board; the run becomes casual. */
  const usePowerUp = (kind: PowerUp) => {
    const state = current.current,
      type = kind === "slot" ? "extraSlot" : kind,
      next = applyAction(state, { type } as Parameters<typeof applyAction>[1]),
      paid = spendPowerUp(profileRef.current, kind);
    if (next === state || !paid) return;
    commit(paid, `powerup:${kind}`);
    current.current = next;
    set(next);
    setOnline(null);
    setHint(null);
    setTrayFlash(Date.now());
    play("bonus", next.combo);
    setNotice(
      kind === "magnet"
        ? "Magnet! A pair snapped together."
        : kind === "slot"
          ? "Extra slot: 5 tray slots for this garden."
          : "Freeze: bonus timers stop for 10 seconds.",
    );
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
  const levelNumber = levelNumberOf(puzzle.id),
    level = useMemo(
      () =>
        levelNumber === null
          ? undefined
          : { number: levelNumber, name: levelName(levelNumber) },
      [levelNumber],
    ),
    chapter = chapterOf(levelNumber),
    chapterLook = chapter === null ? null : chapterTheme(chapter),
    seconds = Math.floor(s.elapsedMs / 1000),
    stars = profile.completed[puzzle.id]?.stars ?? 0,
    left = s.tiles.filter((t) => !t.removed).length + s.tray.length,
    progress = 1 - left / s.tiles.length;
  // Faces follow each group's category tag, so a restored save redraws exactly.
  const highest = highestCleared(profile.completed),
    slots = customTileSlots(highest),
    myFaces = useMemo(
      () => customTiles.slice(0, slots).map(customFace),
      [customTiles, slots],
    ),
    tagKey = s.tiles.map((t) => t.tag ?? "").join(),
    festivalBoard = parseEventId(puzzle.id),
    // A board keeps its own week's pack, even after the weekend ends.
    festivalPack = festivalBoard ? packForWeek(festivalBoard.key) : null,
    faces = useMemo(
      () =>
        facesFor(
          s.tiles,
          puzzle.id,
          level?.number ?? null,
          festivalPack ? [...myFaces, ...festivalPack.faces] : myFaces,
        ),
      [puzzle.id, level, tagKey, myFaces, festivalPack],
    ),
    newPacks =
      level && s.status === "won"
        ? packsUnlockedBy(level.number)
        : [],
    runningBonuses = s.bonuses
      .filter((b) => s.status === "playing" && isBonusRunning(s, b))
      .sort((a, b) => a.remainingMs - b.remainingMs),
    combo = s.combo,
    clearedUpTo = highest,
    endlessOpenTo = endlessUnlockedUpTo(profile.completed),
    canPlay = (n: number) =>
      isEndless(n) ? n <= endlessOpenTo : isUnlocked(n, profile.completed),
    today = localDay(),
    rewardText = (r: Reward) =>
      [r.coins && `${r.coins} coins`, r.undos && `${r.undos} undo${r.undos > 1 ? "s" : ""}`]
        .filter(Boolean)
        .join(" + "),
    statusColor = chapterLook?.felt2 ?? themeColors[settings.theme],
    rushName = (tag: string) =>
      ({
        programming: "Code Rush",
        animal: "Animal Rush",
        fruit: "Fruit Rush",
        icon: "Icon Rush",
        social: "Social Rush",
        india: "India Rush",
      })[tag] ?? "Bamboo Rush";
  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", statusColor);
  }, [statusColor]);
  async function addCustomTile(kind: CustomTile["kind"], value: string) {
    const tile: CustomTile = {
        id: crypto.randomUUID(),
        kind,
        value,
        created: Date.now(),
      },
      next = [...customTiles, tile];
    if (kind === "photo") await preloadPhoto(tile.id, value);
    await saveCustomTiles(next);
    setCustomTiles(next);
    setTileError("");
    setEmojiDraft("");
    play("bonus");
  }
  async function removeCustomTile(id: string) {
    const next = customTiles.filter((t) => t.id !== id);
    await saveCustomTiles(next);
    setCustomTiles(next);
  }
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
    today: "Today",
    privacy: "Privacy & data",
    leaderboards: "Rankings",
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
    <div
      className="app"
      style={
        chapterLook
          ? ({
              "--felt-1": chapterLook.felt1,
              "--felt-2": chapterLook.felt2,
            } as CSSProperties)
          : undefined
      }
    >
      <header className="topbar">
        <button
          className="level-title"
          onClick={() => open("campaign")}
          aria-label="Choose level"
        >
          <span className="eyebrow">
            {puzzle.id.startsWith("daily-")
              ? "DAILY · UTC"
              : festivalBoard
                ? `WEEKEND FESTIVAL · BOARD ${festivalBoard.board}/${EVENT_BOARDS}`
                : chapterLook
                ? `LEVEL ${level?.number} · ${chapterLook.name.toUpperCase()}`
                : `LEVEL ${level?.number ?? 1}`}
            <span>•</span>
            {puzzle.difficulty.toUpperCase()}
          </span>
          <h1>
            {level?.name ??
              (festivalPack ? `${festivalPack.name} festival` : "Daily garden")}
          </h1>
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
            className="icon-btn has-dot"
            onClick={() => open("today")}
            aria-label={
              hasClaimable(profile, today) ? "Today (rewards ready)" : "Today"
            }
          >
            <Icon name="gift" size={20} />
            {hasClaimable(profile, today) && (
              <span className="dot" aria-hidden="true" />
            )}
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
        {(s.rush || runningBonuses.length > 0 || (s.freezeMs ?? 0) > 0) &&
          s.status === "playing" && (
          <div className="live-strip" aria-live="polite">
            {(s.freezeMs ?? 0) > 0 && (
              <span className="chip frozen">
                ❄ Frozen · {Math.ceil((s.freezeMs ?? 0) / 1000)}s
              </span>
            )}
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
          className={`tray ${trayFlash ? "flash" : ""} ${s.tray.length >= trayCap(s) - 1 ? "danger" : ""} ${trayCap(s) > TRAY_SIZE ? "wide" : ""}`}
          aria-label={`Tray: ${s.tray.length} of ${trayCap(s)} slots used`}
        >
          {Array.from({ length: trayCap(s) }, (_, i) => {
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
        <div className="powerups" role="group" aria-label="Power-ups">
          {POWER_UPS.map((u) => {
            const count = powerUps(profile)[u.id],
              usable =
                count > 0 &&
                (u.id === "slot"
                  ? (s.status === "playing" || s.status === "lost") &&
                    trayCap(s) === TRAY_SIZE
                  : s.status === "playing");
            return (
              <button
                key={u.id}
                data-sfx
                className="power"
                disabled={!usable || busy}
                title={u.help}
                aria-label={`${u.name}: ${u.help}. ${count} left`}
                onClick={() => usePowerUp(u.id)}
              >
                <span aria-hidden="true">
                  {u.id === "magnet" ? "🧲" : u.id === "slot" ? "➕" : "❄️"}
                </span>
                {u.name}
                <b>{count}</b>
              </button>
            );
          })}
        </div>
        <section className="table" aria-busy={busy || growing !== null}>
          {growing !== null && (
            <div className="growing" role="status">
              <div className="spinner" aria-hidden="true" />
              Growing garden {growing}…
            </div>
          )}
          {s.status !== "paused" ? (
            <Suspense fallback={<div className="board-loading" />}>
              <Board
                state={s}
                onSelect={select}
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
                {winStats?.perfect && (
                  <p className="perfect-banner">✨ Perfect clear ✨</p>
                )}
                <h2>Garden complete</h2>
                <div className="stars" aria-label={`${stars} of 3 stars`}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} className={i < stars ? "on" : ""}>
                      <Icon name="star" size={34} fill />
                    </span>
                  ))}
                </div>
                {winStats && (
                  <dl className="win-stats">
                    <div>
                      <dt>Time</dt>
                      <dd>
                        {formatTime(winStats.time)}
                        {(winStats.bestBefore === null ||
                          winStats.time < winStats.bestBefore) && (
                          <em className="new-best">New best!</em>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Best time</dt>
                      <dd>
                        {formatTime(
                          Math.min(
                            winStats.time,
                            winStats.bestBefore ?? Infinity,
                          ),
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Pairs</dt>
                      <dd>{s.moves}</dd>
                    </div>
                    <div>
                      <dt>Max combo</dt>
                      <dd>×{Math.max(1, winStats.maxCombo)}</dd>
                    </div>
                    <div className="wide">
                      <dt>Score</dt>
                      <dd>
                        {s.score.toLocaleString()}
                        {winStats.scoreBefore !== null &&
                          s.score > winStats.scoreBefore && (
                            <em className="new-best">New best!</em>
                          )}
                      </dd>
                    </div>
                  </dl>
                )}
                {winStats && winStats.newStars > 0 && (
                  <p className="unlock-chip">
                    +{winStats.newStars} ★ toward a chest ·{" "}
                    {(profile.chests ?? 0) > 0
                      ? "a chest is ready in Today!"
                      : `${profile.chestStars ?? 0}/${STARS_PER_CHEST}`}
                  </p>
                )}
                {winStats?.bestBefore === null && (
                  <p className="muted">+25 garden coins for a first clear</p>
                )}
                {level && level.number < CAMPAIGN_SIZE && (
                  <p className="unlock-chip">
                    <Icon name="star" size={14} fill /> Level{" "}
                    {level.number + 1} unlocked
                  </p>
                )}
                {level?.number === CAMPAIGN_SIZE && (
                  <p className="unlock-chip">
                    <Icon name="star" size={14} fill /> Endless gardens open ·
                    levels {CAMPAIGN_SIZE + 1}–{endlessOpenTo}
                  </p>
                )}
                {level &&
                  isEndless(level.number) &&
                  endlessCleared(profile.completed) % ENDLESS_BATCH === 0 && (
                    <p className="unlock-chip">
                      <Icon name="star" size={14} fill /> {ENDLESS_BATCH} new
                      gardens unlocked · up to level {endlessOpenTo}
                    </p>
                  )}
                {level &&
                  customTileSlots(level.number) >
                    customTileSlots(level.number - 1) && (
                    <p className="unlock-chip">
                      <Icon name="star" size={14} fill /> New custom tile slot ·
                      make one in Profile
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
                  <button onClick={() => void shareWin()}>Share</button>
                  <button onClick={() => start(puzzle)}>Play again</button>
                  {festivalBoard && festivalBoard.board < EVENT_BOARDS && (
                    <button
                      className="primary"
                      onClick={() =>
                        startFestival(festivalBoard.key, festivalBoard.board + 1)
                      }
                    >
                      Next festival board
                    </button>
                  )}
                  {level && canPlay(level.number + 1) && (
                    <button
                      className="primary"
                      onClick={() => startLevel(level.number + 1)}
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
                <p>
                  {profile.undos > 0
                    ? "Four different tiles filled the tray. Undo the last move or start the garden again."
                    : "Four different tiles filled the tray, and you have no undos left. Start the garden again — every ten gardens cleared earns 3 undos."}
                </p>
                <div className="row">
                  {powerUps(profile).slot > 0 && trayCap(s) === TRAY_SIZE && (
                    <button className="primary" onClick={() => usePowerUp("slot")}>
                      ➕ Use extra slot ({powerUps(profile).slot})
                    </button>
                  )}
                  {profile.undos > 0 && (
                    <button onClick={doUndo}>
                      Undo last move ({profile.undos} left)
                    </button>
                  )}
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
            disabled={
              !s.history.length ||
              busy ||
              s.status === "paused" ||
              profile.undos <= 0
            }
            aria-label={`${text.undo}, ${profile.undos} left`}
          >
            <span className="tool-icon">
              <Icon name="undo" />
              <small className={`badge ${profile.undos ? "" : "empty"}`}>
                {profile.undos}
              </small>
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
                  startLevel(nextPlayable(profile.completed));
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
                      if (!levels.some((l) => l.puzzle.id === puzzle.id)) {
                        setNotice(
                          "Verified online runs are for the 100 handmade levels and dailies. Generated levels are casual.",
                        );
                        setScreen("game");
                        return;
                      }
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
                    {CAMPAIGN_SIZE} handmade gardens, each harder than the
                    last, then endless generated gardens ·{" "}
                    {Object.keys(profile.completed).length} completed.
                  </p>
                  {[0, 1, 2, 3].map((block) => (
                    <section key={block} className="band">
                      <h3>
                        Levels {block * 25 + 1}–{block * 25 + 25}
                      </h3>
                      <div className="levels">
                        {levels.slice(block * 25, block * 25 + 25).map((l) => {
                          const got =
                              profile.completed[l.puzzle.id]?.stars ?? 0,
                            open = canPlay(l.number);
                          return (
                            <button
                              key={l.number}
                              className={`${got ? "done" : ""} ${l.puzzle.id === puzzle.id ? "current" : ""} ${open ? "" : "locked"}`}
                              disabled={!open}
                              onClick={() => startLevel(l.number)}
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
                  ))}
                  <section className="band endless">
                    <h3>Endless gardens</h3>
                    {endlessOpenTo ? (
                      (() => {
                        const first = CAMPAIGN_SIZE + 1,
                          next = nextPlayable(profile.completed),
                          pageStart =
                            endlessPage ??
                            Math.max(
                              first,
                              first +
                                Math.floor((Math.max(next, first) - first) / ENDLESS_PAGE) *
                                  ENDLESS_PAGE,
                            ),
                          pageEnd = Math.min(
                            pageStart + ENDLESS_PAGE - 1,
                            endlessOpenTo + 1,
                          );
                        return (
                          <>
                            <p className="muted">
                              Levels {first}–{endlessOpenTo} are open.{" "}
                              {`Clear ${nextBatchIn(profile.completed)} more to open the next ${ENDLESS_BATCH}.`}{" "}
                              Generated levels are casual: they are not on the
                              verified leaderboard.
                            </p>
                            <div className="levels">
                              {Array.from(
                                { length: pageEnd - pageStart + 1 },
                                (_, i) => pageStart + i,
                              ).map((n) => {
                                const id = `endless-${n}`,
                                  got = profile.completed[id]?.stars ?? 0,
                                  open = canPlay(n),
                                  ch = chapterTheme(chapterOf(n)!);
                                return (
                                  <button
                                    key={n}
                                    className={`${got ? "done" : ""} ${id === puzzle.id ? "current" : ""} ${open ? "" : "locked"}`}
                                    style={{ "--chip": ch.felt1 } as CSSProperties}
                                    disabled={!open}
                                    onClick={() => startLevel(n)}
                                    aria-label={`Play level ${n}${open ? "" : " (locked)"}`}
                                  >
                                    <strong>{open ? n : "🔒"}</strong>
                                    <span>{ch.name}</span>
                                    <small>
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
                            <div className="row pager">
                              <button
                                disabled={pageStart <= first}
                                onClick={() =>
                                  setEndlessPage(Math.max(first, pageStart - ENDLESS_PAGE))
                                }
                              >
                                ‹ Earlier
                              </button>
                              <span className="muted">
                                {pageStart}–{pageEnd}
                              </span>
                              <button
                                disabled={pageEnd >= endlessOpenTo}
                                onClick={() => setEndlessPage(pageStart + ENDLESS_PAGE)}
                              >
                                Later ›
                              </button>
                            </div>
                          </>
                        );
                      })()
                    ) : (
                      <p className="muted">
                        🔒 Clear level {CAMPAIGN_SIZE} to open {50} endless
                        gardens. After that, every {ENDLESS_BATCH} cleared open{" "}
                        {ENDLESS_BATCH} more, forever, each chapter with its own
                        board colours.
                      </p>
                    )}
                  </section>
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
                  <h3>My tiles</h3>
                  {slots === 0 ? (
                    <p className="muted">
                      🔒 Clear level {nextCustomSlotAt(highest)} to make your
                      own tile from an emoji or a photo.
                    </p>
                  ) : (
                    <>
                      <p className="muted">
                        {customTiles.length} of {slots} slot
                        {slots === 1 ? "" : "s"} used · next slot at level{" "}
                        {nextCustomSlotAt(highest)}. Your tiles appear on every
                        board. Photos stay on this device.
                      </p>
                      <div className="my-tiles">
                        {customTiles.map((t, i) => (
                          <div
                            key={t.id}
                            className={`my-tile ${i < slots ? "" : "idle"}`}
                          >
                            <TileCanvas face={customFace(t)} width={40} />
                            <button
                              className="icon-btn"
                              aria-label="Delete this tile"
                              onClick={() => void removeCustomTile(t.id)}
                            >
                              <Icon name="close" size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                      {customTiles.length < slots && (
                        <div className="tile-maker">
                          <label className="field row-field">
                            <span>Emoji</span>
                            <input
                              value={emojiDraft}
                              maxLength={16}
                              placeholder="🦄"
                              aria-label="Emoji for your tile"
                              onChange={(e) => setEmojiDraft(e.target.value)}
                            />
                          </label>
                          <button
                            className="primary"
                            disabled={!emojiDraft.trim()}
                            onClick={() => {
                              const emoji = validEmoji(emojiDraft);
                              if (!emoji)
                                return setTileError("Type a single emoji.");
                              if (
                                customTiles.some(
                                  (t) => t.kind === "emoji" && t.value === emoji,
                                )
                              )
                                return setTileError("You already have that one.");
                              void addCustomTile("emoji", emoji);
                            }}
                          >
                            Make emoji tile
                          </button>
                          <label className="block photo-pick">
                            <Icon name="palette" size={18} /> Make tile from a
                            photo
                            <input
                              type="file"
                              accept="image/*"
                              aria-label="Photo for your tile"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                if (!file) return;
                                photoToDataUrl(file)
                                  .then((url) => addCustomTile("photo", url))
                                  .catch((err) =>
                                    setTileError(
                                      err instanceof Error
                                        ? err.message
                                        : "That photo could not be used.",
                                    ),
                                  );
                              }}
                            />
                          </label>
                        </div>
                      )}
                      {tileError && (
                        <p className="form-note error" role="alert">
                          {tileError}
                        </p>
                      )}
                    </>
                  )}
                  <h3>Tile collection</h3>
                  <p className="muted">
                    {totalTypes(clearedUpTo + 1)}{" "}
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
                      const open = clearedUpTo >= p.after;
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
                              : p.category === "animal"
                                ? "animals"
                                : "tiles"}{" "}
                            · after level {p.after}
                          </small>
                        </li>
                      );
                    })}
                  </ul>
                  {!!profile.badges?.length && (
                    <>
                      <h3>Badges</h3>
                      <ul className="badges">
                        {profile.badges.map((b) => (
                          <li key={b}>
                            🏅 Weekend champion · {b.replace("weekend:", "")}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
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
                          disabled={
                            !owned && balance(profile) < themePrices[theme]
                          }
                          onClick={() => {
                            if (!owned)
                              commit(
                                buyTheme(profileRef.current, theme),
                                `theme:${theme}`,
                              );
                            change("theme", theme);
                          }}
                        >
                          <span className="swatch" aria-hidden="true" />
                          <strong>{theme}</strong>
                          <small>
                            {owned
                              ? "Use theme"
                              : `${themePrices[theme]} garden coins`}
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
                            "Show tile list (screen readers)",
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
              {screen === "today" && (
                <>
                  {(() => {
                    const ev = weekendEvent();
                    if (!ev)
                      return (
                        <p className="festival-off">
                          🎪 The weekend festival opens on Friday
                          {daysUntilFestival() === 1 ? " (tomorrow)" : ` (in ${daysUntilFestival()} days)`}.
                        </p>
                      );
                    const cleared = eventCleared(profile, ev.key),
                      champion = profile.badges?.includes(`weekend:${ev.key}`);
                    return (
                      <section className="festival">
                        <h3>
                          🎪 Weekend festival · {ev.pack.name}
                        </h3>
                        <p className="muted">
                          10 boards full of {ev.pack.name} tiles, until{" "}
                          {ev.endsOn}. Clear them all for the Weekend champion
                          badge.
                        </p>
                        <div className="bar" aria-label={`${cleared} of ${EVENT_BOARDS} cleared`}>
                          <span style={{ width: `${(cleared / EVENT_BOARDS) * 100}%` }} />
                        </div>
                        <div className="festival-boards">
                          {Array.from({ length: EVENT_BOARDS }, (_, i) => {
                            const n = i + 1,
                              done = eventPuzzleId(ev.key, n) in profile.completed,
                              open = eventBoardOpen(profile, ev.key, n);
                            return (
                              <button
                                key={n}
                                className={done ? "done" : ""}
                                disabled={!open}
                                aria-label={`Festival board ${n}${done ? " (cleared)" : open ? "" : " (locked)"}`}
                                onClick={() => startFestival(ev.key, n)}
                              >
                                {done ? "✓" : open ? n : "🔒"}
                              </button>
                            );
                          })}
                        </div>
                        {champion && (
                          <p className="unlock-chip">🏅 Weekend champion</p>
                        )}
                      </section>
                    );
                  })()}
                  <h3>Daily gift</h3>
                  <p className="muted">
                    Come back each day for the next gift. Day 7 is the
                    biggest. Missing a day starts again at day 1 — you keep
                    everything you already have.
                  </p>
                  <ol className="calendar">
                    {LOGIN_REWARDS.map((r, i) => {
                      const day = i + 1,
                        current = loginDayFor(profile, today),
                        claimedToday = !canClaimLogin(profile, today),
                        state =
                          day < current || (day === current && claimedToday)
                            ? "got"
                            : day === current
                              ? "now"
                              : "later";
                      return (
                        <li key={day} className={`cal-day ${state} ${day === 7 ? "big" : ""}`}>
                          <b>Day {day}</b>
                          <span>{rewardText(r)}</span>
                          {state === "got" && <i aria-label="claimed">✓</i>}
                        </li>
                      );
                    })}
                  </ol>
                  <button
                    className="primary block"
                    disabled={!canClaimLogin(profile, today)}
                    onClick={() => {
                      const next = claimLogin(profileRef.current, today);
                      if (next === profileRef.current) return;
                      commit(next, "gift");
                      play("bonus");
                      setNotice(
                        `Daily gift: ${rewardText(LOGIN_REWARDS[next.login!.day - 1])}.`,
                      );
                    }}
                  >
                    {canClaimLogin(profile, today)
                      ? `Claim day ${loginDayFor(profile, today)} · ${rewardText(LOGIN_REWARDS[loginDayFor(profile, today) - 1])}`
                      : "Claimed today — see you tomorrow"}
                  </button>
                  <h3>Star chest</h3>
                  <div className="chest-card">
                    <span className="chest-icon" aria-hidden="true">
                      {(profile.chests ?? 0) > 0 ? "🎁" : "🧰"}
                    </span>
                    <div>
                      <strong>
                        {(profile.chests ?? 0) > 0
                          ? `${profile.chests} chest${profile.chests! > 1 ? "s" : ""} ready`
                          : `${profile.chestStars ?? 0} / ${STARS_PER_CHEST} stars`}
                      </strong>
                      <div className="bar">
                        <span
                          style={{
                            width: `${((profile.chestStars ?? 0) / STARS_PER_CHEST) * 100}%`,
                          }}
                        />
                      </div>
                      <small>
                        New stars fill chests: a first clear or a better
                        result. Next chest: {rewardLabel(
                          CHEST_REWARDS[(profile.chestsOpened ?? 0) % CHEST_REWARDS.length],
                        )}
                        .
                      </small>
                    </div>
                    <button
                      className="primary"
                      disabled={!(profile.chests ?? 0)}
                      onClick={() => {
                        const opened = openChest(profileRef.current);
                        if (!opened) return;
                        commit(opened.profile, "chest");
                        play("perfect");
                        setNotice(`Chest opened: ${rewardLabel(opened.reward)}!`);
                      }}
                    >
                      Open
                    </button>
                  </div>
                  <details className="chest-table">
                    <summary>What chests give</summary>
                    <ol>
                      {CHEST_REWARDS.map((r, i) => (
                        <li key={i}>{rewardLabel(r)}</li>
                      ))}
                    </ol>
                    <p className="muted small">
                      Always in this order, then it repeats. No luck, nothing
                      to buy. Using a power-up makes that run casual.
                    </p>
                  </details>
                  <h3>Today's missions</h3>
                  <ul className="missions">
                    {missionsFor(today).map((m) => {
                      const t = todayStats(profile, today),
                        done = missionDone(m, t),
                        claimed = t.claimed.includes(m.id),
                        value = Math.min(m.progress(t), m.target);
                      return (
                        <li key={m.id} className={claimed ? "claimed" : ""}>
                          <div>
                            <strong>{m.text}</strong>
                            <small>
                              {m.target >= 100
                                ? `${value.toLocaleString()} / ${m.target.toLocaleString()}`
                                : `${value} / ${m.target}`}{" "}
                              · {m.coins} coins
                            </small>
                            <div
                              className="bar"
                              role="progressbar"
                              aria-valuenow={value}
                              aria-valuemin={0}
                              aria-valuemax={m.target}
                            >
                              <span style={{ width: `${(value / m.target) * 100}%` }} />
                            </div>
                          </div>
                          <button
                            className={done && !claimed ? "primary" : ""}
                            disabled={!done || claimed}
                            onClick={() => {
                              const next = claimMission(profileRef.current, m.id, today);
                              if (next === profileRef.current) return;
                              commit(next, `mission:${m.id}`);
                              play("bonus");
                            }}
                          >
                            {claimed ? "✓" : "Claim"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="muted small">
                    New missions every day at midnight (your local time).
                    Balance: {balance(profile)} garden coins.
                  </p>
                </>
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
                    Custom tiles you make, including photos, are stored only
                    in this browser on this device and are never uploaded.
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
