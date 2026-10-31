import { test } from "vitest";
import assert from "node:assert/strict";
import { faceKey, packs } from "../../../src/game/TileDefinitions";
import { dealBoard, facesFor, levelMix } from "../../../src/game/TileGenerator";
import { levels } from "../../../src/services/content";
import { generateEndless } from "../../../src/services/endless";

test("every pack has enough distinct faces and no face is in two packs", () => {
  const seen = new Map<string, string>();
  for (const p of packs) {
    assert.ok(p.faces.length >= 9, `${p.name} has ${p.faces.length} faces`);
    for (const f of p.faces) {
      const key = faceKey(f);
      assert.ok(!seen.has(key), `${key} is in ${seen.get(key)} and ${p.name}`);
      seen.set(key, p.name);
    }
  }
  for (const p of packs)
    for (const f of p.faces)
      if (f.kind === "emoji")
        assert.match(f.char, /^\p{Extended_Pictographic}/u, `${p.name}: "${f.char}" is not an emoji`);
  assert.equal(packs.find((p) => p.name === "Fruits")!.faces.length, 19);
  assert.equal(packs.find((p) => p.name === "India")!.faces.length, 19);
  for (const name of ["Fruits", "Icons", "Social", "India"])
    assert.ok(packs.some((p) => p.name === name), `${name} pack exists`);
});

test("new packs open after level 60, 75, 90 and 100", () => {
  assert.equal(levelMix(60).fruit, undefined);
  assert.ok(levelMix(61).fruit > 0);
  assert.ok(levelMix(76).icon > 0);
  assert.ok(levelMix(91).social > 0);
  assert.equal(levelMix(100).india, undefined);
  assert.ok(levelMix(101).india > 0);
});

test("no board ever shows the same picture twice, with every pack open", () => {
  const boards = [
    ...levels.map((l) => ({ puzzle: l.puzzle, n: l.number })),
    ...[101, 140, 175].map((n) => ({ puzzle: generateEndless(n), n })),
  ];
  const tagsSeen = new Set<string>();
  for (const { puzzle, n } of boards) {
    const s = dealBoard(puzzle, n),
      faces = Object.values(facesFor(s.tiles, puzzle.id, n));
    s.tiles.forEach((t) => tagsSeen.add(t.tag ?? ""));
    const keys = faces.map(faceKey);
    assert.equal(new Set(keys).size, keys.length, `level ${n} repeats a face`);
  }
  for (const tag of ["fruit", "icon", "social", "india"])
    assert.ok(tagsSeen.has(tag), `${tag} tiles appear on some board`);
});
