import assert from 'node:assert/strict';
import test from 'node:test';
import {queryWorkspace} from '../supabase/functions/workhub-chat/context.mjs';

const search=(doc,query={},scope='tasks')=>queryWorkspace(doc,query,scope,'2026-11-26');
const task=(id,title,changes={})=>({id,title,kind:'activity',status:'En proceso',date:'2026-11-23',
  context:'',comment:'',segments:[],...changes});
const ids=page=>page.records.map(row=>row.id);

test('Busca siglas y nombres completos en ambos sentidos; no confunde siglas cortas con fragmentos',()=>{
  const doc={tasks:[
    task('direct','Representante de los obligacionistas'),task('alias','Cambio de representante',{comment:'Se consultó al RO.'}),
    task('false','Proceso de aprobación en trámite'),task('letters','Consolidar EE.FF.')
  ]};
  const full=search(doc,{text:'Representante de los obligacionistas'});
  assert.deepEqual(ids(full),['direct','alias']);
  assert.deepEqual(full.records[1].matchedFields,['comment']);
  assert.deepEqual(full.records[1].matchedEquivalents,['ro']);
  assert.deepEqual(ids(search(doc,{text:'RO'})),['alias','direct']);
  assert.deepEqual(ids(search(doc,{text:'estados financieros'})),['letters']);
  const long=search({tasks:[task('long','Consulta',{comment:'Proceso anterior. '.repeat(100)+'Se consultó al RO.'})]},
    {text:'representante de los obligacionistas'});
  assert.match(long.records[0].comment,/Se consultó al RO/);
});

test('El detalle conserva el comentario, estado y cita verificables; palabras equivalentes anclan el extracto',()=>{
  const comment='Texto anterior. '.repeat(120)+'A la espera del acta. '+'Otro detalle. '.repeat(30);
  const doc={tasks:[task('x','Revisar compromisos',{comment,status:'Culminado'})]};
  const page=search(doc,{text:'seguimiento'});
  assert.equal(page.total,1);
  assert.ok(page.records[0].matchedEquivalents.includes('a la espera'));
  assert.match(page.records[0].comment,/A la espera del acta/);
  assert.deepEqual(page.summary.taskStatus,{Culminado:1});
  assert.equal(search(doc,{type:'task',id:'x'}).records[0].comment,comment);
  const short=search(doc,{type:'task',id:'x',detail:false}).records[0];
  assert.ok(short.comment.length<comment.length && short.excerptFields.includes('comment'));
  assert.equal(search(doc,{text:'en espera',status:'abierto'}).total,0);
});

test('Por relevancia se prioriza el campo del título y el literal sobre la equivalencia; el orden temporal explícito prevalece',()=>{
  const doc={tasks:[task('old','Informe de cartera',{date:'2026-11-21'}),task('new','Revisar cierre',{date:'2026-11-25',comment:'Proyecto de informe.'}),
    task('syn','Reporte de cartera',{date:'2026-11-23'})]};
  assert.deepEqual(ids(search(doc,{text:'informe',order:'relevance'})),['old','new','syn']);
  assert.deepEqual(ids(search(doc,{text:'informe',order:'desc'})),['new','syn','old']);
  assert.deepEqual(ids(search(doc,{text:'informe',order:'asc'})),['old','syn','new']);
});

test('Busca solicitudes de validación o revisión como indicios, mantiene los entregables distintos y excluye un envío sin solicitud',()=>{
  const tasks=[
    task('contrato','Revisar expediente',{context:'Contrato',comment:'Se remitió a Legal para validación.',status:'Culminado'}),
    task('cierre','Revisar expediente',{context:'Cierre del mes',comment:'Se remitió a Contabilidad para su revisión.'}),
    task('consulta','Requerimiento',{comment:'Se solicitó una respuesta a Tesorería.'}),
    task('literal','Responder',{comment:'Esperando respuesta.'}),
    task('archivo','Archivo',{comment:'Se remitió una copia del acta.'}),
    task('modelo','Modelo',{comment:'Se remitió un saludo. Preparar una ficha para revisión.'})
  ];
  for (const text of ['esperando respuesta','pendiente de respuesta']) {
    const page=search({tasks},{text});
    assert.equal(page.total,4);
    assert.equal(page.records[0].id,'literal');
    assert.deepEqual(new Set(ids(page)),new Set(['contrato','cierre','consulta','literal']));
    const contract=page.records.find(row=>row.id==='contrato');
    assert.deepEqual(contract.matchedSignals,['para validacion']);
    assert.equal(contract.status,'Culminado');
    const close=page.records.find(row=>row.id==='cierre');
    assert.deepEqual(close.matchedSignals,['para su revision']);
    assert.notEqual(close.context,contract.context);
    assert.equal(close.status,'En proceso');
  }
});

test('Una búsqueda sin coincidencias sugiere términos parciales dentro de filtros; las sugerencias no integran los totales',()=>{
  const doc={tasks:[task('t','Reporte de proveedores',{segments:[{start:'10:00',end:'12:00'}]}),
    task('older','Secretaría municipal',{date:'2026-10-01'})],notes:[{id:'n',title:'Secretaría',body:'Reporte de proveedores de la municipalidad'}]};
  const result=search(doc,{text:'informe secretaría',from:'2026-11-01'});
  assert.equal(result.total,0);assert.deepEqual(result.records,[]);assert.equal(result.summary.taskMinutes,0);
  assert.deepEqual(result.suggestions,[{text:'informe',reason:'partial_terms'}]);
  assert.equal(search(doc,{text:'palabra inexistente'}).suggestions[0].reason,'review_scope_dates_or_search_without_terms');
});

test('Paginación con relevancia estable, conteo único por actividad, sin falsa coincidencia ni pérdida de agregados',()=>{
  const fragment={start:'08:00',end:'08:15'};
  const tasks=Array.from({length:20},(_,i)=>task('id'+String(i).padStart(2,'0'),i%3?'Revisar informe':'Preparar detalle',{comment:'Revisar el reporte',segments:[fragment,fragment]}));
  const doc={tasks:[...tasks,tasks[5],task('false','Solamente revisar'),task('other','Solo informe')]};
  let offset=0;const found=[];
  while(offset!==null){
    const current=search(doc,{text:'revisar informe',order:'relevance',offset});
    assert.equal(current.total,20);assert.equal(current.summary.taskMinutes,20*30);
    found.push(...ids(current));offset=current.nextOffset;
  }
  assert.equal(new Set(found).size,20);
  assert.deepEqual(ids(search({tasks:[...doc.tasks].reverse()},{text:'revisar informe'})),found.slice(0,8));
});

test('Reformulaciones de vocabulario nuevo recuperan una unión acotada y trazable sin contar dos veces ni incorporar resultados parciales',()=>{
  const slot=[{start:'09:00',end:'09:15'}];
  const tasks=[
    task('original','Bitácora',{comment:'Ajuste del sidéreo',date:'2026-11-20',segments:slot}),
    task('alternativa','Puesta en estación',{comment:'Alineación polar',segments:slot}),
    task('parcial','Puesta de letreros',{comment:'Ajuste del trípode'}),
    task('ambas','Ajuste sidéreo',{comment:'Puesta en estación. Alineación polar.',segments:slot}),
    task('cerrado','Alineación polar',{status:'Culminado'}),
    task('viejo','Alineación polar',{date:'2026-09-15'}),
    task('cuarta','Calibración de montura'),
  ];
  const doc={tasks:[...tasks,tasks[1]],notes:[{id:'n',title:'Alineación polar'}]};
  const base={text:'ajuste sidéreo',from:'2026-11-01',status:'En proceso'};
  const alternatives=[' ','de y','AJUSTE SIDÉREO','puesta en estación','alineación polar','colimación celeste','calibración de montura'];
  const result=search(doc,{...base,alternatives});
  assert.deepEqual(ids(result),['ambas','original','alternativa']);
  assert.equal(result.summary.taskMinutes,45);
  assert.deepEqual(result.summary.counts,{task:3,space:0,goal:0,note:0,event:0});
  assert.equal(result.records[2].matchedQuery,'puesta en estacion');
  assert.equal(result.records[0].matchedQuery,undefined);
  assert.deepEqual(search(doc,{...base,alternatives:['','AJUSTE SIDÉREO']}),search(doc,base));
  assert.deepEqual(ids(search(doc,{...base,alternatives,order:'asc'}))[0],'original');
  const none=search(doc,{text:'colimación lunar',alternatives:['espectro de hidrógeno','puesta diamantina']});
  assert.equal(none.total,0);
  assert.deepEqual(none.suggestions,[{text:'',reason:'review_scope_dates_or_search_without_terms'}]);
  const calendars=search({calendars:[{id:'one',name:'Sesiones sidéreas'},{id:'two',name:'Alineación polar'}]},
    {type:'calendars',text:'sidéreas',alternatives:['alineación polar']},'all');
  assert.equal(calendars.total,2);
  assert.deepEqual(calendars.summary.entries.map(entry=>entry.name),['Sesiones sidéreas','Alineación polar']);
});
