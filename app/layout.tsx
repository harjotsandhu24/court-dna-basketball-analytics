import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import MotionProvider from "@/components/MotionProvider";

export const metadata: Metadata = {
  title: "COURT DNA — Basketball Player Style Explorer",
  description:
    "Explore how basketball players score, create, defend, and evolve. An interactive analytics experience covering NBA player style, similarity, shot profiles, career evolution, and lineup identity from 2000-01 through 2025-26.",
  openGraph: {
    title: "COURT DNA — Basketball Player Style Explorer",
    description: "Explore how basketball players score, create, defend, and evolve.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <MotionProvider>
          <Nav />
          <main className="flex-1">{children}</main>
          <Footer />
        </MotionProvider>
      </body>
    </html>
  );
}
