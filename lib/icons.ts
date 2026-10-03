// categories.icon is a fixed enum (CHECK in 0001_init.sql); the screens render the stored name as a glyph.
export const ICONS: Record<string, string> = {
  cog: "⚙️",
  bell: "🔔",
  goblet: "🍷",
  tower: "🏰",
  shield: "🛡️",
  hex: "⬡",
  star: "⭐",
  book: "📖",
  heart: "❤️",
  flag: "🚩",
};

export const iconGlyph = (icon: string) => ICONS[icon] ?? ICONS.hex;

// categories.color is any lowercase #rrggbb a captain picks, so text drawn on it must stay readable.
export function readableOn(color: string): "#000000" | "#ffffff" {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.4 ? "#000000" : "#ffffff";
}
