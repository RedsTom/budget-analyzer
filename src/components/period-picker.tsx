import { useState } from 'react'
import { CalendarRange } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { datasetRange, PERIOD_PRESETS } from '@/lib/period'
import { usePeriod } from '@/hooks/use-period'
import { useUiStore } from '@/store/ui-store'
import { useVaultStore } from '@/store/vault-store'
import { cn } from 'cn'

export function PeriodPicker({ className }: { className?: string }) {
  const transactions = useVaultStore((state) => state.transactions)
  const preset = useUiStore((state) => state.preset)
  const customRange = useUiStore((state) => state.customRange)
  const setPreset = useUiStore((state) => state.setPreset)
  const setCustomRange = useUiStore((state) => state.setCustomRange)
  const { range } = usePeriod()

  const bounds = datasetRange(transactions)
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState(range.start)
  const [end, setEnd] = useState(range.end)

  function handleOpenChange(next: boolean) {
    if (next) {
      // Resynchronise les champs sur la période courante à chaque ouverture.
      setStart(customRange?.start ?? range.start)
      setEnd(customRange?.end ?? range.end)
    }
    setOpen(next)
  }

  function applyCustom() {
    const from = start <= end ? start : end
    const to = start <= end ? end : start
    setCustomRange({ start: from, end: to })
    setOpen(false)
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5">
        {PERIOD_PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPreset(item.id)}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors',
              preset === item.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button variant={preset === 'custom' ? 'secondary' : 'outline'} size="sm">
            <CalendarRange className="size-3.5" />
            <span className="hidden sm:inline">Personnalisé</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-3">
          <div>
            <p className="text-sm font-medium">Période personnalisée</p>
            <p className="text-xs text-muted-foreground">
              Bornée à l’historique importé.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="period-start" className="text-xs">
                Du
              </Label>
              <Input
                id="period-start"
                type="date"
                value={start}
                min={bounds.start}
                max={bounds.end}
                onChange={(event) => setStart(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="period-end" className="text-xs">
                Au
              </Label>
              <Input
                id="period-end"
                type="date"
                value={end}
                min={bounds.start}
                max={bounds.end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button size="sm" onClick={applyCustom} disabled={!start || !end}>
              Appliquer
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
