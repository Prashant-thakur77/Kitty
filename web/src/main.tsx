import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import './index.css'
import App from './App'
import { wagmiConfig } from './lib/wagmi'
import { ToastProvider } from './components/Toast'
import { initTelegram } from './lib/telegram'

initTelegram() // loads the Telegram Mini App SDK only when opened from Telegram

const qc = new QueryClient({ defaultOptions: { queries: { refetchInterval: 8000, retry: 1 } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <MotionConfig reducedMotion="user">
            <ToastProvider>
              <App />
            </ToastProvider>
          </MotionConfig>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
