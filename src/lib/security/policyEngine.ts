export type Policy = {tier1SingleTxMaxUsd:number;tier1DailyLimitUsd:number;maxGasGwei:number;whitelistedAddresses:string[];blacklistedAddresses:string[];requireApproval:boolean};
export type Action = {kind:'read'|'wrap_eth'|'unwrap_weth'|'transfer_token';token:'ETH'|'WETH'|'USDC';amount:string;recipient:string;prompt:string};
export type Decision = {tier:'TIER_0'|'TIER_1_AUTO'|'TIER_2_HITL'|'BLOCKED';reasons:string[];riskScore:number};
export function evaluateTransactionPolicy(action:Action,policy:Policy,context:{spentUsd:number;usd:number;gasGwei:number;simulation:boolean}):Decision {
 const has=(list:string[],address:string)=>list.some(x=>x.toLowerCase()===address.toLowerCase());
 const block=(reason:string):Decision=>({tier:'BLOCKED',reasons:[reason],riskScore:100});
 if(has(policy.blacklistedAddresses,action.recipient)) return block('Blacklisted recipient');
 const trusted=has(policy.whitelistedAddresses,action.recipient);
 if(/ignore (all|previous)|drain wallet|override|system prompt/i.test(action.prompt)&&!trusted) return block('Adversarial instruction with unverified recipient');
 if(action.kind==='read')return {tier:'TIER_0',reasons:['Read-only operation'],riskScore:0};
 if(!Number.isFinite(context.usd)||context.usd<=0)return block('Invalid transaction value');
 if(!context.simulation)return block('Pre-flight simulation failed');
 if(!Number.isFinite(context.gasGwei)||context.gasGwei>policy.maxGasGwei)return block('Gas exceeds configured ceiling');
 const reasons:string[]=[];
 if(!trusted)reasons.push('Recipient is not whitelisted');
 if(context.usd>policy.tier1SingleTxMaxUsd)reasons.push('Single transaction limit exceeded');
 if(context.spentUsd+context.usd>policy.tier1DailyLimitUsd)reasons.push('Rolling 24-hour autonomous limit exceeded');
 if(policy.requireApproval)reasons.push('Human confirmation enabled');
 return {tier:reasons.length?'TIER_2_HITL':'TIER_1_AUTO',reasons:reasons.length?reasons:['Within autonomous permission bounds'],riskScore:reasons.length?65:10};
}
