import {
  solve,
  shuffle,
  type State,
} from "../../packages/engine/src/index";
self.onmessage = (
  event: MessageEvent<{ state: State; kind: "hint" | "shuffle"; seed: string }>,
) => {
  const { state, kind, seed } = event.data;
  try {
    self.postMessage(
      kind === "shuffle"
        ? { state: shuffle(state, seed) }
        : { result: solve(state.tiles, { maxNodes: 100000, maxMs: 500 }) },
    );
  } catch {
    self.postMessage({ error: "Search failed. You can restart or undo." });
  }
};
