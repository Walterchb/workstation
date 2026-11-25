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
  const requests = [];
  const api = {chat:()=>response(200,answer),beforeRefresh:()=>{},requests};
  const empty = ()=>({version:1,goals:[],tasks:[]});
  const login = name => response(200,{
    user:{id:name,email:name+'@prueba.invalid'},
    access_token:'access-'+name+'-'+renewed,refresh_token:'refresh-'+name,
    expires_at:Math.floor(clock/1000)+100
  });
  const runtime = {
    window:null, Date:Clock, URL, fetch, crypto:webcrypto, setTimeout,clearTimeout,AbortController,atob,
    location:{pathname:'/workstation/'},JORNADA_CONFIG:config,JModel:{empty,validate(){}},
    sessionStorage:{setItem:(k,v)=>credentials.set(k,v),getItem:k=>credentials.get(k),removeItem:k=>credentials.delete(k)}
  };
  runtime.window=runtime;
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
