"use client";

import Link from "next/link";
import { useAccount } from "@/context/AccountProvider";
import { Avatar } from "./ui";

export function TopBar({ children }: { children?: React.ReactNode }) {
  const { account, signOut } = useAccount();
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-white/10 bg-black/20 px-4 py-2.5 backdrop-blur-md">
      <Link href="/" className="flex items-center gap-2 font-display text-[1.35rem] font-bold whitespace-nowrap">
        <span className="grid h-10 w-[30px] -rotate-8 place-items-center rounded-md border-2 border-white bg-linear-to-br from-sb-from to-sb-to text-xs">SB</span>
        Skip-Bo
      </Link>
      {account && (
        <nav className="flex items-center gap-2">
          <span className="mr-1 flex items-center gap-2 font-semibold">
            <Avatar name={account.name} />
            <span className="hidden sm:inline">{account.name}</span>
          </span>
          {children}
          <button className="btn btn-ghost btn-sm" onClick={() => signOut()}>
            Sign out
          </button>
        </nav>
      )}
    </header>
  );
}
