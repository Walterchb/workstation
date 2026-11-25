import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/workhub-chat/index.ts';

const encoder=new TextEncoder(), decoder=new TextDecoder();
const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',OPENAI_API_KEY:'local-only'};
const query={type:'task',text:'',from:'',to:'',status:'',order:'asc',offset:0,source:0};
const call={type:'function_call',name:'consultar',call_id:'internal_call',arguments:JSON.stringify(query)};
const completion=output=>({status:'completed',output});
const message=(text,phase='final_answer')=>({type:'message',role:'assistant',phase,content:[{type:'output_text',text}]});
const frame=event=>'event: '+event.type+'\r\ndata: '+JSON.stringify(event)+'\r\n\r\n';
const item=(index,phase)=>({type:'response.output_item.added',output_index:index,item:{type:'message',role:'assistant',phase}});
const delta=(index,text)=>({type:'response.output_text.delta',output_index:index,delta:text});
const records=[{id:'01',title:'A',date:'2026-11-24'}, {id:'02',title:'B',date:'2026-11-24'}];
function request(headers={}) {
  return new Request('https://fixture.invalid/functions/v1/workhub-chat',{method:'POST',
    headers:{Authorization:'Bearer local-user','Content-Type':'application/json',Accept:'application/x-ndjson',...headers},
    body:JSON.stringify({message:'¿Qué registré?'})});
}
function harness(provider) {
  const calls=[];
  const handler=createHandler({env:key=>env[key],fetch:async(url,init)=>{
    if(url===env.SUPABASE_URL+'/auth/v1/user') return Response.json({id:'one',role:'authenticated'});
    if(url===env.SUPABASE_URL+'/rest/v1/rpc/jornada_leer') return Response.json({revision:1,document:{tasks:records,goals:[]}});
    assert.equal(url,'https://api.openai.com/v1/responses');
    const body=JSON.parse(init.body);
    calls.push(body);
    return provider(body,calls.length,init.signal);
  }});
  return {handler,calls};
}
function channel() {
  let stream, cancelled=false;
  const res=new Response(new ReadableStream({
    start(controller){stream=controller;}, cancel(){cancelled=true;}
  }),{headers:{'Content-Type':'text/event-stream'}});
  return {res,emit(event){stream.enqueue(encoder.encode(frame(event)));},
    chunk(bytes){stream.enqueue(bytes);},end(){stream.close();},wasCancelled:()=>cancelled};
}
const readEvent=async reader=>JSON.parse(decoder.decode((await reader.read()).value));

test('el texto se recibe antes del fin, conserva caracteres cortados y entrega las citas definitivas',async()=>{
  const provider=channel();
  const {handler,calls}=harness((body,round)=>{
    if(round===1) {assert.equal(body.stream,undefined);return Response.json(completion([call]));}
    assert.equal(body.stream,true);
    return provider.res;
  });
  const res=await handler(request());
  assert.match(res.headers.get('content-type'),/^application\/x-ndjson/);
  const reader=res.body.getReader();
  assert.deepEqual(await readEvent(reader),{type:'status',stage:'searching'});
  provider.emit(item(0,'commentary'));
  provider.emit(delta(0,'comentario intermedio privado'));
  provider.emit({type:'response.reasoning_text.delta',output_index:0,delta:'razonamiento privado'});
  provider.emit({type:'response.function_call_arguments.delta',output_index:1,delta:'argumento privado'});
  provider.emit(item(2,'final_answer'));
  const bytes=encoder.encode(frame(delta(2,'Llegó el lote [')));
  const split=bytes.indexOf(0xc3)+1;
  provider.chunk(bytes.subarray(0,split));provider.chunk(bytes.subarray(split));
  assert.deepEqual(await readEvent(reader),{type:'status',stage:'writing'});
  assert.deepEqual(await readEvent(reader),{type:'delta',text:'Llegó el lote '});
  provider.emit(delta(2,'2] y se revisó.'));
  assert.deepEqual(await readEvent(reader),{type:'delta',text:' y se revisó.'});
  provider.emit({type:'response.completed',response:completion([message('comentario interno','commentary'),message('Llegó el lote [2] y se revisó.')])});
  const done=await readEvent(reader);
  assert.equal(done.type,'done');assert.equal(done.answer,'Llegó el lote [1] y se revisó.');
  assert.equal(done.sources[0].id,'02');
  assert.equal((await reader.read()).done,true);
  assert.equal(calls.length,2);
});
test('emite un error terminal al cortar SSE y conserva HTTP para errores de autenticación anteriores al stream',async()=>{
  const provider=channel();
  const {handler,calls}=harness((_body,round)=>round===1?Response.json(completion([call])):provider.res);
  const unauthorized=await handler(request({Authorization:''}));
  assert.equal(unauthorized.status,401);assert.match(unauthorized.headers.get('content-type'),/application\/json/);
  assert.equal(calls.length,0);
  provider.emit(item(0,'final_answer'));provider.emit(delta(0,'Parcial'));provider.end();
  const res=await handler(request());const events=(await res.text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map(e=>e.type),['status','status','delta','error']);
  assert.equal(events.at(-1).code,'CHAT_PROVIDER');assert.equal(events.at(-1).status,502);
});
test('cancelar el stream aborta el proveedor y libera su lectura',async()=>{
  const provider=channel();let upstreamSignal;
  const {handler,calls}=harness((_body,round,signal)=>{
    if(round===1) return Response.json(completion([call]));
    upstreamSignal=signal;
    return provider.res;
  });
  const reader=(await handler(request())).body.getReader();
  await readEvent(reader);provider.emit(item(0,'final_answer'));provider.emit(delta(0,'Inicio'));
  await readEvent(reader);await readEvent(reader);await reader.cancel();
  assert.ok(upstreamSignal.aborted);assert.ok(provider.wasCancelled());assert.equal(calls.length,2);
});
test('negociación explícita del formato y búsquedas adicionales sin solicitudes adicionales por streaming',async()=>{
  const second=channel(), third=channel();
  second.emit(item(0,null));second.emit(delta(0,'Borrador'));
  second.emit({type:'response.completed',response:completion([
    {type:'reasoning',encrypted_content:'contenido-interno'},call])});
  third.emit(item(0,'final_answer'));third.emit(delta(0,'Final'));
  third.emit({type:'response.completed',response:completion([message('Final')])});
  const {handler,calls}=harness((body,round)=>{
    if(round===1 || !body.stream) return Response.json(completion(round===1?[call]:[message('JSON')]));
    return round===2?second.res:third.res;
  });
  const res=await handler(request());const events=(await res.text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map(e=>e.type),['status','status','delta','reset','status','status','delta','done']);
  assert.ok(calls.at(-1).input.some(x=>x.encrypted_content==='contenido-interno'));
  assert.ok(!JSON.stringify(events).includes('contenido-interno'));
  assert.equal(calls.length,3);
  const regular=await handler(request({Accept:'application/x-ndjson;q=0, */*'}));
  assert.match(regular.headers.get('content-type'),/application\/json/);
  assert.deepEqual(await regular.json(),{answer:'JSON',sources:[]});
});
test('un proveedor JSON en una ronda negociada como stream conserva el resultado sin repetir llamadas',async()=>{
  const {handler,calls}=harness((_body,round)=>Response.json(completion(round===1?[call]:[
    message('Detalle interno','commentary'),message('Entrega [2]')])));
  const res=await handler(request());
  const events=(await res.text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map(e=>e.type),['status','done']);
  assert.equal(events[1].answer,'Entrega [1]');assert.equal(events[1].sources[0].id,'02');
  assert.equal(calls.length,2);assert.equal(calls[1].stream,true);
});
test('el aborto de la solicitud libera el proveedor aunque el cliente no consuma el texto en cola',async()=>{
  const stop=new AbortController(), provider=channel();
  const {handler,calls}=harness((_body,round)=>round===1?Response.json(completion([call])):provider.res);
  const reader=(await handler(new Request(request(),{signal:stop.signal}))).body.getReader();
  await readEvent(reader);
  provider.emit(item(0,'final_answer'));provider.emit(delta(0,'Inicio'));
  await readEvent(reader);
  await new Promise(resolve=>setImmediate(resolve));
  stop.abort();
  const remaining=[];
  for(;;){
    const chunk=await reader.read();
    if(chunk.done)break;
    remaining.push(JSON.parse(decoder.decode(chunk.value)));
  }
  assert.equal(remaining.at(-1).code,'CHAT_TIMEOUT');
  assert.ok(provider.wasCancelled());assert.equal(calls.length,2);
});
