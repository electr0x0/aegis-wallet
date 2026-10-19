import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AppShell } from "@/components/wallet/app-shell";
import { WalletProvider } from "@/components/wallet/wallet-provider";
import "./globals.css";
export const metadata: Metadata = {
  title: "AegisWallet · Agent Control",
  description:
    "Autonomous execution. Deterministic boundaries. Base Sepolia wallet control.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <WalletProvider>
          <AppShell>{children}</AppShell>
        </WalletProvider>
      </body>
    </html>
  );
}
