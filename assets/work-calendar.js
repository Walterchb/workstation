/* Calendario mensual, horario del día y edición de eventos. Los horarios se registran en la hora de Lima. */
(() => {
  'use strict';

  const M = window.JModel;
  const C = window.JCalendarModel;
  const {esc,icon} = window.JUI;
  const weekNames = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
  const weekdays = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const palette = ['#167365','#366FAB','#985874','#7365A6','#AA672E','#587B41'];
  const longDay = new Intl.DateTimeFormat('es-PE',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long'});
  const monthName = new Intl.DateTimeFormat('es-PE',{timeZone:'UTC',month:'long',year:'numeric'});
  const shortDate = new Intl.DateTimeFormat('es-PE',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'});
  let currentUser, hidden = new Set(), activeView = 'month', dialogNumber = 0;

  function visibleEvents(state) {
    return C.events(state).filter(event=>!hidden.has(event.calendarId));
  }

  function civilDate(date) { return new Date(date + 'T12:00:00Z'); }

  function dateKey(date) {
    const year=date.getUTCFullYear();
    return year>=1 && year<=9999 ? date.toISOString().slice(0,10) : '';
  }

  function shiftDay(day,amount) {
    const result=civilDate(day);
    result.setUTCDate(result.getUTCDate()+amount);
    return dateKey(result);
  }

  function changeMonth(date, amount) {
    const result = civilDate(date);
    const day = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth()+amount);
    const last = new Date(result.getTime());
    last.setUTCMonth(last.getUTCMonth()+1,0);
    result.setUTCDate(Math.min(day,last.getUTCDate()));
    return dateKey(result);
  }

  function daysOnGrid(date) {
    const start=civilDate(date.slice(0,7)+'-01');
    const end=civilDate(date);
    end.setUTCMonth(end.getUTCMonth()+1,0);
    const offset=(start.getUTCDay()+6)%7;
    const count=Math.ceil((offset+end.getUTCDate())/7)*7;
    start.setUTCDate(1-offset);
    return Array.from({length:count},()=>{
      const day=dateKey(start);
      start.setUTCDate(start.getUTCDate()+1);
      return day;
    });
  }

  function focusControl(stage, selector, data, value) {
    const button = [...stage.querySelectorAll(selector)].find(el => !data || el.dataset[data]===value);
    button?.focus({preventScroll:true});
  }

  function mountDialog(title, html, origin) {
    const dialog = document.createElement('dialog');
    dialog.className = 'wc-dialog';
    const titleId='wc-dialog-title-'+(++dialogNumber);
    dialog.setAttribute('aria-labelledby',titleId);
    dialog.innerHTML = '<form><header><h2 id="'+titleId+'">'+title+'</h2><button type="button" data-wc-close class="icon-btn" aria-label="Cerrar">'+icon('x',16)+'</button></header>'+html+'</form>';
    const form = dialog.querySelector('form');
    let busy = false;
    dialog.oncancel = event => { if(busy) event.preventDefault(); };
    dialog.addEventListener('click',event => {
      if(!busy && event.target.closest('[data-wc-close]')) dialog.close();
    });
    dialog.addEventListener('close',() => {
      dialog.remove();
      if(origin?.isConnected && (!document.querySelector('dialog[open]') || origin.closest('dialog[open]'))) origin.focus({preventScroll:true});
      else if(document.querySelector('dialog[open]')) return;
      else document.querySelector('[data-wc-number][aria-pressed="true"], [data-wc-date]')?.focus({preventScroll:true});
    },{once:true});
    document.body.append(dialog);
    dialog.showModal();
    async function commit(ctx,change,onSave) {
      if(busy) return;
      busy = true;
      form.inert = true;
      form.setAttribute('aria-busy','true');
      try {
        if(await ctx.mutate(change)) {
          dialog.close();
          if(onSave) onSave();
        }
      } finally {
        busy = false;
        form.inert = false;
        form.removeAttribute('aria-busy');
      }
    }
    return {dialog,form,commit};
  }

  function editorFooter(saveText, hasItem, blocked = false) {
    return '<footer>'+(hasItem ? '<button type="button" class="wc-remove" data-wc-delete'+(blocked?' disabled':'')+'>'+icon('trash',14)+'Eliminar</button>' : '')+
      '<button type="button" data-wc-close class="btn">Cancelar</button><button class="btn primary" type="submit">'+saveText+'</button></footer>';
  }

  function deletionPrompt(question) {
    return '<div class="wc-confirm" hidden><p>'+esc(question)+'</p><button class="btn" type="button" data-wc-keep>Conservar</button> <button class="btn wc-danger" type="button" data-wc-confirm>Eliminar</button></div>';
  }

  function bindDelete(form,submitDelete) {
    const del = form.querySelector('[data-wc-delete]');
    if(!del || del.disabled) return;
    const prompt = form.querySelector('.wc-confirm');
    const keep = form.querySelector('[data-wc-keep]');
    const submit = form.querySelector('[type="submit"]');
    del.onclick = () => {
      prompt.hidden=false; del.hidden=true; submit.disabled=true;
      keep.focus();
    };
    keep.onclick = () => {
      prompt.hidden=true; del.hidden=false; submit.disabled=false;
      del.focus();
    };
    form.querySelector('[data-wc-confirm]').onclick=submitDelete;
  }

  function collectionEditor(ctx,item,origin,isCategory=false,onSave) {
    const list = isCategory ? C.categories(ctx.state) : C.calendars(ctx.state);
    const assigned = item && C.events(ctx.state).some(event=>(isCategory?event.categoryId:event.calendarId)===item.id);
    const blocked = item && (assigned || (!isCategory && list.length===1));
    const nameLabel = isCategory?'Nombre de la categoría':'Nombre del calendario';
    const type = isCategory?'categoría':'calendario';
    const title = item ? 'Editar '+type : (isCategory?'Nueva categoría':'Nuevo calendario');
    const id = item?.id || M.id();
    const color = item?.color || palette[list.length%palette.length];
    const help = assigned ? (isCategory?'Cambia la categoría de sus eventos antes de eliminarla.':'Para eliminar este calendario, mueve o elimina primero sus eventos.') : 'Debe haber al menos un calendario.';
    const {form,commit} = mountDialog(title,
      '<div class="wc-form-body"><label>'+nameLabel+'<input name="name" maxlength="80" required autocomplete="off" value="'+esc(item?.name)+'" placeholder="'+(isCategory?'Ej. Seguimiento':'Ej. Estudios')+'"></label>'+
      '<fieldset class="wc-colors"><legend>Color</legend><div>'+palette.map(c=>'<button type="button" data-wc-color="'+c+'" aria-label="Elegir color '+c+'" style="--wc-color:'+c+'"></button>').join('')+
      '<label class="wc-custom-color">Personalizar<input aria-label="Color personalizado" type="color" name="color" value="'+esc(color)+'"></label></div></fieldset>'+
      (blocked?'<small class="wc-help">'+help+'</small>':'')+
      (item&&!blocked?deletionPrompt('¿Eliminar «'+item.name+'»?'):'')+'</div>'+editorFooter('Guardar '+type,!!item,blocked),origin);
    const name = form.elements.name, input = form.elements.color;
    function setColor(c) {
      input.value=c;
      for(const button of form.querySelectorAll('[data-wc-color]')) button.setAttribute('aria-pressed',String(button.dataset.wcColor.toLowerCase()===c.toLowerCase()));
    }
    setColor(color);
    for(const button of form.querySelectorAll('[data-wc-color]')) button.onclick=()=>setColor(button.dataset.wcColor);
    input.oninput=()=>setColor(input.value);
    form.onsubmit=event=>{
      event.preventDefault();
      name.value=name.value.trim();
      if(!form.reportValidity()) return;
      const values = {id,name:name.value,color:input.value};
      const save = isCategory ? C.saveCategory : C.saveCalendar;
      commit(ctx,state=>save(state,values),()=>onSave?.(values));
    };
    const remove = isCategory ? C.removeCategory : C.removeCalendar;
    bindDelete(form,()=>commit(ctx,state=>remove(state,id)));
    name.focus();
  }

  function daySpan(event) {
    return Math.round((civilDate(event.endDate)-civilDate(event.startDate))/86400000);
  }

  function moveToDate(source,date,time) {
    const span=daySpan(source);
    if(source.allDay || !time) {
      const endDate=shiftDay(date,span);
      return endDate ? {...source,reminderMinutes:source.reminderMinutes??null,startDate:date,endDate} : null;
    }
    const minute=hhmm=>Number(hhmm.slice(0,2))*60+Number(hhmm.slice(3));
    const duration=span*1440+minute(source.endTime)-minute(source.startTime);
    const end=minute(time)+duration;
    const endDate=shiftDay(date,Math.floor(end/1440));
    const endTime=String(Math.floor(end/60)%24).padStart(2,'0')+':'+String(end%60).padStart(2,'0');
    return endDate ? {...source,reminderMinutes:source.reminderMinutes??null,startDate:date,startTime:time,endDate,endTime} : null;
  }

  function reminderLabel(minutes) {
    if(minutes==null)return 'Sin aviso';
    if(minutes===0)return 'Al comenzar';
    if(minutes===60)return '1 hora antes';
    if(minutes===1440)return '1 día antes';
    return minutes+' minutos antes';
  }

  function reuseChooser(ctx,origin,onChoose) {
    const calendars=new Map(C.calendars(ctx.state).map(c=>[c.id,c.name]));
    const sorted=C.events(ctx.state).slice().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.startDate.localeCompare(a.startDate));
    const seen=new Set();
    const records=sorted.filter(e=>{
      const signature=JSON.stringify([e.title,e.calendarId,e.categoryId||'',e.kind,e.allDay,e.startTime,e.endTime,daySpan(e),e.location,e.description,e.reminderMinutes??null]);
      if(seen.has(signature)) return false;
      seen.add(signature);return true;
    });
    const {dialog,form}=mountDialog('Reutilizar evento','<div class="wc-form-body wc-reuse-picker"><label>Buscar evento<input type="search" name="search" placeholder="Título, calendario o categoría" autocomplete="off"></label><div data-wc-matches></div></div>',origin);
    const results=form.querySelector('[data-wc-matches]');
    const normalize=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
    function filter() {
      const query=normalize(form.elements.search.value.trim());
      const choices=records.filter(e=>normalize([e.title,calendars.get(e.calendarId),C.eventCategory(ctx.state,e)?.name,e.location].join(' ')).includes(query));
      results.innerHTML=choices.length?'<ul>'+choices.map(e=>{
        const cat=C.eventCategory(ctx.state,e);
        const span=daySpan(e);
        const hours=e.allDay?'Todo el día':e.startTime+' – '+e.endTime;
        const range=span?' · '+(span+1)+' días':'';
        const meta=[shortDate.format(civilDate(e.startDate)),calendars.get(e.calendarId),cat?.name,hours+range].filter(Boolean).join(' · ');
        return '<li><button type="button" data-wc-reuse-id="'+esc(e.id)+'" style="--wc-color:'+esc(C.eventColor(ctx.state,e))+'"><span><strong>'+esc(e.title)+'</strong><small>'+esc(meta)+'</small></span>'+icon('chevron-right',15)+'</button></li>';
      }).join('')+'</ul>':'<p class="wc-empty">'+(records.length?'Ningún evento coincide con tu búsqueda.':'Los eventos que guardes aparecerán aquí para volver a usarlos.')+'</p>';
    }
    form.onsubmit=e=>e.preventDefault();
    form.elements.search.oninput=filter;
    results.onclick=e=>{
      const option=e.target.closest('[data-wc-reuse-id]');
      const item=option&&records.find(record=>record.id===option.dataset.wcReuseId);
      if(item){dialog.close();onChoose(item);}
    };
    filter();form.elements.search.focus();
  }

  function eventEditor(ctx,record,origin,defaults={}) {
    const initial=record||defaults;
    const categories=C.categories(ctx.state).slice();
    const calendars=C.calendars(ctx.state);
    const primary = calendars.find(cal=>!hidden.has(cal.id)) || calendars[0];
    const choices = calendars.map(cal=>'<option value="'+esc(cal.id)+'"'+(cal.id===(initial.calendarId||primary.id)?' selected':'')+'>'+esc(cal.name)+'</option>').join('');
    const start=initial.startDate||ctx.date;
    const end=initial.endDate||start;
    const id=record?.id||M.id();
    const isExistingOrReused=!!record || Object.hasOwn(defaults,'reminderMinutes');
    const categoryId=initial.categoryId||'';
    const reminder=isExistingOrReused ? initial.reminderMinutes??null : 5;
    function categoryChoices(id) {
      return '<option value=""'+(!id?' selected':'')+'>Sin categoría</option>'+categories.map(c=>'<option value="'+esc(c.id)+'"'+(c.id===id?' selected':'')+'>'+esc(c.name)+'</option>').join('');
    }
    const reminderChoices=[null,...C.reminderOptions].map(value=>'<option value="'+(value??'')+'"'+(value===reminder?' selected':'')+'>'+reminderLabel(value)+'</option>').join('');
    const {form,commit}=mountDialog(record?'Editar evento':'Nuevo evento','<div class="wc-form-body">'+
      (!record && C.events(ctx.state).length ? '<button class="wc-import" type="button" data-wc-reuse-here>'+icon('clipboard',15)+'Usar un evento anterior</button>' : '')+
      '<label>Título<input name="title" maxlength="180" autocomplete="off" required placeholder="Ej. Reunión de coordinación" value="'+esc(initial.title)+'"></label>'+
      '<div class="wc-field-pair"><label>Calendario<select name="calendarId">'+choices+'</select></label><label>Tipo<select name="kind"><option value="event">Evento</option><option value="meeting"'+(initial.kind==='meeting'?' selected':'')+'>Reunión</option></select></label></div>'+
      '<div class="wc-field-pair"><div class="wc-category-field"><label>Categoría<select name="categoryId">'+categoryChoices(categoryId)+'</select></label><button type="button" data-wc-add-category class="wc-icon" aria-label="Nueva categoría" title="Nueva categoría">'+icon('plus',15)+'</button></div>'+
      '<label>Aviso<select name="reminderMinutes">'+reminderChoices+'</select></label></div>'+
      '<label class="wc-check"><input type="checkbox" name="allDay"'+(initial.allDay?' checked':'')+'>Todo el día</label>'+
      '<div class="wc-field-pair"><label>Fecha de inicio<input required name="startDate" type="date" min="0001-01-01" max="9999-12-31" value="'+esc(start)+'"></label><label data-wc-time>Hora de inicio<input required name="startTime" type="time" value="'+esc(initial.startTime||'09:00')+'"></label></div>'+
      '<div class="wc-field-pair"><label>Fecha de fin<input required name="endDate" type="date" min="0001-01-01" max="9999-12-31" value="'+esc(end)+'"></label><label data-wc-time>Hora de fin<input required name="endTime" type="time" value="'+esc(initial.endTime||'10:00')+'"></label></div>'+
      '<small class="wc-help" data-wc-time>Zona horaria de Lima</small>'+
      '<label>Lugar o enlace <small>(opcional)</small><input name="location" maxlength="240" value="'+esc(initial.location)+'"></label>'+
      '<label>Descripción <small>(opcional)</small><textarea name="description" rows="2" maxlength="6000">'+esc(initial.description)+'</textarea></label>'+
      (record?deletionPrompt('¿Eliminar «'+record.title+'»?'):'')+'</div>'+editorFooter('Guardar evento',!!record),origin);
    const f=form.elements;
    let previousStart=start, pendingKey='', stamp='';
    function checkDates() {
      f.endDate.min=f.startDate.value||'0001-01-01';
      f.endTime.setCustomValidity('');
      if(!f.allDay.checked && f.startDate.value===f.endDate.value && f.endTime.value && f.startTime.value && f.endTime.value<=f.startTime.value)
        f.endTime.setCustomValidity('La hora de fin debe ser posterior a la de inicio.');
    }
    function setAllDay() {
      form.querySelectorAll('[data-wc-time]').forEach(el=>{el.hidden=f.allDay.checked;});
      f.startTime.disabled=f.endTime.disabled=f.allDay.checked;
      checkDates();
    }
    const addCategory=form.querySelector('[data-wc-add-category]');
    addCategory.onclick=()=>collectionEditor(ctx,null,addCategory,true,value=>{
      categories.push(value);
      f.categoryId.innerHTML=categoryChoices(value.id);
      f.categoryId.focus();
    });
    const useExisting=form.querySelector('[data-wc-reuse-here]');
    if(useExisting) useExisting.onclick=()=>reuseChooser(ctx,useExisting,source=>{
      const copy=moveToDate(source,f.startDate.value||ctx.date,defaults.startTime && !f.allDay.checked ? f.startTime.value : '');
      if(!copy){ctx.toast('El evento excede el rango de fechas.');return;}
      for(const field of ['title','kind','calendarId','location','description','startDate','endDate']) f[field].value=copy[field];
      f.categoryId.value=copy.categoryId||'';
      f.reminderMinutes.value=String(copy.reminderMinutes??'');
      f.startTime.value=copy.startTime||'09:00'; f.endTime.value=copy.endTime||'10:00';
      f.allDay.checked=copy.allDay;
      previousStart=copy.startDate;
      setAllDay();f.title.focus();
    });
    f.startDate.oninput=()=>{
      if(f.startDate.value && previousStart && f.endDate.value && f.endDate.value>=previousStart) {
        const span=daySpan({startDate:previousStart,endDate:f.endDate.value});
        f.endDate.value=shiftDay(f.startDate.value,span) || f.startDate.value;
      } else if(f.startDate.value && f.endDate.value < f.startDate.value) f.endDate.value=f.startDate.value;
      previousStart=f.startDate.value;checkDates();
    };
    f.endDate.oninput=f.startTime.oninput=f.endTime.oninput=checkDates;
    f.allDay.onchange=setAllDay;
    setAllDay();
    form.onsubmit=event=>{
      event.preventDefault();
      f.title.value=f.title.value.trim();
      checkDates();
      if(!form.reportValidity()) return;
      const allDay=f.allDay.checked;
      const values={id,title:f.title.value,calendarId:f.calendarId.value,categoryId:f.categoryId.value,reminderMinutes:f.reminderMinutes.value===''?null:Number(f.reminderMinutes.value),
        kind:f.kind.value,allDay,startDate:f.startDate.value,endDate:f.endDate.value,
        startTime:allDay?'':f.startTime.value,endTime:allDay?'':f.endTime.value,location:f.location.value.trim(),description:f.description.value.trim()};
      const signature=JSON.stringify(values);
      if(signature!==pendingKey) {pendingKey=signature; stamp=new Date().toISOString();}
      if(record) values.expectedSequence=record.sequence;
      commit(ctx,state=>C.saveEvent(state,values,stamp),()=>{
        hidden.delete(values.calendarId);
        if(C.occursOn(values,ctx.date)) ctx.render();
        else ctx.setDate(values.startDate);
      });
    };
    bindDelete(form,()=>commit(ctx,state=>C.removeEvent(state,id)));
    f.title.focus();
  }

  function appleChooser(ctx,origin) {
    const calendars=C.calendars(ctx.state);
    if(calendars.length===1){window.JAppleCalendar.open(calendars[0],ctx);return;}
    const {dialog,form}=mountDialog('Calendario de Apple','<div class="wc-form-body"><label>Calendario para vincular<select name="calendarId">'+
      calendars.map(cal=>'<option value="'+esc(cal.id)+'">'+esc(cal.name)+'</option>').join('')+'</select></label></div>'+
      '<footer><button type="button" data-wc-close class="btn">Cancelar</button><button class="btn primary" type="submit">Continuar</button></footer>',origin);
    form.onsubmit=event=>{
      event.preventDefault();
      const chosen=calendars.find(cal=>cal.id===form.elements.calendarId.value);
      dialog.close();
      window.JAppleCalendar.open(chosen,ctx);
    };
    form.elements.calendarId.focus();
  }

  function timeLabel(event,date) {
    if(event.allDay) return 'Todo el día';
    if(event.startDate===event.endDate) return event.startTime+' – '+event.endTime;
    if(date===event.startDate) return 'Desde '+event.startTime;
    if(date===event.endDate) return 'Hasta '+event.endTime;
    return 'Todo el día';
  }

  function fullDateRange(event) {
    return shortDate.format(civilDate(event.startDate))+' – '+shortDate.format(civilDate(event.endDate));
  }

  function render(stage,ctx) {
    if(currentUser!==ctx.user?.id){currentUser=ctx.user?.id;hidden=new Set();activeView='month';}
    const dayMode=activeView==='day';
    const calendars=C.calendars(ctx.state), byId=new Map(calendars.map(c=>[c.id,c]));
    const dates=dayMode?[ctx.date]:daysOnGrid(ctx.date), actualDates=dates.filter(Boolean), first=actualDates[0], last=actualDates.at(-1), today=M.today();
    const items=visibleEvents(ctx.state).filter(e=>e.startDate<=last && e.endDate>=first)
      .sort((a,b)=>Number(b.allDay)-Number(a.allDay) || a.startDate.localeCompare(b.startDate) || a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title,'es'));
    const onDay=new Map(actualDates.map(date=>[date,items.filter(e=>C.occursOn(e,date))]));
    const selected=onDay.get(ctx.date)||[];
    const month=monthName.format(civilDate(ctx.date));
    const weekday=longDay.format(civilDate(ctx.date));
    const categories=C.categories(ctx.state);
    const categoriesList=categories.map(c=>'<li><button class="wc-category-row" type="button" data-wc-category-edit="'+esc(c.id)+'" aria-label="Editar categoría '+esc(c.name)+'"><span class="wc-category-dot" style="--wc-color:'+esc(c.color)+'"></span><span>'+esc(c.name)+'</span>'+icon('pencil',13)+'</button></li>').join('');
    const calendarList=calendars.map(cal=>'<li><label style="--wc-color:'+esc(cal.color)+'"><input type="checkbox" data-wc-visible="'+esc(cal.id)+'"'+
      (hidden.has(cal.id)?'':' checked')+'><span>'+esc(cal.name)+'</span></label><button type="button" class="wc-icon" data-wc-cal-edit="'+esc(cal.id)+'" aria-label="Editar calendario '+esc(cal.name)+'">'+icon('pencil',14)+'</button></li>').join('');
    function dayBox(date) {
      if(!date) return '<div class="wc-cell outside" aria-hidden="true"></div>';
      const events=onDay.get(date), other=date.slice(0,7)!==ctx.date.slice(0,7);
      const label=longDay.format(civilDate(date))+(events.length?', '+events.length+(events.length===1?' evento':' eventos'):'');
      const chips=events.map(event=>{
        const clock=event.allDay || date!==event.startDate ? '' : '<time>'+esc(event.startTime)+'</time> ';
        return '<button class="wc-chip" type="button" data-wc-event="'+esc(event.id)+'" aria-label="'+esc(event.title+', '+timeLabel(event,date))+'" style="--wc-color:'+esc(C.eventColor(ctx.state,event))+'">'+clock+'<span>'+esc(event.title)+'</span></button>';
      }).join('');
      return '<div class="wc-cell'+(other?' outside':'')+(date===ctx.date?' selected':'')+(date===today?' today':'')+'" data-wc-day="'+date+'">'+
        '<button type="button" class="wc-number" data-wc-number="'+date+'" tabindex="'+(date===ctx.date?'0':'-1')+'" aria-label="'+esc(label)+'" aria-pressed="'+(date===ctx.date)+'"'+(date===today?' aria-current="date"':'')+'>'+Number(date.slice(8))+'</button>'+
        '<div class="wc-chips">'+chips+'</div></div>';
    }
    const dailyEvents=selected.map(event=>{
      const cal=byId.get(event.calendarId), category=C.eventCategory(ctx.state,event);
      return '<li><button type="button" class="wc-day-event" data-wc-event="'+esc(event.id)+'" style="--wc-color:'+esc(C.eventColor(ctx.state,event))+'">'+
        '<span class="wc-day-time">'+icon('clock',13)+esc(timeLabel(event,ctx.date))+'</span><strong>'+esc(event.title)+'</strong>'+
        '<span class="wc-event-meta"><i></i>'+esc([category?.name,cal.name].filter(Boolean).join(' · '))+(event.kind==='meeting'?' · Reunión':'')+'</span>'+
        (event.startDate!==event.endDate?'<small>'+esc(fullDateRange(event))+'</small>':'')+
        (event.location?'<small>'+esc(event.location)+'</small>':'')+'</button></li>';
    }).join('');
    const movePage=dayMode?shiftDay:changeMonth;
    const label=dayMode?weekday:month;
    const picker=dayMode?'<input type="date" data-wc-date aria-label="Elegir fecha" min="0001-01-01" max="9999-12-31" value="'+ctx.date+'">':
      '<input type="month" data-wc-month aria-label="Elegir mes y año" min="0001-01" max="9999-12" value="'+ctx.date.slice(0,7)+'">';
    const modePicker='<div class="wc-modes" role="group" aria-label="Vista del calendario">'+[['month','Mes'],['day','Día']].map(([key,name])=>
      '<button type="button" data-wc-mode="'+key+'" aria-pressed="'+(activeView===key)+'">'+name+'</button>').join('')+'</div>';
    const body=dayMode?'<div data-wc-day-body></div>':
      '<div class="wc-weekdays" aria-hidden="true">'+weekdays.map((short,i)=>'<span title="'+weekNames[i]+'">'+short+'</span>').join('')+'</div><div class="wc-grid">'+dates.map(dayBox).join('')+'</div>';
    const dayAgenda=dayMode?'':'<section class="wc-day panel" aria-label="Agenda del día"><header><span>Agenda del día</span><h2>'+esc(weekday)+'</h2></header>'+
      (dailyEvents?'<ul>'+dailyEvents+'</ul>':'<p class="wc-empty">'+(calendars.every(cal=>hidden.has(cal.id))?'Activa un calendario para ver sus eventos.':'Sin eventos para este día.')+'</p>')+'</section>';
    stage.innerHTML='<section class="wc-view"><header class="wc-heading"><h1>Calendario</h1><div class="wc-actions"><button type="button" class="btn" data-wc-apple>'+icon('calendar',16)+'Calendario de Apple</button>'+
      '<button type="button" class="btn" data-wc-reuse>'+icon('clipboard',16)+'Reutilizar evento</button><button type="button" class="btn primary" data-wc-new>'+icon('plus',16)+'Nuevo evento</button></div></header>'+
      '<div class="wc-layout"><section class="wc-month panel" aria-label="'+(dayMode?'Vista de día':'Vista mensual')+'"><header class="wc-month-head"><h2><label class="wc-month-picker"><span>'+esc(label)+'</span>'+icon('chevron-down',14)+picker+'</label></h2>'+
      '<div class="wc-month-controls">'+modePicker+'<div class="wc-month-nav"><button type="button" class="wc-today" data-wc-today>Hoy</button>'+
      '<button class="wc-icon" type="button" data-wc-step="-1" aria-label="'+(dayMode?'Día anterior':'Mes anterior')+'"'+(!movePage(ctx.date,-1)?' disabled':'')+'>'+icon('chevron-left',16)+'</button><button class="wc-icon" type="button" data-wc-step="1" aria-label="'+(dayMode?'Día siguiente':'Mes siguiente')+'"'+(!movePage(ctx.date,1)?' disabled':'')+'>'+icon('chevron-right',16)+'</button></div></div></header>'+body+'</section>'+
      '<aside class="wc-right">'+dayAgenda+'<section class="wc-calendars panel" aria-label="Mis calendarios"><header><h2>Mis calendarios</h2><button type="button" class="wc-icon" data-wc-cal-new aria-label="Agregar calendario" title="Agregar calendario">'+icon('plus',17)+'</button></header><ul>'+calendarList+'</ul></section>'+
      '<section class="wc-calendars wc-categories panel" aria-label="Categorías de eventos"><header><h2>Categorías de eventos</h2><button type="button" class="wc-icon" data-wc-category-new aria-label="Agregar categoría" title="Agregar categoría">'+icon('plus',17)+'</button></header><ul>'+categoriesList+'</ul></section></aside></div></section>';
    const view=stage.querySelector('.wc-view');
    if(dayMode) window.JCalendarDay.render(view.querySelector('[data-wc-day-body]'),{
      date:ctx.date,state:ctx.state,events:selected,restoreKey:ctx.user?.id,
      onCreate:(defaults,origin)=>eventEditor(ctx,null,origin,defaults),
      onEdit:(item,origin)=>eventEditor(ctx,item,origin)
    });
    function goTo(date,refocus=false) {
      if(!date) return;
      ctx.setDate(date);
      if(refocus) {
        if(dayMode) focusControl(stage,'[data-wc-date]');
        else focusControl(stage,'[data-wc-number]','wcNumber',date);
      }
    }
    view.onchange=event=>{
      if(event.target.hasAttribute('data-wc-date')) {
        const chosen=event.target.value;
        if(chosen && chosen>='0001-01-01' && chosen<='9999-12-31') goTo(chosen,true);
        return;
      }
      if(event.target.hasAttribute('data-wc-month')) {
        const next=event.target.value;
        if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(next) || next.startsWith('0000')) return;
        const dest=civilDate(next+'-01'), from=civilDate(ctx.date);
        const difference=12*(dest.getUTCFullYear()-from.getUTCFullYear())+dest.getUTCMonth()-from.getUTCMonth();
        goTo(changeMonth(ctx.date,difference));focusControl(stage,'[data-wc-month]');
        return;
      }
      const visible=event.target.closest('[data-wc-visible]');
      if(!visible) return;
      const id=visible.dataset.wcVisible;
      if(visible.checked) hidden.delete(id); else hidden.add(id);
      ctx.render(); focusControl(stage,'[data-wc-visible]','wcVisible',id);
    };
    view.onkeydown=event=>{
      const day=event.target.closest('[data-wc-number]');
      const steps={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
      if(!day || !Object.hasOwn(steps,event.key)) return;
      event.preventDefault();goTo(shiftDay(day.dataset.wcNumber,steps[event.key]),true);
    };
    view.onclick=event=>{
      const button=event.target.closest('button');
      const day=event.target.closest('[data-wc-day]')?.dataset.wcDay;
      if(button?.hasAttribute('data-wc-event')){
        const item=items.find(e=>e.id===button.dataset.wcEvent);
        if(item) {
          if(day && day!==ctx.date){ctx.setDate(day);eventEditor({...ctx,date:day},item,button);}
          else eventEditor(ctx,item,button);
        }
      } else if(day) goTo(day,true);
      else if(button?.hasAttribute('data-wc-today')) goTo(today,true);
      else if(button?.hasAttribute('data-wc-step')){
        const step=button.dataset.wcStep;
        goTo(movePage(ctx.date,Number(step)));focusControl(stage,'[data-wc-step]','wcStep',step);
      } else if(button?.hasAttribute('data-wc-mode')){
        activeView=button.dataset.wcMode;ctx.render();focusControl(stage,'[data-wc-mode]','wcMode',activeView);
      } else if(button?.hasAttribute('data-wc-new')) eventEditor(ctx,null,button);
      else if(button?.hasAttribute('data-wc-reuse')) reuseChooser(ctx,button,source=>{
        const defaults=moveToDate(source,ctx.date);
        if(defaults)eventEditor(ctx,null,button,defaults);
        else ctx.toast('El evento excede el rango de fechas.');
      });
      else if(button?.hasAttribute('data-wc-cal-new')) collectionEditor(ctx,null,button);
      else if(button?.hasAttribute('data-wc-cal-edit')) collectionEditor(ctx,byId.get(button.dataset.wcCalEdit),button);
      else if(button?.hasAttribute('data-wc-category-new')) collectionEditor(ctx,null,button,true);
      else if(button?.hasAttribute('data-wc-category-edit')) collectionEditor(ctx,categories.find(c=>c.id===button.dataset.wcCategoryEdit),button,true);
      else if(button?.hasAttribute('data-wc-apple')) appleChooser(ctx,button);
    };
  }
  function openEvent(id,ctx) {
    const item=C.events(ctx.state).find(event=>event.id===id);
    if(item)eventEditor(ctx,item,document.activeElement);
  }

  window.JWorkCalendar={render,visibleEvents,openEvent};
})();
