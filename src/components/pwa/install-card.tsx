import { useEffect, useState, useSyncExternalStore } from 'react'
import { Check, Download, Share, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  canInstall,
  isIos,
  isStandalone,
  promptInstall,
  subscribeInstall,
} from '@/lib/install'

/** Carte d'installation réutilisée dans Réglages et dans la feuille « Plus ». */
export function InstallCard({ compact = false }: { compact?: boolean }) {
  const [installed, setInstalled] = useState(() => isStandalone())
  const canPrompt = useSyncExternalStore(subscribeInstall, canInstall, () => false)

  useEffect(() => {
    const onInstalled = () => setInstalled(true)
    window.addEventListener('appinstalled', onInstalled)
    return () => window.removeEventListener('appinstalled', onInstalled)
  }, [])

  async function handleInstall() {
    const accepted = await promptInstall()
    if (accepted) {
      setInstalled(true)
      toast.success('Application installée')
    }
  }

  if (installed) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Check className="size-3.5 text-emerald-600" />
        Application installée sur cet appareil
      </div>
    )
  }

  if (canPrompt) {
    return (
      <Button variant="outline" size="sm" onClick={() => void handleInstall()}>
        <Download className="size-3.5" />
        Installer l’application
      </Button>
    )
  }

  if (isIos()) {
    return (
      <div className={compact ? 'text-xs text-muted-foreground' : 'space-y-1.5 text-sm'}>
        <p className="flex items-center gap-2 font-medium text-foreground">
          <Smartphone className="size-4" />
          Installer sur iPhone / iPad
        </p>
        <p className="text-xs text-muted-foreground">
          Dans Safari, touchez <Share className="mx-0.5 inline size-3.5" /> Partager,
          puis « Sur l’écran d’accueil ».
        </p>
      </div>
    )
  }

  return (
    <p className={compact ? 'text-xs text-muted-foreground' : 'text-sm text-muted-foreground'}>
      Utilisez le menu de votre navigateur pour installer l’application sur cet
      appareil.
    </p>
  )
}
