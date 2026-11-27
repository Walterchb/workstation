'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');

const storeCode = readFileSync(join(__dirname,'../assets/store.js'),'utf8');
const config = {supabaseUrl:'https://prueba.invalid',supabasePublishableKey:'sb_publishable_ejemplo'};
const payload = {message:'¿Qué queda pendiente?',history:[],scope:'tasks'};
const answer = {answer:'Hay una revisión [1].',sources:[{number:1,type:'task',id:'t1',title:'Revisión'}]};
const snapshot = value => JSON.parse(JSON.stringify(value));
const waitForFetch = () => new Promise(resolve=>setImmediate(resolve));
const hasCode = code => error => error.code === code;
const response = (status,value) => ({status,ok:status>=200 && status<300,text:async()=>JSON.stringify(value)});
function deferred() {
  let resolve;
  const promise = new Promise(done=>{resolve=done;});
  return {promise,resolve};
}

function workSession() {
  let clock = Date.now(), renewed = 0;
  class Clock extends Date { static now() {return clock;} }
  const credentials = new Map();
  const requests = [], metering = [], attempts = [];
  const api = {chat:()=>response(200,answer),beforeRefresh:()=>{},requests,metering,attempts};
  const empty = ()=>({version:1,goals:[],tasks:[]});
  const login = name => response(200,{
    user:{id:name,email:name+'@prueba.invalid'},
    access_token:'access-'+name+'-'+renewed,refresh_token:'refresh-'+name,
    expires_at:Math.floor(clock/1000)+100
  });
  const runtime = {
    window:null, Date:Clock, URL, fetch, crypto:webcrypto, setTimeout,clearTimeout,AbortController,TextDecoder,atob,
    location:{pathname:'/workstation/'},JORNADA_CONFIG:config,JModel:{empty,validate(){}},
    sessionStorage:{setItem:(k,v)=>credentials.set(k,v),getItem:k=>credentials.get(k),removeItem:k=>credentials.delete(k)}
  };
  runtime.window=runtime;
  runtime.WorkStationChatBudget={
    beginAttempt:(...args)=>attempts.push(['start',...args]),
    settleUnbilled:(...args)=>attempts.push(['unbilled',...args]),
    record:(...args)=>metering.push(['record',...args]),
    markUnknown:(...args)=>metering.push(['unknown',...args])
  };
  runtime.fetch=async(url,opts)=>{
    const endpoint=new URL(url);
    assert.equal(endpoint.origin,config.supabaseUrl);
    const body=JSON.parse(opts.body);
    requests.push({route:endpoint.pathname+endpoint.search,body,options:opts});
    if(endpoint.search.includes('grant_type=password')) return login(body.email);
    if(endpoint.search.includes('grant_type=refresh_token')) {
      await api.beforeRefresh();
      renewed++;
      return login(body.refresh_token.slice('refresh-'.length));
    }
    if(endpoint.pathname==='/auth/v1/logout') return response(204,null);
    if(endpoint.pathname.endsWith('/rpc/jornada_leer')) return response(200,{revision:0,document:null});
    if(endpoint.pathname.endsWith('/rpc/jornada_guardar')) return response(200,body.p_revision+1);
    assert.equal(endpoint.pathname,'/functions/v1/workhub-chat');
    return api.chat(opts);
  };
  const ctx=vm.createContext(runtime);
  vm.runInContext(storeCode,ctx);
  return {api,store:ctx.JStore,credentials,nearExpiry:()=>{clock+=70000;},empty};
}

test('El chat requiere sesión y envía solo la consulta a la función autenticada del proyecto',async()=>{
  const {store,api,credentials}=workSession();
  await assert.rejects(store.askChat(payload),hasCode('CHAT_AUTH'));
  assert.equal(api.requests.length,0);
  await store.signIn('maria','clave de ejemplo');
  assert.deepEqual(snapshot(await store.askChat(payload)),answer);
  const {route,options,body}=api.requests.at(-1);
  assert.equal(route,'/functions/v1/workhub-chat');
  assert.deepEqual(body,payload);
  assert.equal(options.headers.apikey,config.supabasePublishableKey);
  assert.equal(options.headers.Authorization,'Bearer access-maria-0');
  assert.equal(options.headers.Accept,undefined);
  assert.equal(options.cache,'no-store');
  assert.equal(options.credentials,'omit');
  assert.ok(![...credentials.values()].join('').includes(payload.message));
});

test('Una respuesta perdida no duplica el consumo del chat; los diagnósticos distinguen instalación y cuota',async()=>{
  const {store,api}=workSession();
  await store.signIn('maria','ejemplo');
  const cases=[
    [()=>{throw Error('red cortada');},'CHAT_NETWORK'],
    [()=>response(404,{code:'NOT_FOUND'}),'CHAT_NOT_CONFIGURED'],
    [()=>response(503,{code:'CHAT_NOT_CONFIGURED'}),'CHAT_NOT_CONFIGURED'],
    [()=>response(503,{code:'CHAT_SUPABASE_CONFIG'}),'CHAT_SUPABASE_CONFIG'],
    [()=>response(503,{code:'CHAT_KEY_MISSING'}),'CHAT_KEY_MISSING'],
    [()=>response(401,{code:'CHAT_KEY_INVALID'}),'CHAT_KEY_INVALID'],
    [()=>response(403,{code:'CHAT_KEY_PERMISSION'}),'CHAT_KEY_PERMISSION'],
    [()=>response(404,{code:'CHAT_MODEL'}),'CHAT_MODEL'],
    [()=>response(429,{code:'CHAT_QUOTA'}),'CHAT_QUOTA'],
    [()=>response(429,{code:'CHAT_LIMIT'}),'CHAT_LIMIT'],
    [()=>response(403,{code:'CHAT_ACCESS'}),'CHAT_ACCESS'],
    [()=>response(502,{code:'CHAT_PROVIDER'}),'CHAT_PROVIDER'],
    [()=>response(200,{}),'CHAT_PROVIDER']
  ];
  for(const [reply,code] of cases) {
    const before=api.requests.length;
    api.chat=reply;
    await assert.rejects(store.askChat(payload),hasCode(code));
    assert.equal(api.requests.length-before,1,code);
  }
});

test('Solo una denegación de sesión permite repetir antes de consultar al modelo',async()=>{
  const {store,api}=workSession();
  await store.signIn('maria','ejemplo');
  api.chat=opts=>opts.headers.Authorization==='Bearer access-maria-0'?response(401,{code:'CHAT_AUTH'}):response(200,answer);
  assert.deepEqual(snapshot(await store.askChat(payload)),answer);
  assert.equal(api.requests.filter(r=>r.route.endsWith('/workhub-chat')).length,2);
  assert.equal(api.requests.filter(r=>r.route.includes('refresh_token')).length,1);
  api.chat=()=>response(401,{code:'CHAT_PROVIDER'});
  const before=api.requests.length;
  await assert.rejects(store.askChat(payload),hasCode('CHAT_PROVIDER'));
  assert.equal(api.requests.length-before,1);
  api.chat=()=>response(401,{code:'CHAT_AUTH',usage:{rounds:1,complete:false}});
  const after=api.requests.length;
  await assert.rejects(store.askChat(payload),hasCode('CHAT_AUTH'));
  assert.equal(api.requests.length-after,1,'Sin reenvío tras una llamada facturable');
  assert.equal(api.metering.at(-1)[3].rounds,1);
});

test('El guardado simultáneo al chat comparte la renovación y deja la agenda editable',async()=>{
  const {store,api,nearExpiry,empty}=workSession();
  await store.signIn('maria','ejemplo');
  const release=deferred();
  api.beforeRefresh=()=>release.promise;
  nearExpiry();
  const chat=store.askChat(payload);
  const save=store.save(empty());
  await waitForFetch();
  assert.equal(api.requests.filter(r=>r.route.includes('refresh_token')).length,1);
  release.resolve();
  const [reply]=await Promise.all([chat,save]);
  assert.deepEqual(snapshot(reply),answer);
  assert.deepEqual(api.requests.filter(r=>r.route.endsWith('/workhub-chat') || r.route.endsWith('/jornada_guardar')).map(r=>r.options.headers.Authorization),['Bearer access-maria-1','Bearer access-maria-1']);
  await store.save(empty());
  assert.equal(api.requests.at(-1).body.p_revision,1);
});

test('Cancelar o cerrar sesión descarta respuestas tardías incluso al ingresar con otra cuenta',async()=>{
  const {store,api}=workSession();
  await store.signIn('maria','ejemplo');
  const controller=new AbortController();
  controller.abort();
  await assert.rejects(store.askChat(payload,controller.signal),hasCode('CHAT_ABORTED'));
  assert.equal(api.requests.filter(r=>r.route.endsWith('/workhub-chat')).length,0);
  const late=deferred();
  api.chat=()=>late.promise;
  const signal=new AbortController();
  const cancelled=store.askChat(payload,signal.signal);
  const old=api.requests.at(-1);
  signal.abort();
  assert.ok(old.options.signal.aborted);
  late.resolve(response(200,answer));
  await assert.rejects(cancelled,hasCode('CHAT_ABORTED'));
  const last=deferred();
  api.chat=()=>last.promise;
  const oldAccount=store.askChat(payload);
  const inflight=api.requests.at(-1);
  await store.signOut();
  assert.ok(inflight.options.signal.aborted);
  await store.signIn('sofia','ejemplo');
  last.resolve(response(200,answer));
  await assert.rejects(oldAccount,hasCode('CHAT_AUTH'));
  api.chat=()=>response(200,answer);
  await store.askChat(payload);
  assert.equal(api.requests.at(-1).options.headers.Authorization,'Bearer access-sofia-0');
});

test('Una renovación tardía del chat no puede reemplazar ni revocar las credenciales de una nueva cuenta',async()=>{
  const {store,api,nearExpiry}=workSession();
  await store.signIn('maria','ejemplo');
  nearExpiry();
  const waiting=deferred();
  api.beforeRefresh=()=>waiting.promise;
  const previous=store.askChat(payload);
  await waitForFetch();
  await store.signIn('sofia','ejemplo');
  waiting.resolve();
  await assert.rejects(previous,hasCode('CHAT_AUTH'));
  assert.equal(api.requests.filter(r=>r.route.endsWith('/workhub-chat')).length,0);
  await store.askChat(payload);
  assert.equal(api.requests.at(-1).options.headers.Authorization,'Bearer access-sofia-0');
});

function streamFixture() {
  let source, cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {source=controller;},
    cancel() {cancelled=true;}
  });
  return {
    response:new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8'}}),
    bytes:bytes=>source.enqueue(bytes),
    write:text=>source.enqueue(encoder.encode(text)),
    close:()=>source.close(),
    get cancelled(){return cancelled;}
  };
}

test('La respuesta llega por partes antes de terminar, preserva UTF-8 fragmentado y usa las citas finales',async()=>{
  const {store,api}=workSession();
  await store.signIn('maria','ejemplo');
  const fixture=streamFixture(), updates=[];
  api.chat=()=>fixture.response;
  const result=store.askChat(payload,null,event=>updates.push(snapshot(event)));
  const delta={type:'delta',text:'Revisión 📅'};
  const bytes=new TextEncoder().encode(JSON.stringify(delta)+'\r\n');
  fixture.write('{"type":"status","stage":"searching"}\n');
  fixture.write('{"type":"status","stage":"writing"}\n');
  for(const byte of bytes) fixture.bytes(Uint8Array.of(byte));
  await waitForFetch();
  assert.deepEqual(updates,[{type:'status',stage:'searching'},{type:'status',stage:'writing'},delta]);
  fixture.write('{"type":"reset"}\n{"type":"delta","text":"Confirmado"}\n');
  fixture.write(JSON.stringify({type:'done',...answer})+'\n');
  assert.deepEqual(snapshot(await result),answer);
  assert.deepEqual(updates.slice(-2),[{type:'reset'},{type:'delta',text:'Confirmado'}]);
  assert.equal(api.requests.at(-1).options.headers.Accept,'application/x-ndjson');
  assert.equal(fixture.cancelled,true);
});

test('Una función anterior puede responder JSON al cliente en vivo sin una segunda consulta',async()=>{
  const {store,api}=workSession();
  await store.signIn('maria','ejemplo');
  api.chat=()=>Response.json(answer);
  assert.deepEqual(snapshot(await store.askChat(payload,null,()=>assert.fail('JSON sin avances'))),answer);
  assert.equal(api.requests.filter(r=>r.route.endsWith('/workhub-chat')).length,1);
});

test('El indicador registra una sola vez las rondas agregadas de cada pregunta o error, con JSON o transmisión',async()=>{
  const {store,api}=workSession();
  await store.signIn('ana','ejemplo');
  const usage={rounds:3,measuredRounds:3,model:'prueba',complete:true,knownCostUsd:0.014,costUsd:0.014};
  for (const stream of [false,true]) {
    for (const success of [true,false]) {
      const result=success ? {...answer,requestId:'server',usage} : {code:'CHAT_PROVIDER',requestId:'server',usage};
      api.chat=()=>stream ? new Response(JSON.stringify({type:success?'done':'error',...result})+'\n',{headers:{'Content-Type':'application/x-ndjson'}})
        : response(success?200:502,result);
      const delivered=store.askChat(payload,null,()=>{});
      if (success) assert.deepEqual(snapshot(await delivered),result);
      else await assert.rejects(delivered,error=>error.code==='CHAT_PROVIDER' && error.usage.costUsd===usage.costUsd);
      const [verb,user,id,value,outcome]=api.metering.at(-1);
      assert.equal(verb,'record'); assert.equal(user,'ana'); assert.ok(id);
      assert.deepEqual(snapshot(value),usage); assert.equal(outcome,success?'success':'error');
    }
  }
  assert.equal(api.metering.length,4);
  assert.equal(new Set(api.metering.map(row=>row[2])).size,4);
});

test('Interrupciones reales dejan consumo incierto; un rechazo antes del modelo no crea consumos',async()=>{
  const {store,api}=workSession();
  await store.signIn('ana','ejemplo');
  api.chat=()=>response(400,{code:'CHAT_INPUT'});
  await assert.rejects(store.askChat(payload),hasCode('CHAT_INPUT'));
  assert.equal(api.metering.length,0);
  assert.deepEqual(api.attempts.map(row=>row[0]),['start','unbilled']);
  assert.equal(api.attempts[0][2],api.attempts[1][2]);
  const stopped=new AbortController();stopped.abort();
  await assert.rejects(store.askChat(payload,stopped.signal),hasCode('CHAT_ABORTED'));
  assert.equal(api.metering.length,0);
  assert.equal(api.attempts.length,2);
  const fixture=streamFixture();
  api.chat=()=>fixture.response;
  const stop=new AbortController();
  const query=store.askChat(payload,stop.signal,()=>{});
  assert.equal(api.attempts.at(-1)[0],'start');
  fixture.write('{"type":"status","stage":"searching"}\n');
  await waitForFetch(); stop.abort();
  await assert.rejects(query,hasCode('CHAT_ABORTED'));
  assert.deepEqual(api.metering.map(row=>row.slice(0,2)),[['unknown','ana']]);
  assert.equal(api.metering[0][2],api.attempts.at(-1)[2]);
});

test('Un flujo cortado, excesivo o fallido nunca se confirma ni se vuelve a enviar automáticamente',async()=>{
  const {store,api}=workSession();
  await store.signIn('maria','ejemplo');
  for(const [tail,code] of [
    ['', 'CHAT_NETWORK'],
    ['{"type":"done","sources":[]}', 'CHAT_PROVIDER'],
    ['{texto inválido}\n', 'CHAT_PROVIDER'],
    ['{"type":"error","code":"CHAT_AUTH","status":401}\n','CHAT_AUTH'],
    ['{"type":"error","code":"CHAT_QUOTA","status":429}\n','CHAT_QUOTA'],
    ['x'.repeat(1024*1024+1),'CHAT_PROVIDER']
  ]) {
    api.chat=()=>new Response('{"type":"delta","text":"Parcial"}\n'+tail,{headers:{'Content-Type':'application/x-ndjson'}});
    const before=api.requests.length;
    await assert.rejects(store.askChat(payload,null,()=>{}),hasCode(code));
    assert.equal(api.requests.length-before,1);
  }
});

test('Detener la lectura o salir de la cuenta interrumpe incluso un flujo inactivo y libera la siguiente consulta',async()=>{
  const {store,api}=workSession();
  await store.signIn('maria','ejemplo');
  for(const stop of ['cancel','logout']) {
    const controller=new AbortController(), fixture=streamFixture(), updates=[];
    api.chat=()=>fixture.response;
    const promise=store.askChat(payload,controller.signal,evt=>updates.push(evt.text));
    const ended=assert.rejects(promise,hasCode(stop==='cancel'?'CHAT_ABORTED':'CHAT_AUTH'));
    fixture.write('{"type":"delta","text":"Inicio"}\n');
    await waitForFetch();
    if(stop==='cancel') controller.abort();
    else await store.signOut();
    await ended;
    assert.deepEqual(updates,['Inicio']);
    assert.equal(fixture.cancelled,true);
  }
  await store.signIn('sofia','ejemplo');
  api.chat=()=>Response.json(answer);
  assert.deepEqual(snapshot(await store.askChat(payload,null,()=>{})),answer);
});
