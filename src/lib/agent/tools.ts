import {randomUUID} from 'node:crypto';
import {formatUnits,isAddress} from 'viem';
import {z} from 'zod';
import {account,publicClient,portfolio,transaction,wallet,WETH} from '../chain';
import {exclusive,ledger,policy,saveJSON,log,type Ledger} from '../store';
import {evaluateTransactionPolicy,type Action} from '../security/policyEngine';
export const actionSchema=z.object({kind:z.enum(['read','wrap_eth','unwrap_weth','transfer_token']),token:z.enum(['ETH','WETH','USDC']),amount:z.string().regex(/^\d+(\.\d{1,18})?$/),recipient:z.string().refine(isAddress),prompt:z.string().max(4000)});
async function inspect(a:Action,l:Ledger){
 const p=await policy();const usd=Number(a.amount)*(a.token==='USDC'?1:2500);const latest=[...new Map(l.logs.map(x=>[x.operationId||x.id,x])).values()];const spentUsd=latest.filter(x=>x.tier==='TIER_1_AUTO'&&['SUBMITTED','CONFIRMED','BROADCASTING'].includes(x.status)&&Date.now()-Date.parse(x.timestamp)<86400000).reduce((sum,x)=>sum+x.usd,0);
 let gasEstimate='0',gasGwei=0,simulation=false,error='';
 const early=evaluateTransactionPolicy(a,p,{usd,spentUsd,gasGwei:0,simulation:true});
 if(early.tier==='BLOCKED')return {decision:early,usd,gasEstimate,error:'Blocked before RPC'};
 try{if(await publicClient.getChainId()!==84532)throw new Error('RPC chain mismatch');const tx=transaction(a);const acc=account();const [gas,price,call]=await Promise.all([publicClient.estimateGas({...tx,account:acc}),publicClient.getGasPrice(),publicClient.call({...tx,account:acc.address})]);if(a.kind==='transfer_token'&&a.token!=='ETH'&&(!call.data||BigInt(call.data)!==1n))throw new Error('Token transfer did not return true');gasEstimate=gas.toString();gasGwei=Number(formatUnits(price,9));simulation=true;}catch(e){error=(e as Error).message;}
 return {decision:evaluateTransactionPolicy(a,p,{usd,spentUsd,gasGwei,simulation}),usd,gasEstimate,error};
}
export async function executeAction(input:Action,dryRun=false,approvalId?:string){return exclusive(async()=>{
 const a=actionSchema.parse(input);if(a.kind==='wrap_eth'||a.kind==='unwrap_weth'){a.recipient=WETH;a.token=a.kind==='wrap_eth'?'ETH':'WETH';}
 const l=await ledger();const proposal=approvalId?l.pending.find(p=>p.id===approvalId&&p.status==='AWAITING_HITL_APPROVAL'):undefined;
 if(approvalId&&!proposal)throw new Error('Proposal already handled or missing');
 const check=await inspect(a,l);const {decision,usd,gasEstimate,error}=check;
 const base={intent:a.prompt,tier:decision.tier,simulation:error||'PASSED',gasEstimate,reasons:decision.reasons,riskScore:decision.riskScore,usd};
 if(dryRun){log(l,{...base,status:'DRY_RUN'});await saveJSON('audit_log.json',l);return check;}
 if(decision.tier==='BLOCKED'){if(proposal)proposal.status='BLOCKED';log(l,{...base,status:'BLOCKED'});await saveJSON('audit_log.json',l);return check;}
 if(decision.tier==='TIER_2_HITL'&&!proposal){const id=randomUUID();l.pending.push({id,action:a,decision,usd,gasEstimate,status:'AWAITING_HITL_APPROVAL'});log(l,{...base,status:'AWAITING_HITL_APPROVAL'});await saveJSON('audit_log.json',l);return {...check,proposalId:id};}
 // Persist a reservation before any broadcast. Unknown outcomes require manual reconciliation.
 if(proposal)proposal.status='BROADCASTING';log(l,{...base,operationId:randomUUID(),tier:proposal?'TIER_2_HITL':base.tier,status:'BROADCASTING'});const record={...l.logs[l.logs.length-1],reasons:[...base.reasons]};await saveJSON('audit_log.json',l);
 try{const hash=await wallet().sendTransaction(transaction(a));record.txHash=hash;record.status='SUBMITTED';if(proposal)proposal.status='SUBMITTED';log(l,record);await saveJSON('audit_log.json',l);const receipt=await publicClient.waitForTransactionReceipt({hash,timeout:60000});record.status=receipt.status==='success'?'CONFIRMED':'REVERTED';if(proposal)proposal.status=record.status;log(l,record);await saveJSON('audit_log.json',l);return {...check,txHash:hash,status:record.status};}catch(e){record.reasons=[...record.reasons,(e as Error).message];log(l,record);await saveJSON('audit_log.json',l);throw new Error(record.txHash?`Transaction submitted: ${record.txHash}. Receipt pending; do not retry.`:'Broadcast outcome unresolved. Inspect the wallet before retrying.');}
 });}
export async function decide(id:string,approve:boolean){const p=(await ledger()).pending.find(x=>x.id===id);if(!p)throw new Error('Proposal not found');if(approve)return executeAction(p.action,false,id);return exclusive(async()=>{const l=await ledger();const current=l.pending.find(x=>x.id===id);if(!current||current.status!=='AWAITING_HITL_APPROVAL')throw new Error('Proposal already handled');current.status='REJECTED';log(l,{intent:current.action.prompt,tier:'TIER_2_HITL',status:'REJECTED',simulation:'PASSED',reasons:['Rejected by operator'],riskScore:65,usd:current.usd});await saveJSON('audit_log.json',l);return {status:'REJECTED'};});}
export async function get_wallet_portfolio(prompt:string){const result=await portfolio();await exclusive(async()=>{const l=await ledger();log(l,{intent:prompt,tier:'TIER_0',status:'COMPLETED',simulation:'READ_ONLY',reasons:['Live RPC portfolio read'],riskScore:0,usd:0});await saveJSON('audit_log.json',l);});return result;}
export async function audit_contract_address(address:string){if(!isAddress(address))throw new Error('Invalid address');const p=await policy();const blocked=p.blacklistedAddresses.some(x=>x.toLowerCase()===address.toLowerCase());const trusted=p.whitelistedAddresses.some(x=>x.toLowerCase()===address.toLowerCase());const code=await publicClient.getBytecode({address});return {address,contract:Boolean(code&&code!=='0x'),riskScore:blocked?100:trusted?10:60,warning:'Bytecode presence is not a contract security audit.'};}
export const simulate_transaction=(a:Action)=>executeAction(a,true);
export const execute_token_transfer=executeAction;
export async function execute_eth_weth_rebalance(targetWethRatio:number,prompt:string){if(targetWethRatio<0||targetWethRatio>1)throw new Error('Ratio must be between 0 and 1');const p=await portfolio();const delta=(Number(p.balances.ETH)+Number(p.balances.WETH))*targetWethRatio-Number(p.balances.WETH);return executeAction({kind:delta>=0?'wrap_eth':'unwrap_weth',token:delta>=0?'ETH':'WETH',amount:Math.abs(delta).toFixed(18),recipient:WETH,prompt});}
