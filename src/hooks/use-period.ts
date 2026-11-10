import { useMemo } from 'react'
import {
  previousPeriod,
  periodLabel,
  resolvePeriod,
  type DateRange,
  type PeriodPreset,
} from '@/lib/period'
import { useUiStore } from '@/store/ui-store'
import { useVaultStore } from '@/store/vault-store'

export interface PeriodState {
  preset: PeriodPreset
  customRange: DateRange | null
  range: DateRange
  previous: DateRange
  label: string
}

/** Période globale partagée par les pages, ancrée sur la dernière donnée. */
export function usePeriod(): PeriodState {
  const transactions = useVaultStore((state) => state.transactions)
  const preset = useUiStore((state) => state.preset)
  const customRange = useUiStore((state) => state.customRange)

  return useMemo(() => {
    const range = resolvePeriod(preset, transactions, customRange)
    return {
      preset,
      customRange,
      range,
      previous: previousPeriod(range),
      label: periodLabel(range, preset),
    }
  }, [transactions, preset, customRange])
}
