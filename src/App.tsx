import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AiNoticeDialog } from '@/components/ai-notice-dialog'
import { AppShell } from '@/components/app-shell'
import { PwaUpdatePrompt } from '@/components/pwa/update-prompt'
import { SetupScreen } from '@/components/setup-screen'
import { ThemeProvider } from '@/components/theme-provider'
import { UnlockScreen } from '@/components/unlock-screen'
import { VaultRecoveryScreen } from '@/components/vault-recovery-screen'
import { useIsMobile } from '@/hooks/use-media-query'
import { useVaultStore } from '@/store/vault-store'

function AppToaster() {
  const mobile = useIsMobile()
  return <Toaster position={mobile ? 'top-center' : 'bottom-right'} />
}

function App() {
  const status = useVaultStore((state) => state.status)

  return (
    <ThemeProvider>
      <TooltipProvider>
        {status === 'empty' ? (
          <SetupScreen />
        ) : status === 'corrupted' ? (
          <VaultRecoveryScreen />
        ) : status === 'locked' ? (
          <UnlockScreen />
        ) : (
          <AppShell />
        )}
        <AppToaster />
        <AiNoticeDialog />
        <PwaUpdatePrompt />
      </TooltipProvider>
    </ThemeProvider>
  )
}

export default App
