import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { StarknetConfig, jsonRpcProvider, voyager, argent, braavos } from '@starknet-react/core'
import { sepolia } from '@starknet-react/chains'
import './index.css'
import App from './App.jsx'

const RPC_URL = 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/A_aQEk8ItXSiyZveFp_6y'

// Override sepolia chain to replace dead BlastAPI URLs with Alchemy
const sepoliaFixed = {
  ...sepolia,
  rpcUrls: {
    ...sepolia.rpcUrls,
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
}

const chains = [sepoliaFixed]
const connectors = [argent(), braavos()]

const provider = jsonRpcProvider({
  rpc: () => ({ nodeUrl: RPC_URL }),
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StarknetConfig chains={chains} provider={provider} connectors={connectors} explorer={voyager}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StarknetConfig>
  </StrictMode>,
)
