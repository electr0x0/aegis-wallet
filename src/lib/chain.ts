import {createPublicClient,createWalletClient,http,parseAbi,formatEther,formatUnits,parseUnits,encodeFunctionData} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {baseSepolia} from 'viem/chains';
import type {Action} from './security/policyEngine';
export const WETH='0x4200000000000000000000000000000000000006';
export const USDC='0x036CbD53842c5426634e7929541eC2318f3dCF7e';
export const EXPLORER='https://sepolia.basescan.org';
export const abi=parseAbi(['function balanceOf(address) view returns (uint256)','function transfer(address,uint256) returns (bool)','function deposit() payable','function withdraw(uint256)']);
const transport=()=>http(process.env.BASE_SEPOLIA_RPC_URL||'https://sepolia.base.org',{timeout:15000,retryCount:1});
export const publicClient=createPublicClient({chain:baseSepolia,transport:transport()});
export function account(){const key=process.env.AGENT_PRIVATE_KEY;if(!key||!/^0x[0-9a-fA-F]{64}$/.test(key))throw new Error('Wallet not configured. Run pnpm setup-wallets and fund the printed addresses.');return privateKeyToAccount(key as `0x${string}`);}
export function wallet(){return createWalletClient({account:account(),chain:baseSepolia,transport:transport()});}
export async function portfolio(){const a=account();const [eth,weth,usdc,gas]=await Promise.all([publicClient.getBalance({address:a.address}),publicClient.readContract({address:WETH,abi,functionName:'balanceOf',args:[a.address]}),publicClient.readContract({address:USDC,abi,functionName:'balanceOf',args:[a.address]}),publicClient.getGasPrice()]);const balances={ETH:formatEther(eth),WETH:formatEther(weth),USDC:formatUnits(usdc,6)};return {address:a.address,vault:process.env.VAULT_ADDRESS||null,balances,gasGwei:Number(formatUnits(gas,9)),totalUsd:(Number(balances.ETH)+Number(balances.WETH))*2500+Number(balances.USDC),referenceEthUsd:2500};}
export function transaction(a:Action):{to:`0x${string}`;value:bigint;data?:`0x${string}`} {const amount=parseUnits(a.amount,a.token==='USDC'?6:18);if(amount<=0n)throw new Error('Amount must be positive');if(a.kind==='wrap_eth')return {to:WETH,value:amount,data:encodeFunctionData({abi,functionName:'deposit'})};if(a.kind==='unwrap_weth')return {to:WETH,value:0n,data:encodeFunctionData({abi,functionName:'withdraw',args:[amount]})};if(a.token==='ETH')return {to:a.recipient as `0x${string}`,value:amount};return {to:(a.token==='USDC'?USDC:WETH),value:0n,data:encodeFunctionData({abi,functionName:'transfer',args:[a.recipient as `0x${string}`,amount]})};}
