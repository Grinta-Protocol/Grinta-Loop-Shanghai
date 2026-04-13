import { useAccount, useConnect, useDisconnect } from '@starknet-react/core'
import { useGritBalance } from '../hooks/useGrinta.js'
import { formatWad } from '../lib/format.js'

export default function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const { balance } = useGritBalance()

  if (isConnected && address) {
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`
    return (
      <div className="wallet-connected-group">
        {balance != null && (
          <span className="wallet-balance">{formatWad(balance)} GRIT</span>
        )}
        <button className="btn-wallet connected" onClick={() => disconnect()}>
          {short}
        </button>
      </div>
    )
  }

  return (
    <div className="wallet-options">
      {connectors.map((connector) => (
        <button
          key={connector.id}
          className="btn-wallet"
          onClick={() => connect({ connector })}
        >
          Connect {connector.name || connector.id}
        </button>
      ))}
    </div>
  )
}
