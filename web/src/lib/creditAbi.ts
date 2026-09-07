import { parseAbi } from 'viem'
// Hand-written subset so the UI compiles independently of the exported JSON; matches KittyCreditLine / KittyBadge / KittyUSD.
export const creditAbi = parseAbi([
  'function creditLimit(address member) view returns (uint256)',
  'function underwrite(address member) view returns (uint16 score, string tier, uint256 limit, string reason)',
  'function outstanding(address member) view returns (uint256)',
  'function totalDeposits() view returns (uint256)',
  'function borrow(uint256 amount)',
  'function repay(uint256 amount)',
  'function deposit(uint256 amount)',
  'function withdraw(uint256 amount)',
  'event Borrowed(address indexed member, uint256 amount, uint256 owed)',
  'event Repaid(address indexed member, uint256 amount, uint256 owed)',
])
export const badgeAbi = parseAbi([
  'function claim()',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function locked(uint256 tokenId) view returns (bool)',
])
export const kusdAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)',
])
