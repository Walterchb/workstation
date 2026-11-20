/* Navegación, calendario y confirmación de cambios en el espacio personal. */
(() => {
  'use strict';
  const {icon,esc}=window.JUI;
  const model=window.JModel;
  const store=window.JStore;
  const root=document.getElementById('root');
  const titles={agenda:'Mi jornada',goals:'Objetivos',analysis:'Análisis'};
  let view='agenda', date=model.today(), calendarMonth=date.slice(0,7);
  let session=null, state=null, saving=false, clockHandle;
  const mark='<img src="./assets/icons/mark.svg" width="37" height="37" alt="">';
  const brand='<div class="brandbar">'+mark+'<span>Jornada</span></div>';

  function notify(message,action) {
    // Dentro de un diálogo modal el aviso se mantiene en la capa visible.
    const host=document.querySelector('dialog[open]') || document.getElementById('notices');
    const node=document.createElement('div');
    node.className='notice';
    node.setAttribute('role','status');
    const content=document.createElement('span');
    content.textContent=message;
    node.append(content);
    if(action) {
      const button=document.createElement('button');
      button.textContent=action.label;
      button.onclick=action.run;
      node.append(button);
    } else {
      const close=document.createElement('button');
      close.type='button';
      close.title='Cerrar aviso';
      close.setAttribute('aria-label','Cerrar aviso');
      close.innerHTML=icon('x',14);
      close.onclick=()=>node.remove();
      node.append(close);
    }
    host.append(node);
    if(!action) setTimeout(()=>node.remove(),5500);
  }

  function showGuide() {
    const dialog=document.createElement('dialog');
    dialog.className='shell-dialog';
    dialog.setAttribute('aria-labelledby','help-title');
    dialog.innerHTML='<div class="dialog-top"><h2 id="help-title">Cómo usar Jornada</h2><button class="icon-btn" aria-label="Cerrar ayuda">'+icon('x')+'</button></div>'+
      '<div class="help-list"><div><strong>Al planificar</strong><p>En Mi jornada, abre Editar actividades. Escribe una actividad y su contexto por fila. Puedes insertar otra entre dos tareas si cambian tus prioridades.</p></div>'+
      '<div><strong>Al trabajar</strong><p>Registra las horas y los comentarios en Editar actividades. En el horario puedes cambiar el estado y marcar «¿Se hizo?» de forma independiente. Marca la casilla cuando hayas cumplido el avance que planificaste para hoy, incluso si el encargo continúa.</p></div>'+
      '<div><strong>Al revisar con gerencia</strong><p>En Objetivos puedes seguir los avances de varios días. En Análisis elige el período para revisar las horas, los resultados y las evidencias, o preparar el informe gerencial.</p></div></div>'+
      '<div class="help-actions"><a class="btn" href="./GUIA.html" target="_blank" rel="noopener">'+icon('book',16)+' Guía de instalación y uso</a></div>';
    dialog.querySelector('button').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    document.body.append(dialog);
    dialog.showModal();
  }

  function toggleMenu(open) {
    const rail=root.querySelector('.rail');
    if(!rail) return;
    rail.classList.toggle('is-open',open);
    root.querySelector('.backdrop').classList.toggle('is-open',open);
    const trigger=root.querySelector('.hamburger');
    trigger.setAttribute('aria-expanded',String(open));
    if(open) rail.querySelector('[aria-current=page]')?.focus();
    else if(window.matchMedia('(max-width:860px)').matches) trigger.focus();
  }

  function navigate(next) {
    if(!titles[next])return;
    const wasOpen=!!root.querySelector('.rail.is-open');
    if(wasOpen) toggleMenu(false);
    view=next;
    render();
    window.scrollTo(0,0);
    root.querySelector('#main').focus({preventScroll:true});
  }

  function setDate(next) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(next))return;
    const test=new Date(next+'T12:00:00Z');
    if(!Number.isFinite(test.getTime())||test.toISOString().slice(0,10)!==next)return;
    date=next;calendarMonth=next.slice(0,7);
    render();
  }

  async function mutate(change) {
    if(saving) {notify('Hay un cambio guardándose. Inténtalo de nuevo en un momento.');return false;}
    saving=true;
    updateStatus();
    try {
      const copy=JSON.parse(JSON.stringify(state));
      change(copy);
      model.validate(copy);
      await store.save(copy);
      state=copy;
      render();
      return true;
    } catch(error) {
      if(error.code==='CONFLICT')notify(error.message,{label:'Recargar',run:()=>location.reload()});
      else if(error.code==='AUTH')notify(error.message,{label:'Ingresar',run:()=>location.reload()});
      else notify(error.message||'No se pudo guardar el cambio.');
      return false;
    } finally {saving=false;updateStatus();}
  }

  async function updateTaskField(day,id,field,value) {
    const valid=field==='status' ? model.statuses.includes(value) : field==='done' && typeof value==='boolean';
    if(!valid){notify('Revisa el valor seleccionado.');return false;}
    const activity=state.tasks.find(task=>task.date===day && task.id===id);
    if(!activity){notify('La actividad ya no está disponible en esta jornada.');return false;}
    if(activity[field]===value)return true;
    if(field==='status' && value!=='En proceso' && activity.segments.some(segment=>!segment.end)){
      notify('Hay un tramo abierto. Registra su hora de cierre en Editar actividades antes de cambiar el estado.');
      return false;
    }
    return mutate(copy=>{
      const row=copy.tasks.find(task=>task.id===id);
      row[field]=value;
    });
  }

  function getContext() {
    const day=date;
    return {state,date:day,setDate,mutate,toast:notify,render,icon,navigate,
      updateTaskField:(id,field,value)=>updateTaskField(day,id,field,value),
      openTask:(id=null,defaults={})=>window.JEditor.open(id,defaults,getContext())};
  }

  function dateTools() {
    return '<nav class="jd-heading-tools" aria-label="Fecha de la jornada">'+
      '<button class="jd-today" type="button" data-go-today>Ir a hoy</button>'+
      '<div class="jd-date-nav"><button type="button" data-step="-1" aria-label="Día anterior" title="Día anterior">'+icon('chevron-left',16)+'</button>'+
      '<label class="jd-picker">'+icon('calendar',16)+'<span class="date-long"></span><span class="date-short"></span>'+
      '<input type="date" aria-label="Elegir fecha de la jornada"></label>'+
      '<button type="button" data-step="1" aria-label="Día siguiente" title="Día siguiente">'+icon('chevron-right',16)+'</button></div></nav>';
  }

  function updateDateTools() {
    const tools=root.querySelector('.jd-heading-tools');
    const label=model.formatDate(date);
    const short=model.formatDate(date,{day:'numeric',month:'short'}).replace(/\./g,'');
    const long=model.formatDate(date,{weekday:'short',day:'numeric',month:'short',year:'numeric'}).replace(/\./g,'');
    tools.querySelector('.date-long').textContent=long;
    tools.querySelector('.date-short').textContent=short;
    tools.querySelector('input').value=date;
    tools.querySelector('.jd-picker').title=label;
    tools.querySelector('[data-go-today]').hidden=date===model.today() && view==='agenda';
  }

  function showDay(next) {
    if(!next)return;
    view='agenda';
    setDate(next);
    window.scrollTo(0,0);
  }

  function renderCalendar() {
    const section=root.querySelector('.cal-wrap');
    if(!section)return;
    const first=calendarMonth+'-01';
    const firstDay=new Date(first+'T12:00:00Z');
    const blanks=(firstDay.getUTCDay()+6)%7;
    const daysInMonth=new Date(Date.UTC(firstDay.getUTCFullYear(),firstDay.getUTCMonth()+1,0)).getUTCDate();
    const marked=new Set(state.tasks.map(x=>x.date));
    let body=['L','M','M','J','V','S','D'].map(x=>'<span class="cal-weekday" aria-hidden="true">'+x+'</span>').join('')+'<span></span>'.repeat(blanks);
    const today=model.today();
    for(let d=1;d<=daysInMonth;d++) {
      const day=calendarMonth+'-'+String(d).padStart(2,'0');
      const cls='cal-day'+(day===today?' today':'')+(marked.has(day)?' has-data':'');
      const label=model.formatDate(day)+(marked.has(day)?', con actividades':'');
      body+='<button class="'+cls+'" data-day="'+day+'" aria-pressed="'+(date===day)+'" title="'+esc(label)+'" aria-label="'+esc(label)+'">'+d+'</button>';
    }
    const monthLabel=model.formatDate(first,{month:'long',year:'numeric'});
    section.innerHTML='<div class="cal-top"><h2>'+esc(monthLabel)+'</h2><div class="cal-controls"><button data-month="-1" aria-label="Mes anterior">'+icon('chevron-left',15)+'</button><button data-month="1" aria-label="Mes siguiente">'+icon('chevron-right',15)+'</button></div></div><div class="cal-grid">'+body+'</div>';
    section.onclick=event=>{
      const day=event.target.closest('[data-day]');
      if(day){view='agenda';if(root.querySelector('.rail.is-open'))toggleMenu(false);setDate(day.dataset.day);window.scrollTo(0,0);return;}
      const month=event.target.closest('[data-month]');
      if(month){
        firstDay.setUTCMonth(firstDay.getUTCMonth()+Number(month.dataset.month));
        calendarMonth=firstDay.toISOString().slice(0,7);renderCalendar();
      }
    };
  }

  function updateStatus() {
    const badge=root.querySelector('.account-mode');
    if(!badge||!session)return;
    const demo=session.mode==='demo';
    badge.textContent=saving?'Guardando…':(demo?'Demo local':'Cuenta privada');
    badge.title=demo?'Datos de ejemplo guardados en este navegador':'Tus registros se guardan en Supabase';
    const active=state?.tasks.find(t=>t.segments.some(s=>!s.end));
    const running=root.querySelector('.work-running');
    running.hidden=!active;
    if(active) {
      const s=active.segments.find(s=>!s.end);
      running.innerHTML=icon('timer',15)+'<span>Desde '+esc(s.start)+'</span>';
      running.title='Tramo abierto · '+active.title+' · '+active.date;
    }
  }

  function render() {
    if(!state||!root.querySelector('.stage'))return;
    const el=root.querySelector('.stage');
    document.title='Jornada · '+titles[view];
    root.querySelectorAll('[data-view]').forEach(btn=>{
      if(btn.dataset.view===view)btn.setAttribute('aria-current','page');
      else btn.removeAttribute('aria-current');
    });
    el.onclick=null;el.onchange=null;
    if(view==='agenda') window.JAgenda.render(el,getContext());
    else window.JInsights.render(el,getContext(),view);
    renderCalendar(); updateStatus(); updateDateTools();
  }

  function shell() {
    const demo=session.mode==='demo';
    const email=session.user?.email||'';
    const userName=demo?'Cuenta de ejemplo':(email.split('@')[0] || 'Mi cuenta');
    const initials=demo?'JD':userName.split(/[._\s-]+/).slice(0,2).map(p=>p.charAt(0)).join('').toUpperCase();
    root.innerHTML='<div class="app-shell"><button type="button" class="backdrop" aria-label="Cerrar navegación"></button><aside id="side-menu" class="rail" aria-label="Menú de Jornada">'+
      '<div class="brandbar">'+mark+'<span>Jornada</span><button class="close-menu" aria-label="Cerrar menú">'+icon('x')+'</button></div>'+
      '<nav class="rail-nav" aria-label="Vistas principales">'+[['agenda','calendar-days'],['goals','target'],['analysis','bar-chart']].map(([v,i])=>'<button data-view="'+v+'">'+icon(i,19)+titles[v]+'</button>').join('')+'</nav>'+
      '<section class="cal-wrap" aria-label="Calendario de jornadas"></section>'+
      '<div class="rail-bottom"><button class="rail-link" data-help>'+icon('help',18)+' Guía de uso</button><div class="rail-user"><span class="monogram">'+esc(initials)+'</span><div class="usercopy"><b title="'+esc(email)+'">'+esc(userName)+'</b><span class="account-mode" role="status"></span></div>'+
      (demo?'':'<button data-logout aria-label="Cerrar sesión" title="Cerrar sesión">'+icon('logout',18)+'</button>')+'</div></div></aside>'+
      '<div class="shell-content"><header class="workbar"><div class="toolbar-left"><button class="hamburger icon-btn" aria-label="Abrir menú" aria-controls="side-menu" aria-expanded="false">'+icon('menu',20)+'</button><div class="work-context">'+icon('building',17)+'<span>Mercado de Capitales</span><span class="slash">/</span><span class="context-secondary">Control de Gestión</span></div></div>'+
      '<div class="bar-right"><span class="work-running" hidden></span>'+dateTools()+'</div></header><main id="main" tabindex="-1" class="stage"></main></div></div>';
    const tools=root.querySelector('.jd-heading-tools');
    tools.querySelectorAll('[data-step]').forEach(button=>button.onclick=()=>showDay(model.shiftDate(date,Number(button.dataset.step))));
    tools.querySelector('[data-go-today]').onclick=()=>{showDay(model.today());tools.querySelector('input').focus();};
    tools.querySelector('input').onchange=event=>{if(event.target.value)showDay(event.target.value);else updateDateTools();};
    root.querySelector('.hamburger').onclick=()=>toggleMenu(true);
    root.querySelector('.close-menu').onclick=root.querySelector('.backdrop').onclick=()=>toggleMenu(false);
    root.querySelectorAll('[data-view]').forEach(btn=>btn.onclick=()=>navigate(btn.dataset.view));
    root.querySelector('[data-help]').onclick=()=>{if(root.querySelector('.rail.is-open'))toggleMenu(false);showGuide();};
    const logout=root.querySelector('[data-logout]');
    if(logout)logout.onclick=async()=>{
      if(saving){notify('Espera a que termine el guardado.');return;}
      logout.disabled=true;
      try {await store.signOut();location.reload();}
      catch(error){logout.disabled=false;notify(error.message);}
    };
    render();
    clearInterval(clockHandle);
    clockHandle=setInterval(()=>{
      if(saving||view!=='agenda'||date!==model.today()||document.querySelector('dialog[open]'))return;
      if(!state?.tasks.some(t=>t.date===date&&t.segments.some(s=>!s.end)))return;
      const stage=root.querySelector('.stage');
      if(stage.contains(document.activeElement) && document.activeElement.matches('select,input,button,summary'))return;
      window.JAgenda.render(stage,getContext());
    },60000);
  }

  function auth() {
    root.innerHTML='<main id="main" class="auth-screen"><div class="auth-banner">'+brand+
      '<div class="banner-body"><p>Agenda personal</p><h2>Mercado de Capitales y Control de Gestión</h2></div><div class="banner-chart" aria-hidden="true"><div class="auth-hours"><span>08:00</span><span>12:00</span><span>16:00</span></div><div class="auth-bars"><i></i><i></i><i></i><i></i></div></div></div>'+
      '<section class="auth-main"><div class="auth-card"><span class="auth-ico">'+icon('lock',24)+'</span><h1>Iniciar sesión</h1><p>Ingresa a tu agenda personal.</p>'+
      '<form><label>Correo electrónico<input name="email" type="email" autocomplete="username" required placeholder="tu@correo.com"></label><label>Contraseña<span class="pass-field"><input name="password" type="password" autocomplete="current-password" required><button class="icon-btn" type="button" aria-label="Mostrar contraseña">'+icon('eye',18)+'</button></span></label>'+
      '<p class="auth-err" role="alert" hidden></p><button class="btn primary" type="submit">Ingresar</button></form><a href="./GUIA.html" target="_blank" rel="noopener" class="auth-guide">Guía de configuración de la cuenta</a></div></section></main>';
    document.title='Jornada · Iniciar sesión';
    const form=root.querySelector('form');
    const password=form.elements.password;
    const toggle=form.querySelector('.pass-field button');
    toggle.onclick=()=>{password.type=password.type==='password'?'text':'password';toggle.setAttribute('aria-label',password.type==='password'?'Mostrar contraseña':'Ocultar contraseña');};
    form.onsubmit=async event=>{
      event.preventDefault();
      const submit=form.querySelector('[type=submit]');
      if(submit.disabled)return;
      const msg=form.querySelector('.auth-err');
      submit.disabled=true;submit.textContent='Ingresando…';msg.hidden=true;
      try {accept(await store.signIn(form.elements.email.value,password.value));}
      catch(error){msg.hidden=false;msg.textContent=error.message;submit.disabled=false;submit.textContent='Ingresar';}
    };
  }

  function accept(opened) {
    session=opened;
    if(session.mode==='auth'){state=null;auth();return;}
    model.validate(session.state);state=session.state;shell();
  }
  async function boot(){
    try{accept(await store.boot());}
    catch(error){
      root.innerHTML='<main id="main" class="boot boot-error">'+mark+'<h1>No se pudo abrir Jornada</h1><p></p><button class="btn primary">Reintentar</button><a href="./GUIA.html" target="_blank" rel="noopener">Ver guía de configuración</a></main>';
      root.querySelector('p').textContent=error.message;
      root.querySelector('button').onclick=()=>location.reload();
    }
  }
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&!document.querySelector('dialog[open]')&&root.querySelector('.rail.is-open'))toggleMenu(false);
  });
  boot();
})();
