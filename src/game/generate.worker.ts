import {
  generatePuzzle,
  validatePuzzle,
  type Slot,
} from "../../packages/engine/src/index";
self.onmessage = (
  e: MessageEvent<{ slots: Slot[]; seed: string; id: string }>,
) => {
  try {
    const p = generatePuzzle(e.data.slots, e.data.seed, "custom");
    p.id = e.data.id;
    const r = validatePuzzle(p);
    if (!r.valid) throw Error(r.errors.join("; "));
    self.postMessage({ puzzle: p });
  } catch (e) {
    self.postMessage({ error: String(e) });
  }
};
