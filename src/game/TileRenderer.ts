// TileRenderer: paints a premium ivory tile (shadow, body, bevelled face and
// picture) once into a canvas; the board caches it as a texture per face.
import { colors, emojiFont, type Face } from "./TileDefinitions";
export type Look = "free" | "blocked" | "selected";
const palette: Record<Look, { top: string; bottom: string; side: [string, string]; rim: string }> = {
  free: { top: "#fffef8", bottom: "#f1e8cf", side: ["#ddd2ad", "#b9ab82"], rim: "#00000022" },
  blocked: { top: "#dfe3d3", bottom: "#c9cfba", side: ["#b4b8a2", "#959a83"], rim: "#00000026" },
  selected: { top: "#fff3cc", bottom: "#f6d98d", side: ["#e2b45c", "#bf8a2d"], rim: "#c98a2e" },
};
function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
const luminance = (hex: string) => {
  const n = parseInt(hex, 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};
/**
 * Paints one tile (shadow, body, bevelled face and picture) onto a canvas of
 * size (w + 2·pad) × (h + 2·pad). The tile's visual centre is the canvas centre.
 */
export function paintTile(
  ctx: CanvasRenderingContext2D,
  face: Face,
  look: Look,
  w: number,
  h: number,
  pad: number,
  /** Bonus badge text ("5×", "GOLD", "COMBO"); gives the tile a gold rim. */
  badge?: string,
) {
  const p = palette[look],
    depth = Math.max(3, h * 0.07),
    r = Math.min(w, h) * 0.14,
    fh = h - depth,
    x = pad,
    y = pad;
  ctx.clearRect(0, 0, w + pad * 2, h + pad * 2);
  // Soft drop shadow under the whole tile.
  ctx.save();
  ctx.shadowColor = look === "selected" ? "#0008" : "#0006";
  ctx.shadowBlur = pad * 0.9;
  ctx.shadowOffsetY = pad * 0.35;
  rounded(ctx, x, y + depth, w, fh, r);
  ctx.fillStyle = p.side[1];
  ctx.fill();
  ctx.restore();
  // Body edge (the tile's thickness).
  const side = ctx.createLinearGradient(0, y + depth, 0, y + h);
  side.addColorStop(0, p.side[0]);
  side.addColorStop(1, p.side[1]);
  rounded(ctx, x, y + depth, w, fh, r);
  ctx.fillStyle = side;
  ctx.fill();
  // Face with a gentle vertical gradient.
  const top = ctx.createLinearGradient(0, y, 0, y + fh);
  top.addColorStop(0, p.top);
  top.addColorStop(1, p.bottom);
  rounded(ctx, x, y, w, fh, r);
  ctx.fillStyle = top;
  ctx.fill();
  ctx.lineWidth = look === "selected" ? Math.max(2, w * 0.035) : Math.max(1, w * 0.012);
  ctx.strokeStyle = p.rim;
  ctx.stroke();
  // Glossy highlight along the top edge.
  const gloss = ctx.createLinearGradient(0, y, 0, y + fh * 0.45);
  gloss.addColorStop(0, "#ffffffb0");
  gloss.addColorStop(1, "#ffffff00");
  rounded(ctx, x + w * 0.06, y + fh * 0.04, w * 0.88, fh * 0.42, r * 0.8);
  ctx.fillStyle = gloss;
  ctx.fill();
  // Picture.
  const cx = x + w / 2,
    cy = y + fh / 2;
  ctx.save();
  if (look === "blocked") ctx.filter = "saturate(0.35) brightness(0.9)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (face.kind === "emoji") {
    ctx.font = `${Math.round(fh * 0.52)}px ${emojiFont}`;
    ctx.fillText(face.char, cx, cy + fh * 0.03);
  } else if (face.kind === "logo") {
    const size = w * 0.58,
      s = size / 24;
    if (luminance(face.hex) > 0.72) {
      // Very light brand colours get a dark plate so they stay legible.
      rounded(ctx, cx - size * 0.62, cy - size * 0.62, size * 1.24, size * 1.24, size * 0.22);
      ctx.fillStyle = "#1f2a24";
      ctx.fill();
    }
    ctx.translate(cx - size / 2, cy - size / 2);
    ctx.scale(s, s);
    ctx.fillStyle = `#${face.hex}`;
    ctx.fill(new Path2D(face.path));
  } else {
    ctx.fillStyle = colors[face.suit];
    ctx.font = `700 ${Math.round(fh * 0.56)}px "Noto Serif SC","Songti SC","Microsoft YaHei",serif`;
    ctx.fillText(face.glyph, cx, cy + fh * 0.02);
  }
  ctx.restore();
  if (badge) {
    // Metallic gold rim and a corner badge for special tiles.
    const gold = ctx.createLinearGradient(x, y, x + w, y + fh);
    gold.addColorStop(0, "#fff0b3");
    gold.addColorStop(0.35, "#e3b34a");
    gold.addColorStop(0.65, "#b07a1c");
    gold.addColorStop(1, "#f7d77a");
    rounded(ctx, x + 1, y + 1, w - 2, fh - 2, r);
    ctx.lineWidth = Math.max(2.5, w * 0.06);
    ctx.strokeStyle = gold;
    ctx.stroke();
    const bh = fh * 0.22,
      font = Math.round(bh * 0.7);
    ctx.font = `800 ${font}px "DM Sans",sans-serif`;
    const bw = Math.max(bh * 1.3, ctx.measureText(badge).width + bh * 0.6),
      bx = x + w - bw * 0.82,
      by = y - bh * 0.25;
    rounded(ctx, bx, by, bw, bh, bh / 2);
    ctx.fillStyle = gold;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#7a5212";
    ctx.stroke();
    ctx.fillStyle = "#4a3108";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badge, bx + bw / 2, by + bh / 2 + 0.5);
  }
}
