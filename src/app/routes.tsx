import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import {
  ArrowLeftRight,
  ChartColumn,
  LayoutDashboard,
  Repeat,
  Settings,
  Sparkles,
  SquarePen,
  Store,
  Target,
  Timer,
} from 'lucide-react'
import type { PageId } from '@/lib/router'

export type NavGroup = 'Pilotage' | 'Explorer' | 'Opérations' | 'Système'

export interface AppRoute {
  id: PageId
  label: string
  shortLabel?: string
  icon: ComponentType<{ className?: string }>
  group: NavGroup
  component: LazyExoticComponent<ComponentType>
  /** Les pages de données affichent l'écran d'import tant que le coffre est vide. */
  requiresData: boolean
  /** Onglet principal de la barre mobile. */
  mobileTab: boolean
}

export const ROUTES: AppRoute[] = [
  {
    id: 'overview',
    label: 'Vue d’ensemble',
    shortLabel: 'Accueil',
    icon: LayoutDashboard,
    group: 'Pilotage',
    component: lazy(() =>
      import('@/pages/overview-page').then((module) => ({ default: module.OverviewPage })),
    ),
    requiresData: true,
    mobileTab: true,
  },
  {
    id: 'analysis',
    label: 'Analyses',
    icon: ChartColumn,
    group: 'Pilotage',
    component: lazy(() =>
      import('@/pages/analysis-page').then((module) => ({ default: module.AnalysisPage })),
    ),
    requiresData: true,
    mobileTab: false,
  },
  {
    id: 'budgets',
    label: 'Budgets',
    icon: Target,
    group: 'Pilotage',
    component: lazy(() =>
      import('@/pages/budgets-page').then((module) => ({ default: module.BudgetsPage })),
    ),
    requiresData: true,
    mobileTab: true,
  },
  {
    id: 'assistant',
    label: 'Assistant',
    icon: Sparkles,
    group: 'Pilotage',
    component: lazy(() =>
      import('@/pages/assistant-page').then((module) => ({ default: module.AssistantPage })),
    ),
    requiresData: false,
    mobileTab: false,
  },
  {
    id: 'transactions',
    label: 'Transactions',
    icon: ArrowLeftRight,
    group: 'Explorer',
    component: lazy(() =>
      import('@/pages/transactions-page').then((module) => ({ default: module.TransactionsPage })),
    ),
    requiresData: true,
    mobileTab: true,
  },
  {
    id: 'recurring',
    label: 'Récurrences',
    icon: Repeat,
    group: 'Explorer',
    component: lazy(() =>
      import('@/pages/recurring-page').then((module) => ({ default: module.RecurringPage })),
    ),
    requiresData: true,
    mobileTab: false,
  },
  {
    id: 'merchants',
    label: 'Marchands',
    icon: Store,
    group: 'Explorer',
    component: lazy(() =>
      import('@/pages/merchants-page').then((module) => ({ default: module.MerchantsPage })),
    ),
    requiresData: true,
    mobileTab: false,
  },
  {
    id: 'coverage',
    label: 'Couverture & runway',
    shortLabel: 'Couverture',
    icon: Timer,
    group: 'Explorer',
    component: lazy(() =>
      import('@/pages/coverage-page').then((module) => ({ default: module.CoveragePage })),
    ),
    requiresData: true,
    mobileTab: false,
  },
  {
    id: 'manual',
    label: 'Saisie manuelle',
    shortLabel: 'Saisie',
    icon: SquarePen,
    group: 'Opérations',
    component: lazy(() =>
      import('@/pages/manual-entry-page').then((module) => ({ default: module.ManualEntryPage })),
    ),
    requiresData: false,
    mobileTab: false,
  },
  {
    id: 'settings',
    label: 'Réglages',
    icon: Settings,
    group: 'Système',
    component: lazy(() =>
      import('@/pages/settings-page').then((module) => ({ default: module.SettingsPage })),
    ),
    requiresData: false,
    mobileTab: false,
  },
]

export const ROUTE_BY_ID = Object.fromEntries(
  ROUTES.map((route) => [route.id, route]),
) as Record<PageId, AppRoute>

/**
 * Trois accès directs + le bouton central « + » + « Plus ».
 * L'assistant, les analyses, les récurrences, les marchands, la couverture,
 * la saisie et les réglages restent dans la feuille « Plus ».
 */
export const MOBILE_TABS = (
  ['overview', 'transactions', 'budgets'] as PageId[]
).map((id) => ROUTE_BY_ID[id])

export const MORE_ROUTES = ROUTES.filter((route) => !route.mobileTab)

export const NAV_GROUPS = (['Pilotage', 'Explorer', 'Opérations', 'Système'] as const).map(
  (label) => ({
    label,
    items: ROUTES.filter((route) => route.group === label),
  }),
)
