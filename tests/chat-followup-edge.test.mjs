import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/workhub-chat/index.ts';

const settings={SUPABASE_URL:'https://local.invalid',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',OPENAI_API_KEY:'test-key'};
const tasks=[
  {id:'opaque-01',date:'2026-11-23',title:'Envío',comment:'Listo para enviar.',status:'Culminada'},
  {id:'opaque-02',date:'2026-11-24',title:'Envío',comment:'Se remitió la versión corregida.',status:'Culminada'}
];
const doc={tasks,goals:[],notes:[{id:'private-note',title:'Nota',body:'Contenido de otro ámbito'}]};
const usage={input_tokens:120,input_tokens_details:{cached_tokens:20},output_tokens:30};
const frame=(output,extra={})=>({status:'completed',model:'gpt-6.2-sol',usage,output,...extra});
const query=(type,source,extra={})=>({type:'function_call',name:'consultar',call_id:crypto.randomUUID(),arguments:JSON.stringify({
  type,source,text:'',from:'',to:'',status:'',order:'relevance',offset:0,...extra})});
const msg=(text)=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
function setup(provider,document=doc) {
  const calls=[],reads=[];
  const handler=createHandler({env:key=>settings[key],now:()=>new Date('2026-11-26T12:00:00Z'),fetch:async(url,init)=>{
    if(url.endsWith('/auth/v1/user')) return Response.json({id:'u1',role:'authenticated'});
    if(url.endsWith('/rpc/jornada_leer')) {
      reads.push(init.headers.Authorization);
      return Response.json({document,revision:1});
    }
    assert.equal(url,'https://api.openai.com/v1/responses');
    const body=JSON.parse(init.body);
    calls.push(body);
    const result=provider(body,calls.length);
    return result instanceof Response?result:Response.json(result);
  }});
  return {calls,reads,run:(fields,live=false)=>handler(new Request('https://local.invalid/chat',{
    method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer person-1',Accept:live?'application/x-ndjson':'application/json'},
    body:JSON.stringify(fields)}))};
}

test('revalida una fuente en la cuenta y el período vigentes, nunca confía en el título del cliente',async()=>{
  const h=setup((body,round)=>{
    if(round===1) {
      const ui=body.input.find(item=>item.content?.includes?.('Contexto de interfaz'));
      assert.equal(ui.role,'user');
      assert.match(ui.content,/2026-11-24/);
      assert.match(ui.content,/TÍTULO OBSOLETO/);
      assert.doesNotMatch(body.instructions,/TÍTULO OBSOLETO/);
      assert.doesNotMatch(JSON.stringify(body),/opaque-02/);
      return frame([query('remembered',1,{from:'2026-11-24',to:'2026-11-24'})]);
    }
    const record=JSON.parse(body.input.at(-1).output).records[0];
    assert.equal(record.title,'Envío');
    assert.equal(record.comment,'Se remitió la versión corregida.');
    return frame([msg('Se remitió la versión corregida [1].')]);
  });
  const res=await h.run({message:'¿Y ese?',scope:'tasks',viewContext:{view:'Semana',from:'2026-11-24',to:'2026-11-24',filters:['Envío']},
    memory:{topics:['Tema de la semana'],sources:[{id:'opaque-02',title:'TÍTULO OBSOLETO',type:'task'}]}});
  const data=await res.json();
  assert.equal(data.sources[0].id,'opaque-02');
  assert.deepEqual(h.reads,['Bearer person-1']);
  assert.equal(data.usage.inputTokens,240);
  assert.equal(data.usage.outputTokens,60);
  assert.equal(data.usage.measuredRounds,2);
  assert.equal(data.usage.complete,true);
  assert.match(data.usage.requestId,/^[\da-f-]{36}$/);
});
test('la relectura del grupo mantiene orden de referencias, ámbito, fechas, borrados y cotas',async()=>{
  const refs=[{type:'task',id:'opaque-02'},{type:'note',id:'private-note'},{type:'task',id:'gone'},{type:'task',id:'opaque-01'}];
  const h=setup((body,round)=>{
    if(round===1) return frame([query('remembered',0,{from:'2026-11-24',to:'2026-11-24'})]);
    const result=JSON.parse(body.input.at(-1).output);
    assert.deepEqual(result.records.map(r=>r.memoryIndex),[1]);
    assert.doesNotMatch(JSON.stringify(result),/Contenido de otro ámbito|Listo para enviar/);
    return frame([msg('Se remitió la versión corregida [1].')]);
  });
  const args={scope:'tasks',message:'¿Y cuáles se enviaron?',memory:{sources:refs}};
  const good=await h.run(args);
  assert.equal(good.status,200);
  for(const extra of [{viewContext:{from:'2026-02-30'}},{memory:{sources:Array(13).fill(refs[0])}},{viewContext:{role:'system'}},
    {memory:{sources:[{type:['task'],id:'opaque-02'}]}},{memory:{topics:['a'.repeat(241)]}}]) {
    assert.equal((await h.run({...args,...extra})).status,400);
  }
  assert.equal(h.calls.length,2);
});
test('un borrador suministrado puede evitar una llamada y no necesita leer la agenda',async()=>{
  const h=setup(body=>{
    assert.equal(body.tool_choice,'auto');
    return frame([msg('Hola, confirmo la recepción del archivo.')]);
  });
  assert.equal((await h.run({message:'Reformula este texto: recibí el archivo.',viewContext:{}})).status,200);
  assert.equal(h.calls.length,1);
  assert.equal(h.reads.length,0);
});
test('una comparación puede recorrer más de tres búsquedas; el acumulado incluye todas las llamadas',async()=>{
  const h=setup((body,round)=>round<=4?frame([query('task',0,{order:'asc'})]):frame([msg('Primero estuvo listo [1] y luego se remitió [2].')]));
  const res=await h.run({message:'¿Qué cambió entre estas jornadas?',viewContext:{view:'Semana'}});
  const data=await res.json();
  assert.equal(data.usage.rounds,5);
  assert.equal(data.usage.measuredRounds,5);
  assert.equal(h.reads.length,1);
  assert.deepEqual(data.sources.map(s=>s.id),['opaque-01','opaque-02']);
});
test('una caída conserva el consumo medido y señala el tramo desconocido en JSON y en streaming',async()=>{
  for(const live of [false,true]){
    const h=setup((_body,round)=>round===1?frame([query('task',0)]):new Response('',{status:503}));
    const res=await h.run({message:'¿Qué cambió?',viewContext:{}},live);
    const error=live?(await res.text()).trim().split('\n').map(JSON.parse).at(-1):await res.json();
    assert.equal(error.code,'CHAT_PROVIDER');
    assert.equal(error.usage.complete,false);
    assert.equal(error.usage.costUsd,null);
    assert.ok(error.usage.knownCostUsd>0);
    assert.equal(error.usage.rounds,2);
    assert.equal(error.usage.measuredRounds,1);
  }
});

test('la fecha expresa supera la vista, conserva subintervalos y sí permite preguntar por el futuro',async()=>{
  const rangeDocs={tasks:[
    ...tasks,{id:'oct',date:'2026-10-11',title:'Octubre'},{id:'old',date:'2025-05-20',title:'Año anterior'},
    {id:'future',date:'2026-11-27',title:'Mañana'}],goals:[]};
  const viewContext={view:'Semana',from:'2026-11-23',to:'2026-11-24'};
  const cases=[
    ['¿Qué hice aquí el mes pasado?',{},['Octubre']],
    ['¿Y el año pasado?',{},['Año anterior']],
    ['¿Y mañana?',{},['Mañana']],
    ['¿Qué se registró aquí?',{},['Envío','Envío']],
    ['¿Qué avances había hasta el 2026-11-23?',{from:'2026-11-23'},['Envío']],
    ['¿Qué hice del 2026-11-23 al 2026-11-24?',{from:'2026-11-24',to:'2026-11-24'},['Envío']],
    ['Compara la vista con el mes pasado',{from:'2026-11-23',to:'2026-11-24'},['Envío','Envío']]
  ];
  for(const [question,parameters,expected] of cases) {
    const h=setup((body,round)=>{
      if(round===1) return frame([query('task',0,parameters)]);
      const result=JSON.parse(body.input.at(-1).output);
      assert.deepEqual(result.records.map(r=>r.title),expected,question);
      return frame([msg('Revisado.')]);
    },rangeDocs);
    const res=await h.run({message:question,scope:'tasks',viewContext});
    assert.equal(res.status,200,question);
  }
});

test('un recuerdo posterior al corte y una reformulación excesiva no suministran evidencia',async()=>{
  const h=setup((body,round)=>{
    if(round===1) return frame([query('task',0,{alternatives:['uno','dos','tres','cuatro']})]);
    if(round===2) {
      assert.match(JSON.parse(body.input.at(-1).output).error,/inválida/);
      return frame([query('remembered',1)]);
    }
    const result=JSON.parse(body.input.at(-1).output);
    assert.equal(result.total,0);
    assert.equal(result.records.length,0);
    return frame([msg('No encontré respaldo a ese corte.')]);
  });
  const res=await h.run({message:'¿Estaba enviado al corte del 2026-11-23?',scope:'tasks',
    memory:{sources:[{id:'opaque-02',type:'task'}]}});
  assert.equal(res.status,200);
});

test('consulta la selección de la interfaz por ID sólo cuando se solicita, también al releer varias fuentes',async()=>{
  const document={tasks:tasks.map((task,i)=>({...task,goalId:['objetivo-privado-a','objetivo-privado-b'][i]})),goals:[
    {id:'objetivo-privado-a',title:'Revisión'},{id:'objetivo-privado-b',title:'Revisión'}]};
  const viewContext={view:'Lista',filters:['Objetivo: Revisión'],selection:{kind:'agenda',goalId:'objetivo-privado-b'}};
  const memory={sources:tasks.map(row=>({id:row.id,type:'task'}))};
  const h=setup((body,round)=>{
    assert.doesNotMatch(JSON.stringify(body),/objetivo-privado/);
    if(round===1) return frame([query('remembered',0,{useViewFilters:true})]);
    if(round===2) {
      assert.deepEqual(JSON.parse(body.input.at(-1).output).records.map(row=>row.memoryIndex),[2]);
      return frame([query('task',0,{useViewFilters:false})]);
    }
    assert.equal(JSON.parse(body.input.at(-1).output).total,2);
    return frame([msg('Revisión concluida.')]);
  },document);
  assert.equal((await h.run({scope:'tasks',message:'Compara esta vista con todos los objetivos.',viewContext,memory})).status,200);
});
