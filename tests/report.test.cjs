'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
global.window = globalThis;
require('../assets/model');
require('../assets/insights');

const date = '2026-11-24';
const range = {from:date, to:date};
const model = globalThis.JModel;
const insights = globalThis.JInsights;
const goal = {
  id:'cierre', title:'Cierre mensual', description:'', color:'#176D69',
  status:'En curso', achievedOn:'', result:''
};
const row = (id, options={}) => model.task({id, title:id, date, goalId:goal.id, ...options});
const time = (start, end) => [{start, end}];

test('El informe asigna cada actividad a una etapa y distingue la planificación del avance', () => {
  const tasks = [
    row('Cerrada por estado', {status:'Culminado'}),
    row('Confirmada', {done:true}),
    row('Tramo cerrado', {segments:time('08:00','08:30')}),
    row('En proceso por estado', {status:'En proceso',done:true}),
    row('Tramo abierto', {segments:time('14:00',''),done:true}),
    row('Pendiente con comentario', {comment:'Solicitar información al área de riesgos'}),
    row('Imprevista sin empezar', {origin:'Imprevista'}),
    row('Espacio de almuerzo', {kind:'space',goalId:'',segments:time('13:00','14:00')}),
    row('Otro día', {date:'2026-11-25'})
  ];
  const state = {...model.empty(), goals:[goal], tasks};
  const report = insights.makeReport(state,range,'day');
  const groups = report.sections.filter(section=>section.group === 'activities');
  assert.deepEqual(groups.map(section=>section.stage), ['completed','started','pending']);
  assert.deepEqual(groups.map(section=>section.rows.map(r=>r[0])),[
    ['Cerrada por estado','Confirmada'], ['Tramo cerrado','En proceso por estado','Tramo abierto'],
    ['Pendiente con comentario','Imprevista sin empezar']
  ]);
  assert.equal(groups[2].columns.at(-1),'Comentarios de planificación');
  assert.equal(groups[2].rows[0].at(-1),tasks[5].comment);
  assert.equal(report.sections.find(s=>s.title==='Prioridades de seguimiento').rows.length,5);
  assert.deepEqual(report.sections.find(s=>s.title==='Dedicación por objetivo general').rows[0], [
    goal.title,'30 min','100%','2','3','2'
  ]);
  assert.equal(report.metrics[0].value,'1 h 30 min');
  assert.equal(report.metrics[1].value,'50%');
  assert.equal(report.metrics[2].note,'1 actividad imprevista');
  assert.equal(report.sections.find(s=>s.title==='Espacios sin objetivo').rows[0][0],tasks[7].title);
});

test('Una jornada con espacios contabiliza sus horas sin crear actividad ni cumplimiento', () => {
  const tasks = [row('Almuerzo', {kind:'space', goalId:'', segments:time('12:45','13:30')})];
  const report = insights.makeReport({...model.empty(),tasks},range,'week');
  assert.equal(report.metrics[0].value,'45 min');
  assert.equal(report.metrics[1].value,'—');
  assert.equal(report.metrics[2].value,'0 min');
  assert.deepEqual(report.sections.map(s=>s.title), ['Balance por jornada','Espacios sin objetivo']);
  assert.equal(report.sections[0].rows[0].at(-1),'45 min');
  assert.equal(report.sections[1].rows[0][3],'45 min');
});

test('Una actividad anterior sin objetivo conserva sus horas como actividad', () => {
  const tasks = [row('Revisar posición', {goalId:'', segments:time('08:00','08:45')})];
  const report = insights.makeReport({...model.empty(),tasks},range,'day');
  assert.equal(report.metrics[0].value,'45 min');
  assert.equal(report.sections.find(s=>s.group==='activities').title,'Sin objetivo general asignado');
  assert.equal(report.sections.some(s=>s.title==='Espacios sin objetivo'),false);
});
