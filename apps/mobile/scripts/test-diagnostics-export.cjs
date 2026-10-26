/** Execute the real export adapter with controlled OS handoffs and cache IO. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/lib/diagnostics/export.ts'),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const uriExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/lib/import-export-uri.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:uriExports});
const tick = async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function load(os='android',save) {
  let reportEpoch=3,cancel,failWrite=false,holdWrite,shareResult={action:'shared'},shareHold;
  const files=new Map(),timers=[],saves=[],shares=[],downloads=[];
  const native=save?{saveDocument:async(...args)=>{saves.push(args);return save(...args);}}:undefined;
  const fileSystem={cacheDirectory:'file:///private/cache/',
    deleteAsync:async p=>{files.delete(p);},getInfoAsync:async p=>({exists:p.endsWith('/')||files.has(p)}),
    readDirectoryAsync:async()=>[...files.keys()].map(p=>p.split('/').at(-1)),makeDirectoryAsync:async()=>{},
    writeAsStringAsync:async(p,text)=>{files.set(p,text);if(holdWrite)await holdWrite;if(failWrite)throw Error('disk full');},
    getContentUriAsync:async p=>'content://private/'+p.split('/').at(-1),
  };
  const mocks={'react-native':{NativeModules:{OrdoExportFile:native},Platform:{OS:os},Share:{dismissedAction:'dismissed',share:async value=>{shares.push(value);if(shareHold)await shareHold;return shareResult;}}},
    'expo-file-system/legacy':fileSystem,
    '../local-diagnostics':{getDiagnosticReportEpoch:()=>reportEpoch,registerDiagnosticCancellation:fn=>{cancel=fn;}},
    './schema':{utf8Bytes:value=>Buffer.byteLength(value,'utf8')},
    '../import-export-uri':uriExports,
  };
  const exports={};
  vm.runInNewContext(source,{exports,require:name=>{assert(name in mocks,'unexpected dependency '+name);return mocks[name];},
    setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{if(t)t.cancelled=true;},
    Date,Blob,URL:{createObjectURL:()=> 'blob:report',revokeObjectURL:value=>downloads.push(['revoke',value])},
    document:{createElement:()=>({click(){downloads.push(['download',this.href,this.download]);}})},
  });
  return {api:exports,files,timers,saves,shares,downloads,
    revoke(){reportEpoch++;cancel();},setFailWrite(){failWrite=true;},setHoldWrite(value){holdWrite=value;},
    setShare(value){shareResult=value;},setShareHold(value){shareHold=value;}};
}
(async()=>{
  const text=JSON.stringify({version:2,build:{version:'0.3.0'},sessions:[]},null,2);
  let releaseSave;const saving=load('android',()=>new Promise(resolve=>{releaseSave=resolve;}));
  const job=saving.api.downloadDiagnosticReport(text,'abc123',3);await tick();
  assert.equal(saving.files.size,1);assert.equal([...saving.files.values()][0],text,'review bytes reach staging unchanged');
  assert.equal(saving.saves[0][0],'ordo-diagnostics-abc123.json');assert.equal(saving.saves[0][1],'application/json');
  assert.equal(await saving.api.downloadDiagnosticReport(text,'other',3),false,'single in-flight handoff');
  releaseSave();assert.equal(await job,true);assert.equal(saving.files.size,0,'Save As removes source after copy');
  assert.equal(await saving.api.downloadDiagnosticReport(text,'../private',3),false);
  assert.equal(await saving.api.downloadDiagnosticReport('é'.repeat(270000),'valid',3),false,'UTF-8 size bound');
  assert.equal(await saving.api.downloadDiagnosticReport(text,'valid',2),false,'stale report refused before IO');

  const sharing=load('ios');assert.equal(await sharing.api.downloadDiagnosticReport(text,'first',3),true);
  assert.equal(sharing.files.size,1,'recipient can read file after share resolves');assert.equal(sharing.timers.at(-1).ms,900000);
  await sharing.api.downloadDiagnosticReport(text,'second',3);assert.equal(sharing.files.size,1,'only newest pending export remains');
  assert(sharing.timers[0].cancelled,'replacing an export cancels its old cleanup timer, including reuse of the same report filename');
  sharing.timers.at(-1).fn();await tick();assert.equal(sharing.files.size,0,'share cache expires');
  sharing.setShare({action:'dismissed'});assert.equal(await sharing.api.downloadDiagnosticReport(text,'cancel',3),false);assert.equal(sharing.files.size,0);

  const interrupted=load('android');let resume;interrupted.setHoldWrite(new Promise(r=>{resume=r;}));
  const writing=interrupted.api.downloadDiagnosticReport(text,'pending',3);await tick();interrupted.revoke();resume();
  assert.equal(await writing,false);assert.equal(interrupted.files.size,0);assert.equal(interrupted.shares.length,0,'clear during IO prevents handoff');
  const inShare=load('ios');let finishShare;inShare.setShareHold(new Promise(r=>{finishShare=r;}));
  const handoff=inShare.api.downloadDiagnosticReport(text,'shared',3);await tick();inShare.revoke();finishShare();
  assert.equal(await handoff,false);assert.equal(inShare.files.size,0,'off during share deletes staging and refuses success');

  const failure=load();failure.setFailWrite();await assert.rejects(failure.api.downloadDiagnosticReport(text,'failed',3));assert.equal(failure.files.size,0);
  const cancelledSave=load('android',()=>Promise.reject({code:'export_save_canceled'}));
  assert.equal(await cancelledSave.api.downloadDiagnosticReport(text,'cancelled',3),false);assert.equal(cancelledSave.files.size,0);
  const nativeCancel=load('android',()=>Promise.reject({code:'ERR_EXPORT_CANCELED'}));
  assert.equal(await nativeCancel.api.downloadDiagnosticReport(text,'cancelled',3),false);assert.equal(nativeCancel.files.size,0);
  const orphans=load();for(let i=0;i<50;i++)orphans.files.set('file:///private/cache/ordo-diagnostics-export/orphan'+i,'old');
  await orphans.api.cleanupDiagnosticExports();assert.equal(orphans.files.size,0,'startup removes every orphan, including recent ones');
  const web=load('web');assert.equal(await web.api.downloadDiagnosticReport(text,'webreport',3),true);
  assert.equal(web.files.size,0);assert.equal(web.downloads[0][2],'ordo-diagnostics-webreport.json');assert.equal(web.downloads[1][0],'revoke');
  console.log('PASS: actual export adapter; exact frozen bytes, UTF-8 cap, safe names, single handoff, Save As/share cancellation, policy revocation, recipient TTL, cache cleanup and web download');
})().catch(error=>{console.error(error);process.exitCode=1;});
