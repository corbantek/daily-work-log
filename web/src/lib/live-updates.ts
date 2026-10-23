import { createContext, useContext, useEffect, useRef, useState } from 'react'

// Live updates: the API keeps an in-memory change counter (GET /changes) that moves after every
// write from any source — notably the AI agent. App polls it and bumps this context's value; parts
// of the page that show data re-fetch in place (no remount, no lost UI state) when it changes.

export const POLL_MS = 3000

export const DataVersionContext = createContext(0)

/** Polls /api/changes while the tab is visible (and at once when it becomes visible again).
 *  `version` bumps on any change; `agentActivity` is the newest change the AI agent made. */
export function usePollForChanges(): { version: number; agentActivity: string | null } {
  const [version, setVersion] = useState(0)
  const [agentActivity, setAgentActivity] = useState<string | null>(null)
  const last = useRef<string | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    async function check() {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await fetch('/api/changes')
        if (!res.ok) return
        const { boot, version: v, agent_activity } = await res.json()
        const key = `${boot}:${v}`
        if (last.current !== null && last.current !== key) setVersion(n => n + 1)
        last.current = key
        setAgentActivity(agent_activity ?? null)
      } catch { /* API down: the header already shows that; try again next tick */ }
    }

    function schedule() {
      if (stopped) return
      timer = setTimeout(async () => { await check(); schedule() }, POLL_MS)
    }

    function onVisible() {
      if (document.visibilityState === 'visible') check()
    }

    check()
    schedule()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  return { version, agentActivity }
}

/** Calls `onChange` whenever the data changed elsewhere (not on mount), while `enabled`. */
export function useOnDataChange(onChange: () => void, enabled = true) {
  const version = useContext(DataVersionContext)
  const seen = useRef(version)
  const callback = useRef(onChange)
  callback.current = onChange
  useEffect(() => {
    if (version === seen.current) return
    seen.current = version
    if (enabled) callback.current()
  }, [version, enabled])
}
