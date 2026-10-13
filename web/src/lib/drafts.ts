// Browser-side copy of an unsaved note draft, so a reload or crash doesn't lose it.
// The editor writes it while you type and removes it once the text is saved or cancelled.

const PREFIX = 'worklog-draft:'

export interface StoredDraft {
  text: string
}

export function readDraft(key: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as StoredDraft) : null
  } catch {
    return null
  }
}

export function writeDraft(key: string, text: string) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ text } satisfies StoredDraft))
  } catch { /* storage full or unavailable: drafts are best-effort */ }
}

export function clearDraft(key: string) {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch { /* ignore */ }
}

export const hasDraft = (key: string) => readDraft(key) !== null
