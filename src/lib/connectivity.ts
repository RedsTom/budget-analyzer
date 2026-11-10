/**
 * État de connectivité minimal. `navigator.onLine` n'est qu'un indice : un
 * réseau captif peut être « en ligne » sans Internet. Les erreurs `fetch`
 * sont donc classées séparément dans `ai-errors.ts`.
 */
export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

export function subscribeConnectivity(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export function getConnectivitySnapshot(): boolean {
  return isOnline()
}
