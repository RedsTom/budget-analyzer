import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/app-shell'
import { SetupScreen } from '@/components/setup-screen'
import { UnlockScreen } from '@/components/unlock-screen'
import { useVaultStore } from '@/store/vault-store'

function App() {
  const status = useVaultStore((state) => state.status)

  return (
    <TooltipProvider>
      {status === 'empty' ? (
        <SetupScreen />
      ) : status === 'locked' ? (
        <UnlockScreen />
      ) : (
        <AppShell />
      )}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}

export default App
