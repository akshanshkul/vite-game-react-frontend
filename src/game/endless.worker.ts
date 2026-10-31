import { generateEndless } from "../services/endless";
// Generating and solver-verifying a 70–80 tile board can take a few seconds
// on a slow phone, so it runs here instead of on the UI thread.
self.onmessage = (e: MessageEvent<{ n: number }>) => {
  try {
    self.postMessage({ puzzle: generateEndless(e.data.n) });
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
