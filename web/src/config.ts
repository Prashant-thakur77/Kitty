export const cfg = {
  ledger: (import.meta.env.VITE_KITTY_LEDGER_ADDRESS ?? '') as `0x${string}`,
  viewer: (import.meta.env.VITE_KITTY_VIEWER_ADDRESS ?? '') as `0x${string}`,
  vault: (import.meta.env.VITE_KITTY_VAULT_ADDRESS ?? '') as `0x${string}`,
  fakeVault: (import.meta.env.VITE_FAKE_VAULT_ADDRESS ?? '') as `0x${string}`,
  token: (import.meta.env.VITE_TEST_USD_ADDRESS ?? '') as `0x${string}`,
  sourceChainKey: Number(import.meta.env.VITE_SOURCE_CHAIN_KEY ?? 1),
  sepoliaRpc: import.meta.env.VITE_SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com',
  creditcoinRpc: import.meta.env.VITE_CREDITCOIN_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network',
  sepoliaChainId: Number(import.meta.env.VITE_SEPOLIA_CHAIN_ID ?? 11155111),
  creditcoinChainId: Number(import.meta.env.VITE_CREDITCOIN_CHAIN_ID ?? 102031),
  sepoliaExplorer: import.meta.env.VITE_SEPOLIA_EXPLORER ?? 'https://sepolia.etherscan.io',
  creditcoinExplorer: import.meta.env.VITE_CREDITCOIN_EXPLORER ?? 'https://creditcoin-testnet.blockscout.com',
  ledgerDeployBlock: BigInt(import.meta.env.VITE_LEDGER_DEPLOY_BLOCK ?? 0),
  labApi: import.meta.env.VITE_LAB_API ?? 'http://localhost:8790',
  repo: import.meta.env.VITE_REPO_URL ?? 'https://github.com/Prashant-thakur77/Kitty',
}
export const CHAIN_INFO_PRECOMPILE = '0x0000000000000000000000000000000000000fD3' as const
export const VERIFIER_PRECOMPILE = '0x0000000000000000000000000000000000000FD2' as const
export const ZERO32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
