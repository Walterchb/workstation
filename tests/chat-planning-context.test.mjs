import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPlanningContext,planningAppointment} from '../supabase/functions/workhub-chat/planning-context.mjs';
import {queryWorkspace} from '../supabase/functions/workhub-chat/context.mjs';

const opts={today:'2028-03-09',targetFrom:'2028-03-10'};
function result(doc,extra={}) {
  const refs=[];
  const pack=buildPlanningContext(doc,{...opts,...extra},row=>{
    const {id,...data}=row;
    const index=refs.findIndex(ref=>ref.id===id && ref.type===row.type);
    const number=index<0 ? refs.push({id,type:row.type}) : index+1;
    return {...data,_source:number};
  });
  return {pack,refs};
}
function task(id,date,title,context,comment,params={}) {
  return {id,date,title,context,comment,status:'Culminado',done:true,segments:[],...params};
}

test('separa la agenda de mañana de las jornadas previas y conserva relectura por fuente, alcance y espacios',()=>{
  const doc={goals:[],tasks:[
    task('uno','2028-03-07','Catálogo','Norte','Pedido al distribuidor.',{segments:[{start:'09:00',end:'09:15'}]}),
    task('dos','2028-03-09','Catálogo','Norte','Respondieron y aprobaron el primer lote.'),
    task('tres','2028-03-09','Catálogo','Sur','Falta confirmar el inventario.'),
    task('espacio','2028-03-10','Descanso','','',{kind:'space',segments:[{start:'12:00',end:'13:00'}]}),
    task('posterior','2028-03-11','Secreto posterior','','Fin inexistente al corte.')],
    events:[
      {id:'visita',title:'Visita',startDate:'2028-03-09',endDate:'2028-03-10',startTime:'23:00',endTime:'01:00'},
      {id:'medianoche',title:'Anterior',startDate:'2028-03-09',endDate:'2028-03-10',startTime:'22:00',endTime:'00:00'}
    ]};
  const {pack,refs}=result(doc);
  assert.equal(pack.target.counts.space,1);assert.equal(pack.target.counts.event,1);
  assert.ok(!JSON.stringify(pack).includes('Secreto posterior'));
  const comments=pack.history.records.map(row=>row.comment);
  assert.ok(comments.includes('Pedido al distribuidor.'));assert.ok(comments.includes('Respondieron y aprobaron el primer lote.'));
  assert.ok(comments.includes('Falta confirmar el inventario.'));
  for (const row of [...pack.history.records,...pack.target.records]) {
    const ref=refs[row._source-1];
    assert.equal(queryWorkspace(doc,{type:ref.type,id:ref.id}).records[0].title,row.title);
  }
  const restricted=result(doc,{scope:'calendar'}).pack;
  assert.equal(restricted.history.counts.task,0);
  assert.equal(restricted.target.counts.space,0);
  assert.equal(result(doc,{selection:{kind:'agenda',taskKind:'space'}}).pack.target.total,1);
});

test('la última resolución corta y la evidencia previa viajan juntas bajo el límite de tamaño',()=>{
  const noise=Array.from({length:110},(_,i)=>task('other'+i,'2028-03-09','Otra labor '+i,'Contexto '+i,'Documentación revisada '.repeat(56)));
  const doc={tasks:[
    task('a','2028-03-08','Revisión de planos','Ladera','Se solicitó completar la documentación del estudio. '.repeat(22)),
    task('b','2028-03-09','Revisión de planos','Ladera','Aprobado.'),
    ...noise.reverse()]};
  const {pack}=result(doc);
  assert.ok(pack.history.records.some(row=>row.title==='Revisión de planos' && row.date==='2028-03-08' && row.fieldsTruncated.includes('comment')));
  assert.ok(pack.history.records.some(row=>row.comment==='Aprobado.'));
  assert.equal(pack.history.total,112);assert.ok(pack.history.omitted>0);
  assert.ok(JSON.stringify(pack).length<40000);
});

test('la recurrencia cuenta jornadas distintas con su horario y mantiene separados los contextos y objetivos',()=>{
  const tasks=[];
  for (const day of ['2028-03-06','2028-03-08','2028-03-09']) for (const area of ['Norte','Sur']) {
    tasks.push(task(day+area,day,'Control',area,'Validado.',{segments:[{start:'08:05',end:'08:15'}]}));
    tasks.push(task(day+area+'2',day,'Control',area,'Validado.'));
  }
  const duplicate={...tasks[0]};
  const {pack}=result({tasks:[...tasks,duplicate]});
  assert.equal(pack.history.total,12);
  assert.deepEqual(pack.history.recurring.map(x=>[x.context,x.distinctDays,x.datesWithTime]),[['Norte',3,3],['Sur',3,3]]);
  assert.ok(pack.history.recurring[0].examples.every(row=>row.slot.start==='08:05' && row._source>0));
});

test('el contexto respeta los rangos explícitos y amplía una semana vacía solo cuando corresponde',()=>{
  const doc={tasks:[task('viejo','2028-02-25','Fondo','','Antecedente.')],
    notes:[{id:'nota',title:'Verificar inventario',lane:'waiting',body:'Pendiente de confirmación.'}],
    goals:[{id:'objetivo',title:'Lanzamiento',status:'En curso'}]};
  const normal=result(doc).pack;
  assert.equal(normal.history.from,'2028-02-25');assert.equal(normal.history.total,1);
  assert.equal(normal.target.total,0);assert.equal(normal.current.total,2);
  const explicit=result(doc,{historyFrom:'2028-03-06'}).pack;
  assert.equal(explicit.history.total,0);assert.equal(explicit.history.from,'2028-03-06');
  const past=result(doc,{targetFrom:'2028-02-23'}).pack;
  assert.equal(past.current,undefined);assert.equal(past.history.to,'2028-02-22');
  const empty=result({tasks:[]}).pack;
  assert.equal(empty.history.total,0);assert.equal(empty.target.total,0);
});

test('la programación futura no transporta comentarios de ejecución ni campos privados',()=>{
  const doc={tasks:[task('secreto','2028-03-10','Prueba de agua','Muestra privada','Evaluación posterior',{privateKey:'oculto',segments:[]})]};
  const {pack}=result(doc);
  assert.equal(pack.target.records[0].title,'Prueba de agua');
  assert.doesNotMatch(JSON.stringify(pack),/Muestra privada|Evaluación posterior|oculto|secreto/);
  assert.equal(planningAppointment({id:'1',type:'task',date:'2028-03-10',title:'A',done:true,status:'Culminado'}).status,undefined);
});
