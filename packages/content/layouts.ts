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
