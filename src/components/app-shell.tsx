import { useEffect, useState, type ComponentType } from 'react'
import {
  ArrowLeftRight,
  ChartColumn,
  LayoutDashboard,
  Lock,
  Menu,
  Repeat,
  Settings,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Store,
  Target,
  Timer,
  Wallet,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { DetailHost } from '@/components/entity-panels'
import { EmptyVault } from '@/components/empty-vault'
import { PeriodPicker } from '@/components/period-picker'
import { usePage, navigate, type PageId } from '@/lib/router'
import { datasetRange } from '@/lib/period'
import { formatCount, formatDate } from '@/lib/format'
import { useUiStore } from '@/store/ui-store'
import { useVaultStore } from '@/store/vault-store'
import { cn } from 'cn'
import { OverviewPage } from '@/pages/overview-page'
import { AssistantPage } from '@/pages/assistant-page'
import { AnalysisPage } from '@/pages/analysis-page'
import { BudgetsPage } from '@/pages/budgets-page'
import { TransactionsPage } from '@/pages/transactions-page'
import { RecurringPage } from '@/pages/recurring-page'
import { MerchantsPage } from '@/pages/merchants-page'
import { CoveragePage } from '@/pages/coverage-page'
import { ManualEntryPage } from '@/pages/manual-entry-page'
import { SettingsPage } from '@/pages/settings-page'

interface NavItem {
  id: PageId
  label: string
  icon: ComponentType<{ className?: string }>
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Pilotage',
    items: [
      { id: 'overview', label: 'Vue d’ensemble', icon: LayoutDashboard },
      { id: 'analysis', label: 'Analyses', icon: ChartColumn },
      { id: 'budgets', label: 'Budgets', icon: Target },
      { id: 'assistant', label: 'Assistant', icon: Sparkles },
    ],
  },
  {
    label: 'Explorer',
    items: [
      { id: 'transactions', label: 'Transactions', icon: ArrowLeftRight },
      { id: 'recurring', label: 'Récurrences', icon: Repeat },
      { id: 'merchants', label: 'Marchands', icon: Store },
      { id: 'coverage', label: 'Couverture & runway', icon: Timer },
    ],
  },
  {
    label: 'Opérations',
    items: [{ id: 'manual', label: 'Saisie manuelle', icon: SquarePen }],
  },
  {
    label: 'Système',
    items: [{ id: 'settings', label: 'Réglages', icon: Settings }],
  },
]

export function AppShell() {
  const page = usePage()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Changer de page ferme le panneau de détail, y compris via l'historique.
  useEffect(() => {
    const onHashChange = () => useUiStore.getState().closeDetail()
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <div className="flex h-svh flex-col bg-muted/25">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-sidebar lg:block">
        <SidebarContent page={page} />
      </aside>

      <div className="flex min-h-0 flex-1 flex-col lg:pl-64">
        <header className="relative z-20 shrink-0 border-b bg-background/85 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2.5 lg:px-8">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon-sm" className="lg:hidden" aria-label="Menu">
                  <Menu className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>Navigation</SheetTitle>
                </SheetHeader>
                <SidebarContent page={page} onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>

            <div className="flex items-center gap-2 lg:hidden">
              <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Wallet className="size-3.5" />
              </div>
              <span className="font-heading text-sm font-medium">Budget Analyzer</span>
            </div>

            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <MobileSaving />
              <PeriodPicker />
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Verrouiller le coffre"
                onClick={() => useVaultStore.getState().lock()}
                className="lg:hidden"
              >
                <Lock className="size-3.5" />
              </Button>
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main
            className={cn(
              'min-h-0 min-w-0 flex-1 px-4 lg:px-8',
              page === 'assistant'
                ? 'flex overflow-hidden py-4'
                : 'overflow-y-auto py-6 pb-16',
            )}
          >
            <div
              className={cn(
                'mx-auto w-full max-w-7xl',
                page === 'assistant' && 'flex min-h-0 flex-1 flex-col',
              )}
            >
              <PageOutlet page={page} />
            </div>
          </main>
          <DetailHost />
        </div>
      </div>
    </div>
  )
}

function MobileSaving() {
  const saving = useVaultStore((state) => state.saving)
  if (!saving) return null
  return <span className="hidden text-xs text-muted-foreground sm:inline">Sauvegarde…</span>
}

function SidebarContent({
  page,
  onNavigate,
}: {
  page: PageId
  onNavigate?: () => void
}) {
  const transactions = useVaultStore((state) => state.transactions)
  const lock = useVaultStore((state) => state.lock)
  const bounds = datasetRange(transactions)

  return (
    <div className="flex h-full flex-col">
      <div className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Wallet className="size-4" />
          </div>
          <div>
            <p className="font-heading text-sm leading-tight font-medium">Budget Analyzer</p>
            <p className="text-xs text-muted-foreground">100 % local</p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border bg-background/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">Historique</p>
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
              <ShieldCheck className="size-2.5" />
              chiffré
            </Badge>
          </div>
          <p className="mt-1 text-sm font-medium">
            {formatCount(transactions.length)} mouvement{transactions.length > 1 ? 's' : ''}
          </p>
          {transactions.length > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              {formatDate(bounds.start)} → {formatDate(bounds.end)}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">aucune donnée importée</p>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="px-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = page === item.id
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      navigate(item.id)
                      onNavigate?.()
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                      active
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" />
                    <span className="truncate">{item.label}</span>
                    {active ? <span className="ml-auto size-1.5 rounded-full bg-primary" /> : null}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          Coffre chiffré local
        </div>
        <Button variant="outline" size="sm" className="mt-2 w-full" onClick={lock}>
          <Lock className="size-3.5" />
          Verrouiller
        </Button>
      </div>
    </div>
  )
}

function PageOutlet({ page }: { page: PageId }) {
  const hasData = useVaultStore((state) => state.transactions.length > 0)
  if (!hasData) return <EmptyVault />

  switch (page) {
    case 'overview':
      return <OverviewPage />
    case 'analysis':
      return <AnalysisPage />
    case 'budgets':
      return <BudgetsPage />
    case 'assistant':
      return <AssistantPage />
    case 'transactions':
      return <TransactionsPage />
    case 'recurring':
      return <RecurringPage />
    case 'merchants':
      return <MerchantsPage />
    case 'coverage':
      return <CoveragePage />
    case 'manual':
      return <ManualEntryPage />
    case 'settings':
      return <SettingsPage />
  }
}
