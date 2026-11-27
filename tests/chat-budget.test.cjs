const test = require('node:test');
const assert = require('node:assert/strict');
const {createTracker} = require('../assets/chat-budget.js');
class Storage {
  constructor() { this.data = new Map(); }
  get length() { return this.data.size; }
  key(i) { return [...this.data.keys()][i]; }
  getItem(k) { return this.data.get(k) ?? null; }
  setItem(k,v) { this.data.set(k,v); }
}
const tracked = (cost, model = 'model-a') => ({complete:true, rounds:2, costUsd:cost, model});
function fixture(storage = new Storage()) {
  let now = 1000;
  const t = createTracker(storage, () => now);
  const tick = () => { now += 100; };
  const add = (id,cost,model,outcome) => { tick(); t.record('a',id,tracked(cost,model),outcome); };
  return {t, storage, tick, add};
}
test('requires a real balance and enough successful samples; all charged requests reduce funds',() => {
  const {t,add} = fixture();
  assert.equal(t.state('a').count,null);
  add('q1',.25); add('q2',.25);
  t.setReference('a',4); add('bad',.25,'model-a','error');
  assert.equal(t.state('a').count,null);
  add('q3',.25);
  assert.equal(t.state('a').sample,3); assert.equal(t.state('a').balance,3.5); assert.equal(t.state('a').count,14);
  assert.equal(t.state('b').ref,null);
});
test('deduplicates by attempt, including across tabs; independent attempts survive interleaved writes',() => {
  const {t,storage,add} = fixture();
  const remote = createTracker(storage,() => 1300);
  t.setReference('a',5); add('1',.4);
  remote.record('a','2',tracked(.3));
  t.record('a','1',tracked(.4)); remote.record('a','1',{complete:false,knownCostUsd:.1},'error');
  assert.equal(t.state('a').spent,.7); assert.equal(t.state('a').sample,2); assert.equal(t.state('a').missing,0);
  assert.deepEqual(t.state('a'),remote.state('a'));
});
test('incomplete estimates pause until final usage or user reconciles; charges after a backdated balance remain',() => {
  const {t,tick,add} = fixture(); t.setReference('a',2);
  tick(); t.record('a','?1',{model:'model-a',complete:false,knownCostUsd:.07},'error');
  assert.equal(t.state('a').balance,null); assert.equal(t.state('a').count,null);
  t.record('a','?1',tracked(.1),'error'); assert.equal(t.state('a').balance,1.9);
  tick(); t.record('a','?2',{complete:false},'error'); assert.equal(t.state('a').missing,1);
  add('3',.25); t.setReference('a',1,1200);
  assert.equal(t.state('a').balance,.75); assert.equal(t.state('a').missing,0);
});
test('uses up to 30 successful queries for the latest model and updates across model switches',() => {
  const {t,add} = fixture(); t.setReference('a',100);
  for (let i=0;i<31;i++) add('Q'+i,i === 0 ? .8 : .25);
  assert.equal(t.state('a').average,.25); assert.equal(t.state('a').sample,30);
  add('other',.5,'model-b'); assert.equal(t.state('a').count,null); assert.equal(t.state('a').sample,1);
});
test('invalid and zero balance, unavailable persistence, and unbilled rejections',() => {
  const {t,add} = fixture(null);
  assert.equal(t.setReference('a',-1),false); assert.equal(t.setReference('a',1,5000),false);
  assert.equal(t.setReference('a',0),true); assert.equal(t.state('a').count,0); assert.equal(t.transient(),true);
  t.record('a','failure',{complete:true,rounds:0,costUsd:0},'error');
  t.record('a','rejected',{complete:false,rounds:0,costUsd:null},'error'); add('ok',.001);
  assert.equal(t.state('a').missing,0);
  assert.equal(t.state('a').sample,1); assert.equal(t.state('a').count,0);
});

test('roundoff at an exact decimal number of queries does not lose one',() => {
  const {t,add} = fixture();
  for (let i=0;i<3;i++) add(String(i),.1);
  t.setReference('a',.3);
  assert.equal(t.state('a').count,3);
});
