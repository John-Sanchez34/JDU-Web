import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dance Studio",
  description: "Classes, schedule, and enrollment for our dance studio.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
