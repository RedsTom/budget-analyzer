import { Sparkles, Timer, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useOnline } from '@/hooks/use-online'
import type { AiFailureCode } from '@/lib/ai-errors'
import { navigate } from '@/lib/router'
import { useAiNoticeStore } from '@/store/ai-notice-store'

const TITLES: Record<AiFailureCode, string> = {
  offline: 'L’IA nécessite une connexion',
  timeout: 'Le service met trop de temps à répondre',
  quota: 'Le service est temporairement saturé',
  auth: 'La clé API est invalide',
  server: 'Le service est momentanément indisponible',
  'invalid-response': 'Réponse inexploitable',
  unknown: 'Action IA impossible',
}

const BODIES: Partial<Record<AiFailureCode, string>> = {
  offline:
    'Le reste de l’application continue de fonctionner hors ligne. Vos données restent dans le coffre chiffré. Reconnectez-vous pour utiliser l’assistant, les synthèses et le renommage automatique.',
  timeout:
    'La requête a dépassé le délai d’attente. Vos données locales ne sont pas affectées. Vous pouvez réessayer dans un instant.',
  quota:
    'Le service distant est très sollicité. Réessayez dans quelques instants ; les analyses locales restent disponibles.',
  auth:
    'Vérifiez la clé API dans les réglages. Elle est peut-être expirée, révoquée ou mal saisie.',
}

export function AiNoticeDialog() {
  const failure = useAiNoticeStore((state) => state.failure)
  const retry = useAiNoticeStore((state) => state.retry)
  const close = useAiNoticeStore((state) => state.close)
  const online = useOnline()

  if (!failure) return null

  const code = failure.code
  const canRetry = Boolean(retry) && failure.retryable && online
  const Icon = code === 'offline' ? WifiOff : code === 'timeout' ? Timer : Sparkles

  function handleRetry() {
    const action = retry
    close()
    action?.()
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-5" />
          </div>
          <DialogTitle>{TITLES[code]}</DialogTitle>
          <DialogDescription>
            {BODIES[code] ?? failure.message}
          </DialogDescription>
          {BODIES[code] && code !== 'offline' && failure.message !== BODIES[code] ? (
            <p className="text-xs text-muted-foreground">{failure.message}</p>
          ) : null}
        </DialogHeader>

        <DialogFooter className="mt-2">
          {code === 'auth' ? (
            <Button
              variant="outline"
              onClick={() => {
                close()
                navigate('settings')
              }}
            >
              Ouvrir les réglages
            </Button>
          ) : null}
          {canRetry ? (
            <Button variant="outline" onClick={handleRetry}>
              Réessayer
            </Button>
          ) : null}
          <Button onClick={close}>
            {code === 'offline' ? 'Continuer hors ligne' : 'Fermer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
