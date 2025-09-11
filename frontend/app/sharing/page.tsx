"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "../../lib/session";
import { API_ORIGIN, apiGet, apiPost } from "../../lib/api";

type Me = {
  user?: { id: string; username: string; email: string; createdAt: string };
};
type Shared = {
  id: string;
  feedId: string;
  title: string | null;
  url: string | null;
  contentHtml?: string | null;
  contentText?: string | null;
  imageUrl?: string | null;
  publishedAt: string | null;
  sharedAt: string | null;
  note?: string | null;
};

export default function SharingPage() {
  const { token, hydrated } = useSession();
  const router = useRouter();
  const [me, setMe] = useState<Me["user"] | null>(null);
  const [items, setItems] = useState<Shared[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // token is provided by SessionProvider; wait for hydration before redirect
  useEffect(() => {
    if (hydrated && !token) {
      // Redirect unauthenticated users to login
      try {
        router.push("/login");
      } catch {}
    }
  }, [hydrated, token, router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const meRes = await apiGet<Me>("/me", { token });
      setMe(meRes.user || null);
      const data = await apiGet<{ items: any[] }>("/sharing/me", { token });
      const mapped: Shared[] = data.items.map((r: any) => ({
        id: r.id,
        feedId: r.feedId,
        title: r.title,
        url: r.url,
        contentHtml: r.contentHtml,
        contentText: r.contentText,
        imageUrl: r.imageUrl,
        publishedAt: r.publishedAt,
        sharedAt: r.sharedAt,
        note: r.note ?? null,
      }));
      setItems(mapped);
    } catch (e: any) {
      setError(e?.message || "Failed to load shared items");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const unshare = useCallback(
    async (id: string) => {
      if (!token) return;
      try {
        await apiPost(
          `/sharing/items/${id}/share`,
          { share: false },
          { token }
        );
        setItems((prev) => prev.filter((i) => i.id !== id));
      } catch (e: any) {
        setError(e?.message || "Failed to unshare");
      }
    },
    [token]
  );

  const rssUrl = me?.username
    ? `${API_ORIGIN}/sharing/${me.username}/rss`
    : null;

  if (!token) {
    return (
      <main className="p-6">
        <div className="text-sm text-gray-600">
          Login to view your shared items.
        </div>
      </main>
    );
  }

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">My shared items</h1>
        <a className="text-blue-600 underline text-sm" href="/">
          ← Back
        </a>
      </div>

      {rssUrl && (
        <div className="text-sm">
          Public RSS:{" "}
          <a
            className="text-blue-700 underline break-all"
            href={rssUrl}
            target="_blank"
            rel="noreferrer"
          >
            {rssUrl}
          </a>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-600">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-600">No shared items yet.</div>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.id} className="border rounded p-3">
              <div className="flex items-center justify-between">
                <a
                  className="font-medium text-blue-700 hover:underline"
                  href={it.url || "#"}
                  target="_blank"
                  rel="noreferrer"
                >
                  {it.title || "(no title)"}
                </a>
                <button
                  className="text-xs px-2 py-1 rounded border"
                  onClick={() => unshare(it.id)}
                >
                  Unshare
                </button>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {it.publishedAt
                  ? new Date(it.publishedAt).toLocaleString()
                  : ""}
                {it.sharedAt
                  ? ` • Shared ${new Date(it.sharedAt).toLocaleString()}`
                  : ""}
              </div>
              {it.note && (
                <div className="text-sm text-gray-700 mt-2">
                  Note: {it.note}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
