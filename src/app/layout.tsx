import type { Metadata, Viewport } from "next";
import { Fredoka, Inter } from "next/font/google";
import "./globals.css";
import { AccountProvider } from "@/context/AccountProvider";
import { UIProvider } from "@/components/ui";

const fredoka = Fredoka({ variable: "--font-fredoka", subsets: ["latin"], weight: ["500", "600", "700"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Skip-Bo Online",
  description: "Play Skip-Bo with friends or against computer opponents. Accounts, win rates and history synced across devices.",
};

export const viewport: Viewport = { themeColor: "#12452e" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fredoka.variable} ${inter.variable} h-full antialiased`}>
      <body className="min-h-full font-sans text-white">
        <AccountProvider>
          <UIProvider>{children}</UIProvider>
        </AccountProvider>
      </body>
    </html>
  );
}
