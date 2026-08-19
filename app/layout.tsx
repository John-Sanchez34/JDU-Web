import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, Public_Sans } from "next/font/google";
import { studio } from "@/content/studio";
import "./globals.css";

/*
 * Three faces, each with one job. Archivo carries the display voice — set wide
 * and heavy rather than the condensed weight a dance poster would usually
 * reach for, so headings read as planted rather than airborne. Public Sans is
 * the reading face. Plex Mono sets every time, price, and age, so schedule
 * columns line up on their digits.
 */
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: studio.name,
    template: `%s — ${studio.name}`,
  },
  description: studio.tagline,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${publicSans.variable} ${plexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
