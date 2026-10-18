import {describe,it,expect} from 'vitest';
import {NextRequest} from 'next/server';
import {POST} from '../src/app/api/agent/route';
describe('Local operator API boundary',()=>{
 it('rejects cross-origin mutations',async()=>{const response=await POST(new NextRequest('http://localhost:3000/api/agent',{method:'POST',headers:{host:'127.0.0.1:3000',origin:'https://attacker.example','Content-Type':'application/json'},body:JSON.stringify({type:'intent',prompt:'portfolio'})}));expect(response.status).toBe(400);expect((await response.json()).error).toContain('Same-origin');});
 it('rejects nonlocal hosts',async()=>{const response=await POST(new NextRequest('http://example.com/api/agent',{method:'POST',headers:{host:'example.com',origin:'http://example.com'},body:'{}'}));expect((await response.json()).error).toContain('Local operator');});
 it('accepts browser origin using incoming authority even when Next normalizes its URL',async()=>{const response=await POST(new NextRequest('http://localhost:3000/api/agent',{method:'POST',headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','Content-Type':'application/json'},body:'{"type":"invalid"}'}));expect((await response.json()).error).toBe('Unknown operation');});
 it('rejects absent origin',async()=>{const response=await POST(new NextRequest('http://localhost:3000/api/agent',{method:'POST',headers:{host:'localhost:3000'},body:'{}'}));expect((await response.json()).error).toContain('Same-origin');});
});
