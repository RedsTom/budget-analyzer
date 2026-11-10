import { useSyncExternalStore } from 'react'

export const PAGE_IDS = [
  'overview',
  'analysis',
  'budgets',
  'assistant',
  'transactions',
  'recurring',
  'merchants',
  'coverage',
  'manual',
  'settings',
] as const

export type PageId = (typeof PAGE_IDS)[number]

const DEFAULT_PAGE: PageId = 'overview'

export function isPageId(value: string): value is PageId {
  return (PAGE_IDS as readonly string[]).includes(value)
}

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

function parseHash(): PageId {
  const raw = currentHash().replace(/^#\/?/, '').split('?')[0]
  return isPageId(raw) ? raw : DEFAULT_PAGE
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

/** Route minimaliste par hash : aucun serveur, fonctionne en local. */
export function usePage(): PageId {
  return useSyncExternalStore(subscribe, parseHash, () => DEFAULT_PAGE)
}

export function navigate(page: PageId): void {
  const target = `#/${page}`
  if (currentHash() !== target) window.location.hash = target
}
