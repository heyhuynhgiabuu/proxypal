import { createMemo, createSignal } from "solid-js";
import { addRequestToHistory, getRequestHistory } from "../lib/tauri";

import type { RequestHistory, RequestLog } from "../lib/tauri";

// Centralized request history store - single source of truth
// Eliminates duplicate state across RequestMonitor, Dashboard, SavingsCard

const [requestHistory, setRequestHistory] = createSignal<RequestHistory>({
  requests: [],
  totalCostUsd: 0,
  totalTokensCached: 0,
  totalTokensIn: 0,
  totalTokensOut: 0,
});

// Loading state for initial fetch
const [isLoading, setIsLoading] = createSignal(false);

// Derived: recent requests (last 100)
export const recentRequests = createMemo(() => requestHistory().requests.slice(-100));

// Derived: today's requests
export const todayRequests = createMemo(() => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTimestamp = todayStart.getTime();

  return requestHistory().requests.filter((r) => r.timestamp >= todayTimestamp);
});

// Derived: today's stats
export const todayStats = createMemo(() => {
  const today = todayRequests();
  return {
    count: today.length,
    tokens: today.reduce((sum, r) => sum + (r.tokensIn || 0) + (r.tokensOut || 0), 0),
  };
});

// Derived: total stats
export const totalStats = createMemo(() => ({
  totalCost: requestHistory().totalCostUsd,
  totalRequests: requestHistory().requests.length,
  totalTokensIn: requestHistory().totalTokensIn,
  totalTokensOut: requestHistory().totalTokensOut,
}));

// Add a request to the store (and persist)
export async function addRequest(log: RequestLog): Promise<void> {
  try {
    // Persist to disk
    await addRequestToHistory(log);

    // Update local state
    setRequestHistory((prev) => {
      const newRequests = [...prev.requests, log];
      // Keep only last 500 to match backend limit
      const trimmed = newRequests.length > 500 ? newRequests.slice(-500) : newRequests;

      return {
        ...prev,
        requests: trimmed,
        totalTokensIn: prev.totalTokensIn + (log.tokensIn || 0),
        totalTokensOut: prev.totalTokensOut + (log.tokensOut || 0),
      };
    });
  } catch (error) {
    console.error("[requestStore] Failed to persist request:", error);
    // Still update local state for UI
    setRequestHistory((prev) => ({
      ...prev,
      requests: [...prev.requests, log].slice(-500),
    }));
  }
}

// Load initial history from disk
export async function loadHistory(): Promise<void> {
  if (isLoading()) {
    return;
  }

  setIsLoading(true);
  try {
    const history = await getRequestHistory();
    setRequestHistory(history);
  } catch (error) {
    console.error("[requestStore] Failed to load history:", error);
  } finally {
    setIsLoading(false);
  }
}

// Clear history
export function clearHistory(): void {
  setRequestHistory({
    requests: [],
    totalCostUsd: 0,
    totalTokensCached: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
  });
}

// Export the raw signal for components that need full access
export const requestStore = {
  addRequest,
  clearHistory,
  history: requestHistory,
  isLoading,
  loadHistory,
  recentRequests,
  todayRequests,
  todayStats,
  totalStats,
};
