import { createContext, useContext } from 'react'

// How tall the markdown notes editor is, chosen per kind of note in Settings.
export type NoteKind = 'task' | 'meeting' | 'person'
export type NoteSize = 'short' | 'medium' | 'long'
export type NotesHeights = Record<NoteKind, NoteSize>

export const NOTE_KINDS: { kind: NoteKind; label: string }[] = [
  { kind: 'task', label: 'Task notes' },
  { kind: 'meeting', label: 'Meeting notes' },
  { kind: 'person', label: 'Person notes' },
]
export const NOTE_SIZES: { size: NoteSize; label: string }[] = [
  { size: 'short', label: 'Short' },
  { size: 'medium', label: 'Medium' },
  { size: 'long', label: 'Long' },
]

export const NOTE_SIZE_PX: Record<NoteSize, number> = { short: 120, medium: 240, long: 400 }
export const DEFAULT_NOTES_HEIGHTS: NotesHeights = { task: 'medium', meeting: 'long', person: 'medium' }

export const noteHeightSettingKey = (kind: NoteKind) => `notes_height_${kind}`
export const isNoteSize = (v: string | undefined): v is NoteSize => v === 'short' || v === 'medium' || v === 'long'

export const NotesHeightContext = createContext<NotesHeights>(DEFAULT_NOTES_HEIGHTS)

/** Minimum editor height in px for this kind of note. */
export function useNoteHeight(kind: NoteKind): number {
  return NOTE_SIZE_PX[useContext(NotesHeightContext)[kind]]
}
