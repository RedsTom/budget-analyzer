import { useCallback, useMemo, useSyncExternalStore } from 'react'

/** Media query réactive, sans dépendance externe. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined') return () => {}
      const media = window.matchMedia(query)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    [query],
  )

  const getSnapshot = useMemo(
    () => () => (typeof window === 'undefined' ? false : window.matchMedia(query).matches),
    [query],
  )

  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

/** Sous `md` : téléphone, panneau plein écran, listes tactiles. */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)')
}
