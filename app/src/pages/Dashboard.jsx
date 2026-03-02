import { useState, useEffect } from 'react'
import { useAccount } from '@starknet-react/core'
import Navbar from '../components/Navbar.jsx'
import SystemStats from '../components/SystemStats.jsx'
import SafeList from '../components/SafeList.jsx'
import SafeActions, { OpenSafeForm } from '../components/SafeActions.jsx'
import ErrorBoundary from '../components/ErrorBoundary.jsx'
import { useUserSafes } from '../hooks/useGrinta.js'
import './Dashboard.css'

function DashboardContent() {
  const { safes, isLoading, refetch } = useUserSafes()
  const [selectedSafe, setSelectedSafe] = useState(null)
  const [showOpenForm, setShowOpenForm] = useState(false)

  useEffect(() => {
    if (safes.length > 0 && selectedSafe == null && !showOpenForm) {
      setSelectedSafe(safes[0].id)
    }
  }, [safes, selectedSafe, showOpenForm])

  const handleOpenNew = () => {
    setSelectedSafe(null)
    setShowOpenForm(true)
  }

  const handleSelectSafe = (id) => {
    setSelectedSafe(id)
    setShowOpenForm(false)
  }

  const handleSuccess = async () => {
    // Wait for tx to land on-chain, then refresh
    await new Promise(r => setTimeout(r, 3000))
    await refetch()
    if (showOpenForm) setShowOpenForm(false)
  }

  return (
    <div className="dashboard-grid">
      <div className="dashboard-left">
        <ErrorBoundary>
          <SafeList
            safes={safes}
            isLoading={isLoading}
            selectedSafe={selectedSafe}
            onSelect={handleSelectSafe}
            onOpenNew={handleOpenNew}
          />
        </ErrorBoundary>
      </div>
      <div className="dashboard-right">
        <ErrorBoundary>
          {showOpenForm ? (
            <OpenSafeForm onSuccess={handleSuccess} />
          ) : (
            <SafeActions
              selectedSafe={selectedSafe}
              onSuccess={handleSuccess}
            />
          )}
        </ErrorBoundary>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { isConnected } = useAccount()

  return (
    <div className="dashboard">
      <Navbar />
      <ErrorBoundary>
        <SystemStats />
      </ErrorBoundary>

      <main className="dashboard-main">
        {!isConnected ? (
          <div className="connect-prompt">
            <div className="connect-prompt-inner">
              <h2>Connect Your Wallet</h2>
              <p>Connect an Argent X or Braavos wallet on Starknet Sepolia to manage your SAFEs.</p>
            </div>
          </div>
        ) : (
          <ErrorBoundary>
            <DashboardContent />
          </ErrorBoundary>
        )}
      </main>
    </div>
  )
}
