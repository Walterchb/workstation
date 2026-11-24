'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../assets/model.js');
require('../assets/sheet-model.js');
const model = globalThis.JModel;
const sheet = globalThis.JSheetModel;
const date = '2026-11-24';

function lunch() {
  return model.task({kind:'space', date, title:'Almuerzo', segments:[{start:'13:00',end:'14:00'}]});
}

test('El espacio computa su tiempo y admite un tramo abierto, sin permitir solapamientos ni objetivos', () => {
  const state = model.empty();
  const draft = sheet.createDraft(state,date);
  const meal = sheet.insertRow(draft,0,lunch());
  sheet.applyDay(state,draft);
  assert.equal(model.minutes(state.tasks[0]),60);
  assert.equal(state.tasks[0].kind,'space');
  meal.segments.push({start:'14:10',end:''});
  const log = sheet.createDraft(state,date);
  log.rows[0] = meal;
  sheet.applyDay(state,log);
  assert.equal(state.tasks[0].status,'En proceso');
  state.tasks.push(model.task({date,title:'Revisar el informe',segments:[{start:'13:45',end:'14:10'}]}));
  assert.throws(() => model.validate(state), /superponen/);
  state.tasks.pop();
  state.goals.push({id:'g',title:'Cierre',description:'',color:'#087F79',status:'En curso',achievedOn:'',result:''});
  state.tasks[0].goalId = 'g';
  assert.throws(() => model.validate(state), /espacio.*objetivo/i);
});

test('Al reutilizar se distingue una actividad antigua sin objetivo de un espacio con el mismo nombre', () => {
  const state = model.empty();
  const meal = lunch(), ordinary = model.task({date,title:'Almuerzo'});
  delete ordinary.kind;
  state.tasks = [ordinary,meal];
  const next = model.shiftDate(date,1);
  assert.equal(model.reuseActivities(state,date,next,new Set([ordinary.id,meal.id])),2);
  const copies = state.tasks.filter(row=>row.date === next);
  assert.deepEqual(copies.map(row=>[row.kind,row.goalId,row.segments]),[['activity','',[]],['space','',[]]]);
  assert.equal(model.reuseActivities(state,date,next,new Set([meal.id])),0);
  assert.doesNotThrow(() => model.validate(state));
});

test('Las hojas copiadas para Excel conservan el tipo y aceptan también las ocho columnas anteriores', () => {
  const state = model.empty();
  const draft = sheet.createDraft(state,date);
  const header = ['Estado','Actividades','Contexto','¿Se hizo?','Hora de inicio','Hora de cierre','Duración','Comentarios'];
  const values = ['Culminado','Almuerzo','','Sí','13:00','14:00','1:00',''];
  sheet.paste(draft,0,1,[[...header,'Tipo de fila'],[...values,'Espacio sin objetivo']]);
  sheet.paste(draft,1,1,[header,['Pendiente','Revisar ROF','','No','','','','']]);
  sheet.applyDay(state,draft);
  assert.deepEqual(state.tasks.map(row=>[row.kind,model.minutes(row)]),[['space',60],['activity',0]]);
  const snapshot = structuredClone(draft.rows);
  assert.throws(() => sheet.paste(draft,0,0,[[...header,'Tipo de fila'],[...values,'x']]), /Tipo de fila/);
  assert.deepEqual(draft.rows,snapshot);
});
