const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync(require.resolve('../assets/chat-budget.js'),'utf8');
const {createTracker} = require('../assets/chat-budget.js');
const {MemoryStorage,testCloud} = require('./fixtures/chat-budget-cloud.cjs');
const receipt = costUsd => ({complete:true, rounds:1, costUsd, model:'test-model'});

async function fixture() {
  const storage = new MemoryStorage();
  const cloud = testCloud();
  const listeners = new Map(), docListeners = new Map(), timers = new Map();
  const window = {
    localStorage:storage,
    JStore:{syncChatBudget:cloud.exchange},
    addEventListener:(event,handler)=>listeners.set(event,handler),
    setInterval:(fn,ms)=>{timers.set(ms,fn); return ms;},
    clearInterval:id=>timers.delete(id),
    document:{addEventListener:(event,handler)=>docListeners.set(event,handler),querySelectorAll:()=>[]}
  };
  vm.runInNewContext(script,{window});
  const chat = window.WorkStationChatBudget;
  // La misma persistencia permite verificar saldos registrados en versiones anteriores.
  const tracker = createTracker(storage,() => 1000);
  await chat.setUser('work');
  return {chat,tracker,cloud,listeners,docListeners,timers,document:window.document};
}

function widget(chat,expectedLevel,expectedPercent) {
  const html = chat.header('widget');
  const button = html.match(/<button\b[^>]*>/)?.[0];
  assert.ok(button,html);
  assert.match(button,/data-chat-budget-open/);
  assert.match(button,/data-chat-budget-ring/);
  assert.match(button,/aria-label="[^"]+"/);
  assert.match(button,new RegExp('data-level="'+expectedLevel+'"'));
  assert.equal(html.replace(/<[^>]*>/g,'').trim(),'');
  if (expectedPercent != null) {
    const value = button.match(/--remaining:\s*([\d.]+)%/);
    assert.ok(value,html);
    assert.ok(Math.abs(Number(value[1])-expectedPercent)<1e-6,html);
  }
}

test('el anillo refleja el saldo con cortes inclusivos en 15 y 50, aun sin historial de consultas',async ()=>{
  for (const [spent,level,pct] of [
    [0,'high',100],[.49,'high',51],[.50,'medium',50],[.85,'medium',15],
    [.8501,'low',14.99],[1,'low',0],[1.25,'low',0]
  ]) {
    const {tracker,chat} = await fixture();
    tracker.setReference('work',1);
    if (spent) await chat.record('work','a',receipt(spent));
    await chat.sync();
    widget(chat,level,pct);
  }
});

test('saldo pendiente de configurar o con cargos sin medir y saldo cero son estados distintos',async ()=>{
  const {tracker,chat} = await fixture();
  widget(chat,'unknown');
  tracker.setReference('work',0);
  await chat.sync();
  widget(chat,'low',0);
  tracker.setReference('work',5);
  await chat.markUnknown('work','desconocido');
  widget(chat,'unknown');
  await chat.record('work','desconocido',receipt(.5));
  widget(chat,'high',90);
});

test('la pestaña expresa los créditos estimados en singular y plural y el widget conserva el acceso a saldo',async ()=>{
  const {tracker,chat} = await fixture();
  for (const id of ['1','2','3']) tracker.record('work',id,receipt(.25));
  tracker.setReference('work',1);
  const label = () => chat.header().replace(/<[^>]*>/g,'').trim();
  await chat.sync();
  assert.equal(label(),'4 créditos');
  widget(chat,'high',100);
  tracker.setReference('work',.25);
  await chat.sync();
  assert.equal(label(),'1 crédito');
  await chat.setUser('otra');
  widget(chat,'unknown');
  await chat.setUser('work');
  assert.equal(label(),'1 crédito');
});

test('el saldo remoto se consulta al enfocar, abrir el widget, reconectar y periódicamente mientras hay sesión visible',async ()=>{
  const {chat,cloud,listeners,docListeners,timers,document} = await fixture();
  assert.equal(timers.size,1);
  await cloud.exchange('work',{reference:{usd:5,at:100,changedAt:110},entries:[]});
  widget(chat,'unknown');
  await listeners.get('focus')(); widget(chat,'high',100);
  const mutate = async (id,usd) => cloud.exchange('work',{entries:[{id,at:200,usd,complete:true,ok:true,model:'m'}]});
  await mutate('otro',1);
  const click = docListeners.get('click');
  await click({target:{closest:selector=>selector.includes('[data-chat-launcher]')}}); widget(chat,'high',80);
  await mutate('otro2',2); await [...timers.values()][0](); widget(chat,'medium',40);
  await mutate('otro3',.5); await listeners.get('online')(); widget(chat,'medium',30);
  document.visibilityState = 'hidden'; const n = cloud.calls.length;
  await [...timers.values()][0](); assert.equal(cloud.calls.length,n);
  document.visibilityState = 'visible'; await docListeners.get('visibilitychange')(); assert.equal(cloud.calls.length,n+1);
  await chat.setUser(null); assert.equal(timers.size,0); assert.equal(chat.header('widget'),'');
});
