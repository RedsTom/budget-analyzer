import { useState } from 'react'
import { Download, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getRawEnvelope } from '@/lib/storage'
import { restoreVaultBackup } from '@/lib/vault-backup'
import { useVaultStore } from '@/store/vault-store'

function downloadRaw(): void {
  const raw = getRawEnvelope()
  if (!raw) {
    toast.error('Aucune donnée à récupérer.')
    return
  }
  const blob = new Blob([raw], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'budget-analyzer-coffre-illisible.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Le coffre existe mais son enveloppe est illisible (JSON tronqué, schéma
 * inconnu…). On ne propose jamais de créer un nouveau coffre par-dessus :
 * l'utilisateur peut d'abord récupérer les octets bruts.
 */
export function VaultRecoveryScreen() {
  const reset = useVaultStore((state) => state.reset)
  const [restoring, setRestoring] = useState(false)

  async function handleRestore(file: File) {
    if (!window.confirm('Remplacer le coffre illisible par cette sauvegarde ?')) return
    setRestoring(true)
    try {
      await restoreVaultBackup(file)
      toast.success('Sauvegarde restaurée', {
        description: 'Rechargement pour déverrouiller le coffre…',
      })
      window.setTimeout(() => window.location.reload(), 600)
    } catch (cause) {
      toast.error('Restauration impossible', {
        description: cause instanceof Error ? cause.message : 'Fichier invalide',
      })
    } finally {
      setRestoring(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <ShieldCheck className="size-5" />
          </div>
          <CardTitle className="text-xl">Coffre illisible</CardTitle>
          <CardDescription>
            Un coffre est bien présent dans ce navigateur, mais son enveloppe chiffrée
            est corrompue ou utilise un format inconnu. Vos données ne sont pas
            écrasées automatiquement.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Alert>
            <ShieldCheck />
            <AlertTitle>Téléchargez d’abord une copie brute</AlertTitle>
            <AlertDescription>
              Le fichier reste chiffré : sans votre mot de passe, il est inutilisable.
              Conservez-le avant toute tentative de réinitialisation.
            </AlertDescription>
          </Alert>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="flex-1" onClick={downloadRaw}>
              <Download className="size-4" />
              Télécharger la sauvegarde brute
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              disabled={restoring}
              onClick={() => document.getElementById('recovery-restore-input')?.click()}
            >
              <Upload className="size-4" />
              {restoring ? 'Restauration…' : 'Restaurer'}
            </Button>
            <input
              id="recovery-restore-input"
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void handleRestore(file)
              }}
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="flex-1">
                  <Trash2 className="size-4" />
                  Réinitialiser
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Supprimer le coffre illisible ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Cette action efface définitivement l’enveloppe présente dans ce
                    navigateur. Elle est irréversible.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => {
                      reset()
                      toast.success('Coffre supprimé')
                    }}
                  >
                    Supprimer
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Si vous avez une sauvegarde valide, utilisez « Restaurer ». La
            réinitialisation ne doit servir qu’en dernier recours.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
