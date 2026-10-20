"use client";

import { useAccount } from "@/context/AccountProvider";
import { AuthScreen } from "@/components/AuthScreen";
import { Dashboard } from "@/components/Dashboard";
import { TopBar } from "@/components/TopBar";
import { Spinner } from "@/components/ui";

export default function Home() {
  const { account, loading } = useAccount();
  return (
    <>
      <TopBar />
      <main>{loading ? <Spinner /> : account ? <Dashboard key={account.uid} /> : <AuthScreen />}</main>
    </>
  );
}
