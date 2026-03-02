import { useAccount, useConnect, useDisconnect } from '@starknet-react/core'

export default function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()

  if (isConnected && address) {
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`
    return (
      <button className="btn-wallet connected" onClick={() => disconnect()}>
        {short}
      </button>
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
