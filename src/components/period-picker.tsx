import { useState } from 'react'
import { CalendarRange } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-media-query'
import { usePeriod } from '@/hooks/use-period'
import { datasetRange, PERIOD_PRESETS, type PeriodPreset } from '@/lib/period'
import { useUiStore } from '@/store/ui-store'
import { useVaultStore } from '@/store/vault-store'
import { cn } from 'cn'

export function PeriodPicker({ className }: { className?: string }) {
  const transactions = useVaultStore((state) => state.transactions)
  const preset = useUiStore((state) => state.preset)
  const customRange = useUiStore((state) => state.customRange)
  const setPreset = useUiStore((state) => state.setPreset)
  const setCustomRange = useUiStore((state) => state.setCustomRange)
  const { range, label } = usePeriod()
  const isMobile = useIsMobile()

  const bounds = datasetRange(transactions)
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState(range.start)
  const [end, setEnd] = useState(range.end)

  const presetLabel =
    preset === 'custom'
      ? 'Personnalisé'
      : (PERIOD_PRESETS.find((item) => item.id === preset)?.label ?? label)

  function handleOpenChange(next: boolean) {
    if (next) {
      // Resynchronise les champs sur la période courante à chaque ouverture.
      setStart(customRange?.start ?? range.start)
      setEnd(customRange?.end ?? range.end)
    }
    setOpen(next)
  }

  function choosePreset(next: PeriodPreset) {
    setPreset(next)
    if (isMobile) setOpen(false)
  }

  function applyCustom() {
    const from = start <= end ? start : end
    const to = start <= end ? end : start
    setCustomRange({ start: from, end: to })
    setOpen(false)
  }

  const rangeFields = (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
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
      <div className="space-y-1.5">
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
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger asChild>
          <Button
            variant={preset === 'custom' ? 'secondary' : 'outline'}
            size="sm"
            className={cn('h-10 max-w-[10.5rem]', className)}
          >
            <CalendarRange className="size-3.5" />
            <span className="truncate">{presetLabel}</span>
          </Button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
          <SheetHeader>
            <SheetTitle>Période analysée</SheetTitle>
            <SheetDescription>
              {label} · bornée à l’historique importé.
            </SheetDescription>
          </SheetHeader>

          <div className="grid grid-cols-3 gap-2 px-4">
            {PERIOD_PRESETS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => choosePreset(item.id)}
                className={cn(
                  'min-h-11 rounded-xl border px-2 text-sm font-medium transition-colors',
                  preset === item.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'bg-background text-muted-foreground hover:text-foreground',
                )}
                aria-pressed={preset === item.id}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="space-y-3 border-t px-4 pt-4">
            <p className="text-sm font-medium">Plage personnalisée</p>
            {rangeFields}
          </div>

          <SheetFooter className="flex-row justify-end">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button onClick={applyCustom} disabled={!start || !end}>
              Appliquer
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5">
        {PERIOD_PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => choosePreset(item.id)}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors',
              preset === item.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={preset === item.id}
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
            <p className="text-xs text-muted-foreground">Bornée à l’historique importé.</p>
          </div>
          {rangeFields}
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
