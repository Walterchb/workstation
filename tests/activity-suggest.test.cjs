'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../assets/model.js');
require('../assets/activity-suggest.js');
const {history,matches} = globalThis.JActivitySuggest;
const model = globalThis.JModel;

test('El título puede coincidir sin tildes e identificar variantes del detalle de fila',() => {
  const state = model.empty();
  state.goals = [{id:'a',title:'Mercados'},{id:'b',title:'Proyectos'}];
  const common = {date:'2026-04-24',title:'Revisión de términos',goalId:'a',priority:'Alta',origin:'Imprevista',
    category:'Coordinación',done:true,status:'Culminado',segments:[{start:'11:00',end:'12:00'}],context:'origen',comment:'privado'};
  state.tasks = [model.task(common),model.task({...common,date:'2026-03-01',context:'otro'}),
    model.task({...common,goalId:'b'}),model.task({...common,kind:'space'}),model.task({...common,title:'Preparar revisión de términos'})];
  const results = matches(history(state),'revision de ter');
  assert.equal(results.length,3);
  assert.deepEqual(results.map(x=>x.goal),['Mercados','Proyectos','Mercados']);
  assert.equal(results[0].date,'2026-04-24');
  assert.deepEqual(results[0].details,{title:common.title,goalId:'a',category:'Coordinación',priority:'Alta',origin:'Imprevista'});
  assert.equal(matches(history(state),'TÉRMINOS rev').length,3);
  assert.deepEqual(matches(history(state),' '),[]);
});

test('Cada cuenta aporta su propio historial y al reutilizar sólo se aplican valores disponibles',() => {
  const state = model.empty();
  state.categories = model.categoryList(state).map(item=>({...item,archived:item.title==='Coordinación'}));
  state.tasks = [model.task({title:'Compilar',goalId:'borrado',category:'Coordinación'})];
  assert.deepEqual(history(state)[0].details,{title:'Compilar',goalId:'',category:model.defaultCategory(state),priority:'Media',origin:'Planificada'});
  assert.deepEqual(matches(history(model.empty()),'Compilar'),[]);
  assert.equal(state.tasks[0].category,'Coordinación');
});
