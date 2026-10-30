// FNV-1a over UTF-16 code units seeds mulberry32; all arithmetic is unsigned 32-bit.
export function prng(seed: string) {
  let n = 2166136261;
  for (let i = 0; i < seed.length; i++)
    n = Math.imul(n ^ seed.charCodeAt(i), 16777619) >>> 0;
  return () => {
    n = (n + 0x6d2b79f5) >>> 0;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
