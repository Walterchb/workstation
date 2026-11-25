'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../assets/model.js');
require('../assets/calendar-model.js');
const model = globalThis.JCalendarModel;
const empty = globalThis.JModel.empty;
const token = digit => digit.repeat(64);
const calendar = (state,id) => model.calendars(state).find(item=>item.id === id);

test('Activar enlaces por categoría materializa una agenda anterior y conserva separadas las suscripciones', () => {
  const state = empty();
  const work = model.setCategoryToken(state,'work','gestion',token('1'));
  assert.equal(model.getCategoryToken(work,'gestion'),token('1'));
  assert.deepEqual(work.appleCategoryTokens,{'c:gestion':token('1')});
  assert.ok(state.eventCategories.some(category=>category.id === 'gestion'));
  assert.equal(state.events,undefined);
  model.setCategoryToken(state,'personal','gestion',token('2'));
  model.setCategoryToken(state,'work','',token('3'));
  model.saveCalendar(state,{id:'work',appleToken:token('4'),name:'Oficina'});
  const snapshot = JSON.stringify(state);
  model.setCategoryToken(state,'work','gestion',token('1'));
  assert.equal(JSON.stringify(state),snapshot);
  model.validate(JSON.parse(snapshot));
  model.saveCalendar(state,{id:'work',appleToken:null});
  assert.equal(model.getCategoryToken(calendar(state,'work'),'gestion'),token('1'));
  assert.equal(model.getCategoryToken(calendar(state,'work'),''),token('3'));
  model.setCategoryToken(state,'work','gestion',null);
  assert.deepEqual(calendar(state,'work').appleCategoryTokens,{'c:':token('3')});
  assert.equal(model.getCategoryToken(calendar(state,'personal'),'gestion'),token('2'));
  model.setCategoryToken(state,'work','',null);
  assert.equal(Object.hasOwn(calendar(state,'work'),'appleCategoryTokens'),false);
  assert.equal(model.getCategoryToken(calendar(state,'work'),''),undefined);
});

test('No se pueden compartir tokens entre ámbitos ni guardar suscripciones inválidas parcialmente', () => {
  const state = empty();
  model.saveCalendar(state,{id:'work',appleToken:token('1')});
  model.setCategoryToken(state,'personal','',token('2'));
  model.setCategoryToken(state,'personal','tramites',token('3'));
  const snapshot = structuredClone(state);
  assert.throws(()=>model.setCategoryToken(state,'personal','gestion',token('1')),/propio enlace/);
  assert.throws(()=>model.setCategoryToken(state,'work','tramites',token('3')),/propio enlace/);
  assert.throws(()=>model.saveCalendar(state,{id:'work',appleToken:token('2')}),/propio enlace/);
  for (const invalid of [undefined,42,'',token('g'),'a'.repeat(63)]) {
    assert.throws(()=>model.setCategoryToken(state,'work','gestion',invalid),/suscripción/);
  }
  assert.throws(()=>model.setCategoryToken(state,'work','desconocida',token('4')),/categoría/);
  assert.throws(()=>model.setCategoryToken(state,'eliminado','gestion',token('4')),/calendario/);
  assert.deepEqual(state,snapshot);
  for (const invalid of [null,[],7,{'gestion':token('6')},{'c:desconocida':token('6')},{'c:':'abc'}]) {
    const copy = structuredClone(state);
    copy.calendars[0].appleCategoryTokens = invalid;
    assert.throws(()=>model.validate(copy),/suscripción/);
  }
});

test('Eliminar y recrear una categoría o un calendario no reactiva los enlaces anteriores', () => {
  const state = empty();
  model.saveCategory(state,{id:'__proto__', name:'Prueba', color:'#123456'});
  model.saveCalendar(state,{id:'work',appleToken:token('a')});
  model.setCategoryToken(state,'work','__proto__',token('b'));
  model.setCategoryToken(state,'personal','__proto__',token('c'));
  model.setCategoryToken(state,'personal','gestion',token('d'));
  model.saveCategory(state,{id:'__proto__',name:'Renombrada',color:'#543210'});
  assert.equal(model.getCategoryToken(calendar(state,'personal'),'__proto__'),token('c'));
  assert.ok(Object.hasOwn(calendar(state,'work').appleCategoryTokens,'c:__proto__'));
  model.removeCategory(state,'__proto__');
  model.saveCategory(state,{id:'__proto__',name:'Nueva',color:'#FFFFFF'});
  assert.equal(model.getCategoryToken(calendar(state,'work'),'__proto__'),undefined);
  assert.equal(model.getCategoryToken(calendar(state,'personal'),'__proto__'),undefined);
  assert.equal(calendar(state,'work').appleToken,token('a'));
  assert.equal(model.getCategoryToken(calendar(state,'personal'),'gestion'),token('d'));
  model.removeCalendar(state,'personal');
  model.saveCalendar(state,{id:'personal',name:'Otro',color:'#111111'});
  assert.equal(model.getCategoryToken(calendar(state,'personal'),'gestion'),undefined);
});
