import {NextRequest,NextResponse} from 'next/server';
import {isAddress} from 'viem';
import {z} from 'zod';
import {runIntent} from '@/lib/agent/runner';
import {decide} from '@/lib/agent/tools';
import {ledger,policy,exclusive,saveJSON} from '@/lib/store';
import {portfolio} from '@/lib/chain';
export const runtime='nodejs';
export const dynamic='force-dynamic';
function local(req:NextRequest){const authority=req.headers.get('host')||'';const host=new URL('http://'+authority).hostname;if(!['localhost','127.0.0.1','[::1]'].includes(host))throw new Error('Local operator access only');const origin=req.headers.get('origin');if(req.method!=='GET'&&origin!==req.nextUrl.protocol+'//'+authority)throw new Error('Same-origin operator request required');}
export async function GET(req:NextRequest){try{local(req);const [l,p]=await Promise.all([ledger(),policy()]);let live=null,error='';try{live=await portfolio();}catch(e){error=(e as Error).message;}return NextResponse.json({ledger:l,policy:p,portfolio:live,error});}catch(e){return NextResponse.json({error:(e as Error).message},{status:403});}}
export async function POST(req:NextRequest){try{local(req);const body=await req.json();let result;if(body.type==='intent')result=await runIntent(z.string().min(1).max(4000).parse(body.prompt));else if(body.type==='approval')result=await decide(z.string().uuid().parse(body.id),z.boolean().parse(body.approve));else if(body.type==='policy'){const schema=z.object({tier1SingleTxMaxUsd:z.number().min(0).max(10000),tier1DailyLimitUsd:z.number().min(0).max(10000),maxGasGwei:z.number().positive().max(1000),whitelistedAddresses:z.array(z.string().refine(isAddress)).max(100),requireApproval:z.boolean()});const settings=schema.parse(body.policy);result=await exclusive(async()=>{const p=await policy();const next={...p,...settings};await saveJSON('policy.json',next);return next;});}else throw new Error('Unknown operation');return NextResponse.json({result});}catch(e){return NextResponse.json({error:(e as Error).message},{status:400});}}
