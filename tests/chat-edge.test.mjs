import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/workhub-chat/index.ts';

// Todos los servicios y datos de este archivo pertenecen a la prueba.
const env={SUPABASE_URL:'https://fixture.invalid', SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture', OPENAI_API_KEY:'fixture-provider'};
const fixture={tasks:[
  {id:'r-a',date:'2026-11-24',title:'Medición A',comment:'Confirmé el pesaje.',status:'En proceso',done:true,segments:[{start:'08:00',end:'08:30'}]},
  {id:'r-b',date:'2026-11-24',title:'Medición B',comment:'Queda pendiente el pesaje.',status:'Pendiente',done:false,segments:[{start:'09:00',end:''}]}
], goals:[],notes:[{id:'n',title:'Nota reservada',body:'solo-notas',lane:'inbox'}],
  profile:{photo:'foto-no-publicable'},calendars:[{id:'c',name:'Operaciones',color:'#FFFFFF',feedToken:'no-exportar'}]};
const query={type:'task',text:'pesaje',from:'',to:'',status:'',order:'asc',offset:0,source:0};
const ok=value=>Response.json(value);
const result=(out)=>ok({status:'completed',output:out});
const call=(query,id='call-1')=>({type:'function_call',name:'consultar',call_id:id,arguments:JSON.stringify(query)});
const answer=text=>result([{type:'message',content:[{type:'output_text',text}]}]);
function request(body={message:'¿Cuánto tiempo registré hoy?'},headers={},method='POST') {
  return new Request('https://fixture.invalid/functions/v1/workhub-chat',{method,
    headers:{Authorization:'Bearer fixture-A','Content-Type':'application/json',...headers},
    ...(method==='POST'?{body:JSON.stringify(body)}:{})});
}
function rig({settings=env,auth=()=>ok({id:'account-A',role:'authenticated'}),rpc=()=>ok({document:fixture,revision:1}),
    openai=()=>answer('Una respuesta.'), instant='2026-11-25T04:40:00Z'}={}) {
  const seen=[];
  const handler=createHandler({env:k=>settings[k],now:()=>new Date(instant),fetch:async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null;
    const record={url,options,body};
    seen.push(record);
    if(url===env.SUPABASE_URL+'/auth/v1/user') return auth(record);
    if(url===env.SUPABASE_URL+'/rest/v1/rpc/jornada_leer') return rpc(record);
    assert.equal(url,'https://api.openai.com/v1/responses');
    return openai(record,seen.filter(i=>i.url===url).length);
  }});
  return {handler,seen};
}
test('preflight, validez de entrada y cuenta antes de enviar datos al proveedor',async()=>{
  const {handler,seen}=rig();
  const preflight=await handler(request({}, {},'OPTIONS'));
  assert.equal(preflight.status,204); assert.match(preflight.headers.get('access-control-allow-headers'),/authorization/);
  assert.equal((await handler(request({}, {},'GET'))).status,405);
  assert.equal((await handler(request({user_id:'otra',message:'hola'}))).status,400);
  assert.equal((await handler(request({message:'x'.repeat(3001)}))).status,400);
  assert.equal((await handler(request({message:'hola',history:[{role:'system',content:'Hola'}]}))).status,400);
  assert.equal((await handler(request({message:'hola'},{Authorization:''}))).status,401);
  assert.equal(seen.length,0);
  for(const [auth,code] of [[()=>new Response('',{status:401}),401],[()=>ok({id:'a',is_anonymous:true}),403]]) {
    const app=rig({auth});
    assert.equal((await app.handler(request())).status,code);
    assert.equal(app.seen.length,1);
  }
});
test('la lectura usa el JWT del usuario; el modelo recibe horas, registros seleccionados y citas verificables',async()=>{
  const app=rig({openai:({body,options},turn)=>{
    assert.equal(options.headers.Authorization,'Bearer fixture-provider');
    assert.equal(body.store,false);
    assert.match(body.instructions,/2026-11-24/);
    assert.equal(body.tools.length,1);
    assert.ok(body.input.some(x=>x.role==='user' && x.content==='¿Y hoy?'));
    assert.ok(body.input.some(x=>x.role==='assistant' && x.content==='Antes revisamos pesajes.'));
    if(turn===1) {
      assert.equal(body.tool_choice,'required');
      assert.ok(!JSON.stringify(body.input).includes('Confirmé el pesaje.'));
      return result([{type:'reasoning',id:'r',summary:[],encrypted_content:'fixture-thinking'},call(query)]);
    }
    const payload=JSON.parse(body.input.at(-1).output);
    assert.ok(body.input.some(x=>x.encrypted_content==='fixture-thinking'));
    assert.equal(payload.total,2); assert.equal(payload.summary.taskMinutes,30);
    assert.equal(payload.summary.taskChecks.yes,1);
    assert.ok(payload.records.every(x=>!Object.hasOwn(x,'id')));
    assert.ok(!/solo-notas|foto-no-publicable|no-exportar|fixture-A/.test(JSON.stringify(body)));
    return answer('La segunda medición está pendiente [2] y la primera tiene 30 minutos [1].');
  }});
  const response=await app.handler(request({message:'¿Y hoy?',history:[{role:'assistant',content:'Antes revisamos pesajes.'}],scope:'tasks'}));
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.answer,'La segunda medición está pendiente [1] y la primera tiene 30 minutos [2].');
  assert.deepEqual(data.sources.map(s=>[s.number,s.id]),[[1,'r-b'],[2,'r-a']]);
  assert.deepEqual(data.sources[0],{number:1,type:'task',id:'r-b',title:'Medición B',date:'2026-11-24'});
  for(const x of app.seen.filter(x=>x.url.includes('fixture.invalid'))) {
    assert.equal(x.options.headers.Authorization,'Bearer fixture-A');
    assert.equal(x.options.headers.apikey,env.SUPABASE_PUBLISHABLE_KEY);
    assert.ok(!JSON.stringify(x.options.headers).includes('fixture-provider'));
  }
  assert.deepEqual(app.seen.find(x=>x.url.includes('/rpc/')).body,{});
});
test('un turno local a cada cuenta, un solo RPC, una segunda búsqueda y referencias falsas excluidas',async()=>{
  const app=rig({auth:({options})=>ok({id:options.headers.Authorization,role:'authenticated'}),
    rpc:({options})=>ok({revision:1,document:{tasks:[{...fixture.tasks[0],id:options.headers.Authorization,title:'registro-propio'}],goals:[]}}),
    openai:({body})=>{
      const outputs=body.input.filter(x=>x.type==='function_call_output');
      if(!outputs.length) return result([call(query)]);
      if(outputs.length===1) return result([call({...query,source:1},'call-2')]);
      return answer('Hecho registrado [1]. Otra referencia [99].');
    }});
  const responses=await Promise.all(['A','B'].map(async who=>{
    const res=await app.handler(request({message:'Mis pesajes',scope:'tasks'},{Authorization:'Bearer '+who}));
    return res.json();
  }));
  assert.equal(app.seen.filter(x=>x.url.includes('/rpc/')).length,2);
  for(const [i,who] of ['A','B'].entries()) {
    assert.equal(responses[i].sources.length,1); assert.equal(responses[i].sources[0].id,'Bearer '+who);
    assert.ok(!responses[i].answer.includes('[99]'));
  }
});
test('la consulta elegida limita el ámbito; saludo y aclaración no leen la agenda',async()=>{
  for(const type of ['none','note']) {
    const app=rig({openai:({body},round)=>{
      if(round===1) return result([call({...query,text:'',type})]);
      const output=JSON.parse(body.input.at(-1).output);
      if(type==='none') assert.ok(output.sinConsulta);
      else {assert.equal(output.records.length,0);assert.equal(output.total,0);}
      return answer('Puedo ayudarte con ese tema.');
    }});
    const resp=await app.handler(request({message:'Hola',scope:'tasks'}));
    assert.equal(resp.status,200);
    assert.equal(app.seen.filter(x=>x.url.includes('/rpc/')).length,type==='none'?0:1);
  }
});
test('errores fijos distinguen acceso, configuración, cuota y proveedor sin filtrar respuestas de upstream',async()=>{
  const fixtures=[
    [{settings:{...env,OPENAI_API_KEY:''}},503,'CHAT_NOT_CONFIGURED'],
    [{settings:{...env,SUPABASE_PUBLISHABLE_KEY:'sb_secret_no'}},503,'CHAT_NOT_CONFIGURED'],
    [{openai:()=>new Response('detalle proveedor',{status:401})},503,'CHAT_NOT_CONFIGURED'],
    [{openai:()=>Response.json({error:{code:'insufficient_quota',message:'detalle proveedor'}},{status:429})},429,'CHAT_QUOTA'],
    [{openai:()=>new Response('detalle proveedor',{status:429})},429,'CHAT_LIMIT'],
    [{openai:()=>new Response('detalle proveedor',{status:500})},502,'CHAT_PROVIDER'],
    [{rpc:()=>new Response('detalle proveedor',{status:403}),openai:()=>result([call(query)])},403,'CHAT_ACCESS'],
    [{rpc:()=>new Response('detalle proveedor',{status:401}),openai:()=>result([call(query)])},403,'CHAT_ACCESS'],
    [{rpc:()=>ok({revision:4,document:{tasks:[]}}),openai:()=>result([call(query)])},502,'CHAT_DATA']
  ];
  for(const [setup,status,code] of fixtures) {
    const app=rig(setup);const res=await app.handler(request());const data=await res.json();
    assert.equal(res.status,status);assert.equal(data.code,code);assert.ok(!JSON.stringify(data).includes('detalle proveedor'));
  }
});
test('pide respuesta al llegar al límite de consultas, sin seguir iterando',async()=>{
  const app=rig({openai:({body},round)=>{
    if(round===4) {assert.equal(body.tool_choice,'none');return answer('Resultado parcial.');}
    return result([call(query,'call-'+round)]);
  }});
  const resp=await app.handler(request());assert.equal(resp.status,200);
  assert.equal(app.seen.filter(x=>x.url.includes('/v1/responses')).length,4);
});

test('una fecha imposible devuelve un error a la herramienta y permite corregir la búsqueda',async()=>{
  const {handler,seen}=rig({openai:({body},round)=>{
    if(round===1) return result([call({...query,from:'2026-02-30'})]);
    if(round===2) {
      const first=JSON.parse(body.input.at(-1).output);
      assert.match(first.error,/fechas/);
      return result([call({...query,from:'2026-11-24'},'call-2')]);
    }
    assert.equal(JSON.parse(body.input.at(-1).output).total,2);
    return answer('Consulta corregida [1].');
  }});
  assert.equal((await handler(request())).status,200);
  assert.equal(seen.filter(x=>x.url.includes('/rpc/')).length,1);
});
