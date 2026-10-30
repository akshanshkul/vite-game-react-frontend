import { useEffect, useRef, type RefObject } from "react";
import Phaser from "phaser";
import { classicFace, faceKey, type Face } from "./TileDefinitions";
import { paintTile, type Look } from "./TileRenderer";
import {
  isBonusRunning,
  isTileFree,
  type Bonus,
  type Pair,
  type State,
  type Tile,
} from "../../packages/engine/src/index";
const burst = [0xf3d48c, 0xffffff, 0x9fd6a8, 0xe9b65c];
type Props = {
  state: State;
  onSelect: (id: string) => void;
  large: boolean;
  /** Picture for each match group on this board. */
  faces: Record<string, Face>;
  reducedMotion: boolean;
  /** Changes whenever a fresh board is dealt (new level, restart, shuffle). */
  introKey: string;
  hint: Pair | null;
  /** A blocked tile the player tried to pick; `key` re-triggers the shake. */
  shake: { id: string; key: number } | null;
  /** Filled with a lookup of a tile's on-screen rectangle (CSS pixels). */
  locate?: RefObject<((id: string) => ScreenRect | null) | null>;
  /** Tiles the page is animating into the tray itself; drop them at once. */
  flying?: string[];
};
export type ScreenRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export default function Board(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    current = useRef(props),
    scene = useRef<BoardScene | null>(null);
  current.current = props;
  useEffect(() => {
    const el = host.current!,
      dpr = Math.min(window.devicePixelRatio || 1, 3),
      size = () => ({
        w: Math.max(1, Math.round(el.clientWidth * dpr)),
        h: Math.max(1, Math.round(el.clientHeight * dpr)),
      });
    const s = new BoardScene(() => current.current, dpr);
    scene.current = s;
    const { w, h } = size();
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: el,
      width: w,
      height: h,
      transparent: true,
      scene: s,
      // Render at device resolution, display at CSS size: crisp tiles on phones.
      scale: { mode: Phaser.Scale.NONE, zoom: 1 / dpr },
      fps: { target: 60 },
      render: { antialias: true },
      banner: false,
    });
    const observer = new ResizeObserver(() => {
      const { w, h } = size();
      if (w === game.scale.width && h === game.scale.height) return;
      game.scale.resize(w, h);
      s.invalidate();
    });
    observer.observe(el);
    if (props.locate) props.locate.current = (id) => s.tileRect(id, el);
    return () => {
      if (props.locate) props.locate.current = null;
      observer.disconnect();
      scene.current = null;
      game.destroy(true);
    };
  }, []);
  useEffect(() => {
    if (props.shake) scene.current?.shake(props.shake.id);
  }, [props.shake]);
  return (
    <div
      className={`canvas ${props.large ? "large" : ""}`}
      ref={host}
      aria-hidden="true"
    />
  );
}

class BoardScene extends Phaser.Scene {
  signature = "";
  intro = "";
  layoutKey = "";
  bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1, maxZ: 0 };
  drawn = new Map<string, Phaser.GameObjects.Container>();
  removed = new Set<string>();
  selected: string | null = null;
  textureSize = "";
  /** Countdown rings on live bonus tiles, refreshed every frame. */
  rings = new Map<
    string,
    {
      bonusId: string;
      ring: Phaser.GameObjects.Graphics;
      glow: Phaser.GameObjects.Graphics;
      label: Phaser.GameObjects.Text;
      w: number;
      h: number;
    }
  >();
  /** Last known remaining time per bonus, so rings sweep smoothly between ticks. */
  clocks = new Map<string, { ms: number; at: number }>();
  awardSeq: number | null = null;
  constructor(
    private props: () => Props,
    private dpr: number,
  ) {
    super("board");
  }
  invalidate() {
    this.signature = "";
  }
  position(t: Tile) {
    const { tiles } = this.props().state;
    const key = tiles.map((t) => t.id).join();
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      const minX = Math.min(...tiles.map((t) => t.x)),
        minY = Math.min(...tiles.map((t) => t.y));
      this.bounds = {
        minX,
        minY,
        maxX: Math.max(...tiles.map((t) => t.x)) + 2 - minX,
        maxY: Math.max(...tiles.map((t) => t.y)) + 2 - minY,
        maxZ: Math.max(...tiles.map((t) => t.z)),
      };
    }
    const { minX, minY, maxX, maxY, maxZ } = this.bounds,
      W = this.scale.width,
      H = this.scale.height,
      pad = 6 * this.dpr,
      boardW = maxX * 38 + maxZ * 8 + 4,
      boardH = maxY * 45 + maxZ * 10 + 8,
      scale = Math.min((W - pad * 2) / boardW, (H - pad * 2) / boardH),
      x0 = (W - boardW * scale) / 2,
      y0 = (H - boardH * scale) / 2 + maxZ * 10 * scale;
    return {
      x: x0 + (t.x - minX) * 38 * scale + t.z * 8 * scale,
      y: y0 + (t.y - minY) * 45 * scale - t.z * 10 * scale,
      w: 70 * scale,
      h: 82 * scale,
      scale,
    };
  }
  create() {
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const { state, onSelect } = this.props();
      if (state.status !== "playing") return;
      const t = state.tiles
        .filter((t) => !t.removed)
        .sort((a, b) => b.z - a.z || b.y - a.y)
        .find((t) => {
          const r = this.position(t);
          return (
            p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
          );
        });
      if (t) onSelect(t.id);
    });
  }
  /** Cached high-resolution tile picture for this face, look and size. */
  texture(face: Face, look: Look, w: number, h: number, badge?: string) {
    const size = `${Math.round(w)}x${Math.round(h)}`;
    if (size !== this.textureSize) {
      // The board was resized (e.g. the Rush/bonus strip appeared). Tiles that
      // are still animating out keep drawing the old-size pictures, so only
      // drop old textures nothing uses now, and sweep again once they finish.
      this.textureSize = size;
      this.purgeTextures();
      this.time.delayedCall(1500, () => this.purgeTextures());
    }
    const key = `tile|${faceKey(face)}|${look}|${badge ?? ""}|${size}`;
    if (!this.textures.exists(key)) {
      const pad = Math.ceil(w * 0.12),
        tex = this.textures.createCanvas(key, Math.ceil(w + pad * 2), Math.ceil(h + pad * 2))!;
      paintTile(tex.getContext(), face, look, w, h, pad, badge);
      tex.refresh();
    }
    return key;
  }
  /** Remove tile textures of other sizes that no live image still renders. */
  purgeTextures() {
    const used = new Set<string>(),
      walk = (list: Phaser.GameObjects.GameObject[]) => {
        for (const o of list) {
          if (o instanceof Phaser.GameObjects.Image) used.add(o.texture.key);
          else if (o instanceof Phaser.GameObjects.Container) walk(o.list);
        }
      };
    walk(this.children.list);
    for (const key of this.textures.getTextureKeys())
      if (
        key.startsWith("tile|") &&
        !key.endsWith(`|${this.textureSize}`) &&
        !used.has(key)
      )
        this.textures.remove(key);
  }
  /** Redraw countdown rings: smooth sweep, warning colour in the last 3 s. */
  tickRings() {
    const { state: s } = this.props(),
      now = performance.now(),
      playing = s.status === "playing";
    for (const b of s.bonuses) {
      const c = this.clocks.get(b.id);
      if (!c || c.ms !== b.remainingMs)
        this.clocks.set(b.id, { ms: b.remainingMs, at: now });
    }
    for (const { bonusId, ring, glow, label, w, h } of this.rings.values()) {
      const b = s.bonuses.find((x) => x.id === bonusId);
      if (!b || !ring.active) continue;
      const running = playing && isBonusRunning(s, b),
        clock = this.clocks.get(bonusId)!,
        shown = running
          ? Math.max(0, clock.ms - Math.min(990, now - clock.at))
          : clock.ms,
        warn = running && shown <= 3000,
        r = w * 0.2,
        cx = -w / 2 + r * 0.9,
        cy = -h / 2 + r * 0.9,
        pulse = warn ? 1 + 0.1 * Math.sin(now / 90) : 1;
      ring.clear();
      ring.fillStyle(0x1d2b22, 0.85);
      ring.fillCircle(cx, cy, r * pulse);
      ring.lineStyle(Math.max(2, r * 0.22), 0xffffff, 0.18);
      ring.strokeCircle(cx, cy, r * 0.78 * pulse);
      ring.lineStyle(
        Math.max(2, r * 0.22),
        warn ? 0xff5a36 : running ? 0xf6c453 : 0x9aa392,
        1,
      );
      ring.beginPath();
      ring.arc(
        cx,
        cy,
        r * 0.78 * pulse,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, shown / b.durationMs),
        false,
      );
      ring.strokePath();
      label
        .setPosition(cx, cy)
        .setText(String(Math.ceil(shown / 1000)))
        .setColor(warn ? "#ffd2c4" : running ? "#ffffff" : "#c9cfba");
      glow.clear();
      if (running) {
        glow.lineStyle(
          Math.max(3, w * 0.07),
          warn ? 0xff6a3d : 0xf6c453,
          0.3 + 0.35 * Math.sin(now / (warn ? 110 : 260)) ** 2,
        );
        glow.strokeRoundedRect(
          -w / 2 - w * 0.05,
          -h / 2 - w * 0.05,
          w * 1.1,
          h * 1.02,
          w * 0.18,
        );
      }
    }
  }
  /** Floating "+500 · 5× BONUS" text and gold sparkles for each new award. */
  showAward() {
    const { state: s, reducedMotion } = this.props(),
      award = s.lastAward,
      seq = award?.seq ?? 0;
    if (this.awardSeq === null || seq <= this.awardSeq || !award) {
      this.awardSeq = seq;
      return;
    }
    this.awardSeq = seq;
    const tile = s.tiles.find((t) => t.id === award.tile);
    if (!tile) return;
    const { x, y, w, h } = this.position(tile),
      special = award.labels.length > 0,
      cx = Math.min(Math.max(x + w / 2, w * 1.6), this.scale.width - w * 1.6),
      cy = y + h / 2,
      text = this.add
        .text(cx, cy, `+${award.points}`, {
          fontFamily: '"DM Sans",sans-serif',
          fontStyle: "800",
          fontSize: `${Math.round(w * (special ? 0.62 : 0.42))}px`,
          color: special ? "#ffe08a" : "#ffffff",
          stroke: "#3b2a07",
          strokeThickness: Math.max(3, w * 0.07),
        })
        .setOrigin(0.5)
        .setDepth(3000),
      caption = special
        ? this.add
            .text(cx, cy + w * 0.5, award.labels.join(" · "), {
              fontFamily: '"DM Sans",sans-serif',
              fontStyle: "800",
              fontSize: `${Math.round(w * 0.24)}px`,
              color: "#fff6d8",
              stroke: "#3b2a07",
              strokeThickness: Math.max(2, w * 0.05),
            })
            .setOrigin(0.5)
            .setDepth(3000)
        : null,
      parts = caption ? [text, caption] : [text];
    if (reducedMotion) {
      this.time.delayedCall(900, () => parts.forEach((p) => p.destroy()));
      return;
    }
    parts.forEach((p) => p.setScale(0.4));
    this.tweens.add({ targets: parts, scale: 1, duration: 260, ease: "Back.easeOut" });
    this.tweens.add({
      targets: parts,
      y: `-=${w * 1.1}`,
      alpha: 0,
      delay: special ? 750 : 420,
      duration: 650,
      ease: "Cubic.easeIn",
      onComplete: () => parts.forEach((p) => p.destroy()),
    });
    if (special)
      for (let i = 0; i < 26; i++) {
        const angle = Math.random() * Math.PI * 2,
          dist = w * (0.8 + Math.random() * 1.6),
          star = this.add
            .star(cx, cy, 4, w * 0.03, w * 0.08, i % 3 ? 0xf6c453 : 0xfff3c4)
            .setDepth(2999);
        this.tweens.add({
          targets: star,
          x: cx + Math.cos(angle) * dist,
          y: cy + Math.sin(angle) * dist,
          angle: 180,
          alpha: 0,
          scale: 0.2,
          duration: 700 + Math.random() * 500,
          ease: "Cubic.easeOut",
          onComplete: () => star.destroy(),
        });
      }
  }
  shake(id: string) {
    const c = this.drawn.get(id);
    if (!c || this.props().reducedMotion) return;
    const x = c.x,
      d = 5 * this.dpr;
    this.tweens.killTweensOf(c);
    c.x = x;
    this.tweens.add({
      targets: c,
      x: { from: x - d, to: x + d },
      duration: 55,
      yoyo: true,
      repeat: 2,
      ease: "Sine.easeInOut",
      onComplete: () => (c.x = x),
    });
  }
  /** Where a tile currently sits on screen, in CSS pixels. */
  tileRect(id: string, el: HTMLElement): ScreenRect | null {
    const t = this.props().state.tiles.find((t) => t.id === id),
      c = this.drawn.get(id);
    if (!t || !c) return null;
    const box = el.getBoundingClientRect(),
      { w, h } = this.position(t);
    return {
      left: box.left + (c.x - w / 2) / this.dpr,
      top: box.top + (c.y - h / 2) / this.dpr,
      width: w / this.dpr,
      height: h / this.dpr,
    };
  }
  /** Fallback when the page could not animate the tile: shrink in place. */
  lift(c: Phaser.GameObjects.Container) {
    c.setDepth(2000);
    this.tweens.add({
      targets: c,
      scale: 0.6,
      alpha: 0,
      duration: 180,
      ease: "Cubic.easeIn",
      onComplete: () => c.destroy(),
    });
  }
  explode(c: Phaser.GameObjects.Container, scale: number) {
    this.tweens.add({
      targets: c,
      scale: 1.18,
      alpha: 0,
      y: c.y - 14 * scale,
      duration: 260,
      ease: "Back.easeIn",
      onComplete: () => c.destroy(),
    });
    for (let i = 0; i < 12; i++) {
      const angle = (Math.PI * 2 * i) / 12 + Math.random() * 0.4,
        dist = (40 + Math.random() * 40) * scale,
        dot = this.add
          .circle(
            c.x,
            c.y,
            (2 + Math.random() * 3) * scale,
            burst[i % burst.length],
          )
          .setDepth(1000);
      this.tweens.add({
        targets: dot,
        x: c.x + Math.cos(angle) * dist,
        y: c.y + Math.sin(angle) * dist,
        alpha: 0,
        scale: 0.3,
        duration: 420 + Math.random() * 200,
        ease: "Cubic.easeOut",
        onComplete: () => dot.destroy(),
      });
    }
    const ring = this.add
      .circle(c.x, c.y, 18 * scale)
      .setStrokeStyle(3 * scale, 0xf3d48c, 0.9)
      .setDepth(999);
    this.tweens.add({
      targets: ring,
      scale: 3,
      alpha: 0,
      duration: 380,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
  }
  update() {
    this.tickRings();
    this.showAward();
    const { state: s, reducedMotion, introKey, hint, faces, flying = [] } =
        this.props(),
      sig = JSON.stringify([
        s.tiles,
        s.selected,
        hint,
        faces,
        this.scale.width,
        this.scale.height,
      ]);
    if (sig === this.signature) return;
    this.signature = sig;
    const fresh = introKey !== this.intro;
    this.intro = introKey;
    for (const [id, c] of this.drawn) {
      this.tweens.killTweensOf([c, ...c.list]);
      const removed = s.tiles.find((t) => t.id === id)?.removed;
      if (flying.includes(id)) c.destroy();
      else if (removed && !this.removed.has(id) && !reducedMotion && !fresh) {
        const scale = this.position(s.tiles.find((t) => t.id === id)!).scale;
        if (s.tray.includes(id)) this.lift(c);
        else this.explode(c, scale);
      }
      else c.destroy();
    }
    this.drawn.clear();
    this.rings.clear();
    const order = [...s.tiles].sort((a, b) => a.z - b.z || a.y - b.y);
    order.forEach((t, index) => {
      if (t.removed) return;
      const { x, y, w, h, scale } = this.position(t),
        free = isTileFree(s, t.id),
        selected = s.selected === t.id,
        hinted = !!hint?.includes(t.id),
        lift = selected ? 5 * scale : 0,
        r = 8 * scale,
        c = this.add.container(x + w / 2, y + h / 2 - lift),
        face: Face = faces[t.matchGroup] ?? classicFace(t.matchGroup, t.suit);
      c.setDepth(index + (selected ? 500 : 0));
      const bonus = t.bonusId
          ? s.bonuses.find((b) => b.id === t.bonusId && b.status === "live")
          : undefined,
        items: Phaser.GameObjects.GameObject[] = [
          this.add.image(
            0,
            0,
            this.texture(
              face,
              selected ? "selected" : free ? "free" : "blocked",
              w,
              h,
              bonus ? badgeOf(bonus) : undefined,
            ),
          ),
        ];
      if (bonus) {
        const glow = this.add.graphics(),
          ring = this.add.graphics(),
          label = this.add
            .text(0, 0, "", {
              fontFamily: '"DM Sans",sans-serif',
              fontStyle: "800",
              fontSize: `${Math.round(w * 0.2)}px`,
              color: "#ffffff",
              stroke: "#3b2a07",
              strokeThickness: Math.max(2, w * 0.035),
            })
            .setOrigin(0.5);
        items.unshift(glow);
        items.push(ring, label);
        this.rings.set(t.id, { bonusId: bonus.id, ring, glow, label, w, h });
      }
      if (hinted) {
        const glow = this.add.graphics();
        glow.lineStyle(4 * scale, 0xf6c453, 1);
        glow.strokeRoundedRect(-w / 2 - 3 * scale, -h / 2 - 3 * scale, w + 6 * scale, h + 6 * scale, r + 2 * scale);
        items.unshift(glow);
        if (!reducedMotion)
          this.tweens.add({
            targets: glow,
            alpha: { from: 1, to: 0.25 },
            duration: 550,
            yoyo: true,
            repeat: -1,
          });
      }
      c.add(items);
      this.drawn.set(t.id, c);
      if (reducedMotion) return;
      if (fresh) {
        const yy = c.y;
        c.setAlpha(0).setScale(0.6);
        c.y = yy - 30 * scale;
        this.tweens.add({
          targets: c,
          alpha: 1,
          scale: 1,
          y: yy,
          delay: Math.min(index * 9, 700),
          duration: 360,
          ease: "Back.easeOut",
        });
      } else if (this.removed.has(t.id)) {
        c.setAlpha(0).setScale(1.15);
        this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 240, ease: "Cubic.easeOut" });
      } else if (selected && this.selected !== t.id) {
        this.tweens.add({
          targets: c,
          scale: { from: 0.94, to: 1.06 },
          duration: 110,
          yoyo: true,
          ease: "Sine.easeOut",
        });
      }
    });
    this.removed = new Set(s.tiles.filter((t) => t.removed).map((t) => t.id));
    this.selected = s.selected;
  }
}
const badgeOf = (b: Bonus) =>
  b.kind === "golden"
    ? "GOLD"
    : b.kind === "combo"
      ? "COMBO"
      : `${b.multiplier}×`;
