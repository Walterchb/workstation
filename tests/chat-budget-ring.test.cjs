const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync(require.resolve('../assets/chat-budget.js'),'utf8');
const {createTracker} = require('../assets/chat-budget.js');
const receipt = costUsd => ({complete:true, rounds:1, costUsd, model:'test-model'});

function fixture() {
  const rows = new Map();
  const storage = {
    get length() { return rows.size; },
    key: index => [...rows.keys()][index],
    getItem: key => rows.get(key) ?? null,
    setItem: (key,value) => rows.set(key,value)
  };
  const window = {
    localStorage:storage,
    addEventListener(){},
    document:{addEventListener(){},querySelectorAll:()=>[]}
  };
  vm.runInNewContext(script,{window});
  const chat = window.WorkStationChatBudget;
  // La misma persistencia permite verificar saldos registrados en versiones anteriores.
  const tracker = createTracker(storage,() => 1000);
  chat.setUser('work');
  return {chat,tracker};
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

test('el anillo refleja el saldo con cortes inclusivos en 15 y 50, aun sin historial de consultas',()=>{
  for (const [spent,level,pct] of [
    [0,'high',100],[.49,'high',51],[.50,'medium',50],[.85,'medium',15],
    [.8501,'low',14.99],[1,'low',0],[1.25,'low',0]
  ]) {
    const {tracker,chat} = fixture();
    tracker.setReference('work',1);
    if (spent) chat.record('work','a',receipt(spent));
    widget(chat,level,pct);
  }
});

test('saldo pendiente de configurar o con cargos sin medir y saldo cero son estados distintos',()=>{
  const {tracker,chat} = fixture();
  widget(chat,'unknown');
  tracker.setReference('work',0);
  widget(chat,'low',0);
  tracker.setReference('work',5);
  chat.markUnknown('work','desconocido');
  widget(chat,'unknown');
  chat.record('work','desconocido',receipt(.5));
  widget(chat,'high',90);
});

test('la pestaña expresa los créditos estimados en singular y plural y el widget conserva el acceso a saldo',()=>{
  const {tracker,chat} = fixture();
  for (const id of ['1','2','3']) tracker.record('work',id,receipt(.25));
  tracker.setReference('work',1);
  const label = () => chat.header().replace(/<[^>]*>/g,'').trim();
  assert.equal(label(),'4 créditos');
  widget(chat,'high',100);
  tracker.setReference('work',.25);
  assert.equal(label(),'1 crédito');
  chat.setUser('otra');
  widget(chat,'unknown');
  chat.setUser('work');
  assert.equal(label(),'1 crédito');
});
