import type { Metadata, Viewport } from "next";
import { Alegreya_Sans, Cinzel } from "next/font/google";
import "./globals.css";

// Cinzel echoes the guild poster's engraved titles; Alegreya Sans stays readable at phone sizes.
const display = Cinzel({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-display" });
const body = Alegreya_Sans({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Fuksipisteet",
  description: "Your fuksi year as a skill tree: join events, complete tasks and earn points with your tutor group.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#120f0c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
