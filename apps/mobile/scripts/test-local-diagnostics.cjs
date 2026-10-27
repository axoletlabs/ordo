/** Real facade + core, persistent fake disk and adversarial native responses. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src/lib');
const disk = new Map();
const keychain = new Map(), webDisk = new Map();
let now = 1_800_000_000_000;
let mono = 100;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function load(native, broken = false, platform = 'android') {
  const timers = [], forwarded = [], cache = new Map(), storageOptions = [];
  let handler = (error, fatal) => forwarded.push([error, fatal]);
  const mocks = {
    'expo-constants': { __esModule: true, default: { nativeAppVersion:'0.3.0', expoConfig:{version:'0.3.0',extra:{ordo:{gitHash:'a'.repeat(40)}}} } },
    'expo-updates': { isEmbeddedLaunch:true },
    'expo-file-system/legacy': {cacheDirectory:'file:///private/cache/'},
    'expo-secure-store': {WHEN_UNLOCKED_THIS_DEVICE_ONLY:7,getItem:key=>keychain.get(key)??null,setItem:(key,value)=>{if(broken)throw Error('keychain locked');keychain.set(key,value);},setItemAsync:async(key,value)=>{if(broken)throw Error('storage full');keychain.set(key,value);}},
    '@react-native-async-storage/async-storage': {__esModule:true,default:{setItem:async()=>{if(broken)throw Error('storage full');}}},
    'react-native': { Platform:{OS:platform,Version:36}, NativeModules:{OrdoDiagnostics:native} },
    'react-native-mmkv': { createMMKV(options) { storageOptions.push(options);if(broken) throw Error('disk unavailable'); return {
      getString:key=>disk.get(key), set:(key,value)=>disk.set(key,value), remove:key=>disk.delete(key), trim:()=>{},
    }; } },
  };
  const globals = { __DEV__:false, Date:{now:()=>now}, performance:{now:()=>mono}, Error, TypeError, RangeError, Object, JSON, Math, console,
    localStorage:{getItem:key=>webDisk.get(key)??null,setItem:(key,value)=>webDisk.set(key,value),removeItem:key=>webDisk.delete(key)},
    setTimeout:(fn,ms)=> { const t={fn,ms}; timers.push(t); return t; },
    clearTimeout:t=> {if(t)t.cleared=true;},
    setInterval:(fn,ms)=> { const t={fn,ms,interval:true}; timers.push(t); return t; },
    clearInterval:t=> {if(t)t.cleared=true;},
    ErrorUtils:{getGlobalHandler:()=>handler,setGlobalHandler:next=>{handler=next;}},
  };
  function source(file) {
    if(cache.has(file))return cache.get(file);
    const exports={};cache.set(file,exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
      {...globals,exports,require:name=>name.startsWith('.')?source(path.resolve(path.dirname(file),name+'.ts')):mocks[name]??(()=>{throw Error('unexpected dependency '+name);})()},{filename:file});
    return exports;
  }
  return {api:source(path.join(root,'local-diagnostics.ts')),timers,forwarded,storageOptions,loadSource:name=>source(path.join(root,name+'.ts')),error:(...args)=>handler(...args)};
}
(async()=>{
  const calls=[];
  const native={diagnosticsApiVersion:2,recordingGeneration:42,
    configureRecording:async(...args)=>{calls.push(['configure',...args]);return true;},
    cancelDiagnosticCapture:async generation=>{calls.push(['cancel',generation]);return true;},
    collectSafeEvidence:async()=>{calls.push(['collect']);return {status:'complete',text:'192.0.2.44 SECRET',incidents:[{code:'react.host_destroyed',count:1,agoMs:100}],exits:[{reason:10,description:'private.example'}]};},
    captureSafeFrameStats:async()=>({status:'complete',frameCount:12,intervalP95Ms:33}),
    getSafeRenderState:async()=>({status:'complete',nodes:[{type:'text',text:'SECRET',width:100}]}),
  };
  let {api,timers,forwarded,error}=load(native);
  api.installLocalErrorRecording();api.installLocalErrorRecording();
  assert.equal(calls[0][3],43,'native token continues across runtime/process restarts');
  const err=new Error('SECRET 192.0.2.44');error(err,true);
  assert.equal(forwarded.length,1);assert.equal(forwarded[0][0],err);assert.equal(forwarded[0][1],true);
  assert(disk.has('fatal-v2'),'fatal marker before forwarding');
  const report=await api.prepareDiagnosticReport();
  const text=api.serializeDiagnosticReport(report);
  assert(Object.isFrozen(report) && Object.isFrozen(report.snapshot.sessions));
  assert.throws(()=>report.snapshot.sessions.push({private:'SECRET'}));
  assert(!text.includes('SECRET'));assert(!text.includes('192.0.2.44'));assert(!text.includes('private.example'));
  assert.equal(calls.filter(c=>c[0]==='collect').length,1);
  api.recordDiagnosticEvent('reader.controls.open');
  assert.equal(api.serializeDiagnosticReport(report),text,'frozen bytes do not change with new events');
  assert.equal(api.serializeDiagnosticReport({...report, private:'SECRET'}),null,'forged report objects cannot bypass ingress validation');
  const selected=JSON.parse(api.serializeDiagnosticReport(report,{actions:false,errors:false,measurements:false,native:false}));
  assert(!('sessions'in selected)&&!('issues'in selected)&&!('measurements'in selected)&&!('android'in selected));
  api.recordDiagnosticEvent('app.state','background');
  assert.equal(api.serializeDiagnosticReport(report),text,'system Save As/share handoff must not revoke a reviewed report');
  api.clearLocalDiagnostics();assert.equal(api.serializeDiagnosticReport(report),null);
  assert.equal(api.getPreparedDiagnosticReport(),null);
  api.setLocalDiagnosticsEnabled(false);
  const priorCalls=calls.length;
  api.recordDiagnosticEvent('route','(app)/reader/[id]');error(err,true);
  const once=await api.prepareDiagnosticReport();assert(once.oneTime);
  assert.equal(calls.length,priorCalls,'one-time report while off never calls native collectors');
  assert(!('sessions' in JSON.parse(api.serializeDiagnosticReport(once))));
  assert.equal(forwarded.length,2,'off still forwards original failure');
  api.setLocalDiagnosticsEnabled(true);api.startDetailedDiagnostics();
  assert.equal(api.getDiagnosticStatus().mode,'detailed');
  assert(timers.some(t=>t.interval&&!t.cleared),'only detailed mode has a clock');
  await api.captureDiagnosticMeasurement('render');
  assert(!api.localDiagnosticReport().includes('SECRET'));
  api.stopDetailedDiagnostics();assert(timers.filter(t=>t.interval).every(t=>t.cleared));

  let resolveFrame;
  native.captureSafeFrameStats=()=>new Promise(resolve=>{resolveFrame=resolve;});
  api.startDetailedDiagnostics();
  const capture=api.captureDiagnosticMeasurement('frames');await flush();
  assert.equal(await api.captureDiagnosticMeasurement('frames'),false,'single measurement owner');
  api.clearLocalDiagnostics();resolveFrame({frameCount:100,private:'SECRET'});await capture;
  assert.equal(api.getDiagnosticSnapshot().measurements.length,0,'late measurement cannot restore cleared data');
  let resolveEvidence;
  native.collectSafeEvidence=()=>new Promise(resolve=>{resolveEvidence=resolve;});
  const collecting=api.prepareDiagnosticReport();await flush();
  api.setLocalDiagnosticsEnabled(false);resolveEvidence({status:'complete',incidents:[{code:'fabric.mount_failed'}]});
  assert.equal(await collecting,null,'off during preparation revokes the report');

  // Revocation must reach native now, even if an older disk commit is hung.
  let holdConfiguration;
  native.configureRecording=(...args)=>{calls.push(['configure',...args]);return new Promise(resolve=>{holdConfiguration=resolve;});};
  api.setLocalDiagnosticsEnabled(true);const before=calls.length;
  api.setLocalDiagnosticsEnabled(false);assert.equal(calls.length,before+1);assert.equal(calls.at(-1)[1],false);holdConfiguration(true);

  // A fatal before the routine 1s flush must survive the very next startup.
  disk.clear();const early=load();early.api.installLocalErrorRecording();early.error(err,true);now+=10;
  const recovery=load();recovery.api.installLocalErrorRecording();
  assert.equal(recovery.api.getDiagnosticSnapshot().issues.length,1);
  assert.equal(recovery.api.getDiagnosticSnapshot().sessions.length,2);
  assert(!recovery.api.localDiagnosticReport().includes('SECRET'));
  const old={getNativeLog(){throw Error('unsafe legacy collector called');},getExitHistory(){throw Error('unsafe legacy collector called');}};
  const compatibility=load(old);compatibility.api.installLocalErrorRecording();assert.equal(compatibility.api.nativeDiagnosticsAvailable(),false);await compatibility.api.prepareDiagnosticReport();
  const unavailable=load(undefined,true);unavailable.api.installLocalErrorRecording();unavailable.error(err,true);
  assert.equal(unavailable.api.getDiagnosticStatus().enabled,false);assert.equal(unavailable.forwarded.length,1);
  disk.clear();const beforeJs=load({...native,recordingEnabled:true,cutoffTimestamp:now-10000,configureRecording:async()=>true});
  beforeJs.api.installLocalErrorRecording();
  assert.equal(beforeJs.api.getDiagnosticStatus().cutoff,now-10000,'first JS launch must retain native pre-JS incident window');
  // Execute the storage boundary with private payloads; only category/bucket survives.
  disk.clear();const operations=load();operations.api.installLocalErrorRecording();
  const secret={address:'192.0.2.44',password:'SECRET'};
  const writes=operations.loadSource('storage');await writes.secureSet('private.example',secret);await writes.prefsSet('PRIVATE_KEY',secret);
  assert.equal(await operations.api.withDiagnosticOperation('import',async()=>secret),secret);
  const originalFailure=new Error('SECRET');
  await assert.rejects(operations.api.withDiagnosticOperation('update-check',async()=>{throw originalFailure;}),error=>error===originalFailure);
  const opText=operations.api.localDiagnosticReport();assert(opText.includes('storage.ok fast'));assert(opText.includes('import.ok fast'));assert(opText.includes('update-check.failed fast'));
  for(const forbidden of ['192.0.2.44','SECRET','private.example','PRIVATE_KEY'])assert(!opText.includes(forbidden));
  operations.api.setLocalDiagnosticsEnabled(false);await writes.secureSet('private.example',secret);assert.equal(operations.api.getDiagnosticSnapshot().sessions.length,0);
  // Platform policy adapters preserve disabled across reload; iOS evidence uses caches.
  for(const platform of ['ios','web']) {
    disk.clear();keychain.clear();webDisk.clear();
    const first=load(undefined,false,platform);first.api.installLocalErrorRecording();first.api.setLocalDiagnosticsEnabled(false);
    const second=load(undefined,false,platform);second.api.installLocalErrorRecording();assert.equal(second.api.getDiagnosticStatus().enabled,false,platform+' preserves off');
    second.api.setLocalDiagnosticsEnabled(true);second.api.recordDiagnosticEvent('reader.controls.open');
    if(platform==='ios')assert(second.storageOptions.every(options=>options.path==='/private/cache/ordo-diagnostics'));
    else assert(webDisk.has('ordo.diagnostics.policy-v2'));
  }
  // A single user action owns timing + layout, independent of screen lifetime.
  disk.clear();let finishFrames,finishLayout;const checkCalls=[];
  const checkNative={...native,configureRecording:async()=>true,
    captureSafeFrameStats:(duration,generation)=>{checkCalls.push(['frames',duration,generation]);return new Promise(resolve=>{finishFrames=resolve;});},
    getSafeRenderState:generation=>{checkCalls.push(['render',generation]);return new Promise(resolve=>{finishLayout=resolve;});},
    collectSafeEvidence:async()=>{checkCalls.push(['evidence']);return {status:'complete'};},
  };
  const checkHarness=load(checkNative),check=checkHarness.api;check.installLocalErrorRecording();
  const changes=[];const unsubscribe=check.subscribeDiagnosticCapture(()=>changes.push(check.getDiagnosticCheck()));
  const checking=check.runDiagnosticPerformanceCheck();await flush();
  assert.equal(check.getDiagnosticCheck(),'running');assert.equal(check.getDiagnosticStatus().mode,'detailed');
  assert.equal(checkCalls[0][1],15000,'one tap starts a real bounded 15s timing sample');
  assert.equal(check.getDiagnosticStatus().overlays.performance,true,'progress is visible without extra setup');
  assert.equal(await check.runDiagnosticPerformanceCheck(),'busy','double taps cannot restart a check');
  assert.equal(await check.prepareDiagnosticReport(),null,'report creation cannot interrupt or freeze an incomplete check');
  assert(!checkCalls.some(c=>c[0]==='evidence'));
  check.setDiagnosticOverlay('status',false);check.setDiagnosticOverlay('performance',false);
  assert.equal(check.getDiagnosticCheck(),'running','hiding progress does not cancel measurement');
  check.recordDiagnosticEvent('reader.controls.open');
  finishFrames({status:'complete',intervalP95Ms:21,private:'SECRET'});await flush();
  assert.equal(check.getDiagnosticCapture(),'render','layout follows timing automatically');
  finishLayout({status:'complete',nodes:[{type:'text',text:'SECRET'}]});
  assert.equal(await checking,'complete');assert.equal(check.getDiagnosticCheck(),'complete');
  assert.equal(check.getDiagnosticStatus().mode,'basic');
  assert(Object.values(check.getDiagnosticStatus().overlays).every(value=>!value));
  assert(checkHarness.timers.filter(t=>t.interval).every(t=>t.cleared),'completed check leaves no ticking clock');
  assert.equal(check.getDiagnosticSnapshot().measurements.length,2);
  assert(disk.get('records-v2').includes('intervalP95Ms'),'completed results are flushed before reporting success');
  assert(!check.localDiagnosticReport().includes('SECRET'));
  assert(changes.includes('running')&&changes.includes('complete'));unsubscribe();
  assert((await check.prepareDiagnosticReport()).snapshot.measurements.length===2,'report includes both saved measurements');

  // An unavailable native result must never be presented as a successful check.
  checkNative.captureSafeFrameStats=async()=>({status:'unavailable'});
  checkNative.getSafeRenderState=async()=>({status:'complete',nodes:[]});
  assert.equal(await check.runDiagnosticPerformanceCheck(),'partial');
  checkNative.getSafeRenderState=async()=>({status:'unavailable'});
  assert.equal(await check.runDiagnosticPerformanceCheck(),'unavailable');
  check.startDetailedDiagnostics();assert.equal(await check.captureDiagnosticMeasurement('render'),false);check.stopDetailedDiagnostics();

  // Background, manual stop, disable, and deletion cancel the real pending job.
  for(const cancel of ['background','stop','disable','delete']) {
    check.clearLocalDiagnostics();checkNative.captureSafeFrameStats=()=>new Promise(resolve=>{finishFrames=resolve;});
    const running=check.runDiagnosticPerformanceCheck();await flush();
    const rendersBefore=checkCalls.filter(c=>c[0]==='render').length;
    if(cancel==='background')check.recordDiagnosticEvent('app.state','background');
    else if(cancel==='stop')check.stopDetailedDiagnostics();
    else if(cancel==='disable')check.setLocalDiagnosticsEnabled(false);
    else check.clearLocalDiagnostics();
    assert.equal(await running,'cancelled','cancel settles even when native promise never resolves: '+cancel);
    finishFrames({status:'complete',intervalP95Ms:20});await flush();
    assert.equal(check.getDiagnosticSnapshot().measurements.length,0,'late callback cannot restore results: '+cancel);
    assert.equal(checkCalls.filter(c=>c[0]==='render').length,rendersBefore,'cancel must not start a layout scan: '+cancel);
    assert.equal(check.getDiagnosticStatus().mode,cancel==='disable'?'off':'basic');
    check.setLocalDiagnosticsEnabled(true);
  }
  // Cancelling during the final layout scan cannot overwrite a newer check.
  checkNative.captureSafeFrameStats=async()=>({status:'complete',intervalP95Ms:20});
  checkNative.getSafeRenderState=()=>new Promise(resolve=>{finishLayout=resolve;});
  const oldCheck=check.runDiagnosticPerformanceCheck();await flush();
  assert.equal(check.getDiagnosticCapture(),'render');check.stopDetailedDiagnostics();
  assert.equal(await oldCheck,'cancelled');
  checkNative.captureSafeFrameStats=()=>new Promise(resolve=>{finishFrames=resolve;});
  const newerCheck=check.runDiagnosticPerformanceCheck();await flush();
  finishLayout({status:'complete',nodes:[]});await flush();
  assert.equal(check.getDiagnosticCheck(),'running');assert.equal(check.getDiagnosticCapture(),'frames');
  check.stopDetailedDiagnostics();assert.equal(await newerCheck,'cancelled');

  // A stalled native worker is bounded and yields an honest unavailable result.
  checkNative.captureSafeFrameStats=()=>new Promise(()=>{});checkNative.getSafeRenderState=async()=>({status:'unavailable'});
  const timedCheck=check.runDiagnosticPerformanceCheck();await flush();
  checkHarness.timers.findLast(t=>t.ms===16500&&!t.cleared).fn();
  assert.equal(await timedCheck,'unavailable');assert.equal(check.getDiagnosticStatus().mode,'basic');
  check.setLocalDiagnosticsEnabled(false);assert.equal(await check.runDiagnosticPerformanceCheck(),'unavailable');
  assert.equal(check.getDiagnosticCheck(),'idle');
  assert.equal(await compatibility.api.runDiagnosticPerformanceCheck(),'unavailable','old APK never attempts unsafe legacy collectors');
  console.log('PASS: one-tap performance check, automatic measurements, honest results, report ordering, bounded waits, cancellation and stale callbacks');
  console.log('PASS: real facade, exact fatal chaining, early-crash recovery, restart tokens, no legacy raw APIs, frozen selection/export bytes, off, cancellation, background handoff and failed persistence');
})().catch(error=>{console.error(error);process.exitCode=1;});
