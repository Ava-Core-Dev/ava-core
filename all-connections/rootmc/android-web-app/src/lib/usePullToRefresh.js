import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Mobile-first pull-to-refresh hook.
 * Wraps the top-most scroll container. When scrollTop === 0 and the user drags down
 * past a threshold, onRefresh() is invoked and the visual indicator is shown.
 *
 * Usage:
 *   const { bind, refreshing, pullDist } = usePullToRefresh(async () => {
 *     await Promise.all([...]);
 *   });
 *   return <div {...bind}>{...}</div>
 */
export function usePullToRefresh(onRefresh, threshold = 72) {
  const [refreshing, setRefreshing] = useState(false);
  const [pullDist, setPullDist] = useState(0);
  const startY = useRef(null);
  const active = useRef(false);
  const pullDistRef = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    pullDistRef.current = pullDist;
  }, [pullDist]);

  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  const onTouchStart = useCallback((e) => {
    if (window.scrollY > 0 || refreshingRef.current) return;
    startY.current = e.touches[0].clientY;
    active.current = true;
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!active.current || startY.current === null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0 && window.scrollY <= 0) {
      const d = Math.min(dy * 0.5, threshold * 1.5);
      setPullDist(d);
    } else {
      setPullDist(0);
    }
  }, [threshold]);

  const onTouchEnd = useCallback(async () => {
    if (!active.current) return;
    active.current = false;
    if (pullDistRef.current >= threshold && !refreshingRef.current) {
      setRefreshing(true);
      try {
        await onRefreshRef.current();
      } finally {
        setRefreshing(false);
        setPullDist(0);
      }
    } else {
      setPullDist(0);
    }
    startY.current = null;
  }, [threshold]);

  useEffect(() => {
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [onTouchStart, onTouchMove, onTouchEnd]);

  return { refreshing, pullDist, threshold };
}
