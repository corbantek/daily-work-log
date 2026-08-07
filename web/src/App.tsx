import { useState, useCallback, useEffect } from 'react'
import { Settings, Sun, Moon, Monitor, X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DaySection } from './components/DaySection'
import { ManageWorkstreams } from './components/ManageWorkstreams'
import { ManageLabels } from './components/ManageLabels'
import { BackupRestore } from './components/BackupRestore'
import { ReviewPage } from './pages/ReviewPage'
import { getSettings, setSetting } from './api/client'
import { todayStr, toLocalDateStr } from './api/date'
import './index.css'

type Tab = 'log' | 'review'
type Theme = 'dark' | 'dim' | 'light'

function isTheme(v: string | undefined): v is Theme {
  return v === 'dark' || v === 'dim' || v === 'light'
}

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

function applyTheme(theme: Theme) {
  const html = document.documentElement
  html.classList.remove('dark', 'dim')
  if (theme !== 'light') html.classList.add(theme)
}

export default function App() {
  const [tab, setTab] = useState<Tab>('log')
  const [windowSize, setWindowSize] = useState(5)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [theme, setTheme] = useState<Theme>('dim')
  const [appTitle, setAppTitle] = useState('Daily Work Log')
  const [editTitle, setEditTitle] = useState('')
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [dayStatuses, setDayStatuses] = useState<string[]>([])
  const [newStatus, setNewStatus] = useState('')
  const today = todayStr()
  const dates = buildDateRange(today, windowSize)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // Load all settings from the database on startup
  useEffect(() => {
    getSettings().then(s => {
      if (s.app_title) setAppTitle(s.app_title)
      if (isTheme(s.theme)) setTheme(s.theme)
      const days = parseInt(s.days_to_show)
      if (days && WINDOW_OPTIONS.includes(days)) setWindowSize(days)
      if (s.day_status_options) {
        try {
          const parsed = JSON.parse(s.day_status_options)
          if (Array.isArray(parsed)) setDayStatuses(parsed)
        } catch { /* use defaults */ }
      }
      setSettingsLoaded(true)
    }).catch(() => {
      setSettingsLoaded(true)
    })
  }, [])

  function changeTheme(t: Theme) {
    setTheme(t)
    setSetting('theme', t)
  }

  function changeWindowSize(n: number) {
    setWindowSize(n)
    setSetting('days_to_show', String(n))
  }

  function saveTitle() {
    const val = editTitle.trim() || 'Daily Work Log'
    setSetting('app_title', val).then(() => setAppTitle(val))
  }

  function saveDayStatuses(updated: string[]) {
    setDayStatuses(updated)
    setSetting('day_status_options', JSON.stringify(updated))
  }

  function addDayStatus() {
    const val = newStatus.trim()
    if (!val || dayStatuses.includes(val)) return
    saveDayStatuses([...dayStatuses, val])
    setNewStatus('')
  }

  function removeDayStatus(status: string) {
    saveDayStatuses(dayStatuses.filter(s => s !== status))
  }

  const refresh = useCallback(() => setReloadKey(k => k + 1), [])

  if (!settingsLoaded) {
    return <div className="min-h-screen" />
  }

  return (
    <div className="min-h-screen text-foreground">
      <header className="sticky top-0 z-10 bg-background/70 backdrop-blur-md border-b border-border/60 px-6 py-3 flex items-center gap-4">
        <span className="text-base font-semibold text-primary tracking-tight flex-shrink-0">
          {appTitle}
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
          onClick={() => { setEditTitle(appTitle); setSettingsOpen(true) }}
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
            {/* App title */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">App title</p>
              <div className="flex gap-2">
                <Input
                  value={editTitle}
                  onChange={e => setEditTitle((e.target as HTMLInputElement).value)}
                  placeholder="Daily Work Log"
                  className="h-8 text-sm flex-1"
                  onKeyDown={e => { if (e.key === 'Enter') saveTitle() }}
                />
                <Button size="sm" className="h-8 text-xs" onClick={saveTitle}>
                  Save
                </Button>
              </div>
            </div>

            <Separator />

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
                    onClick={() => changeTheme(t.value)}
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
                    onClick={() => changeWindowSize(n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Day statuses */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Day statuses</p>
              {dayStatuses.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {dayStatuses.map(s => (
                    <span key={s} className="inline-flex items-center gap-1 text-xs bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full">
                      {s}
                      <button onClick={() => removeDayStatus(s)} className="hover:text-destructive transition-colors">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  value={newStatus}
                  onChange={e => setNewStatus((e.target as HTMLInputElement).value)}
                  placeholder="e.g. 🤒 Sick"
                  className="h-7 text-xs flex-1"
                  onKeyDown={e => { if (e.key === 'Enter') addDayStatus() }}
                />
                <Button size="sm" className="h-7 text-xs gap-1" onClick={addDayStatus}>
                  <Plus size={11} /> Add
                </Button>
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
