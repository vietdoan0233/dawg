// One inline SVG set for the whole app (no emoji as icons). Category icons follow categories.icon (CHECK in 0001).
const PATHS: Record<string, string> = {
  // categories
  cog: "M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0",
  goblet: "M7 3h10l-.8 6a4.2 4.2 0 0 1-8.4 0zM12 13.5V19M8 21h8",
  tower: "M5 21V9h2V5h2v2h2V5h2v2h2V5h2v4h2v12zM10 21v-4a2 2 0 0 1 4 0v4",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  hex: "M12 2.5l8.5 4.9v9.2L12 21.5l-8.5-4.9V7.4z",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
  book: "M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h13",
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
  flag: "M5 21V4M5 4h12l-2 4 2 4H5",
  // interface
  check: "M5 12.5l4.5 4.5L19 7.5",
  lock: "M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3",
  keyhole: "M12 3a4.5 4.5 0 0 0-2.2 8.4L8 21h8l-1.8-9.6A4.5 4.5 0 0 0 12 3z",
  clock: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2",
  x: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  target: "M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  sound: "M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11",
  mute: "M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2M14 18h2v2M18 18h2v2h-2",
  trophy: "M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 21h6M10 17h4v4h-4",
  map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
  home: "M3 11.5 12 4l9 7.5M5.5 10v10h5v-6h3v6h5V10",
  logout: "M14 4h5v16h-5M10 12h10M6 8l-4 4 4 4",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 8.5a1 1 0 1 0 0 .1",
  send: "M4 12l16-8-6 16-3-6zM11 14l9-10",
  inbox: "M4 13l2.5-8h11L20 13v6H4zM4 13h5a3 3 0 0 0 6 0h5",
  scan: "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 12h16",
  crown: "M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18.5 14a6.5 6.5 0 0 1 3 6",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
};

export function Icon({ name, size = 20, label, className }: { name: string; size?: number; label?: string; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name] ?? PATHS.hex} />
    </svg>
  );
}
