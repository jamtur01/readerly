/**
 * Minimal IndexedDB wrapper for Readerly offline caching.
 * - Stores individual items in object store 'items' keyed by id
 * - Stores list snapshots in 'lists' keyed by a computed listKey
 * - Allows updating item.state for optimistic offline UX
 *
 * No external deps; uses window.indexedDB directly.
 */

export type OfflineItem = {
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

const DB_NAME = "readerly";
const DB_VERSION = 1;
const STORE_ITEMS = "items";
const STORE_LISTS = "lists";

type ListRecord = {
  key: string;     // computed list key
  ids: string[];   // ids in order
  ts: number;      // snapshot time
};

// Open or upgrade DB
function openDB(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        db.createObjectStore(STORE_ITEMS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_LISTS)) {
        db.createObjectStore(STORE_LISTS, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withTx<T>(
  mode: IDBTransactionMode,
  fn: (db: IDBDatabase, tx: IDBTransaction) => Promise<T> | T
): Promise<T> {
  return openDB().then((db) => {
    if (!db) return Promise.resolve(undefined as unknown as T);
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction([STORE_ITEMS, STORE_LISTS], mode);
      const done = (p: Promise<T> | T) => {
        Promise.resolve(p)
          .then((val) => resolve(val))
          .catch(reject);
      };
      tx.oncomplete = () => {};
      tx.onerror = () => reject(tx.error);
      try {
        done(fn(db, tx));
      } catch (e) {
        reject(e);
      }
    });
  });
}

export function makeListKey(params: {
  feedId?: string | null;
  filter?: string;
  q?: string;
}): string {
  const parts: string[] = [];
  if (params.feedId) parts.push(`feed=${params.feedId}`);
  if (params.filter) parts.push(`filter=${params.filter}`);
  if (params.q) parts.push(`q=${params.q}`);
  return parts.join("&") || "all";
}

export async function putItems(listKey: string, items: OfflineItem[]): Promise<void> {
  if (!items || items.length === 0) {
    // still store empty list snapshot
    return withTx("readwrite", async (_db, tx) => {
      const lists = tx.objectStore(STORE_LISTS);
      const rec: ListRecord = { key: listKey, ids: [], ts: Date.now() };
      lists.put(rec);
    }).catch(() => {});
  }

  return withTx("readwrite", async (_db, tx) => {
    const itemsStore = tx.objectStore(STORE_ITEMS);
    const lists = tx.objectStore(STORE_LISTS);
    const ids: string[] = [];
    for (const it of items) {
      ids.push(it.id);
      itemsStore.put(it);
    }
    const rec: ListRecord = { key: listKey, ids, ts: Date.now() };
    lists.put(rec);
  }).catch(() => {});
}

export async function getList(listKey: string): Promise<OfflineItem[]> {
  return withTx("readonly", async (_db, tx) => {
    const itemsStore = tx.objectStore(STORE_ITEMS);
    const lists = tx.objectStore(STORE_LISTS);
    const rec = await reqProm<ListRecord | undefined>(lists.get(listKey));
    if (!rec || !rec.ids || rec.ids.length === 0) return [];
    const out: OfflineItem[] = [];
    for (const id of rec.ids) {
      const it = await reqProm<OfflineItem | undefined>(itemsStore.get(id));
      if (it) out.push(it);
    }
    return out;
  }).catch(() => {
    return [];
  });
}

export async function updateItemState(id: string, patch: Partial<NonNullable<OfflineItem["state"]>>): Promise<void> {
  return withTx("readwrite", async (_db, tx) => {
    const itemsStore = tx.objectStore(STORE_ITEMS);
    const current = (await reqProm<OfflineItem | undefined>(itemsStore.get(id))) || undefined;
    if (!current) return;
    const next: OfflineItem = {
      ...current,
      state: { ...(current.state || {}), ...patch },
    };
    itemsStore.put(next);
  }).catch(() => {});
}

export async function updateManyStates(ids: string[], patch: Partial<NonNullable<OfflineItem["state"]>>): Promise<void> {
  if (!ids || ids.length === 0) return;
  return withTx("readwrite", async (_db, tx) => {
    const itemsStore = tx.objectStore(STORE_ITEMS);
    for (const id of ids) {
      const current = (await reqProm<OfflineItem | undefined>(itemsStore.get(id))) || undefined;
      if (!current) continue;
      const next: OfflineItem = {
        ...current,
        state: { ...(current.state || {}), ...patch },
      };
      itemsStore.put(next);
    }
  }).catch(() => {});
}

function reqProm<T>(req: IDBRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}