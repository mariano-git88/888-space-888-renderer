import test from 'node:test';
import assert from 'node:assert/strict';
import {makeResearchCollector} from '../collector.mjs';

test('unavailable source is persisted and avoids a repeat request',async()=>{
 const calls=[]; const state={scan:null};
 const pool={query:async(sql,args=[])=>{
  calls.push([sql,args]);
  if(sql.startsWith('SELECT last_scan_at'))return{rows:state.scan?[{last_scan_at:state.scan}]:[]};
  if(sql.includes("VALUES($1,NOW(),'unavailable')"))state.scan=new Date();
  return{rows:[]};
 }};
 let metaCalls=0;
 const research=makeResearchCollector({
  pool,
  installedToken:async()=>({token:'fixture'}),
  meta:async()=>{metaCalls++;throw Error('provider unavailable')},
  igId:'ig-user-id',
  approved:new Set(['publicartist']),
  sanitizeDiscovery:()=>{throw Error('no source')},
  configured:()=>true
 });
 await research.scan();
 assert.equal(metaCalls,2); // rich metadata + captions-only fallback
 assert.ok(calls.some(([sql,args])=>sql.includes("'unavailable'") && args?.[0]==='publicartist'));
 await research.scan();
 assert.equal(metaCalls,2); // last_attempt stored, no restart-style retry burst
});
test('no source scan if credentials are unavailable',async()=>{
 let accessed=false;
 const research=makeResearchCollector({pool:{query:async()=>{accessed=true;return{rows:[]}}},installedToken:async()=>{throw Error('no token')},
   meta:async()=>{throw Error('never')},igId:'id',approved:new Set(['known']),sanitizeDiscovery:()=>{},configured:()=>false});
 await research.scan();
 assert.equal(accessed,false);
});
