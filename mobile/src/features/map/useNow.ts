import { useEffect, useState } from 'react';

/**
 * A coarse wall-clock tick, so time-based labels age without new data.
 *
 * A tracking screen receives a fix every few seconds — or not at all when the
 * bus is in a basement. Without a tick, "Live position" would stay on screen
 * indefinitely over a position that went quiet minutes ago, which is exactly
 * the dishonesty `docs/mobile-tracking-reliability.md` removed from the crew
 * side. The same reasoning applies here, at observer resolution.
 *
 * 5 s is fine-grained enough that the 30 s live → last-known boundary is
 * crossed within 5 s of the truth, and coarse enough that this is not a render
 * loop. The map subtree itself is memoised separately (`MapSurface`), so a tick
 * re-renders the status text and nothing else.
 */
export function useNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
