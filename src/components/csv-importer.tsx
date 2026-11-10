import { useMemo, useRef, useState } from 'react'
import { FileUp, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  CSV_FIELDS,
  decodeCsvBytes,
  FIELD_LABELS,
  inspectCsvText,
  mappingIssue,
  parseCsvText,
  type ColumnMapping,
  type CsvField,
  type CsvInspection,
  type DecimalSeparator,
  type DebitSign,
  type ParsedCsvFile,
} from '@/lib/csv'
import { formatAmount, formatCount, formatDate } from '@/lib/format'

interface MappingDraft {
  sourceFile: string
  text: string
  inspection: CsvInspection
  mapping: ColumnMapping
  delimiter: string
  hasHeader: boolean
  decimalSeparator: DecimalSeparator
  debitSign: DebitSign
  error: string | null
}

export interface CsvImporterProps {
  /** Appelé une fois par fichier exploitable, dans l'ordre de sélection. */
  onParsed: (file: ParsedCsvFile) => void | Promise<void>
  /** Autorise la sélection de plusieurs fichiers (imports successifs). */
  multiple?: boolean
  disabled?: boolean
  compact?: boolean
}

const DELIMITERS: { value: string; label: string }[] = [
  { value: ';', label: 'Point-virgule ( ; )' },
  { value: ',', label: 'Virgule ( , )' },
  { value: '\t', label: 'Tabulation' },
  { value: '|', label: 'Barre verticale ( | )' },
]

/**
 * Sélecteur de fichiers CSV avec détection de format.
 *
 * Si les en-têtes correspondent aux champs attendus, le fichier est parsé
 * directement. Sinon, un panneau permet d'associer chaque colonne au champ
 * correspondant, avec aperçu et validation avant import.
 */
export function CsvImporter({
  onParsed,
  multiple = false,
  disabled = false,
  compact = false,
}: CsvImporterProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const queueRef = useRef<File[]>([])
  const totalRef = useRef(0)
  const positionRef = useRef(0)

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ position: number; total: number } | null>(null)
  const [draft, setDraft] = useState<MappingDraft | null>(null)

  const preview = useMemo(() => {
    if (!draft) return null
    const issue = mappingIssue(draft.mapping)
    if (issue) return { issue, rows: [], total: 0, errorCount: 0 }

    const result = parseCsvText(draft.text, {
      mapping: draft.mapping,
      delimiter: draft.delimiter,
      hasHeader: draft.hasHeader,
      decimalSeparator: draft.decimalSeparator,
      debitSign: draft.debitSign,
    })

    return {
      issue: null,
      rows: result.rows.slice(0, 4),
      total: result.rows.length,
      errorCount: result.errors.length,
    }
  }, [draft])

  async function startImport(files: File[]) {
    if (disabled || busy || files.length === 0) return

    const list = multiple ? files : files.slice(0, 1)
    queueRef.current = list.slice(1)
    totalRef.current = list.length
    positionRef.current = 0

    await importFile(list[0])
  }

  async function importFile(file: File) {
    positionRef.current += 1
    setBusy(true)
    setProgress({ position: positionRef.current, total: totalRef.current })

    try {
      const buffer = await file.arrayBuffer()
      const text = decodeCsvBytes(buffer)
      const inspection = inspectCsvText(text)
      const base: MappingDraft = {
        sourceFile: file.name,
        text,
        inspection,
        mapping: inspection.mapping,
        delimiter: inspection.delimiter,
        hasHeader: true,
        decimalSeparator: 'auto',
        debitSign: 'negative',
        error: null,
      }

      if (!inspection.complete) {
        setDraft(base)
        setBusy(false)
        setProgress(null)
        return
      }

      const { rows, errors } = parseCsvText(text, {
        mapping: inspection.mapping,
        delimiter: inspection.delimiter,
        hasHeader: true,
      })

      if (rows.length === 0) {
        setDraft({
          ...base,
          error: errors[0]?.message ?? 'Aucune opération exploitable détectée.',
        })
        setBusy(false)
        setProgress(null)
        return
      }

      await onParsed({ rows, errors, sourceFile: file.name })
      await importNext()
    } catch (cause) {
      toast.error(`Import impossible : ${file.name}`, {
        description: cause instanceof Error ? cause.message : 'Fichier illisible',
      })
      await importNext()
    }
  }

  async function importNext() {
    const next = queueRef.current.shift()
    if (!next) {
      setBusy(false)
      setProgress(null)
      return
    }
    await importFile(next)
  }

  async function confirmMapping() {
    if (!draft) return

    const issue = mappingIssue(draft.mapping)
    if (issue) {
      setDraft({ ...draft, error: issue })
      return
    }

    setBusy(true)
    try {
      const { rows, errors } = parseCsvText(draft.text, {
        mapping: draft.mapping,
        delimiter: draft.delimiter,
        hasHeader: draft.hasHeader,
        decimalSeparator: draft.decimalSeparator,
        debitSign: draft.debitSign,
      })

      if (rows.length === 0) {
        setDraft({
          ...draft,
          error: errors[0]?.message ?? 'Aucune opération exploitable avec ces colonnes.',
        })
        setBusy(false)
        return
      }

      const sourceFile = draft.sourceFile
      setDraft(null)
      setProgress(null)
      await onParsed({ rows, errors, sourceFile })
      await importNext()
    } catch (cause) {
      toast.error(`Import impossible : ${draft.sourceFile}`, {
        description: cause instanceof Error ? cause.message : 'Fichier illisible',
      })
      setBusy(false)
    }
  }

  function cancelMapping() {
    queueRef.current = []
    setDraft(null)
    setBusy(false)
    setProgress(null)
  }

  function updateMapping(field: CsvField, value: string) {
    if (!draft) return
    const mapping: ColumnMapping = { ...draft.mapping }
    if (value === 'none') delete mapping[field]
    else mapping[field] = Number(value)
    setDraft({ ...draft, mapping, error: null })
  }

  function changeDelimiter(delimiter: string) {
    if (!draft) return
    const inspection = inspectCsvText(draft.text, delimiter)
    setDraft({
      ...draft,
      delimiter,
      inspection,
      mapping: inspection.mapping,
      error: null,
    })
  }

  if (draft) {
    const columnLabel = (index: number) => {
      const header = draft.inspection.headers[index]?.trim()
      return header ? `Colonne ${index + 1} · ${header}` : `Colonne ${index + 1}`
    }

    return (
      <div className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-medium">Associer les colonnes</p>
            <p className="text-xs text-muted-foreground">
              {draft.sourceFile} · en-têtes lus à la ligne {draft.inspection.headerLine} ·{' '}
              {formatCount(draft.inspection.totalRows)} ligne(s)
            </p>
          </div>
          <Badge variant="secondary">Format non reconnu</Badge>
        </div>

        <Alert>
          <AlertTitle>Le format de ce fichier n’est pas standard</AlertTitle>
          <AlertDescription>
            Indiquez quelle colonne contient chaque information. Un aperçu se met à
            jour au fur et à mesure. Les colonnes « Montant signé » et « Débit/Crédit »
            sont deux alternatives.
          </AlertDescription>
        </Alert>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Séparateur</Label>
            <Select value={draft.delimiter} onValueChange={changeDelimiter}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DELIMITERS.map((delimiter) => (
                  <SelectItem key={delimiter.value} value={delimiter.value}>
                    {delimiter.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Séparateur décimal</Label>
            <Select
              value={draft.decimalSeparator}
              onValueChange={(value) =>
                setDraft({
                  ...draft,
                  decimalSeparator: value as DecimalSeparator,
                  error: null,
                })
              }
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Détection automatique</SelectItem>
                <SelectItem value=",">Virgule ( 1 234,56 )</SelectItem>
                <SelectItem value=".">Point ( 1,234.56 )</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {CSV_FIELDS.map((field) => (
            <div key={field} className="space-y-1.5">
              <Label>
                {FIELD_LABELS[field]}
                {field === 'date' || field === 'label' ? (
                  <span className="text-destructive"> *</span>
                ) : null}
              </Label>
              <Select
                value={draft.mapping[field] == null ? 'none' : String(draft.mapping[field])}
                onValueChange={(value) => updateMapping(field, value)}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue placeholder="— Aucune —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Aucune —</SelectItem>
                  {draft.inspection.headers.map((_, index) => (
                    <SelectItem key={index} value={String(index)}>
                      {columnLabel(index)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}

          {draft.mapping.debit != null ? (
            <div className="space-y-1.5">
              <Label>Signe des débits</Label>
              <Select
                value={draft.debitSign}
                onValueChange={(value) =>
                  setDraft({ ...draft, debitSign: value as DebitSign, error: null })
                }
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="negative">Déjà négatifs ( -12,50 )</SelectItem>
                  <SelectItem value="positive">Positifs à inverser ( 12,50 )</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={draft.hasHeader}
            onCheckedChange={(checked) =>
              setDraft({ ...draft, hasHeader: checked === true, error: null })
            }
          />
          La première ligne contient les en-têtes
        </label>

        {preview && preview.issue ? (
          <p className="text-sm text-destructive" role="alert">
            {preview.issue}
          </p>
        ) : null}

        {preview && !preview.issue ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {formatCount(preview.total)} opération(s) détectée(s)
              </span>
              {preview.errorCount > 0 ? (
                <span className="text-amber-600 dark:text-amber-400">
                  · {formatCount(preview.errorCount)} ligne(s) ignorée(s)
                </span>
              ) : null}
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">Libellé</th>
                    <th className="px-3 py-2 text-right font-medium">Débit</th>
                    <th className="px-3 py-2 text-right font-medium">Crédit</th>
                    <th className="px-3 py-2 text-right font-medium">Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, index) => (
                    <tr key={index} className="border-t">
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-muted-foreground">
                        {formatDate(row.date)}
                      </td>
                      <td className="max-w-[16rem] truncate px-3 py-1.5">
                        {row.rawLabel}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-rose-600 dark:text-rose-400">
                        {row.debit === null ? '—' : formatAmount(row.debit)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {row.credit === null ? '—' : formatAmount(row.credit)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatAmount(row.solde)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {draft.mapping.solde == null ? (
              <p className="text-xs text-muted-foreground">
                Aucune colonne de solde : un solde courant sera reconstruit depuis 0
                dans l’ordre du fichier.
              </p>
            ) : null}
          </div>
        ) : null}

        {draft.error ? (
          <p className="text-sm text-destructive" role="alert">
            {draft.error}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={cancelMapping} disabled={busy}>
            Annuler
          </Button>
          <Button
            type="button"
            onClick={() => void confirmMapping()}
            disabled={busy || preview?.issue != null || preview?.total === 0}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? 'Import…' : 'Importer ce fichier'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        void startImport(Array.from(event.dataTransfer.files))
      }}
      className={`rounded-xl border border-dashed transition-colors hover:border-primary/50 hover:bg-accent/40 ${
        compact ? 'p-4' : 'p-8'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        multiple={multiple}
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void startImport(files)
        }}
      />
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        className="flex w-full flex-col items-center gap-2 text-center disabled:opacity-60"
      >
        <div
          className={`flex items-center justify-center rounded-full bg-primary/10 text-primary ${
            compact ? 'size-8' : 'size-12'
          }`}
        >
          {busy ? (
            <Loader2 className={compact ? 'size-4 animate-spin' : 'size-6 animate-spin'} />
          ) : (
            <FileUp className={compact ? 'size-4' : 'size-6'} />
          )}
        </div>
        <div>
          <p className={`font-medium ${compact ? 'text-sm' : ''}`}>
            {busy
              ? progress
                ? `Lecture du fichier ${progress.position}/${progress.total}…`
                : 'Import en cours…'
              : multiple
                ? 'Choisir des fichiers CSV'
                : 'Choisir un fichier CSV'}
          </p>
          {!compact ? (
            <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
              {multiple
                ? 'ou déposez-les ici · plusieurs fichiers acceptés'
                : 'ou déposez-le ici · le format est détecté automatiquement'}
            </p>
          ) : null}
        </div>
      </button>
    </div>
  )
}
