/**
 * Simple TTL-based cache for quota data.
 * Prevents redundant Tauri IPC calls on page loads/navigations.
 * Each cache key maps to a provider's quota fetch result.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Get cached data or fetch fresh data from the provider.
 * @param key - Cache key (e.g., "antigravity", "codex", "copilot", "claude", "kiro")
 * @param fetchFn - Async function that fetches fresh data
 * @param forceRefresh - If true, bypasses cache and fetches fresh data
 * @param ttlMs - Time-to-live in milliseconds (default: 5 minutes)
 */
export async function getCachedOrFetch<T>(
  key: string,
  fetchFn: () => Promise<T>,
  forceRefresh = false,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  if (!forceRefresh) {
    const entry = cache.get(key) as CacheEntry<T> | undefined;
    if (entry && Date.now() - entry.timestamp < ttlMs) {
      return entry.data;
    }
  }

  const data = await fetchFn();
  cache.set(key, { data, timestamp: Date.now() });
  return data;
}

/**
 * Invalidate a specific cache entry.
 */
export function invalidateQuotaCache(key: string): void {
  cache.delete(key);
}

/**
 * Invalidate all quota cache entries.
 */
export function invalidateAllQuotaCache(): void {
  cache.clear();
}
