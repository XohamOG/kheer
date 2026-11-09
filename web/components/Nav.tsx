"use client";

import Link from "next/link";
import { useWallet } from "@/lib/wallet";

export function Nav() {
  const { account, connect, disconnect } = useWallet();
  return (
    <nav className="nav">
      <Link href="/" className="brand">Kheer</Link>
      <Link href="/create">Teach</Link>
      <Link href="/limits">Limits</Link>
      {account ? (
        <button className="btn quiet small" onClick={() => void disconnect()} title="Disconnect">
          {account}
        </button>
      ) : (
        <button className="btn small" onClick={() => void connect()}>Connect</button>
      )}
    </nav>
  );
}
