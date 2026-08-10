/**
 * メモリ + localStorage の2段キャッシュ。
 * 無料運用が前提なので「一度引いたものは二度引かない」を徹底する。
 */

const NS = 'plr:v1:';
const DEFAULT_TTL = 1000 * 60 * 60 * 24 * 7; // 7日
const MAX_ENTRIES = 120;

interface Entry<T> {
  v: T;
  t: number;
}

const mem = new Map<string, Entry<unknown>>();

function lsKey(key: string) {
  return NS + key;
}

export function cacheGet<T>(key: string, ttl = DEFAULT_TTL): T | null {
  const now = Date.now();
  const m = mem.get(key) as Entry<T> | undefined;
  if (m) {
    if (now - m.t < ttl) return m.v;
    mem.delete(key);
  }
  try {
    const raw = localStorage.getItem(lsKey(key));
    if (!raw) return null;
    const e = JSON.parse(raw) as Entry<T>;
    if (now - e.t >= ttl) {
      localStorage.removeItem(lsKey(key));
      return null;
    }
    mem.set(key, e);
    return e.v;
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, value: T): void {
  const e: Entry<T> = { v: value, t: Date.now() };
  mem.set(key, e);
  try {
    localStorage.setItem(lsKey(key), JSON.stringify(e));
    pruneIfNeeded();
  } catch {
    // 容量オーバー等。古いものを捨てて1度だけ再試行する
    try {
      pruneOldest(20);
      localStorage.setItem(lsKey(key), JSON.stringify(e));
    } catch {
      /* localStorage が使えない環境でもメモリキャッシュだけで動く */
    }
  }
}

function allKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(NS)) keys.push(k);
  }
  return keys;
}

function pruneIfNeeded() {
  const keys = allKeys();
  if (keys.length > MAX_ENTRIES) pruneOldest(keys.length - MAX_ENTRIES);
}

function pruneOldest(count: number) {
  const entries = allKeys().map((k) => {
    let t = 0;
    try {
      t = (JSON.parse(localStorage.getItem(k) || '{}') as Entry<unknown>).t || 0;
    } catch {
      /* 壊れたエントリは t=0 扱いで先に消える */
    }
    return { k, t };
  });
  entries.sort((a, b) => a.t - b.t);
  for (const e of entries.slice(0, count)) {
    localStorage.removeItem(e.k);
    mem.delete(e.k.slice(NS.length));
  }
}

/** 「この語は記事が無い」というネガティブ結果も覚えておく（無駄打ち防止） */
export function cacheHasKey(key: string, ttl?: number): boolean {
  return cacheGet(key, ttl) !== null;
}

export function clearCache(): void {
  mem.clear();
  for (const k of allKeys()) localStorage.removeItem(k);
}
