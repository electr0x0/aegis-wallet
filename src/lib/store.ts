import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Action,Decision,Policy} from './security/policyEngine';
export type Entry={operationId?:string;id:string;timestamp:string;intent:string;tier:string;status:string;simulation:string;gasEstimate?:string;txHash?:string;reasons:string[];riskScore:number;usd:number};
export type Proposal={id:string;action:Action;decision:Decision;gasEstimate:string;usd:number;status:string};
export type Ledger={logs:Entry[];pending:Proposal[]};
const root=path.join(process.cwd(),'data');
export async function readJSON<T>(name:string,fallback:T):Promise<T>{try{return JSON.parse(await readFile(path.join(root,name),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw e;}}
export async function saveJSON(name:string,value:unknown){await mkdir(root,{recursive:true});const temp=path.join(root,`${name}.${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(value,null,2),{mode:0o600});await rename(temp,path.join(root,name));}
export async function policy(){const p=await readJSON<Policy>('policy.json',{tier1SingleTxMaxUsd:2,tier1DailyLimitUsd:5,maxGasGwei:25,whitelistedAddresses:[],blacklistedAddresses:['0x000000000000000000000000000000000000dead'],requireApproval:false});return p;}
export const ledger=()=>readJSON<Ledger>('audit_log.json',{logs:[],pending:[]});
const state=globalThis as typeof globalThis & {aegisLock?:Promise<unknown>};
export function exclusive<T>(fn:()=>Promise<T>):Promise<T>{const next=(state.aegisLock??Promise.resolve()).then(fn,fn);state.aegisLock=next.catch(()=>{});return next;}
export function log(l:Ledger,entry:Omit<Entry,'id'|'timestamp'>){l.logs.push({...entry,id:randomUUID(),timestamp:new Date().toISOString()});}
