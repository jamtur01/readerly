"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  API_ORIGIN,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  flushOfflineQueue,
} from "../lib/api";
import { useSession } from "../lib/session";
import SessionStatus from "./components/SessionStatus";
import {
  makeListKey,
  putItems,
  getList,
  updateItemState,
  updateManyStates,
} from "../lib/offlineStore";

type Item = {
  id: string;
  feedId?: string;
  title: string | null;
  url: string | null;
  contentHtml?: string | null;
  contentText?: string | null;
  imageUrl?: string | null;
  publishedAt: string | null;
  state?: { read?: boolean; starred?: boolean; shared?: boolean };
};

type Filter = "all" | "unread" | "starred";

type Subscription = {
  id: string;
  feedId: string;
  tags: string[] | null;
  sortOrder: number | null;
  feed: { id: string; url: string; title: string | null };
  folder: { id: string; name: string } | null;
  unreadCount?: number;
};

// Helper: strip HTML to plain text for previews/details
function stripHtml(html: string): string {
  if (!html) return "";
  try {
    if (typeof window !== "undefined") {
      const div = document.createElement("div");
      div.innerHTML = html;
      const text = (div.textContent || div.innerText || "").trim();
      return text.replace(/\s+/g, " ");
    }
  } catch {}
  // SSR or fallback
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export default function HomePage() {
  const [apiOk, setApiOk] = useState<boolean>(false);
  const { token, logout, hydrated } = useSession();
  const router = useRouter();

  // Sidebar data
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);

  // Search
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Items pane
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);
  const [showFull, setShowFull] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [density, setDensity] = useState<"comfortable" | "compact">(
    "comfortable"
  );
  const listRef = useRef<HTMLUListElement | null>(null);
  // Collapsible sidebar sections
  const [showCategories, setShowCategories] = useState(true);
  const [showSubs, setShowSubs] = useState(true);
  // Per-folder collapse state
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Suppress auto-mark-read for items the user explicitly marked as unread
  const noAutoRead = useRef<Set<string>>(new Set());
  useEffect(() => {
    try {
      setIsDark(document.documentElement.classList.contains("dark"));
    } catch {}
  }, []);

  // Saved searches
  type SavedSearch = { id: string; name: string; query: string; filters?: any };
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [newFeedUrl, setNewFeedUrl] = useState("");

  // Categories (folders)
  type Folder = { id: string; name: string };
  const [folders, setFolders] = useState<Folder[]>([]);
  const [newFolderName, setNewFolderName] = useState("");

  const page = 1;
  const pageSize = 30;

  /** Service worker registration and initial health check */
  useEffect(() => {
    (async () => {
      try {
        if (typeof window !== "undefined" && "serviceWorker" in navigator) {
          // Register service worker for offline caching
          navigator.serviceWorker
            .register("/service-worker.js")
            .catch(() => {});
        }
        const res = await fetch(`${API_ORIGIN}/health`, { cache: "no-store" });
        setApiOk(res.ok);
      } catch {
        setApiOk(false);
      }
    })();
    // Kick off a best-effort flush of any queued offline writes
    void flushOfflineQueue();
  }, []);

  // Token is provided by SessionProvider
  useEffect(() => {
    if (hydrated && !token) {
      // Redirect unauthenticated users to login after hydration
      try {
        router.push("/login");
      } catch {}
    }
  }, [hydrated, token, router]);

  // Load subscriptions after token
  const loadSubs = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiGet<{ subscriptions: Subscription[] }>(
        "/subscriptions",
        { token }
      );
      setSubs(data.subscriptions);
    } catch (e) {
      // Non-fatal; show inline later as needed
    }
  }, [token]);

  useEffect(() => {
    loadSubs();
  }, [loadSubs]);

  // Load saved searches
  const loadSaved = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiGet<{ searches: SavedSearch[] }>(
        "/saved-searches",
        { token }
      );
      setSaved(data.searches);
    } catch {
      // ignore
    }
  }, [token]);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  // Load folders (categories)
  const loadFolders = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiGet<{ folders: Folder[] }>("/folders", { token });
      setFolders(data.folders);
    } catch {
      // ignore
    }
  }, [token]);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  // Folder CRUD
  const createFolder = useCallback(async () => {
    if (!token) return;
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await apiPost("/folders", { name }, { token });
      setNewFolderName("");
      await loadFolders();
    } catch (e: any) {
      setError(e?.message || "Failed to create category");
    }
  }, [token, newFolderName, loadFolders]);

  const renameFolder = useCallback(
    async (id: string) => {
      if (!token) return;
      const current = folders.find((f) => f.id === id)?.name || "";
      const name = window.prompt("Rename category:", current);
      if (!name || name === current) return;
      try {
        await apiPatch(`/folders/${id}`, { name }, { token });
        await loadFolders();
      } catch (e: any) {
        setError(e?.message || "Failed to rename category");
      }
    },
    [token, folders, loadFolders]
  );

  const deleteFolder = useCallback(
    async (id: string) => {
      if (!token) return;
      if (!window.confirm("Delete this category? Feeds will be uncategorized."))
        return;
      try {
        await apiDelete(`/folders/${id}`, { token });
        await loadFolders();
        await loadSubs();
      } catch (e: any) {
        setError(e?.message || "Failed to delete category");
      }
    },
    [token, loadFolders, loadSubs]
  );

  // Group subs by folder
  const grouped = useMemo(() => {
    const groups = new Map<string, Subscription[]>();
    for (const s of subs) {
      const key = s.folder?.name || "Uncategorized";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    // Sort feeds by title within each group
    for (const [k, arr] of groups) {
      arr.sort((a, b) =>
        (a.feed.title || a.feed.url).localeCompare(b.feed.title || b.feed.url)
      );
      groups.set(k, arr);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [subs]);

  // Fetch items when token/filter/selectedFeedId changes
  const loadItems = useCallback(async () => {
    if (!token) return;
    setError(null);
    setLoading(true);
    const listKey = makeListKey({
      feedId: selectedFeedId || undefined,
      filter,
      q: debouncedQuery || undefined,
    });
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });

      // If there's a search query, use /search (FTS, relevance order by default)
      if (debouncedQuery) {
        params.set("q", debouncedQuery);
        // Carry over filters to search endpoint
        if (filter === "unread") params.set("read", "false");
        if (filter === "starred") params.set("starred", "true");
        if (selectedFeedId) params.set("feedId", selectedFeedId);

        const data = await apiGet<{ total: number; items: Item[] }>(
          `/search?${params.toString()}`,
          { token }
        );
        setItems(data.items);
        setSelectedIdx(data.items.length ? 0 : -1);
        await putItems(listKey, data.items as any);
        return;
      }

      // Otherwise, use /items with filters and date order
      params.set("order", "desc");
      if (filter === "unread") params.set("read", "false");
      if (filter === "starred") params.set("starred", "true");
      if (selectedFeedId) params.set("feedId", selectedFeedId);

      const data = await apiGet<{ total: number; items: Item[] }>(
        `/items?${params.toString()}`,
        { token }
      );
      setItems(data.items);
      setSelectedIdx(data.items.length ? 0 : -1);
      await putItems(listKey, data.items as any);
    } catch (e: any) {
      const cached = await getList(listKey);
      if (cached && cached.length) {
        setItems(cached as any);
        setSelectedIdx(cached.length ? 0 : -1);
        setError(null);
      } else {
        setError(e?.message || "Failed to load items");
      }
    } finally {
      setLoading(false);
    }
  }, [token, filter, selectedFeedId, debouncedQuery]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const current = selectedIdx >= 0 ? items[selectedIdx] : null;

  // Reset detail expansion when selection changes
  useEffect(() => {
    setShowFull(false);
  }, [selectedIdx]);

  const detail = useMemo(() => {
    if (!current) return { text: "", isLong: false, display: "" };
    const baseText =
      (current.contentText && current.contentText.trim().length > 0
        ? current.contentText
        : stripHtml(current.contentHtml || "")) || "";
    const limit = 800;
    const isLong = baseText.length > limit;
    const display = showFull
      ? baseText
      : isLong
      ? baseText.slice(0, limit) + "…"
      : baseText;
    return { text: baseText, isLong, display };
  }, [current, showFull]);

  // Actions
  const openCurrent = useCallback(() => {
    if (!current?.url) return;
    window.open(current.url, "_blank", "noopener,noreferrer");
  }, [current]);

  const toggleRead = useCallback(async () => {
    if (!current || !token) return;
    const next = !Boolean(current.state?.read);
    try {
      await apiPost(`/items/${current.id}/state`, { read: next }, { token });
      setItems((prev) =>
        prev.map((it) =>
          it.id === current.id
            ? { ...it, state: { ...(it.state || {}), read: next } }
            : it
        )
      );
      // Manage auto-read suppression based on user's explicit choice
      if (next === false) {
        noAutoRead.current.add(current.id);
        // expire suppression after 30s
        setTimeout(() => noAutoRead.current.delete(current.id), 30000);
      } else {
        noAutoRead.current.delete(current.id);
      }
      void loadSubs();
      void updateItemState(current.id, { read: next });
    } catch (e: any) {
      setError(e?.message || "Failed to toggle read");
    }
  }, [current, token, loadSubs]);

  const toggleStar = useCallback(async () => {
    if (!current || !token) return;
    const next = !Boolean(current.state?.starred);
    try {
      await apiPost(`/items/${current.id}/state`, { starred: next }, { token });
      setItems((prev) =>
        prev.map((it) =>
          it.id === current.id
            ? { ...it, state: { ...(it.state || {}), starred: next } }
            : it
        )
      );
      void updateItemState(current.id, { starred: next });
    } catch (e: any) {
      setError(e?.message || "Failed to toggle star");
    }
  }, [current, token]);

  const toggleShare = useCallback(async () => {
    if (!current || !token) return;
    const next = !Boolean(current.state?.shared);
    try {
      await apiPost(
        `/sharing/items/${current.id}/share`,
        { share: next },
        { token }
      );
      setItems((prev) =>
        prev.map((it) =>
          it.id === current.id
            ? { ...it, state: { ...(it.state || {}), shared: next } }
            : it
        )
      );
      void updateItemState(current.id, { shared: next });
    } catch (e: any) {
      setError(e?.message || "Failed to toggle share");
    }
  }, [current, token]);

  const ensureRead = useCallback(
    async (id: string) => {
      if (!token) return;
      // If user explicitly marked this item as unread, do not auto-mark it
      if (noAutoRead.current.has(id)) return;
      // Optimistic local update to avoid flicker
      let alreadyRead = false;
      setItems((prev) =>
        prev.map((p) => {
          if (p.id === id) {
            alreadyRead = Boolean(p.state?.read);
            return alreadyRead
              ? p
              : { ...p, state: { ...(p.state || {}), read: true } };
          }
          return p;
        })
      );
      if (alreadyRead) return;
      try {
        await apiPost(`/items/${id}/state`, { read: true }, { token });
        // since we've just explicitly marked as read, clear any suppression flag
        noAutoRead.current.delete(id);
        void updateItemState(id, { read: true });
        void loadSubs();
      } catch {
        // ignore; reconciliation will happen on next sync
      }
    },
    [token, loadSubs]
  );

  const markAllVisibleRead = useCallback(async () => {
    if (!token || items.length === 0) return;
    try {
      const itemIds = items.map((i) => i.id);
      await apiPost(`/items/mark-read-bulk`, { itemIds }, { token });
      setItems((prev) =>
        prev.map((it) => ({
          ...it,
          state: { ...(it.state || {}), read: true },
        }))
      );
      void updateManyStates(itemIds, { read: true });
      void loadSubs();
    } catch (e: any) {
      setError(e?.message || "Failed to mark all read");
    }
  }, [items, token, loadSubs]);

  // Mark selected item as read on selection change (after ensureRead is defined)
  useEffect(() => {
    const it = selectedIdx >= 0 ? items[selectedIdx] : null;
    if (!it || it.state?.read || noAutoRead.current.has(it.id)) return;
    void ensureRead(it.id);
  }, [selectedIdx, items, ensureRead]);

  // Mark items as read when they scroll into view (approx 60% visible)
  useEffect(() => {
    if (!token) return;
    const nodes = Array.from(
      document.querySelectorAll('li[data-item="row"]')
    ) as HTMLElement[];
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const el = entry.target as HTMLElement;
            const id = el.getAttribute("data-id") || "";
            if (!id) continue;
            const item = items.find((i) => i.id === id);
            if (item && !item.state?.read && !noAutoRead.current.has(id)) {
              void ensureRead(id);
            }
          }
        }
      },
      { threshold: [0.6] }
    );

    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [items, token, ensureRead]);

  const fetchFeedNow = useCallback(
    async (feedId: string) => {
      if (!token) return;
      try {
        await apiPost(`/feeds/${feedId}/fetch`, {}, { token });
        // optional: refresh items if we're on this feed
        if (selectedFeedId === feedId) {
          await loadItems();
        }
      } catch (e: any) {
        setError(e?.message || "Failed to enqueue fetch");
      }
    },
    [token, selectedFeedId, loadItems]
  );

  const addSubscription = useCallback(async () => {
    if (!token || !newFeedUrl.trim()) return;
    setError(null);
    try {
      // 1) Ensure feed exists (idempotent on URL)
      const feed = (await apiPost<{
        id: string;
        url: string;
        title: string | null;
      }>("/feeds", { url: newFeedUrl.trim() }, { token })) as any;

      const feedId =
        (feed?.id as string) || (feed as any)?.feed?.id || feed?.feedId || null;
      if (!feedId) throw new Error("Failed to create or locate feed");

      // 2) Create subscription (idempotent: backend returns 409 if already subscribed)
      try {
        await apiPost("/subscriptions", { feedId }, { token });
      } catch (e: any) {
        // ignore "already subscribed" conflicts; show others
        if (!String(e?.message || "").includes("409")) {
          throw e;
        }
      }

      setNewFeedUrl("");
      // Reload subscriptions and select the new feed
      await loadSubs();
      setSelectedFeedId(feedId);
      // Optionally kick off an immediate fetch
      await fetchFeedNow(feedId);
    } catch (e: any) {
      setError(e?.message || "Failed to add subscription");
    }
  }, [token, newFeedUrl, loadSubs, fetchFeedNow]);

  // Keyboard shortcuts: j/k navigation, m toggle read, s star, o/Enter open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!items.length) return;
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName))
        return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(items.length - 1, Math.max(0, i + 1)));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "m") {
        e.preventDefault();
        toggleRead();
      } else if (e.key === "s") {
        e.preventDefault();
        toggleStar();
      } else if (e.key === "h") {
        e.preventDefault();
        toggleShare();
      } else if (e.key === " ") {
        e.preventDefault();
        setShowFull((v) => !v);
      } else if (e.key === "o" || e.key === "Enter") {
        e.preventDefault();
        openCurrent();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, toggleRead, toggleStar, toggleShare, openCurrent]);

  return (
    <main id="content" className="h-screen flex">
      <aside className="w-80 border-r p-4 space-y-5 overflow-auto bg-gray-50 dark:bg-gray-900">
        <div className="mb-1">
          <h2 className="text-2xl font-bold tracking-tight text-blue-700">
            Readerly
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <SessionStatus />
          <button
            className="text-xs px-2 py-1 rounded border"
            title="Toggle theme"
            aria-pressed={isDark}
            onClick={() => {
              try {
                const el = document.documentElement;
                const next = el.classList.toggle("dark");
                localStorage.setItem("theme", next ? "dark" : "light");
                setIsDark(next);
              } catch {}
            }}
          >
            Theme
          </button>
          <span className="text-xs text-gray-500">
            {apiOk ? "API ok" : "API down"}
          </span>
        </div>

        <div className="space-y-2 rounded-lg border bg-white p-3 shadow-sm">
          <div className="text-xs uppercase text-gray-500">Views</div>
          <div className="flex gap-2">
            <button
              className={`px-2 py-1 text-sm rounded border ${
                filter === "all" && !selectedFeedId
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white"
              }`}
              onClick={() => {
                setFilter("all");
                setSelectedFeedId(null);
              }}
              disabled={!token}
              title={!token ? "Login first" : ""}
            >
              All
            </button>
            <button
              className={`px-2 py-1 text-sm rounded border ${
                filter === "unread"
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white"
              }`}
              onClick={() => setFilter("unread")}
              disabled={!token}
              title={!token ? "Login first" : ""}
            >
              Unread
            </button>
            <button
              className={`px-2 py-1 text-sm rounded border ${
                filter === "starred"
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white"
              }`}
              onClick={() => setFilter("starred")}
              disabled={!token}
              title={!token ? "Login first" : ""}
            >
              Starred
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="space-y-2 rounded-lg border bg-white p-3 shadow-sm">
          <div className="text-xs uppercase text-gray-500">Search</div>
          <div className="flex gap-2">
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              type="search"
              placeholder="Search titles/content"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={!token}
            />
            <button
              className="text-xs px-2 py-1 rounded border"
              disabled={!token || !debouncedQuery}
              title={
                !token
                  ? "Login first"
                  : !debouncedQuery
                  ? "Enter a query to save"
                  : ""
              }
              onClick={async () => {
                if (!token || !debouncedQuery) return;
                const name = window.prompt(
                  "Save search as (name):",
                  debouncedQuery.slice(0, 40)
                );
                if (!name) return;
                try {
                  await apiPost(
                    "/saved-searches",
                    {
                      name,
                      query: debouncedQuery,
                      filters: { filter, selectedFeedId },
                    },
                    { token }
                  );
                  await loadSaved();
                } catch (e: any) {
                  setError(e?.message || "Failed to save search");
                }
              }}
            >
              Save
            </button>
          </div>
          {token && saved.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs uppercase text-gray-500">Saved</div>
              <ul className="space-y-1">
                {saved.map((s) => (
                  <li key={s.id} className="flex items-center justify-between">
                    <button
                      className="text-sm text-left truncate text-blue-700 hover:underline"
                      title={s.query}
                      onClick={() => {
                        setQuery(s.query);
                        // Optional: apply stored filters if present
                        // apply saved filter if present (filters may contain dynamic keys)
                        const f = (s.filters as any) || {};
                        if (typeof f.filter === "string")
                          setFilter(f.filter as Filter);
                        if (f.selectedFeedId)
                          setSelectedFeedId(String(f.selectedFeedId));
                      }}
                    >
                      {s.name}
                    </button>
                    <div className="flex items-center gap-1">
                      <button
                        className="text-xs px-1 py-0.5 rounded border"
                        title="Rename"
                        aria-label="Rename saved search"
                        onClick={async () => {
                          if (!token) return;
                          const next = window.prompt(
                            "Rename saved search:",
                            s.name
                          );
                          if (!next || next === s.name) return;
                          try {
                            await apiPatch(
                              `/saved-searches/${s.id}`,
                              { name: next },
                              { token }
                            );
                            await loadSaved();
                          } catch (e: any) {
                            setError(
                              e?.message || "Failed to rename saved search"
                            );
                          }
                        }}
                      >
                        ✎
                      </button>
                      <button
                        className="text-xs px-1 py-0.5 rounded border"
                        title="Delete"
                        aria-label="Delete saved search"
                        onClick={async () => {
                          if (!token) return;
                          if (
                            !window.confirm(`Delete saved search "${s.name}"?`)
                          )
                            return;
                          try {
                            await apiDelete(`/saved-searches/${s.id}`, {
                              token,
                            });
                            await loadSaved();
                          } catch (e: any) {
                            setError(
                              e?.message || "Failed to delete saved search"
                            );
                          }
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {!token && (
          <Link className="text-blue-600 underline block" href="/login">
            Login / Signup
          </Link>
        )}
        <Link className="text-blue-600 underline block" href="/sharing">
          My shared items
        </Link>


        {/* Add subscription */}
        {token && (
          <div className="space-y-2 rounded-lg border bg-white p-3 shadow-sm">
            <div className="text-xs uppercase text-gray-500">
              Add subscription
            </div>
            <div className="flex gap-2">
              <input
                className="w-full border rounded px-2 py-1 text-sm"
                type="url"
                placeholder="Feed or site URL"
                value={newFeedUrl}
                onChange={(e) => setNewFeedUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addSubscription();
                }}
              />
              <button
                className="text-xs px-2 py-1 rounded border"
                onClick={addSubscription}
                disabled={!newFeedUrl.trim()}
                title={
                  !newFeedUrl.trim()
                    ? "Enter a feed or site URL"
                    : "Add subscription"
                }
              >
                Add
              </button>
            </div>
          </div>
        )}

        {/* Categories */}
        {token && (
          <div className="space-y-2 rounded-lg border bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between text-xs uppercase text-gray-500">
              <span>Categories</span>
              <button
                className="text-xs"
                aria-expanded={showCategories}
                onClick={() => setShowCategories((v) => !v)}
                title={showCategories ? "Collapse" : "Expand"}
              >
                {showCategories ? "▾" : "▸"}
              </button>
            </div>
            {showCategories && (
              <>
                <div className="flex gap-2">
                  <input
                    className="w-full border rounded px-2 py-1 text-sm"
                    type="text"
                    placeholder="New category name"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") createFolder();
                    }}
                  />
                  <button
                    className="text-xs px-2 py-1 rounded border"
                    onClick={createFolder}
                    disabled={!newFolderName.trim()}
                    title={
                      !newFolderName.trim()
                        ? "Enter a category name"
                        : "Create category"
                    }
                  >
                    Add
                  </button>
                </div>
                {folders.length > 0 && (
                  <ul className="space-y-1">
                    {folders.map((f) => (
                      <li key={f.id} className="flex items-center justify-between">
                        <span className="text-sm truncate">{f.name}</span>
                        <div className="flex items-center gap-1">
                          <button
                            className="text-xs px-1 py-0.5 rounded border"
                            title="Rename"
                            aria-label="Rename category"
                            onClick={() => renameFolder(f.id)}
                          >
                            ✎
                          </button>
                          <button
                            className="text-xs px-1 py-0.5 rounded border"
                            title="Delete"
                            aria-label="Delete category"
                            onClick={() => deleteFolder(f.id)}
                          >
                            🗑
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {/* Subscriptions */}
        <div className="pt-2">
          <div className="text-xs uppercase text-gray-500 mb-2">
            Subscriptions
          </div>
          {!token ? (
            <div className="text-xs text-gray-500">
              Login to load subscriptions
            </div>
          ) : grouped.length === 0 ? (
            <div className="text-xs text-gray-500">No subscriptions</div>
          ) : (
            <div className="space-y-3">
              {grouped.map(([folder, arr]) => (
                <div key={folder}>
                  <div className="flex items-center justify-between text-xs font-semibold text-gray-600 mb-1">
                    <span>{folder}</span>
                    <button
                      className="text-xs"
                      aria-expanded={!collapsed[folder]}
                      onClick={() =>
                        setCollapsed((prev) => ({
                          ...prev,
                          [folder]: !prev[folder],
                        }))
                      }
                      title={!collapsed[folder] ? "Collapse" : "Expand"}
                    >
                      {!collapsed[folder] ? "▾" : "▸"}
                    </button>
                  </div>
                  {!collapsed[folder] && (
                  <ul className="space-y-1">
                    {arr.map((s) => {
                      const active = selectedFeedId === s.feed.id;
                      return (
                        <li
                          key={s.id}
                          className="flex items-center justify-between group"
                        >
                          <button
                            className={`text-sm text-left flex-1 truncate ${
                              active
                                ? "font-semibold text-blue-700"
                                : "text-gray-800"
                            } hover:underline`}
                            title={s.feed.title || s.feed.url}
                            onClick={() => {
                              setSelectedFeedId(s.feed.id);
                              setFilter("all");
                            }}
                          >
                            {s.feed.title || s.feed.url}
                          </button>
                          {typeof s.unreadCount === "number" &&
                            s.unreadCount > 0 && (
                              <span className="ml-2 text-xs rounded px-1.5 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100">
                                {s.unreadCount}
                              </span>
                            )}
                          <button
                            className="opacity-0 group-hover:opacity-100 text-xs px-1 py-0.5 rounded border ml-2"
                            title="Fetch now"
                            aria-label="Fetch now"
                            onClick={() => fetchFeedNow(s.feed.id)}
                          >
                            ↻
                          </button>

                          {/* Move to category */}
                          <select
                            className="opacity-0 group-hover:opacity-100 text-xs border rounded ml-2"
                            value={s.folder?.id || ""}
                            onChange={async (e) => {
                              if (!token) return;
                              const folderId = e.target.value || null;
                              try {
                                await apiPatch(
                                  `/subscriptions/${s.id}`,
                                  { folderId },
                                  { token }
                                );
                                await loadSubs();
                              } catch (err: any) {
                                setError(
                                  err?.message || "Failed to move category"
                                );
                              }
                            }}
                            title="Move to category"
                            aria-label="Move to category"
                          >
                            <option value="">Uncategorized</option>
                            {folders.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>

                          {/* Unsubscribe */}
                          <button
                            className="opacity-0 group-hover:opacity-100 text-xs px-1 py-0.5 rounded border ml-2"
                            title="Unsubscribe from this feed"
                            aria-label="Unsubscribe"
                            onClick={async () => {
                              if (!token) return;
                              if (
                                !window.confirm("Unsubscribe from this feed?")
                              )
                                return;
                              try {
                                await apiDelete(`/subscriptions/${s.id}`, {
                                  token,
                                });
                                if (selectedFeedId === s.feed.id)
                                  setSelectedFeedId(null);
                                await loadSubs();
                              } catch (err: any) {
                                setError(
                                  err?.message || "Failed to unsubscribe"
                                );
                              }
                            }}
                          >
                            −
                          </button>

                          {/* Delete feed (danger) */}
                          <button
                            className="opacity-0 group-hover:opacity-100 text-xs px-1 py-0.5 rounded border ml-1"
                            title="Delete feed (removes it entirely)"
                            aria-label="Delete feed"
                            onClick={async () => {
                              if (!token) return;
                              if (
                                !window.confirm(
                                  "Delete this feed entirely? This affects all subscribers."
                                )
                              )
                                return;
                              try {
                                await apiDelete(`/feeds/${s.feed.id}`, {
                                  token,
                                });
                                if (selectedFeedId === s.feed.id)
                                  setSelectedFeedId(null);
                                await loadSubs();
                              } catch (err: any) {
                                setError(
                                  err?.message || "Failed to delete feed"
                                );
                              }
                            }}
                          >
                            🗑
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="text-xs text-gray-500 pt-4 border-t mt-4">
          Shortcuts: j/k navigate • m toggle read • s star • h share • o/Enter open
        </div>
      </aside>

      <section className="flex-1 p-4 overflow-auto">
        {!token ? (
          <div className="text-sm text-gray-600">Login to view items.</div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold">Latest items</h3>
                {selectedFeedId && (
                  <button
                    className="text-xs px-2 py-1 rounded border"
                    onClick={() => setSelectedFeedId(null)}
                    title="Clear feed filter"
                  >
                    Clear feed filter
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="text-xs px-2 py-1 rounded border"
                  onClick={() => {
                    void loadItems();
                  }}
                  disabled={loading}
                  title={loading ? "Loading…" : "Refresh list"}
                >
                  {loading ? "Loading…" : "Refresh"}
                </button>
                {selectedFeedId && (
                  <button
                    className="text-xs px-2 py-1 rounded border"
                    onClick={async () => {
                      if (!token || !selectedFeedId) return;
                      try {
                        await apiPost(
                          `/items/mark-read-bulk`,
                          { feedId: selectedFeedId },
                          { token }
                        );
                        setItems((prev) =>
                          prev.map((it) => ({
                            ...it,
                            state: { ...(it.state || {}), read: true },
                          }))
                        );
                        void loadSubs();
                      } catch (e: any) {
                        setError(e?.message || "Failed to mark feed read");
                      }
                    }}
                  >
                    Mark feed read
                  </button>
                )}
                <button
                  className="text-xs px-2 py-1 rounded border"
                  onClick={markAllVisibleRead}
                  disabled={!items.length}
                >
                  Mark all visible read
                </button>
                {/* Density toggle */}
                <div className="ml-2 inline-flex rounded border overflow-hidden">
                  <button
                    className={`text-xs px-2 py-1 ${
                      density === "comfortable"
                        ? "bg-blue-600 text-white"
                        : "bg-white"
                    }`}
                    onClick={() => setDensity("comfortable")}
                    title="Comfortable density"
                  >
                    Comfort
                  </button>
                  <button
                    className={`text-xs px-2 py-1 border-l ${
                      density === "compact"
                        ? "bg-blue-600 text-white"
                        : "bg-white"
                    }`}
                    onClick={() => setDensity("compact")}
                    title="Compact density"
                  >
                    Compact
                  </button>
                </div>
                <div className="text-xs text-gray-500">
                  Showing {items.length}
                </div>
              </div>
            </div>

            {error && (
              <div
                className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3 mb-3"
                role="status"
                aria-live="polite"
              >
                {error}
              </div>
            )}

            <ul ref={listRef} className="space-y-2">
              {items.map((it, idx) => {
                const selected = idx === selectedIdx;
                const read = Boolean(it.state?.read);
                const starred = Boolean(it.state?.starred);
                const shared = Boolean(it.state?.shared);
                return (
                  <li
                    key={it.id}
                    data-item="row"
                    data-id={it.id}
                    className={[
                      "border rounded cursor-pointer dark:border-gray-700",
                      density === "compact" ? "p-2 text-sm" : "p-3",
                      // unread items get a left accent
                      !read ? "border-l-4 border-blue-500" : "border-l-4 border-transparent",
                      selected
                        ? "ring-2 ring-blue-400 bg-blue-50 dark:ring-blue-600 dark:bg-gray-800"
                        : (!read
                            ? "bg-amber-50 hover:bg-amber-100 dark:hover:bg-gray-800"
                            : "hover:bg-gray-50 dark:hover:bg-gray-800"),
                    ].join(" ")}
                    onClick={() => {
                      setSelectedIdx(idx);
                      if (!read && !noAutoRead.current.has(it.id)) {
                        void ensureRead(it.id);
                      }
                    }}
                    onDoubleClick={() => {
                      if (it.url)
                        window.open(it.url, "_blank", "noopener,noreferrer");
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`inline-block ${read ? "w-2 h-2 bg-gray-300" : "w-2.5 h-2.5 bg-blue-600 ring-2 ring-blue-200"} rounded-full mr-2`}
                        aria-hidden="true"
                      ></span>
                      <a
                        className={`font-medium ${
                          read ? "text-gray-700" : "text-blue-700 font-semibold"
                        }`}
                        href={it.url || "#"}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {it.title || "(no title)"}
                      </a>
                      <span className="ml-2 text-xs text-gray-500">
                        {(() => {
                          try {
                            return it.url
                              ? new URL(it.url).hostname.replace(/^www\./, "")
                              : "";
                          } catch {
                            return "";
                          }
                        })()}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          className="text-xs px-2 py-1 rounded border"
                          aria-pressed={read}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedIdx(idx);
                            void (async () => {
                              const next = !read;
                              try {
                                await apiPost(
                                  `/items/${it.id}/state`,
                                  { read: next },
                                  { token: token! }
                                );
                                setItems((prev) =>
                                  prev.map((p) =>
                                    p.id === it.id
                                      ? {
                                          ...p,
                                          state: {
                                            ...(p.state || {}),
                                            read: next,
                                          },
                                        }
                                      : p
                                  )
                                );
                                // Respect user's explicit unread choice
                                if (next === false) {
                                  noAutoRead.current.add(it.id);
                                  setTimeout(() => noAutoRead.current.delete(it.id), 30000);
                                } else {
                                  noAutoRead.current.delete(it.id);
                                }
                              } catch (err: any) {
                                setError(
                                  err?.message || "Failed to toggle read"
                                );
                              }
                            })();
                          }}
                        >
                          {read ? "Mark unread" : "Mark read"}
                        </button>
                        <button
                          className={`text-xs px-2 py-1 rounded border ${
                            shared ? "bg-green-100" : ""
                          }`}
                          aria-pressed={shared}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedIdx(idx);
                            void (async () => {
                              const next = !shared;
                              try {
                                await apiPost(
                                  `/sharing/items/${it.id}/share`,
                                  { share: next },
                                  { token: token! }
                                );
                                setItems((prev) =>
                                  prev.map((p) =>
                                    p.id === it.id
                                      ? {
                                          ...p,
                                          state: {
                                            ...(p.state || {}),
                                            shared: next,
                                          },
                                        }
                                      : p
                                  )
                                );
                              } catch (err: any) {
                                setError(
                                  err?.message || "Failed to toggle share"
                                );
                              }
                            })();
                          }}
                        >
                          {shared ? "✓ Shared" : "Share"}
                        </button>
                        <button
                          className="text-xs px-2 py-1 rounded border"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (it.url) {
                              window.open(
                                it.url,
                                "_blank",
                                "noopener,noreferrer"
                              );
                            }
                          }}
                          disabled={!it.url}
                          title={
                            it.url ? "Open original in new tab" : "No link"
                          }
                        >
                          Open ↗
                        </button>
                        <button
                          className={`text-xs px-2 py-1 rounded border ${
                            starred ? "bg-yellow-100" : ""
                          }`}
                          aria-pressed={starred}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedIdx(idx);
                            void (async () => {
                              const next = !starred;
                              try {
                                await apiPost(
                                  `/items/${it.id}/state`,
                                  { starred: next },
                                  { token: token! }
                                );
                                setItems((prev) =>
                                  prev.map((p) =>
                                    p.id === it.id
                                      ? {
                                          ...p,
                                          state: {
                                            ...(p.state || {}),
                                            starred: next,
                                          },
                                        }
                                      : p
                                  )
                                );
                              } catch (err: any) {
                                setError(
                                  err?.message || "Failed to toggle star"
                                );
                              }
                            })();
                          }}
                        >
                          {starred ? "★ Starred" : "☆ Star"}
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {it.publishedAt
                        ? new Date(it.publishedAt).toLocaleString()
                        : ""}
                      {read ? " • Read" : " • Unread"}
                      {starred ? " • ★ Starred" : ""}
                      {shared ? " • Shared" : ""}
                    </div>
                    {selected && (
                      <div className="mt-2 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">
                        {(() => {
                          const previewText =
                            (it.contentText && it.contentText.trim().length > 0
                              ? it.contentText
                              : stripHtml(it.contentHtml || "")) || "";
                          if (!previewText) return "No preview";
                          return (
                            previewText.slice(0, 800) +
                            (previewText.length > 800 ? "…" : "")
                          );
                        })()}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {current && (
              <div className="mt-4 border rounded p-4 bg-white">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-semibold">
                      {current.title || "(no title)"}
                    </h4>
                    <div className="text-xs text-gray-500">
                      {current.publishedAt
                        ? new Date(current.publishedAt).toLocaleString()
                        : ""}{" "}
                      •{current.state?.read ? " Read" : " Unread"}
                      {current.state?.starred ? " • ★ Starred" : ""}
                      {current.state?.shared ? " • Shared" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="text-xs px-2 py-1 rounded border"
                      aria-pressed={Boolean(current.state?.read)}
                      onClick={toggleRead}
                    >
                      {current.state?.read ? "Mark unread" : "Mark read"}
                    </button>
                    <button
                      className="text-xs px-2 py-1 rounded border"
                      aria-pressed={Boolean(current.state?.starred)}
                      onClick={toggleStar}
                    >
                      {current.state?.starred ? "★ Starred" : "☆ Star"}
                    </button>
                    <button
                      className="text-xs px-2 py-1 rounded border"
                      aria-pressed={Boolean(current.state?.shared)}
                      onClick={toggleShare}
                    >
                      {current.state?.shared ? "✓ Shared" : "Share"}
                    </button>
                    <button
                      className="text-xs px-2 py-1 rounded border"
                      onClick={openCurrent}
                      disabled={!current.url}
                    >
                      Open
                    </button>
                  </div>
                </div>
                {current.imageUrl && (
                  <div
                    className="relative w-full rounded mb-2 overflow-hidden"
                    style={{ height: "16rem" }}
                  >
                    <Image
                      src={current.imageUrl}
                      alt=""
                      fill
                      sizes="(max-width: 768px) 100vw, 800px"
                      className="object-cover"
                      referrerPolicy="no-referrer"
                      unoptimized
                    />
                  </div>
                )}
                <div className="text-sm whitespace-pre-wrap">
                  {detail.display || "No content"}
                </div>
                {detail.isLong && (
                  <button
                    className="mt-2 text-xs px-2 py-1 rounded border"
                    onClick={() => setShowFull((v) => !v)}
                  >
                    {showFull ? "Show less" : "Show more"}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
