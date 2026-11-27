const test = require('node:test');
const assert = require('node:assert/strict');
const {createAccountBudget,createTracker} = require('../assets/chat-budget.js');
const {MemoryStorage,testCloud} = require('./fixtures/chat-budget-cloud.cjs');
const usage = usd => ({complete:true,model:'chat',costUsd:usd,rounds:1});
const legacyKey = user => 'workstation:chat-budget:1::'+user+':';

function device(exchange,storage = new MemoryStorage()) {
  let clock = 1000;
  const queue = createTracker(storage,() => ++clock);
  const account = createAccountBudget(queue,exchange,() => {});
  return {account,queue,storage};
}

test('dos equipos comparten el saldo confirmado, las consultas concurrentes, la corrección de referencia y la recarga',async () => {
  const cloud = testCloud();
  const {account:a} = device(cloud.exchange), {account:b} = device(cloud.exchange);
  await Promise.all([a.setUser('ana'),b.setUser('ana')]);
  a.setReference('ana',10,500);
  await a.sync(); await b.sync();
  assert.equal(b.state().balance,10);
  await Promise.all([a.record('ana','pc',usage(1)),b.record('ana','movil',usage(2))]);
  await Promise.all([a.record('ana','duplicada',usage(1)),b.record('ana','duplicada',usage(1))]);
  await Promise.all([a.sync(),b.sync()]);
  assert.equal(a.state().balance,6);
  assert.equal(a.state().count,4);
  assert.deepEqual(a.state(),b.state());
  b.setReference('ana',14,400);
  await b.sync(); await a.sync();
  assert.equal(a.state().ref.at,400); assert.equal(a.state().balance,10);
});

test('un equipo migra una vez el historial anterior en lotes, sin reemplazar la referencia más reciente de la cuenta',async () => {
  const cloud = testCloud();
  const {account:work} = device(cloud.exchange);
  await work.setUser('ana'); work.setReference('ana',150,500); await work.sync();
  const storage = new MemoryStorage();
  storage.setItem(legacyKey('ana')+'ref',JSON.stringify({usd:1,at:200}));
  for (let i=0;i<205;i++) {
    storage.setItem(legacyKey('ana')+'q:'+i,JSON.stringify({id:String(i),at:600+i,usd:.25,complete:true,ok:true,model:'chat'}));
  }
  const browser = device(cloud.exchange,storage);
  cloud.calls.length = 0;
  await browser.account.setUser('ana');
  assert.deepEqual(cloud.calls.map(call=>call.entries),[100,100,5]);
  assert.equal(browser.account.state().balance,98.75);
  assert.equal(storage.length,0);
  await browser.account.sync();
  assert.equal(cloud.calls.at(-1).entries,0);
  assert.equal(cloud.accounts.get('ana').entries.size,205);
  assert.equal(browser.account.state().sample,30);
});

test('un corte de red conserva la cola incluso tras cerrar y reabrir, y no permite confundir un saldo local con el confirmado',async () => {
  const cloud = testCloud(), storage = new MemoryStorage();
  let online = true;
  const exchange = async (user,batch) => {
    // La primera transacción llega a destino, pero el cliente pierde la respuesta.
    const snapshot = await cloud.exchange(user,batch);
    if (!online) throw new Error('Sin conexión');
    return snapshot;
  };
  const {account:a} = device(exchange,storage);
  await a.setUser('ana');
  a.setReference('ana',5,100); await a.sync();
  online = false;
  await a.record('ana','reintento',usage(1));
  assert.equal(a.state().sync,'offline');
  assert.equal(storage.length,1);
  await a.setUser(null);
  const {account:b} = device(exchange,storage);
  online = true;
  await b.setUser('ana');
  assert.equal(b.state().balance,4);
  assert.equal(cloud.accounts.get('ana').entries.size,1);
  assert.equal(storage.length,0);
});

test('una respuesta tardía después de cambiar de cuenta mantiene la separación y se reintenta solo para su dueño',async () => {
  const cloud = testCloud(), storage = new MemoryStorage();
  let allow, started;
  const inflight = new Promise(r => { started = r; });
  const hold = new Promise(r => { allow = r; });
  const {account,queue} = device(async (user,batch) => {
    const snapshot = await cloud.exchange(user,batch);
    if (user === 'ana' && batch.entries.length) { started(); await hold; }
    return snapshot;
  },storage);
  await account.setUser('ana'); account.setReference('ana',5,200); await account.sync();
  const old = account.record('ana','original',usage(1));
  await inflight; await account.setUser('bea');
  assert.equal(account.state().ref,null);
  account.record('ana','tardia',usage(.25));
  await account.record('bea','original',usage(.5));
  allow(); await old;
  assert.equal(account.state().ref,null);
  assert.equal(account.state().spent,.5);
  assert.equal(queue.pending('ana').payload.entries.length,2);
  await account.setUser(null);
  assert.equal(account.state().spent,0);
  await account.setUser('ana');
  assert.equal(account.state().balance,3.75);
  assert.equal(cloud.accounts.get('bea').entries.size,1);
  assert.equal(queue.pending('ana').payload.entries.length,0);
});

test('un comprobante parcial se completa mientras el primer lote está en tránsito, sin borrar el importe final',async () => {
  const cloud = testCloud();
  let started, allow;
  const pending = new Promise(resolve=>{started=resolve;});
  const hold = new Promise(resolve=>{allow=resolve;});
  const {account} = device(async (user,batch) => {
    const snapshot = await cloud.exchange(user,batch);
    if (batch.entries.some(row=>!row.complete)) { started(); await hold; }
    return snapshot;
  });
  await account.setUser('ana'); account.setReference('ana',5,200); await account.sync();
  const prior = account.record('ana','1',{complete:false},'error');
  await pending;
  const later = account.record('ana','1',usage(.75)); allow();
  await Promise.all([prior,later]);
  assert.equal(account.state().balance,4.25);
  assert.equal(account.state().missing,0);
  assert.equal(cloud.accounts.get('ana').entries.size,1);
});

test('un RPC ausente se distingue de un saldo sin definir y los cambios se reintentan al instalarlo',async () => {
  const cloud = testCloud(); let installed = false;
  const {account} = device((user,batch) => {
    if (!installed) throw Object.assign(new Error(),{code:'CONFIG'});
    return cloud.exchange(user,batch);
  });
  await account.setUser('ana'); account.setReference('ana',2,500); await account.sync();
  assert.equal(account.state().problem,'setup');
  assert.equal(account.state().sync,'offline');
  installed = true; await account.sync();
  assert.equal(account.state().balance,2);
  assert.equal(account.state().count,null);
});

test('cerrar la web antes de recibir el coste deja el intento pendiente; un rechazo sin consumo restituye el saldo',async () => {
  const cloud = testCloud();
  const {account:a} = device(cloud.exchange), {account:b} = device(cloud.exchange);
  await a.setUser('ana'); a.setReference('ana',4,100); await a.sync();
  await a.beginAttempt('ana','en-curso');
  assert.equal(a.state().inProgress,true);
  await b.setUser('ana');
  assert.equal(b.state().inProgress,false);
  assert.equal(b.state().balance,null);
  await a.settleUnbilled('ana','en-curso');
  await b.sync();
  assert.equal(a.state().inProgress,false);
  assert.equal(b.state().missing,0);
  assert.equal(b.state().balance,4);
  assert.equal(b.state().sample,0);
  await b.beginAttempt('ana','completa');
  await b.record('ana','completa',usage(.5));
  await a.sync(); assert.equal(a.state().balance,3.5);
});
