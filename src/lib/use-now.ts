import { useEffect, useState } from "react";

/**
 * Current time that re-renders every `intervalMs` while `active`. Used for countdowns; stays
 * frozen (no timer) when nothing is counting down.
 */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}
