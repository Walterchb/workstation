/* Navegación, calendario y confirmación de cambios en el espacio personal. */
(() => {
  'use strict';
  const {icon,esc}=window.JUI;
  const model=window.JModel;
  const store=window.JStore;
  const root=document.getElementById('root');
  const titles={agenda:'Actividades',notes:'Notas',goals:'Objetivos',analysis:'Análisis',categories:'Categorías'};
  let view='agenda', date=model.today(), calendarMonth=date.slice(0,7);
  let session=null, state=null, saving=false, clockHandle;
  const mark='<img src="./assets/icons/mark.svg" width="37" height="37" alt="">';
  const brand='<div class="brandbar">'+mark+'<span>Work Hub</span></div>';

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

  function openSearch() {
    if(!state || document.querySelector('dialog[open]'))return;
    window.JSearch.open(getContext());
  }

  function openSearchTask(id) {
    if(!state.tasks.some(task=>task.id===id)){notify('El registro ya no está disponible.');return;}
    view='agenda';
    window.JAgenda.openTaskDetail(id,getContext());
  }

  function openSearchNote(id) {
    if(!state.notes?.some(note=>note.id===id)){notify('La nota ya no está disponible.');return;}
    navigate('notes');
    window.JNotes.open(id,getContext());
  }

  function getContext() {
    const day=date;
    return {state,user:session?.user,date:day,setDate,mutate,toast:notify,render,icon,navigate,openSearch,openSearchTask,openSearchNote,
      updateTaskField:(id,field,value)=>updateTaskField(day,id,field,value),
      updateTaskFieldForDate:updateTaskField,
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

  function weeklyAgenda() {
    return view === 'agenda' && window.JAgenda.getMode() === 'week';
  }

  function updateDateTools() {
    const tools=root.querySelector('.jd-heading-tools');
    tools.hidden=view!=='agenda' && view!=='goals';
    if(tools.hidden)return;
    const week=weeklyAgenda();
    const unit=week?'Semana':'Día';
    const today=model.today();
    let inCurrentPeriod=date===today;
    const fmt=(value,parts)=>model.formatDate(value,parts).replace(/\./g,'');
    let label=model.formatDate(date);
    let short=fmt(date,{day:'numeric',month:'short'});
    let long=fmt(date,{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    if(week) {
      const days=window.JWeek.days(state,date);
      const start=days[0], end=days[days.length-1];
      const sameMonth=start.slice(0,7)===end.slice(0,7);
      const first=fmt(start,sameMonth?{day:'numeric'}:{day:'numeric',month:'short'});
      short=first+' – '+fmt(end,{day:'numeric',month:'short'});
      long=start.slice(0,4)===end.slice(0,4)?short+' '+end.slice(0,4):
        fmt(start,{day:'numeric',month:'short',year:'numeric'})+' – '+fmt(end,{day:'numeric',month:'short',year:'numeric'});
      label='Semana del '+model.formatDate(start)+' al '+model.formatDate(end);
      const bounds=window.JWeek.range(date);
      inCurrentPeriod=today>=bounds.start && today<=bounds.end;
    }
    tools.querySelector('.date-long').textContent=long;
    tools.querySelector('.date-short').textContent=short;
    const input=tools.querySelector('input');
    input.value=date;
    input.setAttribute('aria-label',week?'Elegir una fecha de la semana':'Elegir fecha de la jornada');
    tools.querySelector('.jd-picker').title=label;
    for(const btn of tools.querySelectorAll('[data-step]')) {
      const name=unit+(btn.dataset.step==='-1'?' anterior':' siguiente');
      btn.setAttribute('aria-label',name);
      btn.title=name;
    }
    const todayButton=tools.querySelector('[data-go-today]');
    todayButton.hidden=inCurrentPeriod && view==='agenda';
    todayButton.textContent=week?'Esta semana':'Ir a hoy';
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
      if(day){view='agenda';if(root.querySelector('.rail.is-open'))toggleMenu(false);window.JAgenda.openDay(day.dataset.day,getContext());window.scrollTo(0,0);return;}
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
    badge.textContent=saving?'Guardando…':'Cuenta privada';
    badge.title='Tus registros se guardan en Supabase';
    const active=state?.tasks.find(t=>t.segments.some(s=>!s.end));
    const running=root.querySelector('.work-running');
    running.hidden=!active;
    if(active) {
      const s=active.segments.find(s=>!s.end);
      running.innerHTML=icon('timer',15)+'<span>Desde '+esc(s.start)+'</span>';
      running.title='Tramo abierto · '+active.title+' · '+active.date;
    }
  }

  function updateContext(stage) {
    let detail='';
    if(view==='agenda') detail=root.querySelector('#work-modes [data-jd-mode][aria-pressed="true"]')?.textContent.trim();
    if(view==='analysis') detail=stage.querySelector('[data-period][aria-pressed="true"]')?.textContent.trim();
    if(view==='goals') detail=stage.querySelector('.ji-detail-head h1')?.textContent;
    const name=titles[view];
    const path=root.querySelector('.work-context');
    const separator='<span class="crumb-separator" aria-hidden="true">/</span>';
    path.innerHTML='<span class="crumb-home">Work Hub</span>'+separator+
      (detail?'<span class="crumb-parent">'+esc(name)+'</span>'+separator:'')+
      '<span class="crumb-current" aria-current="page" title="'+esc(detail||name)+'">'+esc(detail||name)+'</span>';
    document.title=[detail,name,'Work Hub'].filter(Boolean).join(' · ');
  }

  function render() {
    if(!state||!root.querySelector('.stage'))return;
    const el=root.querySelector('.stage');
    root.querySelectorAll('[data-view]').forEach(btn=>{
      if(btn.dataset.view===view)btn.setAttribute('aria-current','page');
      else btn.removeAttribute('aria-current');
    });
    el.onclick=null;el.onchange=null;
    const modes=root.querySelector('#work-modes');
    modes.hidden=view!=='agenda';
    if(!modes.hidden) window.JAgenda.renderModes(modes,getContext());
    if(view==='agenda') window.JAgenda.render(el,getContext());
    else if(view==='notes') window.JNotes.render(el,getContext());
    else if(view==='categories') window.JCategories.render(el,getContext());
    else window.JInsights.render(el,getContext(),view);
    updateContext(el); renderCalendar(); updateProfile(); updateStatus(); updateDateTools();
  }

  function updateProfile() {
    const {name,initials,photo}=window.JProfile.display(state,session.user);
    const trigger=root.querySelector('[data-profile]');
    const avatar=trigger.querySelector('.monogram');
    const label=trigger.querySelector('.usercopy b');
    label.textContent=name;
    trigger.title='Editar perfil · '+name;
    if(photo) {
      let img=avatar.querySelector('img');
      if(!img){img=document.createElement('img');img.alt='';avatar.replaceChildren(img);}
      if(img.getAttribute('src')!==photo)img.src=photo;
    } else if(avatar.textContent!==initials||avatar.querySelector('img')) {
      avatar.textContent=initials;
    }
  }

  function shell() {
    root.innerHTML='<div class="app-shell"><button type="button" class="backdrop" aria-label="Cerrar navegación"></button><aside id="side-menu" class="rail" aria-label="Menú de Work Hub">'+
      '<div class="brandbar">'+mark+'<span>Work Hub</span><button class="close-menu" aria-label="Cerrar menú">'+icon('x')+'</button></div>'+
      '<nav class="rail-nav" aria-label="Vistas principales">'+[['agenda','calendar-days'],['notes','notes-board'],['goals','target'],['analysis','bar-chart'],['categories','layers']].map(([v,i])=>'<button data-view="'+v+'">'+icon(i,19)+titles[v]+'</button>').join('')+'</nav>'+
      '<section class="cal-wrap" aria-label="Calendario de jornadas"></section>'+
      '<div class="rail-bottom"><div class="rail-user"><button class="profile-trigger" data-profile type="button" aria-label="Editar perfil" aria-haspopup="dialog"><span class="monogram" aria-hidden="true"></span><span class="usercopy"><b></b><span class="account-mode" role="status"></span></span>'+icon('pencil',13)+'</button>'+
      '<button data-logout aria-label="Cerrar sesión" title="Cerrar sesión">'+icon('logout',18)+'</button></div></div></aside>'+
      '<div class="shell-content"><header class="workbar"><div class="toolbar-left"><button class="hamburger icon-btn" aria-label="Abrir menú" aria-controls="side-menu" aria-expanded="false">'+icon('menu',20)+'</button><nav class="work-context" aria-label="Ubicación actual"></nav></div>'+
      '<div id="work-modes" data-agenda-modes></div><div class="bar-right"><span class="work-running" hidden></span>'+
      '<button class="work-search" data-work-search type="button" aria-label="Buscar en Work Hub" aria-haspopup="dialog" aria-keyshortcuts="Control+k Meta+k">'+icon('search',16)+'<span>Buscar</span></button>'+
      dateTools()+'</div></header><main id="main" tabindex="-1" class="stage"></main></div></div>';
    const findButton=root.querySelector('[data-work-search]');
    findButton.title='Buscar ('+(/Mac|iPad|iPhone/.test(navigator.platform||'')?'⌘':'Ctrl')+' + K)';
    findButton.onclick=openSearch;
    const tools=root.querySelector('.jd-heading-tools');
    tools.querySelectorAll('[data-step]').forEach(button=>button.onclick=()=>showDay(model.shiftDate(date,Number(button.dataset.step)*(weeklyAgenda()?7:1))));
    tools.querySelector('[data-go-today]').onclick=()=>{showDay(model.today());tools.querySelector('input').focus();};
    tools.querySelector('input').onchange=event=>{if(event.target.value)showDay(event.target.value);else updateDateTools();};
    root.querySelector('.hamburger').onclick=()=>toggleMenu(true);
    root.querySelector('.close-menu').onclick=root.querySelector('.backdrop').onclick=()=>toggleMenu(false);
    root.querySelectorAll('[data-view]').forEach(btn=>btn.onclick=()=>navigate(btn.dataset.view));
    root.querySelector('[data-profile]').onclick=()=>window.JProfile.open(getContext(),session.user);
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
      if(saving||view!=='agenda'||document.querySelector('dialog[open]'))return;
      const today=model.today();
      const visible=weeklyAgenda()?window.JWeek.days(state,date).includes(today):date===today;
      if(!visible||!state?.tasks.some(t=>t.date===today&&t.segments.some(s=>!s.end)))return;
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
      '<p class="auth-err" role="alert" hidden></p><button class="btn primary" type="submit">Ingresar</button></form></div></section></main>';
    document.title='Work Hub · Iniciar sesión';
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
      const configuration=error.code==='CONFIG';
      document.title=(configuration?'Configuración':'Acceso')+' · Work Hub';
      root.innerHTML='<main id="main" class="boot boot-error">'+mark+'<h1>'+(configuration?'Configura la conexión de Work Hub':'No se pudo abrir Work Hub')+'</h1><p role="status"></p><button class="btn primary">Reintentar</button></main>';
      root.querySelector('p').textContent=error.message;
      root.querySelector('button').onclick=()=>location.reload();
    }
  }
  document.addEventListener('keydown',e=>{
    if(state && (e.ctrlKey||e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase()==='k' && !document.querySelector('dialog[open]')){
      e.preventDefault();
      openSearch();
    }
    if(e.key==='Escape'&&!document.querySelector('dialog[open]')&&root.querySelector('.rail.is-open'))toggleMenu(false);
  });
  boot();
})();
