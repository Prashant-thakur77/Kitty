import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { defineChain } from 'viem'
import { sepolia as sepoliaBase } from 'wagmi/chains'
import { cfg } from '../config'

export const sepolia = defineChain({
  ...sepoliaBase,
  id: cfg.sepoliaChainId,
  rpcUrls: { default: { http: [cfg.sepoliaRpc] } },
})

export const creditcoinTestnet = defineChain({
  id: cfg.creditcoinChainId,
  name: 'Creditcoin CC3 Testnet',
  nativeCurrency: { name: 'Testnet CTC', symbol: 'tCTC', decimals: 18 },
  rpcUrls: { default: { http: [cfg.creditcoinRpc] } },
  blockExplorers: { default: { name: 'Blockscout', url: cfg.creditcoinExplorer } },
})

export const wagmiConfig = createConfig({
  chains: [sepolia, creditcoinTestnet],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(cfg.sepoliaRpc),
    [creditcoinTestnet.id]: http(cfg.creditcoinRpc),
  },
})
