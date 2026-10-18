import {readFile,writeFile} from 'node:fs/promises';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {isAddress} from 'viem';
async function main(){
 let env='';try{env=await readFile('.env.local','utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 for(const line of env.split(/\r?\n/)){const match=line.match(/^([A-Z_]+)=(.*)$/);if(match&&!process.env[match[1]])process.env[match[1]]=match[2].replace(/^['"]|['"]$/g,'');}
 if(!process.env.AGENT_PRIVATE_KEY){process.env.AGENT_PRIVATE_KEY=generatePrivateKey();env=env.replace(/^AGENT_PRIVATE_KEY=.*\r?\n?/m,'');env+=`\nAGENT_PRIVATE_KEY=${process.env.AGENT_PRIVATE_KEY}\n`;}
 if(!process.env.VAULT_ADDRESS){const vaultKey=generatePrivateKey();process.env.VAULT_PRIVATE_KEY=vaultKey;process.env.VAULT_ADDRESS=privateKeyToAccount(vaultKey).address;env+='VAULT_PRIVATE_KEY='+vaultKey+'\n';env=env.replace(/^VAULT_ADDRESS=.*\r?\n?/m,'');env+=`VAULT_ADDRESS=${process.env.VAULT_ADDRESS}\n`;}
 if(!isAddress(process.env.VAULT_ADDRESS))throw new Error('VAULT_ADDRESS is invalid');
 await writeFile('.env.local',env,{mode:0o600});
 const {account,portfolio,WETH}=await import('../src/lib/chain');
 console.log('Agent address:',account().address);console.log('Vault address:',process.env.VAULT_ADDRESS);console.log('Fund agent with Base Sepolia ETH and USDC. Generated vault key is retained privately in .env.local; never commit that file.');
 const {ledger,policy,saveJSON,exclusive}=await import('../src/lib/store');await exclusive(async()=>{const p=await policy();if(!p.whitelistedAddresses.some(a=>a.toLowerCase()===process.env.VAULT_ADDRESS!.toLowerCase())){p.whitelistedAddresses.push(process.env.VAULT_ADDRESS!);await saveJSON('policy.json',p);}});const {executeAction}=await import('../src/lib/agent/tools');
 let balances;try{balances=await portfolio();}catch(e){console.log('Wallet created. Live funding check unavailable:',(e as Error).message);return;}
 if(Number(balances.balances.ETH)<0.0003||Number(balances.balances.USDC)<0.5){console.log('Funding required: at least 0.0003 test ETH and 0.50 test USDC. Fund the agent and rerun this command to seed two real transactions.');return;}
 const steps=[{kind:'transfer_token' as const,token:'USDC' as const,amount:'0.50',recipient:process.env.VAULT_ADDRESS,prompt:'SETUP_EVIDENCE_USDC'},{kind:'wrap_eth' as const,token:'ETH' as const,amount:'0.0002',recipient:WETH,prompt:'SETUP_EVIDENCE_WRAP'}];
 for(const action of steps){const l=await ledger();if(l.logs.some(x=>x.intent===action.prompt&&['CONFIRMED','SUBMITTED','BROADCASTING','AWAITING_HITL_APPROVAL'].includes(x.status))){console.log(action.prompt,'already attempted; inspect evidence before retrying');continue;}console.log(JSON.stringify(await executeAction(action),null,2));}
}
main().catch(e=>{console.error((e as Error).message);process.exitCode=1;});
