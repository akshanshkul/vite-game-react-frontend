// Player-made tiles: an emoji or a photo, kept in IndexedDB on this device
// only (never uploaded). Photos are cropped square and shrunk to 128 px.
import { db } from "./storage";
import type { Face } from "../game/TileDefinitions";
export type CustomTile = {
  id: string;
  kind: "emoji" | "photo";
  /** The emoji itself, or a JPEG data URL for photos. */
  value: string;
  created: number;
};
const KEY = "customTiles";
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_SIZE = 128;
/** One emoji (a single grapheme that is a pictograph), or null. */
export function validEmoji(text: string): string | null {
  const value = text.trim();
  if (!value) return null;
  const graphemes = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      value,
    ),
  ];
  return graphemes.length === 1 && /\p{Extended_Pictographic}/u.test(value)
    ? value
    : null;
}
const isTile = (t: unknown): t is CustomTile => {
  const c = t as CustomTile;
  return (
    !!c &&
    typeof c.id === "string" &&
    typeof c.created === "number" &&
    ((c.kind === "emoji" && validEmoji(c.value) === c.value) ||
      (c.kind === "photo" &&
        typeof c.value === "string" &&
        c.value.startsWith("data:image/jpeg;base64,") &&
        c.value.length < 400_000))
  );
};
export async function loadCustomTiles(): Promise<CustomTile[]> {
  const row = await db.meta.get(KEY);
  return Array.isArray(row?.value) ? row.value.filter(isTile) : [];
}
export const saveCustomTiles = (tiles: CustomTile[]) =>
  db.meta.put({ id: KEY, value: tiles });
/** Centre-crops an image file to a square JPEG data URL of 128 × 128 px. */
export async function photoToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/"))
    throw Error("Please choose an image file (JPEG, PNG, WebP…).");
  if (file.size > MAX_PHOTO_BYTES)
    throw Error("That photo is larger than 10 MB. Please pick a smaller one.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw Error("This image could not be read. Try another photo.");
  }
  const side = Math.min(bitmap.width, bitmap.height),
    canvas = document.createElement("canvas");
  canvas.width = canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    PHOTO_SIZE,
    PHOTO_SIZE,
  );
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}
export const customFace = (t: CustomTile): Face =>
  t.kind === "emoji"
    ? { kind: "emoji", char: t.value, name: "My tile" }
    : { kind: "photo", id: t.id, src: t.value };
