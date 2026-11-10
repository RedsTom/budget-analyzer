import { useSyncExternalStore } from 'react'
import {
  getConnectivitySnapshot,
  subscribeConnectivity,
} from '@/lib/connectivity'

/** Vrai quand le navigateur se déclare connecté. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeConnectivity,
    getConnectivitySnapshot,
    () => true,
  )
}
