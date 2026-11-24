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

test('El informe resume la ejecución real y distingue las actividades de los espacios', () => {
  const tasks = [
    row('Cerrada por estado', {status:'Culminado',comment:'Se envió el acta.'}),
    row('Confirmada', {done:true}),
    row('Tramo cerrado', {segments:time('08:00','08:30')}),
    row('En proceso por estado', {status:'En proceso',done:true}),
    row('Tramo abierto', {segments:time('14:00',''),done:true}),
    row('Pendiente con comentario', {comment:'Solicitar insumo',priority:'Alta'}),
    row('Imprevista sin empezar', {origin:'Imprevista'}),
    row('Espacio de almuerzo', {kind:'space',goalId:'',segments:time('13:00','14:00')}),
    row('Otro día', {date:'2026-11-25'})
  ];
  const state = {...model.empty(), goals:[goal], tasks};
  const report = insights.makeReport(state,range,'day');
  assert.deepEqual(report.sections.map(s=>s.title),['Cierres documentados','Ejecución por objetivo general','Prioridades de seguimiento']);
  assert.deepEqual(report.sections[0].rows, [[tasks[0].title,tasks[0].comment]]);
  assert.deepEqual(report.sections[1].rows, [[goal.title,'30 min','2','3','2']]);
  assert.equal(report.sections[2].rows.length,3);
  assert.match(report.sections[2].subtitle,/3 de 5 registros abiertos/);
  assert.deepEqual(report.sections[2].rows[0],[tasks[5].title,goal.title,'Sin iniciar','Alta']);
  assert.equal(report.metrics[0].value,'1 h 30 min');
  assert.equal(report.metrics[0].note,'30 min de actividades · 1 h de espacios');
  assert.equal(report.metrics[1].value,'50%');
  assert.equal(report.metrics[2].note,'1 actividad imprevista');
  assert.doesNotMatch(JSON.stringify(report),/Otro día|Espacio de almuerzo|Solicitar insumo/);
});

test('Los períodos vacíos y las jornadas con sólo espacios resumen el total sin tablas vacías', () => {
  const tasks = [row('Almuerzo', {kind:'space', goalId:'', segments:time('12:45','13:30')})];
  for (const list of [[],tasks]) {
    const report = insights.makeReport({...model.empty(),tasks:list},range,'week');
    assert.ok(report.takeaway);
    assert.equal(report.metrics[0].value,list.length ? '45 min' : '0 min');
    assert.equal(report.metrics[1].value,'—');
    assert.deepEqual(report.sections,[]);
  }
});

test('El resumen conserva las horas y etapas de todos los objetivos, incluso al agrupar', () => {
  const goals = Array.from({length:19},(_,i)=>({...goal,id:'g'+i,title:'Objetivo '+String(i).padStart(2,'0')}));
  const tasks = goals.flatMap(g=>[
    row(g.id+'a',{title:'Cuadrar saldo',goalId:g.id,segments:time('08:00','08:01')}),
    row(g.id+'b',{title:'Aprobar cierre',goalId:g.id,done:true}),
    row(g.id+'c',{title:'Revisar el corte',goalId:g.id})
  ]);
  tasks.push(row('Anterior sin objetivo',{goalId:'',segments:time('10:00','10:45')}));
  for (const period of ['day','week','month','custom']) {
    const report = insights.makeReport({...model.empty(),goals,tasks},range,period);
    const rows = report.sections.find(s=>s.title==='Ejecución por objetivo general').rows;
    assert.equal(rows.length,6);
    assert.deepEqual(rows[4],['Otros objetivos (15)','15 min','15','15','15']);
    assert.deepEqual(rows[5],['Sin objetivo general asignado','45 min','0','1','0']);
    assert.equal(report.metrics[0].value,'1 h 4 min');
    for (const [column,expected] of [[2,19],[3,20],[4,19]]) {
      assert.equal(rows.reduce((n,r)=>n+Number(r[column]),0),expected);
    }
  }
});

test('Los resultados deben estar confirmados y el informe indica la cobertura de sus extractos', () => {
  const goals = Array.from({length:6},(_,i)=>({...goal,id:'g'+i,title:'Objetivo '+i,
    status:'Alcanzado',achievedOn:'2026-11-'+(10+i),result:'Resultado '+i+' '+('texto largo '.repeat(1000))}));
  goals.push({...goal,status:'En curso',result:'Expectativa aún no confirmada'});
  const tasks = [row('A',{comment:'Comentario no confirmado',done:true}),row('B',{priority:'Alta'}),
    row('B2',{title:'B',priority:'Alta'}),row('C',{priority:'Media'}),row('D',{priority:'Baja'})];
  const report = insights.makeReport({...model.empty(),goals,tasks},{from:'2026-11-01',to:date},'month');
  const confirmed = report.sections[0];
  assert.equal(confirmed.title,'Resultados confirmados');
  assert.equal(confirmed.rows.length,3);
  assert.equal(confirmed.rows[0][1],'Objetivo 5');
  assert.match(confirmed.rows[0][2],/…$/);
  assert.match(confirmed.subtitle,/3 más recientes de 6/);
  assert.doesNotMatch(JSON.stringify(report),/Expectativa aún no confirmada|Comentario no confirmado/);
  assert.deepEqual(report.sections.at(-1).rows.map(r=>r[0]),['B','C','D']);
});
