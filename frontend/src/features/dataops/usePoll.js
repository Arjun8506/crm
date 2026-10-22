import { useEffect } from 'react';

// Calls `refetch` every second while `active`. The timer is an external system, so state only changes in its callback.
export default function usePoll(refetch, active, ms = 1000) {
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(refetch, ms);
    return () => clearInterval(t);
  }, [active, refetch, ms]);
}
