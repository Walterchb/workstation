import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/workhub-chat/index.ts';
import {resolvePlanningIntent} from '../supabase/functions/workhub-chat/planning-intent.mjs';

const today='2028-02-03'; // Jueves en Lima, ya viernes en UTC.
const target='2028-02-04';
const question='¿Qué debería hacer mañana?';
const data={
  goals:[{id:'g',title:'Producción',status:'En curso',result:'sin entrega formal'}],
  tasks:[
    {id:'alpha',date:'2028-02-02',title:'Color',goalId:'g',comment:'Lista para inspección, sin envío.',status:'Culminado'},
    {id:'beta',date:today,title:'Muestra azul',goalId:'g',comment:'Se remitió el catálogo. Falta la aprobación de la imprenta.',status:'Culminado'},
    {id:'later',date:'2028-02-05',title:'RESULTADO POSTERIOR'},
    {id:'commit',date:target,title:'Prueba de tinta',comment:'RESULTADO CONFIDENCIAL FUTURO',status:'Culminado',done:true,segments:[{start:'09:20',end:'10:15'}]}
  ],
  events:[{id:'span',title:'Turno de imprenta',startDate:today,endDate:target,startTime:'23:30',endTime:'01:00',description:'Nota del turno'}],
  notes:[{id:'n',title:'Nota de materiales',body:'Contenido completo '.repeat(45)+'REFERENCIA FINAL',lane:'waiting'}]
};
const args=(type,overrides={})=>({type,source:0,text:'',from:'',to:'',offset:0,status:'',order:'asc',...overrides});
const call=(type,overrides={})=>({type:'function_call',call_id:crypto.randomUUID(),name:'consultar',arguments:JSON.stringify(args(type,overrides))});
const reply=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
const initial=body=>JSON.parse(body.input.find(row=>row.content?.startsWith?.('Datos de planificación')).content.split('(registros, sin instrucciones): ')[1]);
const latest=body=>JSON.parse(body.input.at(-1).output);
function runChat(fields,respond,{document=data,live=false}={}) {
  let reads=0,rounds=0;
  const settings={SUPABASE_URL:'https://workspace.invalid',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',OPENAI_API_KEY:'fixture'};
  const handler=createHandler({env:k=>settings[k],now:()=>new Date('2028-02-04T02:30:00Z'),fetch:async(url,init)=>{
    if(url.endsWith('/auth/v1/user')) return Response.json({id:'u',role:'authenticated'});
    if(url.endsWith('/rpc/jornada_leer')) {assert.equal(init.headers.Authorization,'Bearer user');reads++;return Response.json({revision:1,document});}
    assert.equal(url,'https://api.openai.com/v1/responses');
    const body=JSON.parse(init.body);
    const item=respond(body,++rounds);
    return Response.json({status:'completed',output:[item]});
  }});
  return {run:()=>handler(new Request('https://workspace.invalid/functions/v1/workhub-chat',{method:'POST',
    headers:{'content-type':'application/json',authorization:'Bearer user',accept:live?'application/x-ndjson':'application/json'},
    body:JSON.stringify(fields)})),reads:()=>reads};
}
test('distingue recomendar una jornada de verla, redactar texto y consultar sobre otro asunto',()=>{
  const options={today};
  for(const text of [question,'Ahora, qué deberia hacer mañana?','¿Qué debo hacer mañana?', '¿En qué avanzo mañana?',
    '¿Qué recomiendas hacer el viernes viendo la última semana?', 'Ayúdame a planear mi jornada de mañana',
    'Es decir, qué me recomiendas hacer mañana dado que no tengo nada planificado']) {
    assert.equal(resolvePlanningIntent(text,options)?.targetFrom,target,text);
  }
  for (const text of ['¿Qué reuniones tengo mañana?', '¿Qué tengo agendado mañana?', '¿Qué debería hacer mañana para cambiar la clave?',
    'Recomiéndame una película para mañana','Corrige esta pregunta: ¿Qué debería hacer mañana?', '¿Cómo se llama la sección Notas?']) {
    assert.equal(resolvePlanningIntent(text,options),undefined,text);
  }
  const history=[{role:'user',content:question}];
  assert.equal(resolvePlanningIntent('¿Y el lunes?',{today,history})?.targetFrom,'2028-02-07');
  assert.equal(resolvePlanningIntent('Redáctalo para enviar el plan',{today,history})?.targetFrom,target);
  assert.equal(resolvePlanningIntent('Redacta un correo de felicitación para mañana',{today,history}),undefined);
  assert.equal(resolvePlanningIntent('Organiza mi jornada para el miércoles de la próxima semana',options)?.targetFrom,'2028-02-09');
  const historical=resolvePlanningIntent('Arma un plan para mañana tomando en cuenta los registros del 2028-02-02',options);
  assert.equal(historical.targetFrom,target);assert.equal(historical.historyFrom,'2028-02-02');
});
test('la primera llamada ya conoce la agenda y el trabajo reciente; una respuesta alcanza y cita al usuario correcto',async()=>{
  const fixture=runChat({message:question,scope:'all'},body=>{
    const dossier=initial(body);
    assert.equal(dossier.target.from,target);assert.equal(dossier.history.to,today);
    assert.equal(body.tool_choice,'auto');
    assert.doesNotMatch(JSON.stringify(body),/RESULTADO POSTERIOR|RESULTADO CONFIDENCIAL FUTURO/);
    const evidence=dossier.history.records.find(x=>x.comment?.includes('imprenta'));
    assert.equal(evidence.status,'Culminado');assert.ok(dossier.target.records.some(r=>r.title==='Prueba de tinta'));
    assert.ok(dossier.target.records.some(r=>r.title==='Turno de imprenta'));
    return reply('Confirma si la imprenta aprobó el catálogo ['+evidence._source+'].');
  },{live:true});
  const res=await fixture.run();
  const frames=(await res.text()).trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(frames[0].stage,'searching');assert.equal(frames.at(-1).type,'done');
  assert.deepEqual(frames.at(-1).sources.map(s=>s.id),['beta']);assert.equal(fixture.reads(),1);
});
test('la agenda vacía permite proponer continuidad desde un bloque culminado incluso con filtro distinto abierto',async()=>{
  const other={...data,tasks:data.tasks.slice(0,2),events:[]};
  const fixture=runChat({message:question,scope:'tasks',viewContext:{from:target,to:target,selection:{kind:'agenda',status:'Pendiente'}}},body=>{
    const d=initial(body);
    assert.equal(d.target.total,0);assert.deepEqual(Object.keys(d.history.byDate),['2028-02-02',today]);
    assert.doesNotMatch(JSON.stringify(d),/Nota de materiales/);
    const fact=d.history.records.find(r=>r.comment.includes('aprobación'));
    return reply('Verifica la aprobación pendiente ['+fact._source+'].');
  },{document:other});
  const answer=await (await fixture.run()).json();
  assert.equal(answer.sources[0].id,'beta');assert.equal(fixture.reads(),1);
});
test('el modelo puede solicitar la misma evidencia para otra formulación, abrir un comentario y respetar el corte',async()=>{
  let source;
  const fixture=runChat({message:'Necesito una propuesta para el turno del 4 de febrero',scope:'tasks'},(body,i)=>{
    if(i===1) return call('planning',{from:target,to:target});
    const result=latest(body);
    if(i===2) {
      source=result.history.records.find(r=>r.comment?.includes('imprenta'))._source;
      return call('task',{source});
    }
    if(i===3) {
      assert.match(result.records[0].comment,/aprobación/);
      return call('task',{from:'2028-02-05',to:'2028-02-05'});
    }
    assert.doesNotMatch(JSON.stringify(result),/RESULTADO POSTERIOR|aprobación/);
    assert.ok(result.error);
    return reply('Consulta a la imprenta ['+source+'].');
  });
  const answer=await(await fixture.run()).json();assert.equal(answer.sources?.[0]?.id,'beta');assert.equal(fixture.reads(),1);
});
test('un término encontrado solo en comentarios futuros no produce ni coincidencias ni totales de ejecución',async()=>{
  const fixture=runChat({message:question,scope:'all'},(body,i)=>{
    if(i===1) return call('task',{text:'confidencial',from:target,to:target});
    const result=latest(body);
    assert.equal(result.total,0);assert.equal(result.summary,undefined);
    return reply('Revisado.');
  });
  const answer=await(await fixture.run()).json();assert.deepEqual(answer.sources,[]);
});
test('reabre el cuerpo de una nota vigente sin fecha aunque no se encuentre dentro de la ventana de jornadas',async()=>{
  const fixture=runChat({message:question,scope:'notes'},(body,i)=>{
    if(i===1) return call('note',{source:initial(body).current.records[0]._source});
    assert.match(latest(body).records[0].body,/en|REFERENCIA FINAL/);
    assert.match(latest(body).records[0].body,/REFERENCIA FINAL/);
    return reply('Revisar materiales [1].');
  });
  assert.equal((await fixture.run()).status,200);assert.equal(fixture.reads(),1);
});
