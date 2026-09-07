import { Routes, Route, Navigate } from 'react-router-dom'
import { Nav } from './components/Nav'
import { Landing } from './pages/Landing'
import { Circles } from './pages/Circles'
import { CirclePage } from './pages/Circle'
import { ScorePage } from './pages/Score'
import { Lab } from './pages/Lab'
import { Architecture } from './pages/Architecture'
import { Presentation } from './pages/Presentation'
import { cfg } from './config'

export default function App() {
  return (
    <>
      <Nav />
      {!cfg.ledger && (
        <div className="mx-auto mt-4 max-w-6xl px-4">
          <div className="panel p-4 text-sm" style={{ color: 'var(--amber)' }}>
            KittyLedger is not configured yet: <code className="mono">VITE_KITTY_LEDGER_ADDRESS</code> is empty. Sepolia contracts are set; the Creditcoin side deploys with <code className="mono">scripts/deploy.sh</code> once the deployer holds tCTC.
          </div>
        </div>
      )}
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/circles" element={<Circles />} />
        <Route path="/circle/:id" element={<CirclePage />} />
        <Route path="/score" element={<ScorePage />} />
        <Route path="/score/:address" element={<ScorePage />} />
        <Route path="/lab" element={<Lab />} />
        <Route path="/architecture" element={<Architecture />} />
        <Route path="/presentation" element={<Presentation />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
