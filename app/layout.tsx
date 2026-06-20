import type { Metadata } from "next";
import { Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

// Brand fonts. Bound to the design-system token variables (--font-sans / --font-mono
// are declared in app/tokens/typography.css with these families as the first choice).
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Run all serverless functions in Singapore to co-locate with the Neon DB.
// Eliminates the ~200ms US-East → Singapore cross-Pacific round trip per query.
export const preferredRegion = "sin1";

export const metadata: Metadata = {
  title: "Trackie — Datagami",
  description: "Collections & payments tracker for Datagami",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Theme is driven by a cookie so the server renders the correct `.dark` class —
  // no inline script, no flash of the wrong theme. The toggle updates the cookie.
  const theme = (await cookies()).get("theme")?.value;
  const dark = theme === "dark";

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${hanken.variable} ${ibmPlexMono.variable} h-full antialiased${dark ? " dark" : ""}`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
