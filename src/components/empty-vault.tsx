import { useState } from 'react'
import { FileUp, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CsvImporter } from '@/components/csv-importer'
import type { ParsedCsvFile } from '@/lib/csv'
import { formatCount } from '@/lib/format'
import type { ImportSummary } from '@/lib/types'
import { useVaultStore } from '@/store/vault-store'

export function EmptyVault() {
  const importRows = useVaultStore((state) => state.importRows)
  const [last, setLast] = useState<ImportSummary | null>(null)

  async function handleParsed(file: ParsedCsvFile) {
    const summary = await importRows(file.rows, file.sourceFile, file.errors)
    setLast(summary)
    toast.success(
      `${file.sourceFile} : ${formatCount(summary.added)} ajoutée(s), ${formatCount(
        summary.duplicates,
      )} ignorée(s)`,
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 py-6">
      <Card>
        <CardHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FileUp className="size-5" />
          </div>
          <CardTitle className="text-xl">Importez votre premier relevé</CardTitle>
          <CardDescription>
            Export CSV de votre banque. Le format est reconnu automatiquement ; sinon,
            vous associez les colonnes à la main. Les fichiers sont dédoublonnés puis
            chiffrés sur cet appareil.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <CsvImporter multiple onParsed={handleParsed} />
          {last ? (
            <p className="text-xs text-muted-foreground">
              Dernier import : {last.sourceFile} · {formatCount(last.added)} ajoutée(s)
              {last.duplicates > 0
                ? ` · ${formatCount(last.duplicates)} ignorée(s)`
                : ''}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">1 · Import</p>
          <p className="mt-1 text-sm">
            Déposez un ou plusieurs exports. Les chevauchements sont ignorés.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">2 · Analyse</p>
          <p className="mt-1 text-sm">
            Catégories, récurrences, couverture FIFO et runway sont calculés localement.
          </p>
        </div>
        <div className="rounded-xl bg-card p-4 border">
          <p className="text-xs font-medium text-muted-foreground">3 · Confidentialité</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm">
            <ShieldCheck className="size-3.5 text-emerald-500" />
            Aucune donnée ne quitte le navigateur.
          </p>
        </div>
      </div>
    </div>
  )
}
