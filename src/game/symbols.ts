// Hand-drawn flat symbols for the Icons, Social and India packs. Everything is
// simple geometry on a 24 × 24 grid. These are generic look-alikes on purpose:
// no company, product or social-network marks.
export type SymbolPart = { d: string; fill: string; evenodd?: boolean };
export type SymbolDef = { title: string; parts: SymbolPart[] };
const f = (n: number) => +n.toFixed(2);
const poly = (pts: [number, number][]) =>
  "M" + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join("L") + "Z";
const circle = (cx: number, cy: number, r: number) =>
  `M${f(cx - r)} ${f(cy)}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0Z`;
const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${f(cx - rx)} ${f(cy)}a${rx} ${ry} 0 1 0 ${f(2 * rx)} 0a${rx} ${ry} 0 1 0 ${f(-2 * rx)} 0Z`;
const rect = (x: number, y: number, w: number, h: number) =>
  poly([
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]);
const rrect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${f(x + r)} ${f(y)}h${f(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${f(h - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${r}h${f(-(w - 2 * r))}a${r} ${r} 0 0 1 ${-r} ${-r}v${f(-(h - 2 * r))}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
/** A bar of `len` × `w` centred on (cx, cy), turned by `deg`. */
const bar = (cx: number, cy: number, len: number, w: number, deg: number) => {
  const a = (deg * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a),
    p = (x: number, y: number): [number, number] => [
      cx + x * c - y * s,
      cy + x * s + y * c,
    ];
  return poly([
    p(-len / 2, -w / 2),
    p(len / 2, -w / 2),
    p(len / 2, w / 2),
    p(-len / 2, w / 2),
  ]);
};
/** Bar between two points. */
const link = (x1: number, y1: number, x2: number, y2: number, w: number) =>
  bar(
    (x1 + x2) / 2,
    (y1 + y2) / 2,
    Math.hypot(x2 - x1, y2 - y1),
    w,
    (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI,
  );
const star = (
  cx: number,
  cy: number,
  n: number,
  outer: number,
  inner: number,
  rot = -90,
) =>
  poly(
    Array.from({ length: n * 2 }, (_, i) => {
      const r = i % 2 ? inner : outer,
        a = ((rot + (i * 180) / n) * Math.PI) / 180;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number];
    }),
  );
/** Ring = outer + inner circle, filled even-odd. */
const ring = (cx: number, cy: number, r1: number, r2: number) =>
  circle(cx, cy, r1) + circle(cx, cy, r2);
const gear = () => {
  const pts: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = i * 45;
    for (const [deg, r] of [
      [a - 10, 10.2],
      [a + 10, 10.2],
      [a + 14, 7.6],
      [a + 31, 7.6],
    ] as const) {
      const t = (deg * Math.PI) / 180;
      pts.push([12 + r * Math.cos(t), 12 + r * Math.sin(t)]);
    }
  }
  return poly(pts) + circle(12, 12, 3.3);
};
/** A chain link: a rounded loop along `deg`, filled even-odd. */
const chainLink = (cx: number, cy: number, deg: number) => {
  const loop = (len: number, r: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 16; i++) {
      const t = -Math.PI / 2 + (i * Math.PI) / 16;
      pts.push([len / 2 + r * Math.cos(t), r * Math.sin(t)]);
    }
    for (let i = 0; i <= 16; i++) {
      const t = Math.PI / 2 + (i * Math.PI) / 16;
      pts.push([-len / 2 + r * Math.cos(t), r * Math.sin(t)]);
    }
    const a = (deg * Math.PI) / 180;
    return poly(
      pts.map(([x, y]) => [
        cx + x * Math.cos(a) - y * Math.sin(a),
        cy + x * Math.sin(a) + y * Math.cos(a),
      ]),
    );
  };
  return loop(7, 3.6) + loop(7, 1.9);
};
const one = (title: string, fill: string, d: string, evenodd = false) => ({
  title,
  parts: [{ d, fill, evenodd }],
});

/** Material-style everyday icons (generic shapes, one colour each). */
export const iconSymbols: SymbolDef[] = [
  one("Home", "#3b82f6", poly([[12, 3], [22, 11.5], [19.5, 11.5], [19.5, 21], [14.5, 21], [14.5, 15], [9.5, 15], [9.5, 21], [4.5, 21], [4.5, 11.5], [2, 11.5]])),
  { title: "Search", parts: [{ d: ring(10, 10, 7, 4.6), fill: "#0f766e", evenodd: true }, { d: link(14.8, 14.8, 21, 21, 3), fill: "#0f766e" }] },
  one("Settings", "#64748b", gear(), true),
  one("Star", "#f59e0b", star(12, 12.6, 5, 10.2, 4.3)),
  { title: "Mail", parts: [{ d: rrect(2.5, 5, 19, 14, 2), fill: "#ef4444" }, { d: poly([[3.6, 6.4], [12, 12.8], [20.4, 6.4], [20.4, 8.8], [12, 15.2], [3.6, 8.8]]), fill: "#fff7f2" }] },
  one("Place", "#e11d48", "M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7z" + circle(12, 9, 2.7), true),
  { title: "Camera", parts: [{ d: rrect(2, 7, 20, 13, 2.5), fill: "#6366f1" }, { d: rrect(8, 4.5, 8, 4, 1), fill: "#6366f1" }, { d: circle(12, 13.5, 4.3), fill: "#f5f3ff" }, { d: circle(12, 13.5, 2.5), fill: "#6366f1" }] },
  { title: "Music", parts: [{ d: rect(13, 3, 2.4, 13.5), fill: "#8b5cf6" }, { d: poly([[15.4, 3], [21, 5.6], [21, 8.6], [15.4, 6.6]]), fill: "#8b5cf6" }, { d: ellipse(10.6, 17, 4, 3.3), fill: "#8b5cf6" }] },
  { title: "Cloud", parts: [{ d: circle(8, 14, 5), fill: "#0ea5e9" }, { d: circle(13.2, 10.5, 6), fill: "#0ea5e9" }, { d: circle(17.8, 14.6, 4.4), fill: "#0ea5e9" }, { d: rrect(4, 14, 18.2, 5, 2.5), fill: "#0ea5e9" }] },
  { title: "Idea", parts: [{ d: circle(12, 9.5, 6.6), fill: "#eab308" }, { d: poly([[8.8, 13.6], [15.2, 13.6], [14.4, 17.6], [9.6, 17.6]]), fill: "#eab308" }, { d: rrect(9.2, 18.1, 5.6, 3.3, 1.2), fill: "#78716c" }] },
  { title: "Alarm", parts: [{ d: ring(12, 13, 8, 6), fill: "#f97316", evenodd: true }, { d: rect(11.2, 8.4, 1.7, 5.4), fill: "#f97316" }, { d: link(12, 13.2, 15.6, 15.6, 1.7), fill: "#f97316" }, { d: circle(4.8, 5, 2.6), fill: "#f97316" }, { d: circle(19.2, 5, 2.6), fill: "#f97316" }] },
  one("Bookmark", "#14b8a6", poly([[6, 3], [18, 3], [18, 21], [12, 16.4], [6, 21]])),
  { title: "Globe", parts: [{ d: ring(12, 12, 9.6, 7.9), fill: "#2563eb", evenodd: true }, { d: ellipse(12, 12, 4.2, 9.6) + ellipse(12, 12, 2.6, 7.9), fill: "#2563eb", evenodd: true }, { d: rect(2.6, 11.15, 18.8, 1.7), fill: "#2563eb" }] },
  one("Bolt", "#eab308", poly([[13.6, 2], [5, 13.6], [11, 13.6], [9.6, 22], [19, 9.6], [13, 9.6]])),
  { title: "Rocket", parts: [{ d: "M12 2c3.5 3 5 7 5 11v4H7v-4c0-4 1.5-8 5-11z", fill: "#dc2626" }, { d: circle(12, 10, 2.1), fill: "#fef2f2" }, { d: poly([[7, 12.5], [3.6, 18], [7, 17.4]]) + poly([[17, 12.5], [20.4, 18], [17, 17.4]]), fill: "#991b1b" }, { d: poly([[9.4, 17.6], [14.6, 17.6], [12, 22.4]]), fill: "#f59e0b" }] },
  { title: "Palette", parts: [{ d: circle(12, 12, 9.6), fill: "#a855f7" }, { d: circle(8.8, 15.8, 2.4), fill: "#f3ecd3" }, { d: circle(7.6, 9.2, 1.8), fill: "#fde047" }, { d: circle(12, 6.6, 1.8), fill: "#22c55e" }, { d: circle(16.4, 9, 1.8), fill: "#3b82f6" }, { d: circle(16.6, 14.2, 1.8), fill: "#ef4444" }] },
  { title: "Flag", parts: [{ d: rect(5, 3, 2, 19), fill: "#475569" }, { d: poly([[7, 4], [19.5, 4], [16.2, 8.5], [19.5, 13], [7, 13]]), fill: "#16a34a" }] },
  { title: "Lock", parts: [{ d: "M7 11V8a5 5 0 0 1 10 0v3h-2.4V8a2.6 2.6 0 0 0-5.2 0v3z", fill: "#0891b2" }, { d: rrect(5, 10.5, 14, 11, 2), fill: "#0891b2" }, { d: circle(12, 15.6, 1.7), fill: "#ecfeff" }] },
];

/** Generic social-app symbols (no network logos or look-alikes). */
export const socialSymbols: SymbolDef[] = [
  { title: "Like", parts: [{ d: rrect(2.5, 10, 4.5, 11, 1), fill: "#2563eb" }, { d: "M8 10l4-7c1.6 0 2.6 1.1 2.3 2.7L13.6 9H19a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 17.6 21H8z", fill: "#2563eb" }] },
  one("Heart", "#e11d48", "M12 21s-8.6-5.2-8.6-11A4.8 4.8 0 0 1 12 6.8 4.8 4.8 0 0 1 20.6 10c0 5.8-8.6 11-8.6 11z"),
  { title: "Share", parts: [{ d: link(18, 5, 6, 12, 1.9) + link(6, 12, 18, 19, 1.9), fill: "#10b981" }, { d: circle(18, 5, 3.1), fill: "#10b981" }, { d: circle(6, 12, 3.1), fill: "#10b981" }, { d: circle(18, 19, 3.1), fill: "#10b981" }] },
  { title: "Chat", parts: [{ d: circle(12, 11, 9), fill: "#0ea5e9" }, { d: poly([[5, 15.5], [3.4, 22], [10.4, 18.8]]), fill: "#0ea5e9" }, { d: circle(8, 11, 1.5) + circle(12, 11, 1.5) + circle(16, 11, 1.5), fill: "#f0f9ff" }] },
  { title: "Comment", parts: [{ d: rrect(2.5, 3.5, 19, 14, 3), fill: "#f59e0b" }, { d: poly([[6, 16.5], [6, 22], [11.5, 16.5]]), fill: "#f59e0b" }, { d: rect(6, 7.4, 12, 1.9) + rect(6, 11.4, 8, 1.9), fill: "#fffbeb" }] },
  { title: "Photo", parts: [{ d: rrect(2.5, 4, 19, 16, 2.6), fill: "#ec4899" }, { d: poly([[5, 17.2], [10, 10.4], [13.6, 14.6], [15.6, 12.6], [19, 17.2]]), fill: "#fdf2f8" }, { d: circle(16, 8.4, 1.9), fill: "#fdf2f8" }] },
  one("Hashtag", "#7c3aed", bar(9.6, 12, 18, 2.3, 80) + bar(15, 12, 18, 2.3, 80) + rect(4, 7.9, 16.5, 2.3) + rect(3.4, 13.8, 16.5, 2.3)),
  { title: "Mention", parts: [{ d: "M20.5 12a8.5 8.5 0 1 0-4 7.2l-1-1.7A6.5 6.5 0 1 1 18.5 12v1.2a1.5 1.5 0 0 1-3 0V8h-2v.8A4.2 4.2 0 1 0 14.3 15a3.5 3.5 0 0 0 6.2-1.8z" + circle(11.5, 12, 2.3), fill: "#0d9488", evenodd: true }] },
  { title: "Bell", parts: [{ d: "M12 2.5a1.5 1.5 0 0 1 1.5 1.5v.7A6 6 0 0 1 18 10.5v4.3l2 2.7v1H4v-1l2-2.7v-4.3a6 6 0 0 1 4.5-5.8V4A1.5 1.5 0 0 1 12 2.5z", fill: "#f59e0b" }, { d: circle(12, 20.6, 2), fill: "#f59e0b" }] },
  { title: "Play", parts: [{ d: circle(12, 12, 10), fill: "#22c55e" }, { d: poly([[9.6, 7.4], [17.2, 12], [9.6, 16.6]]), fill: "#f0fdf4" }] },
  { title: "Friends", parts: [{ d: circle(9, 7.6, 3.6) + "M2.5 20.5c0-4 3-6.6 6.5-6.6s6.5 2.6 6.5 6.6z", fill: "#6366f1" }, { d: circle(16.8, 8.6, 2.9) + "M13.2 20.5c.3-3.1 1.9-5.3 3.6-5.4 2.8 0 4.9 2.3 4.9 5.4z", fill: "#a5b4fc" }] },
  { title: "Mic", parts: [{ d: rrect(9, 2.5, 6, 11.5, 3), fill: "#db2777" }, { d: "M5.5 11h2a4.5 4.5 0 0 0 9 0h2a6.5 6.5 0 0 1-5.5 6.4V20h3v2h-8v-2h3v-2.6A6.5 6.5 0 0 1 5.5 11z", fill: "#db2777" }] },
  { title: "Link", parts: [{ d: chainLink(8.4, 15.6, -45), fill: "#0284c7", evenodd: true }, { d: chainLink(15.6, 8.4, -45), fill: "#0284c7", evenodd: true }] },
  { title: "Smile", parts: [{ d: circle(12, 12, 10), fill: "#f59e0b" }, { d: circle(8.6, 9.6, 1.5) + circle(15.4, 9.6, 1.5), fill: "#78350f" }, { d: "M7 13.4h10a5 5 0 0 1-10 0z", fill: "#78350f" }] },
  { title: "Fire", parts: [{ d: "M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 1.5-5 3-6 0 2 1 3.5 2.5 3.5C11.5 8 11 5 12 2z", fill: "#f97316" }, { d: "M12 13c1.5 1.5 3 2.7 3 4.5a3 3 0 0 1-6 0c0-1.5 1-2.5 2-3.2.2 1 .7 1.5 1.3 1.5-.3-1-.4-2-.3-2.8z", fill: "#facc15" }] },
  { title: "Trophy", parts: [{ d: "M6.5 3h11v5.5a5.5 5.5 0 0 1-11 0z", fill: "#ca8a04" }, { d: ring(5, 7.4, 3, 1.5) + ring(19, 7.4, 3, 1.5), fill: "#ca8a04", evenodd: true }, { d: rect(10.8, 13.4, 2.4, 4), fill: "#a16207" }, { d: rrect(7, 17.2, 10, 3.6, 1), fill: "#a16207" }] },
  { title: "Megaphone", parts: [{ d: poly([[3, 9], [8, 9], [18, 4], [18, 20], [8, 15], [3, 15]]), fill: "#0ea5e9" }, { d: poly([[6, 15], [9, 15], [10, 21], [7, 21]]), fill: "#0369a1" }, { d: link(20, 9, 22.4, 7.4, 1.5) + link(20, 15, 22.4, 16.6, 1.5), fill: "#0369a1" }] },
  { title: "Send", parts: [{ d: poly([[2, 11], [22, 3], [15, 21], [11.5, 13.5]]), fill: "#22c55e" }, { d: poly([[11.5, 13.5], [22, 3], [13.2, 15.4]]), fill: "#15803d" }] },
];

/** Drawn pieces of the India pack (the rest are emoji). */
const spokes = Array.from({ length: 24 }, (_, i) => bar(12, 12, 15.4, 0.75, i * 7.5)).join("");
export const indiaSymbols: SymbolDef[] = [
  { title: "Tricolour", parts: [{ d: rect(3.4, 4.4, 17.2, 15.2) + rect(4, 5, 16, 14), fill: "#9ca3af", evenodd: true }, { d: rect(4, 5, 16, 4.7), fill: "#ff9933" }, { d: rect(4, 9.7, 16, 4.6), fill: "#ffffff" }, { d: rect(4, 14.3, 16, 4.7), fill: "#138808" }, { d: ring(12, 12, 2.1, 1.5) + circle(12, 12, 0.6), fill: "#000080", evenodd: true }] },
  { title: "Wheel", parts: [{ d: ring(12, 12, 9.8, 8.2), fill: "#000080", evenodd: true }, { d: spokes, fill: "#000080" }, { d: circle(12, 12, 1.8), fill: "#000080" }] },
  { title: "India Gate", parts: [{ d: "M3 3.5h18V6h-1v15h-5.5v-7.5a2.5 2.5 0 0 0-5 0V21H4V6H3z", fill: "#b45309" }, { d: rect(5, 7.4, 14, 1.4), fill: "#78350f" }] },
  { title: "Lotus Temple", parts: [{ d: "M12 3c3 4 3 10 0 15-3-5-3-11 0-15z", fill: "#94a3b8" }, { d: "M4 18c0-5 3-9 7-10-1 4-1 7 1 10z" + "M20 18c0-5-3-9-7-10 1 4 1 7-1 10z", fill: "#64748b" }, { d: rect(3, 18, 18, 2.6), fill: "#475569" }] },
  { title: "Samosa", parts: [{ d: poly([[12, 3], [21.6, 20], [2.4, 20]]), fill: "#d97706" }, { d: poly([[12, 7.6], [17.6, 17.6], [6.4, 17.6]]), fill: "#fbbf24" }, { d: circle(11, 14.6, 1) + circle(13.4, 15.4, 0.9) + circle(12, 12.4, 0.8), fill: "#65a30d" }] },
  { title: "Rangoli", parts: [{ d: star(12, 12, 8, 10.4, 5.6), fill: "#db2777" }, { d: star(12, 12, 8, 6.6, 3.4, -67.5), fill: "#f59e0b" }, { d: circle(12, 12, 2.2), fill: "#16a34a" }] },
  { title: "Feather", parts: [{ d: "M12 2c4 4 6 8 6 11a6 6 0 0 1-12 0c0-3 2-7 6-11z", fill: "#0f766e" }, { d: ellipse(12, 13, 3.4, 3.9), fill: "#1d4ed8" }, { d: circle(12, 13.3, 1.6), fill: "#172554" }, { d: rect(11.4, 18.8, 1.2, 3.6), fill: "#78350f" }] },
];
