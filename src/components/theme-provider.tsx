import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ThemeContext,
  type Theme,
  type ThemeContextValue,
} from '@/components/theme-context'

const STORAGE_KEY = 'theme'
const MEDIA = '(prefers-color-scheme: dark)'

function systemPrefersDark(): boolean {
  return typeof window === 'undefined' ? false : window.matchMedia(MEDIA).matches
}

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' || stored === 'system'
      ? stored
      : 'system'
  } catch {
    return 'system'
  }
}

function applyTheme(theme: Theme, systemDark: boolean): void {
  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
  const color = resolved === 'dark' ? '#0b0b0f' : '#ffffff'
  for (const meta of document.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  )) {
    meta.content = color
  }
}

/**
 * Thème minimal, sans script injecté par un provider : le script inline de
 * `index.html` applique déjà la bonne classe avant le premier rendu.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readTheme())
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark())
  const resolvedTheme: 'light' | 'dark' =
    theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useEffect(() => {
    const media = window.matchMedia(MEDIA)
    const onChange = () => setSystemDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    applyTheme(theme, systemDark)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Le thème reste appliqué pour la session courante.
    }
  }, [theme, systemDark])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme: setThemeState,
    }),
    [theme, resolvedTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
