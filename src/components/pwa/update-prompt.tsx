import { useEffect } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { flushVaultWrites } from '@/store/vault-store'
import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Mise à jour contrôlée : on ne recharge jamais pendant une saisie. Les
 * écritures du coffre sont vidées avant de basculer sur la nouvelle version.
 */
export function PwaUpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  useEffect(() => {
    if (!offlineReady) return
    toast.success('Application prête hors ligne', {
      description: 'Vos données locales restent disponibles sans connexion.',
    })
    setOfflineReady(false)
  }, [offlineReady, setOfflineReady])

  if (!needRefresh) return null

  async function handleUpdate() {
    try {
      await flushVaultWrites()
      setNeedRefresh(false)
      await updateServiceWorker(true)
    } catch {
      toast.error('Mise à jour impossible pour le moment', {
        description: 'Vos données n’ont pas été modifiées. Réessayez plus tard.',
      })
    }
  }

  return (
    <div
      className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96"
      role="status"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <RefreshCw className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Nouvelle version disponible</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Rechargez quand vous avez terminé. Vos données ne seront pas affectées.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => void handleUpdate()}>
              Recharger
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setNeedRefresh(false)}
            >
              Plus tard
            </Button>
          </div>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Masquer la mise à jour"
          onClick={() => setNeedRefresh(false)}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
