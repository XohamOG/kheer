import type { Metadata } from "next";
import { Inter_Tight } from "next/font/google";
import type { ReactNode } from "react";
import { WalletProvider } from "@/lib/wallet";
import { Nav } from "@/components/Nav";
import "./globals.css";

const font = Inter_Tight({ subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: { default: "Kheer", template: "%s – Kheer" },
  description: "AI is learning your job. Own the AI that does it.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={font.className}>
        <WalletProvider>
          <header className="bar">
            <div className="testnet">Testnet. No real money.</div>
            <Nav />
          </header>
          <main>{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
