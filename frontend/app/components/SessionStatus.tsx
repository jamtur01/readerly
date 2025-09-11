"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "../../lib/session";
import { apiGet } from "../../lib/api";

type Me = { user?: { id: string; username: string; email: string } };

export default function SessionStatus() {
  const { token, logout } = useSession();
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setUsername(null);
        return;
      }
      try {
        const res = await apiGet<Me>("/me", { token });
        if (!cancelled) setUsername(res.user?.username || null);
      } catch {
        if (!cancelled) setUsername(null);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [token]);

  if (!token) {
    return (
      <div className="text-sm">
        <Link className="text-blue-600 underline" href="/login">Sign in</Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gray-600 dark:text-gray-300">{username ? `@${username}` : `Signed in`}</span>
      <button
        className="text-xs px-2 py-1 rounded border"
        onClick={() => logout()}
        title="Logout"
      >
        Logout
      </button>
    </div>
  );
}