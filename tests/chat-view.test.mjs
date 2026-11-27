import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {queryWorkspace} from '../supabase/functions/workhub-chat/context.mjs';
import {parseViewSelection} from '../supabase/functions/workhub-chat/view-filter.mjs';

const code = fs.readFileSync(new URL('../assets/chat-view.js',import.meta.url),'utf8');
const window = {JAgenda:{getMode:()=>'week'}, JWeek:{range:()=>({start:'2028-02-28',end:'2028-03-05'})},
  JInsights:{chatPeriod:()=>({from:'2027-12-04',to:'2028-01-07'}),chatGoal:()=>'~goal'}};
vm.runInNewContext(code,{window});
const stage = (fields={}, list=[]) => ({querySelector:key=>fields[key],querySelectorAll:()=>list});
const activeMode = {'[data-wc-mode][aria-pressed="true"]':{dataset:{wcMode:'month'}}};
const calendar = (id,checked) => ({checked,dataset:{wcVisible:id},closest:()=>({textContent:'Igual nombre'})});

test('el chat lee el período aplicado, cruces de año/mes, y filtros por ID incluso con etiquetas idénticas',()=>{
  const date = '2028-02-29';
  let info = window.JChatView.read('calendar',date,stage(activeMode,[calendar('one',false),calendar('two',true)]));
  assert.equal(info.to,'2028-02-29'); assert.equal(info.from,'2028-02-01');
  assert.deepEqual([...info.selection.ids],['two']); assert.equal(info.selection.mode,'include');
  info=window.JChatView.read('analysis',date,stage());
  assert.equal(info.from,'2027-12-04'); assert.equal(info.to,'2028-01-07');
  info=window.JChatView.read('agenda',date,stage({'[data-jd-goal-filter]':{value:'~~goal', selectedOptions:[{textContent:'Revisiones'}]}}));
  assert.equal(info.selection.goalId,'~goal'); assert.equal(info.to,'2028-03-05');
  assert.equal(window.JChatView.read('notes',date,stage()).from,undefined);
});

const doc = {
  goals:[{id:'g',title:'Objetivo'}],
  tasks:[{id:'a',title:'Revisar',goalId:'g',status:'Pendiente'},{id:'b',title:'Revisar',goalId:'eliminado'},{id:'s',kind:'space',title:'Almuerzo'}],
  calendars:[{id:'uno',name:'Igual'},{id:'dos',name:'Igual'}],
  events:[{id:'e1',title:'Consulta',calendarId:'uno'},{id:'e2',title:'Consulta',calendarId:'dos'}]
};
const ids = selection=>queryWorkspace(doc,{type:'all',selection:parseViewSelection(selection)}).records.map(row=>row.id).sort();
test('los filtros estructurados limitan los registros antes de calcular totales',()=>{
  assert.deepEqual(ids({kind:'agenda',taskKind:'space'}),['s']);
  assert.deepEqual(ids({kind:'agenda',taskKind:'unassigned'}),['b']);
  assert.deepEqual(ids({kind:'agenda',goalId:'g',status:'Pendiente'}),['a']);
  assert.deepEqual(ids({kind:'calendar',mode:'include',ids:[]}),[]);
  assert.deepEqual(ids({kind:'calendar',mode:'exclude',ids:['uno']}),['e2']);
  assert.deepEqual(ids({kind:'goals',goalId:'g'}),['a','g']);
  assert.throws(()=>parseViewSelection({kind:'calendar',mode:'include',ids:'dos'}));
  const partial=queryWorkspace(doc,{type:'event',selection:{kind:'calendar',mode:'partial'}});
  assert.ok(partial.error); assert.equal(partial.total,undefined);
});

test('la referencia del chat en Mes sigue el calendario Workhub efectivo incluso sin eventos',()=>{
  const virtual='source:activities';
  window.JCalendarModel={activityCalendar:{id:virtual}};
  window.JWorkCalendar={visibleCalendarIds:(state,mode)=>state[mode]};
  const inputs=[calendar('one',true),calendar('two',true),calendar(virtual,true)];
  const getInfo=(list,mode='month')=>window.JChatView.read('calendar','2028-02-29',
    stage({'[data-wc-mode][aria-pressed="true"]':{dataset:{wcMode:mode}}},inputs),{[mode]:list});
  const info=getInfo(['two']);
  assert.equal(info.selection.mode,'include');
  assert.deepEqual([...info.selection.ids],['two']);
  const empty=getInfo([]);
  assert.equal(empty.selection.mode,'include');
  assert.deepEqual([...empty.selection.ids],[]);
  assert.equal(getInfo([virtual],'day').selection.kind,'agenda');
});

test('Calendario · Semana comunica sus fechas y el objetivo activo aunque cruce el año',()=>{
  const virtual='source:activities';
  window.JCalendarWeek={range:()=>({start:'2026-12-28',end:'2027-01-03'})};
  window.JCalendarModel={activityCalendar:{id:virtual}};
  window.JWorkCalendar={
    visibleCalendarIds:(state,mode)=>state[mode],
    selectedCategory:()=>({id:'goal:g',kind:'goal',name:'Informe'})
  };
  const fields={'[data-wc-mode][aria-pressed="true"]':{dataset:{wcMode:'week'}}};
  const info=window.JChatView.read('calendar','2027-01-01',stage(fields,[calendar(virtual,true)]),{week:[virtual]});
  assert.equal(info.view,'Calendario · Semana');
  assert.equal(info.from,'2026-12-28');
  assert.equal(info.to,'2027-01-03');
  assert.equal(info.selection.goalId,'g');
  assert.ok(info.filters.includes('Objetivo visible: Informe'));
});
