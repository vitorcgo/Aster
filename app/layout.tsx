import type { Metadata, Viewport } from "next";
import { Geist, IBM_Plex_Mono } from "next/font/google";
import { StudioHost } from "@/components/StudioHost";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex", display: "swap" });

export const metadata: Metadata = {
  title: "Aster",
  description: "Agente de estudos que pesquisa nas aulas e na web e mostra cada fonte.",
};

export const viewport: Viewport = {
  themeColor: "#0a4fb8",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${geist.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <StudioHost />
        {children}
      </body>
    </html>
  );
}
