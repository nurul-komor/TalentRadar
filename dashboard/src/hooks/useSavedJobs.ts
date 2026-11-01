import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'hunter-saved-jobs'

function readSaved(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeSaved(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // ignore storage failures (private browsing, quota, etc.)
  }
}

export function useSavedJobs() {
  const [savedIds, setSavedIds] = useState<string[]>(() => readSaved())

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setSavedIds(readSaved())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const isSaved = useCallback((jobId: string) => savedIds.includes(jobId), [savedIds])

  const toggleSaved = useCallback((jobId: string) => {
    setSavedIds((current) => {
      const next = current.includes(jobId)
        ? current.filter((id) => id !== jobId)
        : [...current, jobId]
      writeSaved(next)
      return next
    })
  }, [])

  return { savedIds, isSaved, toggleSaved }
}
