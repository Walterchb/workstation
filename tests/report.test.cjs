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
  assert.deepEqual(report.sections.map(s=>s.title),['Seguimiento por actividad','Ejecución por objetivo general','Prioridades de seguimiento']);
  const history = report.sections[0].rows;
  assert.deepEqual(history.map(r=>r[2]),[tasks[0].comment,tasks[5].comment]);
  assert.match(history[0][1],/24 nov\nCulminada$/);
  assert.match(history[1][1],/24 nov\nSin iniciar$/);
  assert.deepEqual(report.sections[1].rows, [[goal.title,'30 min','2','3','2']]);
  assert.equal(report.sections[2].rows.length,3);
  assert.match(report.sections[2].subtitle,/3 de 5 registros abiertos/);
  assert.deepEqual(report.sections[2].rows[0],[tasks[5].title,goal.title,'Sin iniciar','Alta']);
  assert.equal(report.metrics[0].value,'1 h 30 min');
  assert.equal(report.metrics[0].note,'30 min de actividades · 1 h de espacios');
  assert.equal(report.metrics[1].value,'50%');
  assert.equal(report.metrics[2].note,'1 actividad imprevista');
  assert.doesNotMatch(JSON.stringify(report),/Otro día|Espacio de almuerzo/);
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
  const confirmed = report.sections.find(s=>s.title==='Resultados confirmados');
  assert.equal(confirmed.title,'Resultados confirmados');
  assert.equal(confirmed.rows.length,3);
  assert.equal(confirmed.rows[0][1],'Objetivo 5');
  assert.match(confirmed.rows[0][2],/…$/);
  assert.match(confirmed.subtitle,/3 más recientes de 6/);
  assert.doesNotMatch(JSON.stringify(report),/Expectativa aún no confirmada/);
  assert.doesNotMatch(JSON.stringify(confirmed),/Comentario no confirmado/);
  assert.deepEqual(report.sections[0].rows.map(r=>r[2]),['Comentario no confirmado']);
  assert.deepEqual(report.sections.at(-1).rows.map(r=>r[0]),['B','C','D']);
});


test('El seguimiento agrupa por objetivo y actividad, conserva comentarios individuales y diferencia las observaciones previas al inicio', () => {
  const other = {...goal,id:'g2',title:'Auditoría'};
  const rows = [
    row('r5',{title:'Revisar cartera',comment:'Se envió el sustento.',date:'2026-11-24',status:'Culminado'}),
    row('r2',{title:'Revisar cartera',comment:'Falta la respuesta de Riesgos.',date:'2026-11-21'}),
    row('r3',{title:'Revisar cartera',comment:'Se acordó el nuevo corte.',date:'2026-11-21',status:'En proceso'}),
    row('r1',{title:'  REVISAR   CARTERA ',comment:'Se recibió la primera versión.',date:'2026-11-20',status:'En proceso'}),
    row('r4',{goalId:other.id,title:'Revisar cartera',comment:'Observación del auditor.'}),
    row('r6',{title:'Plan sin comentario',comment:' '}),
    row('s',{title:'Almuerzo',kind:'space',goalId:'',comment:'Pausa'}),
    row('out',{title:'Anterior',date:'2026-11-19',comment:'Comentario fuera del período.'})
  ];
  const state={...model.empty(),goals:[goal,other],tasks:rows};
  const {sections,abbreviatedComments}=insights.makeReport(state,{from:'2026-11-20',to:date},'week');
  assert.equal(abbreviatedComments,false);
  const section=sections[0];
  assert.deepEqual(section.joins,[false,true,true,true,false]);
  assert.deepEqual(section.rows.map(r=>r[2]),[rows[3].comment,rows[1].comment,rows[2].comment,rows[0].comment,rows[4].comment]);
  assert.match(section.rows[1][1],/21 nov\nSin iniciar/);
  assert.match(section.rows[2][1],/21 nov\nIniciada/);
  assert.ok(section.rows.slice(0,4).every(r=>r[0].endsWith(goal.title)));
  assert.ok(section.rows[4][0].endsWith(other.title));
  assert.doesNotMatch(JSON.stringify(section),/Plan sin comentario|Pausa|Comentario fuera/);
});

test('La selección conserva el primer y último día y el historial conserva todos los textos completos', () => {
  const rows=Array.from({length:17},(_,i)=>row('r'+i,{title:'Conciliar el ROF',date:model.shiftDate(date,i-16),
    comment:'Entrega '+i+' '+(i===4 ? 'Detalle mensual '.repeat(28)+'Fin del comentario' : 'validada.'),status:'En proceso'}));
  const state={...model.empty(),goals:[goal],tasks:rows.reverse()};
  const range={from:'2026-11-01',to:date};
  const summary=insights.makeReport(state,range,'month');
  assert.equal(summary.abbreviatedComments,true);
  const exec=summary.sections[0];
  assert.equal(exec.rows.length,8);
  assert.match(exec.subtitle,/8 de 17 comentarios/);
  assert.match(exec.rows[0][2],/^Entrega 0 /);
  assert.match(exec.rows.at(-1)[2],/^Entrega 16 /);
  const all=insights.makeReport(state,range,'month',null,true);
  assert.equal(all.sections[0].rows.length,17);
  assert.match(all.sections[0].rows[4][2],/Fin del comentario$/);
  assert.equal(all.abbreviatedComments,false);
  const day=insights.makeReport(state,{from:rows[12].date,to:rows[12].date},'day');
  assert.equal(day.abbreviatedComments,true);
  assert.equal(day.sections[0].rows[0][2].endsWith('…'),true);
  assert.match(day.sections[0].subtitle,/textos largos/);
  assert.deepEqual(all.metrics,summary.metrics);
});
