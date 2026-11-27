'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {webcrypto} = require('node:crypto');

const modelSource = readFileSync(path.resolve(__dirname, '../assets/model.js'), 'utf8');
const storeSource = readFileSync(path.resolve(__dirname, '../assets/store.js'), 'utf8');
const config = {supabaseUrl:'https://work.test', supabasePublishableKey:'sb_publishable_test'};
const copy = data => JSON.parse(JSON.stringify(data));
const matchesCode = expected => error => error.code === expected;
function sessionCache() {
  const entries = new Map();
  return {entries, getItem:key => entries.get(key) ?? null, setItem:(key,val) => entries.set(key,val), removeItem:key => entries.delete(key)};
}
function openTab(fetch, settings = config, credentials = sessionCache()) {
  const legacy = {value:'<datos locales previos>',reads:0,writes:0,removals:0};
  const sandbox = {
    JORNADA_CONFIG:settings, fetch, URL, Date, Intl, crypto:webcrypto, setTimeout, clearTimeout, AbortController, atob,
    location:{pathname:'/work/index.html'}, sessionStorage:credentials,
    localStorage:{getItem(){legacy.reads++;return legacy.value},setItem(){legacy.writes++},removeItem(){legacy.removals++}}
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(modelSource,ctx);
  vm.runInContext(storeSource,ctx);
  return {store:ctx.JStore, model:ctx.JModel, credentials, legacy};
}

// Las solicitudes se resuelven en memoria y nunca salen del proceso de prueba.
function service() {
  const api = {requests:[], records:new Map(), offline:false, droppedWrites:0, expiresIn:3600, refreshDenied:false};
  const send = (status, data) => ({status,ok:status>=200 && status<300,text:async()=>JSON.stringify(data)});
  const tokens = (email, ttl) => ({
    user:{id:'id-'+email, email}, access_token:'jwt:'+email, refresh_token:'ref:'+email,
    expires_at:Math.floor(Date.now()/1000)+ttl
  });
  api.fetch = async (url, options) => {
    const {pathname,search,origin} = new URL(url);
    assert.equal(origin,config.supabaseUrl);
    assert.equal(options.cache,'no-store');
    assert.equal(options.headers.apikey,config.supabasePublishableKey);
    const body = JSON.parse(options.body);
    api.requests.push({pathname,search,body});
    if(api.offline) throw new TypeError('offline');
    if(pathname === '/auth/v1/token' && search.includes('grant_type=password')) {
      if(body.password !== 'pass') return send(400,{error_code:'invalid_credentials'});
      return send(200,tokens(body.email,api.expiresIn));
    }
    if(pathname === '/auth/v1/token' && search.includes('grant_type=refresh_token')) {
      if(api.refreshDenied) return send(400,{error_code:'refresh_token_not_found'});
      return send(200,tokens(body.refresh_token.slice(4),3600));
    }
    if(pathname === '/auth/v1/logout') return send(204,null);
    if(!options.headers.Authorization?.startsWith('Bearer jwt:'))return send(401,{});
    const account=options.headers.Authorization.slice('Bearer jwt:'.length);
    const row=api.records.get(account)||{revision:0,document:null};
    if(pathname === '/rest/v1/rpc/jornada_leer') return send(200,{revision:row.revision, document:row.document});
    assert.equal(pathname,'/rest/v1/rpc/jornada_guardar');
    if(row.revision === body.p_revision){
      api.records.set(account,{revision:row.revision+1,document:body.p_document,last:body.p_operation});
    }else if(!(row.revision===body.p_revision+1 && row.last===body.p_operation && JSON.stringify(row.document)===JSON.stringify(body.p_document))){
      return send(409,{code:'PT409'});
    }
    if(api.droppedWrites>0) {api.droppedWrites--;throw new Error('Respuesta interrumpida después del guardado');}
    return send(200,body.p_revision+1);
  };
  return api;
}

test('Sin configuración o sin transporte compatible se detiene antes de habilitar el espacio',async()=>{
  for(const settings of [{},{supabaseUrl:config.supabaseUrl},{...config,supabasePublishableKey:'sb_secret_ejemplo'},null]) {
    const app=openTab(()=>assert.fail('Se llamó a la red sin configuración'),settings);
    await assert.rejects(app.store.boot(),matchesCode('CONFIG'));
    await assert.rejects(app.store.signIn('x','pass'),matchesCode('CONFIG'));
    await assert.rejects(app.store.save(app.model.empty()),matchesCode('AUTH'));
    assert.deepEqual([app.legacy.reads,app.legacy.writes,app.legacy.removals],[0,0,0]);
  }
  await assert.rejects(openTab(undefined).store.boot(),matchesCode('CONFIG'));
});

test('Una cuenta nueva inicia en blanco y sólo crea una fila en la primera edición guardada',async()=>{
  const api=service(),app=openTab(api.fetch);
  assert.equal((await app.store.boot()).mode,'auth');
  assert.equal(api.requests.length,0);
  await assert.rejects(app.store.signIn('ana','incorrecta'),matchesCode('CREDENTIALS'));
  const {state,mode,user}=await app.store.signIn('ana','pass');
  assert.equal(mode,'cloud');assert.equal(user.email,'ana');
  assert.deepEqual(copy(state),{version:1,goals:[],tasks:[]});
  assert.equal(api.records.size,0);
  const row=app.model.task({title:'Gestionar expediente reservado',date:'2026-11-12'});
  state.tasks.push(row);
  await app.store.save(state);
  assert.deepEqual(api.records.get('ana').document,copy(state));
  assert.deepEqual([app.legacy.reads,app.legacy.writes,app.legacy.removals],[0,0,0]);
  assert.equal(app.credentials.entries.size,1);
  for(const raw of app.credentials.entries.values()) {
    const stored=JSON.parse(raw);
    assert.deepEqual(Object.keys(stored).sort(),['access_token','expires_at','refresh_token','user']);
    assert.ok(!raw.includes(row.title));assert.ok(!raw.includes(row.id));
  }
  const renewed=openTab(api.fetch,config,app.credentials);
  const existing=await renewed.store.boot();
  assert.deepEqual(copy(existing.state),copy(state));
  assert.equal(api.records.get('ana').revision,1);
});

test('Bajo corte de red o lectura incompatible no se habilita una agenda vacía ni se sobrescribe la remota',async()=>{
  const api=service(),app=openTab(api.fetch);
  const original={version:1,goals:[],tasks:[app.model.task({title:'Antecedente'})],futureMetadata:{ref:'estable'}};
  api.records.set('ana',{revision:7,document:original});
  api.offline=true;
  await assert.rejects(app.store.signIn('ana','pass'),matchesCode('NETWORK'));
  api.offline=false;
  assert.deepEqual(copy((await app.store.signIn('ana','pass')).state),copy(original));
  const restored=openTab(api.fetch,config,app.credentials);
  api.offline=true;
  await assert.rejects(restored.store.boot(),matchesCode('NETWORK'));
  await assert.rejects(restored.store.save(restored.model.empty()),matchesCode('AUTH'));
  api.offline=false;
  assert.equal((await restored.store.boot()).state.tasks.length,1);
  assert.equal(api.records.get('ana').revision,7);
  const corrupt={version:1,goals:[],tasks:[{id:'a'}]};
  api.records.set('ana',{revision:8,document:corrupt});
  await assert.rejects(restored.store.boot(),matchesCode('DATA'));
  await assert.rejects(restored.store.save(restored.model.empty()),matchesCode('AUTH'));
  assert.equal(api.records.get('ana').revision,8);
  assert.equal(api.requests.filter(r=>r.pathname.endsWith('guardar')).length,0);
});

test('Reintentos de una confirmación perdida usan el mismo id y una pestaña desactualizada recibe conflicto',async()=>{
  const api=service(),one=openTab(api.fetch),two=openTab(api.fetch);
  const state=(await one.store.signIn('ana','pass')).state;
  const old=(await two.store.signIn('ana','pass')).state;
  state.tasks.push(one.model.task({title:'Cierre'}));
  api.droppedWrites=2;
  await assert.rejects(one.store.save(state),matchesCode('NETWORK'));
  assert.equal(api.records.get('ana').revision,1);
  await one.store.save(state);
  assert.equal(api.records.get('ana').revision,1);
  const sent=api.requests.filter(x=>x.pathname.endsWith('guardar'));
  assert.equal(sent.length,3);assert.equal(new Set(sent.map(x=>x.body.p_operation)).size,1);
  old.tasks.push(two.model.task({title:'Desde otra pestaña'}));
  await assert.rejects(two.store.save(old),matchesCode('CONFLICT'));
  assert.equal((await two.store.boot()).state.tasks[0].title,'Cierre');
});

test('Renovación, cierre normal o sin conexión y cambio de cuenta conservan el aislamiento',async()=>{
  const api=service(),tab=openTab(api.fetch);api.expiresIn=-1;
  const previous=(await tab.store.signIn('ana','pass')).state;
  assert.ok(api.requests.some(r=>r.search.includes('grant_type=refresh_token')));
  previous.tasks.push(tab.model.task({title:'Sólo Ana'}));
  await tab.store.save(previous);
  await tab.store.signOut();assert.equal(tab.credentials.entries.size,0);
  api.expiresIn=3600;
  assert.equal((await tab.store.signIn('otra','pass')).state.tasks.length,0);
  api.offline=true;
  assert.equal((await tab.store.signOut()).mode,'auth');
  assert.equal(tab.credentials.entries.size,0);
  assert.equal((await tab.store.boot()).mode,'auth');
  assert.equal(api.records.get('ana').document.tasks[0].title,'Sólo Ana');
  assert.equal(api.records.has('otra'),false);
});

test('Una renovación denegada quita credenciales de la pestaña y exige ingreso',async()=>{
  const api=service(),tab=openTab(api.fetch);api.expiresIn=-1;api.refreshDenied=true;
  await assert.rejects(tab.store.signIn('ana','pass'),matchesCode('AUTH'));
  assert.equal((await tab.store.boot()).mode,'auth');assert.equal(tab.credentials.entries.size,0);
  assert.equal(api.records.size,0);
});

test('El perfil opcional se conserva con el historial en Supabase y jamás pasa a las credenciales de la pestaña',async()=>{
  const api=service(),app=openTab(api.fetch),other=openTab(api.fetch);
  const original=app.model.empty();
  original.tasks.push(app.model.task({title:'Seguimiento histórico'}));
  original.goals.push({id:'a',title:'Reporte',description:'',color:'#336699',status:'En curso',result:'',achievedOn:''});
  const dateSnapshot=copy(original);
  api.records.set('ana',{revision:5,document:dateSnapshot});
  const state=(await app.store.signIn('ana','pass')).state;
  assert.equal(state.profile,undefined);
  const jpeg='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAEAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCVAPTT/9k=';
  assert.equal(app.model.validProfilePhoto(jpeg),true);
  const updates={name:'Ana Pérez',photo:jpeg};
  app.model.saveProfile(state,{},updates);
  await app.store.save(state);
  const loaded=(await openTab(api.fetch,config,app.credentials).store.boot()).state;
  assert.deepEqual(copy(loaded.profile),updates);
  assert.deepEqual(copy(loaded.tasks),dateSnapshot.tasks);
  assert.deepEqual(copy(loaded.goals),dateSnapshot.goals);
  assert.equal(api.records.get('ana').revision,6);
  assert.equal((await other.store.signIn('otra','pass')).state.profile,undefined);
  assert.deepEqual([app.legacy.reads,app.legacy.writes,app.legacy.removals],[0,0,0]);
  for(const raw of app.credentials.entries.values()) {assert.ok(!raw.includes(jpeg));assert.ok(!raw.includes(updates.name));}
  assert.throws(()=>app.model.saveProfile(state,{},updates),/cambió/);
  for(const bad of ['https://servidor.invalid/foto.jpg','data:image/svg+xml,<svg/>','data:image/jpeg;base64,/9j/AABB',
    'data:image/jpeg;base64,/9j/'+ 'A'.repeat(100000)]) {
    assert.throws(()=>app.model.saveProfile(state,updates,{name:'Ana',photo:bad}),/JPEG/);
    assert.deepEqual(copy(state.profile),updates);
  }
  app.model.saveProfile(state,updates,{name:'Ana',photo:''});
  await app.store.save(state);
  assert.equal(api.records.get('ana').document.profile.photo,'');
  assert.deepEqual(api.records.get('ana').document.tasks,dateSnapshot.tasks);
});

test('El saldo se solicita con la sesión de su titular y no se reintenta para otra cuenta',async()=>{
  const api=service(), bodies=[];
  let release, mode='ok';
  const summary={ref:null,model:'',sample:0,average:null,spent:0,missing:0,balance:null,count:null};
  const app=openTab(async(url,options)=>{
    if (!url.endsWith('/workhub_chat_budget_sync')) return api.fetch(url,options);
    bodies.push([options.headers.Authorization,JSON.parse(options.body)]);
    if (mode==='wait') await new Promise(resolve=>{release=resolve;});
    if (mode==='disconnect') throw new Error('offline');
    if (mode==='missing') return {status:404,ok:false,text:async()=>'{}'};
    return {status:200,ok:true,text:async()=>JSON.stringify(summary)};
  });
  await app.store.signIn('ana','pass');
  await assert.rejects(app.store.syncChatBudget('id-otra'),matchesCode('AUTH'));
  assert.equal(bodies.length,0);
  assert.deepEqual(copy(await app.store.syncChatBudget('id-ana')),summary);
  assert.deepEqual(bodies[0],['Bearer jwt:ana',{p_reference:null,p_entries:[]}]);
  mode='missing';
  await assert.rejects(app.store.syncChatBudget('id-ana'),e=>e.code==='CONFIG' && e.message.includes('chat-budget.sql'));
  mode='wait';
  const inFlight=app.store.syncChatBudget('id-ana',{reference:{usd:6,at:10,changedAt:11}});
  await app.store.signOut(); await app.store.signIn('otra','pass');
  mode='disconnect'; release();
  await assert.rejects(inFlight,matchesCode('AUTH'));
  assert.equal(bodies.length,3);
  assert.deepEqual(bodies.at(-1),['Bearer jwt:ana',{p_reference:{usd:6,at:10,changedAt:11},p_entries:[]}]);
  mode='ok';
  assert.deepEqual(copy(await app.store.syncChatBudget('id-otra')),summary);
});
