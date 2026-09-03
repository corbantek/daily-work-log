import { useState, useCallback, useEffect, useRef } from 'react'
import { Settings, Sun, Moon, Monitor, X, Plus, Eye, EyeOff, WifiOff, ChevronDown, CalendarDays, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DaySection } from './components/DaySection'
import { ManageWorkstreams } from './components/ManageWorkstreams'
import { ManageLabels } from './components/ManageLabels'
import { BackupRestore } from './components/BackupRestore'
import { ReviewPage } from './pages/ReviewPage'
import { getSettings, setSetting, getDayVisibility, setDayVisibility, clearDayVisibility, getOncallPeriods, createOncallPeriod, deleteOncallPeriod } from './api/client'
import type { OncallPeriod } from './api/types'
import { todayStr, toLocalDateStr, isWeekend } from './api/date'
import { HiddenDaysIndicator } from './components/HiddenDaysIndicator'
import './index.css'

type Tab = 'log' | 'review'
type Theme = 'dark' | 'dim' | 'light'
type ContentWidth = 'normal' | 'wide' | 'wider' | 'full'

function isTheme(v: string | undefined): v is Theme {
  return v === 'dark' || v === 'dim' || v === 'light'
}

function isContentWidth(v: string | undefined): v is ContentWidth {
  return v === 'normal' || v === 'wide' || v === 'wider' || v === 'full'
}

const CONTENT_WIDTH_MAP: Record<ContentWidth, string> = {
  normal: 'max-w-5xl',
  wide:   'max-w-6xl',
  wider:  'max-w-7xl',
  full:   'max-w-full',
}

const CONTENT_WIDTH_OPTIONS: { value: ContentWidth; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'wide',   label: 'Wide' },
  { value: 'wider',  label: 'Wider' },
  { value: 'full',   label: 'Full' },
]

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return toLocalDateStr(dt)
}

function isDateVisible(
  dateStr: string,
  today: string,
  hideWeekends: boolean,
  overrides: Record<string, boolean>,
): boolean {
  if (dateStr === today) return true
  if (dateStr in overrides) return overrides[dateStr]
  if (hideWeekends && isWeekend(dateStr)) return false
  return true
}

function buildDateRange(
  today: string,
  windowSize: number,
  hideWeekends: boolean,
  overrides: Record<string, boolean>,
  fromDate?: string,
): string[] {
  const visible: string[] = []
  if (fromDate) {
    const maxLookback = 400
    for (let i = 0; i < maxLookback; i++) {
      const d = addDays(today, -i)
      if (isDateVisible(d, today, hideWeekends, overrides)) visible.push(d)
      if (d <= fromDate) break
    }
  } else {
    const maxLookback = windowSize * 4
    for (let i = 0; i < maxLookback && visible.length < windowSize; i++) {
      const d = addDays(today, -i)
      if (isDateVisible(d, today, hideWeekends, overrides)) visible.push(d)
    }
  }
  return visible
}

function getHiddenDatesBetween(
  laterDate: string,
  earlierDate: string,
  hideWeekends: boolean,
  overrides: Record<string, boolean>,
  today: string,
): string[] {
  const hidden: string[] = []
  for (let d = addDays(laterDate, -1); d > earlierDate; d = addDays(d, -1)) {
    if (!isDateVisible(d, today, hideWeekends, overrides)) {
      hidden.push(d)
    }
  }
  return hidden
}

const WINDOW_OPTIONS = [3, 5, 7, 10, 14]

const DEFAULT_DAY_STATUSES = ['🤒 Sick', '🏠 Kid at home', '🏖️ Vacation', '⏰ Half day', '📅 Out of office']

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
  const [dayStatuses, setDayStatuses] = useState<string[]>(DEFAULT_DAY_STATUSES)
  const [newStatus, setNewStatus] = useState('')
  const [hideWeekends, setHideWeekends] = useState(false)
  const [visibilityOverrides, setVisibilityOverrides] = useState<Record<string, boolean>>({})
  const [serverUp, setServerUp] = useState(true)
  const [contentWidth, setContentWidth] = useState<ContentWidth>('normal')
  const [extendedFrom, setExtendedFrom] = useState<string | null>(() => {
    const p = new URLSearchParams(window.location.search).get('from')
    return p && /^\d{4}-\d{2}-\d{2}$/.test(p) && p < todayStr() ? p : null
  })
  const [oncallPeriods, setOncallPeriods] = useState<OncallPeriod[]>([])
  const [newOncallStart, setNewOncallStart] = useState('')
  const [newOncallEnd, setNewOncallEnd] = useState('')
  const today = todayStr()
  const dates = buildDateRange(today, windowSize, hideWeekends, visibilityOverrides, extendedFrom ?? undefined)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch('/api/health')
        setServerUp(res.ok)
      } catch {
        setServerUp(false)
      }
    }
    checkHealth()
    const id = setInterval(checkHealth, 15000)
    return () => clearInterval(id)
  }, [])

  function loadVisibilityOverrides(from?: string) {
    const floor = from && from < addDays(today, -60) ? from : addDays(today, -60)
    return getDayVisibility(floor, today).then(setVisibilityOverrides).catch(() => {})
  }

  // Load all settings from the database on startup
  useEffect(() => {
    Promise.all([
      getSettings().then(s => {
        if (s.app_title) setAppTitle(s.app_title)
        if (isTheme(s.theme)) setTheme(s.theme)
        const days = parseInt(s.days_to_show)
        if (days && WINDOW_OPTIONS.includes(days)) setWindowSize(days)
        if (s.hide_weekends === 'true') setHideWeekends(true)
        if (isContentWidth(s.content_width)) setContentWidth(s.content_width)
        if (s.day_status_options) {
          try {
            const parsed = JSON.parse(s.day_status_options)
            if (Array.isArray(parsed)) {
              const custom = parsed.filter((v: string) => !DEFAULT_DAY_STATUSES.includes(v))
              setDayStatuses([...DEFAULT_DAY_STATUSES, ...custom])
            }
          } catch { /* use defaults */ }
        }
      }),
      loadVisibilityOverrides(),
      getOncallPeriods().then(setOncallPeriods).catch(() => {}),
    ]).finally(() => {
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

  function changeHideWeekends(val: boolean) {
    setHideWeekends(val)
    setSetting('hide_weekends', String(val))
  }

  function changeContentWidth(val: ContentWidth) {
    setContentWidth(val)
    setSetting('content_width', val)
  }

  const handleVisibilityChange = useCallback(async (date: string, visible: boolean | null) => {
    if (visible === null) {
      await clearDayVisibility(date)
      setVisibilityOverrides(prev => {
        const next = { ...prev }
        delete next[date]
        return next
      })
    } else {
      await setDayVisibility(date, visible)
      setVisibilityOverrides(prev => ({ ...prev, [date]: visible }))
    }
  }, [])

  function applyExtendedFrom(newFrom: string) {
    setExtendedFrom(newFrom)
    history.replaceState(null, '', `?from=${newFrom}`)
    loadVisibilityOverrides(newFrom)
  }

  function loadMore() {
    const currentBottom = dates.length > 0 ? dates[dates.length - 1] : today
    applyExtendedFrom(addDays(currentBottom, -windowSize))
  }

  function goToDate(dateStr: string) {
    if (!dateStr) return
    const currentBottom = dates.length > 0 ? dates[dates.length - 1] : today
    if (dateStr < currentBottom) {
      applyExtendedFrom(dateStr)
    }
  }

  const datePickerRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    setReloadKey(k => k + 1)
    loadVisibilityOverrides(extendedFrom ?? undefined)
  }, [extendedFrom])

  function resetExtendedFrom() {
    setExtendedFrom(null)
    setReloadKey(k => k + 1)
    history.replaceState(null, '', window.location.pathname)
  }

  async function addOncallPeriod() {
    if (!newOncallStart || !newOncallEnd) return
    if (newOncallEnd < newOncallStart) return
    await createOncallPeriod(newOncallStart, newOncallEnd)
    setNewOncallStart('')
    setNewOncallEnd('')
    getOncallPeriods().then(setOncallPeriods)
    setReloadKey(k => k + 1)
  }

  async function removeOncallPeriod(id: string) {
    await deleteOncallPeriod(id)
    setOncallPeriods(prev => prev.filter(p => p.id !== id))
    setReloadKey(k => k + 1)
  }

  if (!settingsLoaded) {
    return <div className="min-h-screen" />
  }

  return (
    <div className="min-h-screen text-foreground">
      <header className="sticky top-0 z-10 bg-background/70 backdrop-blur-md border-b border-border/60 px-6 py-3 flex items-center gap-4">
        <button
          onClick={resetExtendedFrom}
          className="text-base font-semibold text-primary tracking-tight flex-shrink-0 hover:opacity-75 transition-opacity"
        >
          {appTitle}
        </button>

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

            {/* Content width */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Width</p>
              <div className="flex gap-1.5">
                {CONTENT_WIDTH_OPTIONS.map(opt => (
                  <Button
                    key={opt.value}
                    size="sm"
                    variant={contentWidth === opt.value ? 'default' : 'secondary'}
                    className="h-8 text-xs flex-1"
                    onClick={() => changeContentWidth(opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Weekends */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Weekends</p>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant={hideWeekends ? 'default' : 'secondary'}
                  className="h-8 text-xs gap-1.5 flex-1"
                  onClick={() => changeHideWeekends(true)}
                >
                  <EyeOff size={13} />
                  Hide
                </Button>
                <Button
                  size="sm"
                  variant={!hideWeekends ? 'default' : 'secondary'}
                  className="h-8 text-xs gap-1.5 flex-1"
                  onClick={() => changeHideWeekends(false)}
                >
                  <Eye size={13} />
                  Show
                </Button>
              </div>
            </div>

            <Separator />

            {/* Day statuses */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Day statuses</p>
              {dayStatuses.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {dayStatuses.map(s => (
                    <span key={s} className="inline-flex items-center gap-1 text-xs bg-red-500/15 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full">
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

            {/* On-call periods */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                <Bell size={11} className="text-amber-400" /> On-call periods
              </p>
              {oncallPeriods.length > 0 && (
                <div className="space-y-1 mb-2">
                  {oncallPeriods.map(p => (
                    <div key={p.id} className="flex items-center justify-between text-xs bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-1.5">
                      <span className="text-amber-400/90">{p.start_date} → {p.end_date}</span>
                      <button onClick={() => removeOncallPeriod(p.id)} className="text-muted-foreground hover:text-destructive transition-colors ml-2">
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 items-center">
                <Input
                  type="date"
                  value={newOncallStart}
                  onChange={e => setNewOncallStart((e.target as HTMLInputElement).value)}
                  className="h-7 text-xs flex-1"
                />
                <span className="text-xs text-muted-foreground">→</span>
                <Input
                  type="date"
                  value={newOncallEnd}
                  onChange={e => setNewOncallEnd((e.target as HTMLInputElement).value)}
                  className="h-7 text-xs flex-1"
                />
                <Button size="sm" className="h-7 text-xs gap-1 shrink-0" onClick={addOncallPeriod} disabled={!newOncallStart || !newOncallEnd || newOncallEnd < newOncallStart}>
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

      {!serverUp && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <WifiOff size={32} className="text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Server connection lost</p>
            <p className="text-xs text-muted-foreground">Changes won't be saved until the server comes back.</p>
          </div>
        </div>
      )}

      <main>
        {tab === 'log' ? (
          <div className={`${CONTENT_WIDTH_MAP[contentWidth]} mx-auto px-4 py-6 space-y-1`}>
            {dates.map((date, i) => {
              const hiddenBetween = i > 0
                ? getHiddenDatesBetween(dates[i - 1], date, hideWeekends, visibilityOverrides, today)
                : []
              return (
                <div key={`${date}-${reloadKey}`}>
                  {hiddenBetween.length > 0 && (
                    <HiddenDaysIndicator
                      hiddenDates={hiddenBetween}
                      onUnhide={(d) => handleVisibilityChange(d, true)}
                    />
                  )}
                  <DaySection
                    date={date}
                    isToday={i === 0}
                    defaultCollapsed={i > 0}
                    isHiddenByDefault={hideWeekends && isWeekend(date)}
                    onVisibilityChange={handleVisibilityChange}
                  />
                  {i < dates.length - 1 && <Separator className="my-1 opacity-30" />}
                </div>
              )
            })}

            <div className="flex items-center gap-3 pt-4 pb-2">
              <button
                onClick={loadMore}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <ChevronDown size={13} /> Load {windowSize} more days
              </button>
              <Separator orientation="vertical" className="h-4" />
              <button
                onClick={() => datePickerRef.current?.showPicker()}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <CalendarDays size={13} /> Go to date…
              </button>
              <input
                ref={datePickerRef}
                type="date"
                max={addDays(today, -1)}
                className="sr-only"
                style={{ colorScheme: theme === 'light' ? 'light' : 'dark' }}
                onChange={e => { goToDate((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = '' }}
              />
            </div>
          </div>
        ) : (
          <ReviewPage containerClass={`${CONTENT_WIDTH_MAP[contentWidth]} mx-auto px-4 py-6`} />
        )}
      </main>
    </div>
  )
}
