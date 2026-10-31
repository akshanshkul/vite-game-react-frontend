import type { Slot } from "../engine/src/index";
const patterns = [
  ["Jade Terrace", [8, 8, 8, 8]],
  ["Lotus", [4, 6, 8, 6, 4]],
  ["Moon Gate", [8, 4, 4, 8]],
  ["Bamboo Grove", [4, 4, 4, 4, 4, 4]],
  ["Butterfly", [8, 6, 4, 6, 8]],
  ["Cloud Steps", [4, 6, 8, 8]],
  ["River Bend", [6, 8, 6, 4]],
  ["Lantern", [4, 8, 8, 4]],
  ["Stone Bridge", [8, 8, 4, 4]],
  ["Mountain", [2, 4, 6, 8, 8]],
] as const;
export const layouts = patterns.map(([name, rows], i) => {
  const slots: Slot[] = [];
  rows.forEach((n, y) => {
    for (let x = 0; x < n; x++)
      slots.push({ id: `t${slots.length}`, x: 8 - n + x * 2, y: y * 2, z: 0 });
  });
  if (i % 2 === 0)
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++)
        slots.push({
          id: `t${slots.length}`,
          x: 6 + x * 2,
          y: 2 + y * 2,
          z: 1,
        });
  return { id: `layout-${i + 1}`, name, version: 1, slots };
});
/**
 * Campaign boards grow one small step per level so difficulty rises steadily:
 * the tile count climbs from 12 (level 1) to 80 (level 100). Boards stay
 * within 7 × 7 tiles so tiles remain tappable on phones; bigger boards gain
 * stacked layers instead. The ten named patterns only set each outline.
 */
export function campaignLayout(level: number) {
  const [name, pattern] = patterns[(level - 1) % patterns.length],
    // Grows to 80 tiles at level 100, then stays there for endless levels.
    target = 2 * Math.round(Math.min(80, 12 + ((level - 1) * 68) / 99) / 2),
    build = (width: number, rows: number, layers: number) => {
      const slots: Slot[] = [];
      // Each layer is one tile narrower than the one below and sits half a
      // tile in, so every upper tile rests across two lower ones.
      for (let z = 0; z < layers; z++)
        for (let r = z >> 1; r < rows - (z >> 1); r++) {
          const n =
            Math.min(
              7,
              Math.max(1, Math.round((width * pattern[r % pattern.length]) / 8)),
            ) - z;
          for (let i = 0; i < n; i++)
            slots.push({ id: `t${slots.length}`, x: 7 - n + i * 2, y: r * 2, z });
        }
      return slots;
    };
  let slots: Slot[] = [];
  search: for (let layers = Math.min(6, 1 + Math.floor(level / 25)); layers <= 6; layers++)
    for (let rows = Math.min(7, 3 + Math.floor(level / 16)); rows <= 7; rows++)
      for (let width = 3; width <= 14; width++) {
        slots = build(width, rows, layers);
        if (slots.length >= target) break search;
      }
  // Trim from the top of the stack down to exactly the target count.
  slots = slots.slice(0, target);
  return { id: `campaign-${level}`, name, version: 2, slots };
}
