'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../assets/model.js');
const model = globalThis.JModel;

const session = (start, end) => ({ start, end });
const activity = (segments = [], options = {}) => model.task({
  date: '2026-09-30', title: 'Revisar expediente', segments, ...options
});
const agenda = (...tasks) => ({ ...model.empty(), tasks });

test('El calendario conserva la fecha civil de Lima al cruzar medianoche UTC', () => {
  const beforeMidnight = new Date('2026-11-20T04:59:00.000Z');
  const midnight = new Date('2026-11-20T05:00:00.000Z');
  assert.equal(model.today(beforeMidnight), '2026-11-19');
  assert.equal(model.timeNow(beforeMidnight), '23:59');
  assert.equal(model.today(midnight), '2026-11-20');
  assert.equal(model.timeNow(midnight), '00:00');
  assert.equal(model.shiftDate('2024-03-01', -1), '2024-02-29');
  assert.equal(model.shiftDate('2026-12-31', 1), '2027-01-01');
});

test('Una actividad reanudada acumula exclusivamente tramos cerrados', () => {
  const row = activity([session('10:30','12:20'), session('13:20','14:00'), session('15:15','')], {
    status: 'En proceso', done: true
  });
  assert.doesNotThrow(() => model.validate(agenda(row)));
  assert.equal(model.minutes(row), 150);
  assert.equal(model.duration(model.minutes(row)), '2 h 30 min');
  assert.equal(model.duration(10), '10 min');
  assert.equal(model.duration(120), '2 h');
  assert.equal(model.duration(0), '0 min');
});

test('Cruces dentro de una actividad y entre actividades se rechazan independientemente del orden', () => {
  assert.throws(() => model.validate(agenda(activity([session('10:00','11:00'), session('09:59','10:04')]))), /superponen/);
  assert.throws(() => model.validate(agenda(activity([session('10:00','11:00')]), activity([session('09:50','10:20')]))), /superponen/);
  assert.throws(() => model.validate(agenda(activity([session('08:00','')]), activity([session('09:00','10:00')]))), /superponen/);
  assert.doesNotThrow(() => model.validate(agenda(activity([session('10:00','11:00')]), activity([session('11:00','12:00')]))));
  assert.doesNotThrow(() => model.validate(agenda(activity([session('10:00','11:00')]), activity([session('10:00','11:00')], {date:'2026-10-01'}))));
});

test('Sólo hay un cronómetro abierto incluso en días distintos', () => {
  assert.throws(() => model.validate(agenda(activity([session('10:00','')]), activity([session('11:00','')], {date:'2026-10-01'}))), /tramo abierto/);
});

test('Se rechazan fechas inexistentes, formatos horarios inválidos y tramos invertidos o vacíos', () => {
  assert.throws(() => model.validate(agenda(activity([], {date:'2026-02-29'}))), /fecha/);
  for (const [start, end] of [['24:00',''],['09:61','10:00'],[['01:00'],'04:00'],['09:00','09:00'],['16:00','08:00'],['08:00','25:00']]) {
    assert.throws(() => model.validate(agenda(activity([session(start, end)]))), /hora/);
  }
});

test('Un objetivo eliminado no deja referencias huérfanas ni se infiere un logro sin resultado', () => {
  assert.throws(() => model.validate(agenda(activity([], {goalId:'inexistente'}))), /objetivo/);
  const state = model.empty();
  state.goals.push({id:'objetivo', title:'Emitir bonos', description:'', status:'Alcanzado', color:'#227777', achievedOn:'2026-10-01', result:''});
  assert.throws(() => model.validate(state), /resultado/);
  state.goals[0].result = 'Emisión completada';
  assert.doesNotThrow(() => model.validate(state));
});

test('Una cuenta nueva tiene objetivos y actividades vacíos con categorías disponibles', () => {
  const state = model.empty();
  assert.deepEqual(state, {version:1, goals:[], tasks:[]});
  assert.doesNotThrow(() => model.validate(state));
  assert.ok(model.categoryList(state).some(category => category.isDefault && !category.archived));
  assert.deepEqual(model.empty(), state);
});

test('Cada actividad inicial tiene su propio arreglo de tramos y un identificador único', () => {
  const first = model.task();
  const second = model.task();
  first.segments.push(session('08:00','08:15'));
  assert.deepEqual(second.segments, []);
  assert.notEqual(first.id, second.id);
  assert.throws(() => model.validate(agenda(activity([], {id:'misma'}),activity([], {id:'misma'}))), /duplicado/);
});

test('Reutilizar copia las filas seleccionadas en su orden, una vez y sin alterar el historial', () => {
  const first = activity([session('08:00','08:15')], {
    title:'Validar ROF', context:'Conciliar por producto', origin:'Imprevista', done:true,
    comment:'Se envió el reporte', status:'Culminado', priority:'Alta', category:'Mercado de capitales', goalId:'cierre'
  });
  const equivalent = activity([], {...first, id:model.id(), title:'  VALIDAR   ROF  ', segments:[]});
  const other = activity([], {title:first.title, context:'Atender observaciones', goalId:'cierre'});
  const sameTextNewGoal = activity([], {title:first.title, context:first.context});
  const next = '2026-10-01';
  const alreadyHere = activity([], {...other,id:model.id(),date:next});
  const state = agenda(first, equivalent, other, sameTextNewGoal, alreadyHere);
  state.goals.push({id:'cierre', title:'Cierre mensual', description:'', color:'#227777', status:'En curso', achievedOn:'', result:''});
  const original = structuredClone(state.tasks);
  const candidates = model.reusableActivities(state,first.date,next);
  assert.deepEqual(candidates.map(row=>row.reason),['','Repetida en el día de origen','Ya está en esta jornada','']);
  const chosen = new Set([sameTextNewGoal.id, equivalent.id, other.id, first.id]);
  assert.equal(model.reuseActivities(state, first.date, next, chosen), 2);
  assert.deepEqual(state.tasks.slice(0,original.length), original);
  const [a,b] = state.tasks.slice(original.length);
  assert.equal(a.goalId, first.goalId);
  assert.equal(b.goalId, '');
  for (const key of ['title','context','priority','category']) assert.equal(a[key],first[key]);
  assert.notEqual(a.id, first.id);
  assert.deepEqual([a.date,a.origin,a.status,a.done,a.comment,a.segments],[next,'Planificada','Pendiente',false,'',[]]);
  assert.equal(model.reuseActivities(state,first.date,next,chosen),0);
  assert.equal(model.reuseActivities(state,next,first.date,new Set([alreadyHere.id])),0);
  assert.doesNotThrow(()=>model.validate(state));
});
