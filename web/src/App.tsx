import { useState, useCallback, useEffect } from 'react'
import { Settings, Sun, Moon, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DaySection } from './components/DaySection'
import { ManageWorkstreams } from './components/ManageWorkstreams'
import { ManageLabels } from './components/ManageLabels'
import { BackupRestore } from './components/BackupRestore'
import { ReviewPage } from './pages/ReviewPage'
import './index.css'

type Tab = 'log' | 'review'
type Theme = 'dark' | 'dim' | 'light'

import { todayStr, toLocalDateStr } from './api/date'

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return toLocalDateStr(dt)
}

function buildDateRange(today: string, windowSize: number): string[] {
  const dates: string[] = []
  for (let i = 0; i < windowSize; i++) {
    dates.push(addDays(today, -i))
  }
  return dates
}

const WINDOW_OPTIONS = [3, 5, 7, 10, 14]

const THEMES: { value: Theme; label: string; icon: typeof Moon }[] = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'dim', label: 'Dim', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
]

function getStoredTheme(): Theme {
  const stored = localStorage.getItem('worklog-theme')
  if (stored === 'dark' || stored === 'dim' || stored === 'light') return stored
  return 'dark'
}

function applyTheme(theme: Theme) {
  const html = document.documentElement
  html.classList.remove('dark', 'dim')
  if (theme !== 'light') html.classList.add(theme)
  localStorage.setItem('worklog-theme', theme)
}

export default function App() {
  const [tab, setTab] = useState<Tab>('log')
  const [windowSize, setWindowSize] = useState(5)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [theme, setTheme] = useState<Theme>(getStoredTheme)
  const today = todayStr()
  const dates = buildDateRange(today, windowSize)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const refresh = useCallback(() => setReloadKey(k => k + 1), [])

  return (
    <div className="min-h-screen text-foreground">
      <header className="sticky top-0 z-10 bg-background/70 backdrop-blur-md border-b border-border/60 px-6 py-3 flex items-center gap-4">
        <span className="text-base font-semibold text-primary tracking-tight flex-shrink-0">
          Daily Work Log
        </span>

        <Separator orientation="vertical" className="h-5" />

        <nav className="flex gap-1">
          {(['log', 'review'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-md text-sm transition-colors capitalize ${
                tab === t
                  ? 'bg-primary/15 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>

        <div className="flex-1" />

        <ManageWorkstreams onChanged={refresh} />
        <ManageLabels />

        <Separator orientation="vertical" className="h-5" />

        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground h-8"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={14} />
        </Button>
      </header>

      {/* Settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {/* Theme */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Theme</p>
              <div className="flex gap-1.5">
                {THEMES.map(t => (
                  <Button
                    key={t.value}
                    size="sm"
                    variant={theme === t.value ? 'default' : 'secondary'}
                    className="h-8 text-xs gap-1.5 flex-1"
                    onClick={() => setTheme(t.value)}
                  >
                    <t.icon size={13} />
                    {t.label}
                  </Button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Day window */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Days to show</p>
              <div className="flex flex-wrap gap-1.5">
                {WINDOW_OPTIONS.map(n => (
                  <Button
                    key={n}
                    size="sm"
                    variant={windowSize === n ? 'default' : 'secondary'}
                    className="h-7 w-10 text-xs p-0"
                    onClick={() => setWindowSize(n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Data */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Data</p>
              <BackupRestore onRestored={refresh} />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <main>
        {tab === 'log' ? (
          <div className="max-w-5xl mx-auto px-4 py-6 space-y-1">
            {dates.map((date, i) => (
              <div key={`${date}-${reloadKey}`}>
                <DaySection date={date} isToday={i === 0} defaultCollapsed={i > 0} />
                {i < dates.length - 1 && <Separator className="my-1 opacity-30" />}
              </div>
            ))}
          </div>
        ) : (
          <ReviewPage />
        )}
      </main>
    </div>
  )
}
