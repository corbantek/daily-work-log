import { useEffect, useRef } from 'react'

/**
 * Calls `onActivate` each time `active` turns from false to true (not on mount).
 * Review views stay mounted while hidden so their state survives tab switches;
 * this lets them reload their data when they are shown again.
 */
export function useOnActivate(active: boolean, onActivate: () => void) {
  const wasActive = useRef(active)
  const callback = useRef(onActivate)
  callback.current = onActivate
  useEffect(() => {
    if (active && !wasActive.current) callback.current()
    wasActive.current = active
  }, [active])
}
