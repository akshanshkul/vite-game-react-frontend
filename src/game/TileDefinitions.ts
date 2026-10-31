// TileDefinitions: every face a tile can show, grouped into categories and
// packs that unlock with campaign progress. Matching is always by match group
// (plus bonus pairing); a face is only the picture a group wears on one board.
import {
  siAngular,
  siCplusplus,
  siCss,
  siDart,
  siDjango,
  siDocker,
  siFlutter,
  siGit,
  siGithub,
  siGo,
  siHtml5,
  siJavascript,
  siKotlin,
  siLaravel,
  siLinux,
  siMongodb,
  siMysql,
  siNodedotjs,
  siOpenjdk,
  siPhp,
  siPostgresql,
  siPython,
  siReact,
  siRuby,
  siRust,
  siSvelte,
  siSwift,
  siTailwindcss,
  siTypescript,
  siVuedotjs,
} from "simple-icons";
import {
  iconSymbols,
  indiaSymbols,
  socialSymbols,
  type SymbolDef,
  type SymbolPart,
} from "./symbols";
export type Category =
  | "traditional"
  | "programming"
  | "animal"
  | "fruit"
  | "icon"
  | "social"
  | "india";
export type Face =
  | { kind: "classic"; suit: string; glyph: string }
  | { kind: "emoji"; char: string; name: string }
  /** Brand logo from Simple Icons (CC0): 24×24 SVG path + brand colour. */
  | { kind: "logo"; title: string; path: string; hex: string }
  /** A player's own photo (128 px JPEG data URL), stored on the device. */
  | { kind: "photo"; id: string; src: string }
  /** Hand-drawn flat symbol: coloured 24 × 24 path parts. */
  | { kind: "symbol"; title: string; parts: SymbolPart[] };
/**
 * One distinct glyph per traditional match group, so tiles never need a
 * number: the two tiles of a group share it and no two groups do.
 */
export const glyphs: Record<string, string> = {
  ...Object.fromEntries(
    [..."竹松梅蘭菊荷柳桃楓"].map((g, i) => [`bamboo:${i + 1}`, g]),
  ),
  ...Object.fromEntries(
    [..."日月星雲雪雷山水火"].map((g, i) => [`dots:${i + 1}`, g]),
  ),
  ...Object.fromEntries(
    [..."福祿壽喜財吉和愛夢"].map((g, i) => [`characters:${i + 1}`, g]),
  ),
  ...Object.fromEntries([..."東南西北"].map((g, i) => [`winds:${i + 1}`, g])),
  ...Object.fromEntries([..."中發龍"].map((g, i) => [`dragons:${i + 1}`, g])),
  flowers: "花",
  seasons: "春",
};
export const colors: Record<string, string> = {
  bamboo: "#286441",
  dots: "#315c85",
  characters: "#a63f35",
  flowers: "#81521f",
  dragons: "#a63f35",
  seasons: "#654b86",
  winds: "#315c85",
};
export const emojiFont =
  '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
export const faceKey = (f: Face) =>
  f.kind === "classic"
    ? `c:${f.glyph}`
    : f.kind === "emoji"
      ? `e:${f.char}`
      : f.kind === "logo"
        ? `l:${f.title}`
        : f.kind === "symbol"
          ? `s:${f.title}`
          : `p:${f.id}`;
/** The traditional face for a match group. */
export const classicFace = (matchGroup: string, suit: string): Face => ({
  kind: "classic",
  suit,
  glyph: glyphs[matchGroup] ?? "?",
});
export const faceName = (f: Face) =>
  f.kind === "classic"
    ? f.suit
    : f.kind === "emoji"
      ? f.name
      : f.kind === "logo" || f.kind === "symbol"
        ? f.title
        : "My photo";
/** "🍏:Green apple 🍐:Pear" → faces; names may contain spaces. */
const animals = (list: string): Face[] =>
  list.split(/\s+(?=\S+:)/).map((pair) => {
    const [char, name] = pair.split(":");
    return { kind: "emoji", char, name };
  });
const drawn = (defs: SymbolDef[]): Face[] =>
  defs.map(({ title, parts }) => ({ kind: "symbol", title, parts }));
const logos = (...icons: { title: string; path: string; hex: string }[]): Face[] =>
  icons.map(({ title, path, hex }) => ({ kind: "logo", title, path, hex }));
export type Pack = {
  name: string;
  category: Category;
  /** Opens once this many campaign levels are cleared (0 = from the start). */
  after: number;
  faces: Face[];
};
export const TRADITIONAL_TYPES = 36;
/** Picture packs, oldest first. Java is shown with the OpenJDK logo. */
export const packs: Pack[] = [
  {
    name: "Animals",
    category: "animal",
    after: 5,
    faces: animals(
      "🐼:Panda 🐯:Tiger 🦊:Fox 🐰:Rabbit 🐘:Elephant 🦉:Owl 🦌:Deer 🦁:Lion 🦚:Peacock 🐢:Turtle 🐵:Monkey 🦋:Butterfly",
    ),
  },
  {
    name: "Code",
    category: "programming",
    after: 10,
    faces: logos(
      siPython,
      siJavascript,
      siPhp,
      siReact,
      siNodedotjs,
      siOpenjdk,
      siCplusplus,
      siHtml5,
      siCss,
      siMysql,
      siMongodb,
      siDocker,
    ),
  },
  {
    name: "Zodiac",
    category: "animal",
    after: 20,
    faces: animals(
      "🐭:Rat 🐮:Ox 🐉:Dragon 🐍:Snake 🐴:Horse 🐑:Goat 🐔:Rooster 🐶:Dog 🐷:Pig",
    ),
  },
  {
    name: "Code Pro",
    category: "programming",
    after: 30,
    faces: logos(
      siTypescript,
      siVuedotjs,
      siAngular,
      siSvelte,
      siGo,
      siRust,
      siRuby,
      siSwift,
      siKotlin,
      siDart,
      siFlutter,
      siGit,
      siGithub,
      siLinux,
      siTailwindcss,
      siPostgresql,
      siLaravel,
      siDjango,
    ),
  },
  {
    name: "Ocean",
    category: "animal",
    after: 40,
    faces: animals(
      "🐬:Dolphin 🦈:Shark 🦀:Crab 🐙:Octopus 🐳:Whale 🐠:Fish 🐡:Blowfish 🦑:Squid 🦞:Lobster 🐚:Shell 🐟:Carp 🦭:Seal 🐧:Penguin",
    ),
  },
  {
    name: "Forest",
    category: "animal",
    after: 50,
    faces: animals(
      "🐻:Bear 🐨:Koala 🦔:Hedgehog 🐿️:Chipmunk 🦝:Raccoon 🐺:Wolf 🦇:Bat 🐸:Frog 🐝:Bee",
    ),
  },
  {
    name: "Fruits",
    category: "fruit",
    after: 60,
    faces: animals(
      "🍎:Apple 🍏:Green apple 🍐:Pear 🍊:Orange 🍋:Lemon 🍌:Banana 🍉:Watermelon 🍇:Grapes 🍓:Strawberry 🫐:Blueberries 🍈:Melon 🍒:Cherries 🍑:Peach 🥭:Mango 🍍:Pineapple 🥥:Coconut 🥝:Kiwi 🍅:Tomato 🫒:Olive",
    ),
  },
  { name: "Icons", category: "icon", after: 75, faces: drawn(iconSymbols) },
  { name: "Social", category: "social", after: 90, faces: drawn(socialSymbols) },
  {
    name: "India",
    category: "india",
    after: 100,
    faces: [
      ...animals(
        "🕌:Taj Mahal 🛕:Temple ☕:Chai 🏏:Cricket 🪔:Diya 🪁:Kite 🛺:Auto-rickshaw 🐅:Tiger 🪘:Tabla 🍛:Curry 🥻:Sari 🎇:Diwali",
      ),
      ...drawn(indiaSymbols),
    ],
  },
];
/** Packs open on a level: everything with `after` below it (null = all). */
export const openPacks = (levelNumber: number | null) =>
  packs.filter((p) => levelNumber === null || levelNumber > p.after);
/** Tile types in play by a level (traditional + every open pack). */
export const totalTypes = (levelNumber: number | null) =>
  TRADITIONAL_TYPES +
  openPacks(levelNumber).reduce((n, p) => n + p.faces.length, 0);
/** Packs that open when this level is cleared. */
export const packsUnlockedBy = (levelNumber: number) =>
  packs.filter((p) => p.after === levelNumber);
