/* Vista mensual y agenda de eventos. Los horarios se registran en la hora de Lima. */
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
  let currentUser, hidden = new Set();

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
    dialog.setAttribute('aria-labelledby','wc-dialog-title');
    dialog.innerHTML = '<form><header><h2 id="wc-dialog-title">'+title+'</h2><button type="button" data-wc-close class="icon-btn" aria-label="Cerrar">'+icon('x',16)+'</button></header>'+html+'</form>';
    const form = dialog.querySelector('form');
    let busy = false;
    dialog.oncancel = event => { if(busy) event.preventDefault(); };
    dialog.addEventListener('click',event => {
      if(!busy && event.target.closest('[data-wc-close]')) dialog.close();
    });
    dialog.addEventListener('close',() => {
      dialog.remove();
      if(document.querySelector('dialog[open]')) return;
      if(origin?.isConnected) origin.focus({preventScroll:true});
      else document.querySelector('[data-wc-number][aria-pressed="true"]')?.focus({preventScroll:true});
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

  function calendarEditor(ctx,calendar,origin) {
    const existing = C.calendars(ctx.state);
    const assigned = calendar && C.events(ctx.state).some(e=>e.calendarId===calendar.id);
    const blocked = calendar && (assigned || existing.length===1);
    const color = calendar?.color || palette[existing.length%palette.length];
    const id = calendar?.id || M.id();
    const {form,commit} = mountDialog(calendar?'Editar calendario':'Nuevo calendario',
      '<div class="wc-form-body"><label>Nombre del calendario<input name="name" maxlength="80" required autocomplete="off" value="'+esc(calendar?.name)+'" placeholder="Ej. Estudios"></label>'+
      '<fieldset class="wc-colors"><legend>Color</legend><div>'+palette.map(c=>'<button type="button" data-wc-color="'+c+'" aria-label="Elegir color '+c+'" style="--wc-color:'+c+'"></button>').join('')+
      '<label class="wc-custom-color">Personalizar<input aria-label="Color personalizado" type="color" name="color" value="'+esc(color)+'"></label></div></fieldset>'+
      (blocked?'<small class="wc-help">'+(assigned?'Para eliminar este calendario, mueve o elimina primero sus eventos.':'Debe haber al menos un calendario.')+'</small>':'')+
      (calendar&&!blocked?deletionPrompt('¿Eliminar el calendario «'+calendar.name+'»?'):'')+'</div>'+editorFooter('Guardar calendario',!!calendar,blocked),origin);
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
      commit(ctx,state=>C.saveCalendar(state,values));
    };
    bindDelete(form,()=>commit(ctx,state=>C.removeCalendar(state,id)));
    name.focus();
  }

  function eventEditor(ctx,record,origin) {
    const calendars=C.calendars(ctx.state);
    const primary = calendars.find(cal=>!hidden.has(cal.id)) || calendars[0];
    const choices = calendars.map(cal=>'<option value="'+esc(cal.id)+'"'+(cal.id===(record?.calendarId||primary.id)?' selected':'')+'>'+esc(cal.name)+'</option>').join('');
    const start=record?.startDate||ctx.date;
    const end=record?.endDate||start;
    const id=record?.id||M.id();
    const {form,commit}=mountDialog(record?'Editar evento':'Nuevo evento','<div class="wc-form-body">'+
      '<label>Título<input name="title" maxlength="180" autocomplete="off" required placeholder="Ej. Reunión de coordinación" value="'+esc(record?.title)+'"></label>'+
      '<div class="wc-field-pair"><label>Calendario<select name="calendarId">'+choices+'</select></label><label>Tipo<select name="kind"><option value="event">Evento</option><option value="meeting"'+(record?.kind==='meeting'?' selected':'')+'>Reunión</option></select></label></div>'+
      '<label class="wc-check"><input type="checkbox" name="allDay"'+(record?.allDay?' checked':'')+'>Todo el día</label>'+
      '<div class="wc-field-pair"><label>Fecha de inicio<input required name="startDate" type="date" min="0001-01-01" max="9999-12-31" value="'+esc(start)+'"></label><label data-wc-time>Hora de inicio<input required name="startTime" type="time" value="'+esc(record?.startTime||'09:00')+'"></label></div>'+
      '<div class="wc-field-pair"><label>Fecha de fin<input required name="endDate" type="date" min="0001-01-01" max="9999-12-31" value="'+esc(end)+'"></label><label data-wc-time>Hora de fin<input required name="endTime" type="time" value="'+esc(record?.endTime||'10:00')+'"></label></div>'+
      '<small class="wc-help" data-wc-time>Zona horaria de Lima</small>'+
      '<label>Lugar o enlace <small>(opcional)</small><input name="location" maxlength="240" value="'+esc(record?.location)+'"></label>'+
      '<label>Descripción <small>(opcional)</small><textarea name="description" rows="2" maxlength="6000">'+esc(record?.description)+'</textarea></label>'+
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
    f.startDate.oninput=()=>{
      if(f.startDate.value && (f.endDate.value===previousStart || f.endDate.value < f.startDate.value)) f.endDate.value=f.startDate.value;
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
      const values={id,title:f.title.value,calendarId:f.calendarId.value,kind:f.kind.value,allDay,startDate:f.startDate.value,endDate:f.endDate.value,
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
    if(currentUser!==ctx.user?.id){currentUser=ctx.user?.id;hidden=new Set();}
    const calendars=C.calendars(ctx.state), byId=new Map(calendars.map(c=>[c.id,c]));
    const dates=daysOnGrid(ctx.date), actualDates=dates.filter(Boolean), first=actualDates[0], last=actualDates.at(-1), today=M.today();
    const items=visibleEvents(ctx.state).filter(e=>e.startDate<=last && e.endDate>=first)
      .sort((a,b)=>Number(b.allDay)-Number(a.allDay) || a.startDate.localeCompare(b.startDate) || a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title,'es'));
    const onDay=new Map(actualDates.map(date=>[date,items.filter(e=>C.occursOn(e,date))]));
    const selected=onDay.get(ctx.date)||[];
    const month=monthName.format(civilDate(ctx.date));
    const weekday=longDay.format(civilDate(ctx.date));
    const calendarList=calendars.map(cal=>'<li><label style="--wc-color:'+esc(cal.color)+'"><input type="checkbox" data-wc-visible="'+esc(cal.id)+'"'+
      (hidden.has(cal.id)?'':' checked')+'><span>'+esc(cal.name)+'</span></label><button type="button" class="wc-icon" data-wc-cal-edit="'+esc(cal.id)+'" aria-label="Editar calendario '+esc(cal.name)+'">'+icon('pencil',14)+'</button></li>').join('');
    function dayBox(date) {
      if(!date) return '<div class="wc-cell outside" aria-hidden="true"></div>';
      const events=onDay.get(date), other=date.slice(0,7)!==ctx.date.slice(0,7);
      const label=longDay.format(civilDate(date))+(events.length?', '+events.length+(events.length===1?' evento':' eventos'):'');
      const chips=events.map(event=>{
        const clock=event.allDay || date!==event.startDate ? '' : '<time>'+esc(event.startTime)+'</time> ';
        return '<button class="wc-chip" type="button" data-wc-event="'+esc(event.id)+'" aria-label="'+esc(event.title+', '+timeLabel(event,date))+'" style="--wc-color:'+esc(byId.get(event.calendarId).color)+'">'+clock+'<span>'+esc(event.title)+'</span></button>';
      }).join('');
      return '<div class="wc-cell'+(other?' outside':'')+(date===ctx.date?' selected':'')+(date===today?' today':'')+'" data-wc-day="'+date+'">'+
        '<button type="button" class="wc-number" data-wc-number="'+date+'" tabindex="'+(date===ctx.date?'0':'-1')+'" aria-label="'+esc(label)+'" aria-pressed="'+(date===ctx.date)+'"'+(date===today?' aria-current="date"':'')+'>'+Number(date.slice(8))+'</button>'+
        '<div class="wc-chips">'+chips+'</div></div>';
    }
    const dailyEvents=selected.map(event=>{
      const cal=byId.get(event.calendarId);
      return '<li><button type="button" class="wc-day-event" data-wc-event="'+esc(event.id)+'" style="--wc-color:'+esc(cal.color)+'">'+
        '<span class="wc-day-time">'+icon('clock',13)+esc(timeLabel(event,ctx.date))+'</span><strong>'+esc(event.title)+'</strong>'+
        '<span class="wc-event-meta"><i></i>'+esc(cal.name)+(event.kind==='meeting'?' · Reunión':'')+'</span>'+
        (event.startDate!==event.endDate?'<small>'+esc(fullDateRange(event))+'</small>':'')+
        (event.location?'<small>'+esc(event.location)+'</small>':'')+'</button></li>';
    }).join('');
    stage.innerHTML='<section class="wc-view"><header class="wc-heading"><h1>Calendario</h1><div class="wc-actions"><button type="button" class="btn" data-wc-apple>'+icon('calendar',16)+'Calendario de Apple</button>'+
      '<button type="button" class="btn primary" data-wc-new>'+icon('plus',16)+'Nuevo evento</button></div></header>'+
      '<div class="wc-layout"><section class="wc-month panel" aria-label="Vista mensual"><header class="wc-month-head"><h2><label class="wc-month-picker"><span>'+esc(month)+'</span>'+icon('chevron-down',14)+'<input type="month" data-wc-month aria-label="Elegir mes y año" min="0001-01" max="9999-12" value="'+ctx.date.slice(0,7)+'"></label></h2><div class="wc-month-nav"><button type="button" class="wc-today" data-wc-today>Hoy</button>'+
      '<button class="wc-icon" type="button" data-wc-step="-1" aria-label="Mes anterior"'+(!changeMonth(ctx.date,-1)?' disabled':'')+'>'+icon('chevron-left',16)+'</button><button class="wc-icon" type="button" data-wc-step="1" aria-label="Mes siguiente"'+(!changeMonth(ctx.date,1)?' disabled':'')+'>'+icon('chevron-right',16)+'</button></div></header>'+
      '<div class="wc-weekdays" aria-hidden="true">'+weekdays.map((short,i)=>'<span title="'+weekNames[i]+'">'+short+'</span>').join('')+'</div>'+
      '<div class="wc-grid">'+dates.map(dayBox).join('')+'</div></section>'+
      '<aside class="wc-right"><section class="wc-day panel" aria-label="Agenda del día"><header><span>Agenda del día</span><h2>'+esc(weekday)+'</h2></header>'+
      (dailyEvents?'<ul>'+dailyEvents+'</ul>':'<p class="wc-empty">'+(calendars.every(cal=>hidden.has(cal.id))?'Activa un calendario para ver sus eventos.':'Sin eventos para este día.')+'</p>')+
      '</section><section class="wc-calendars panel" aria-label="Mis calendarios"><header><h2>Mis calendarios</h2><button type="button" class="wc-icon" data-wc-cal-new aria-label="Agregar calendario" title="Agregar calendario">'+icon('plus',17)+'</button></header><ul>'+calendarList+'</ul></section></aside></div></section>';
    const view=stage.querySelector('.wc-view');
    function goTo(date,refocus=false) {
      if(!date) return;
      ctx.setDate(date);
      if(refocus) focusControl(stage,'[data-wc-number]','wcNumber',date);
    }
    view.onchange=event=>{
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
        goTo(changeMonth(ctx.date,Number(step)));focusControl(stage,'[data-wc-step]','wcStep',step);
      } else if(button?.hasAttribute('data-wc-new')) eventEditor(ctx,null,button);
      else if(button?.hasAttribute('data-wc-cal-new')) calendarEditor(ctx,null,button);
      else if(button?.hasAttribute('data-wc-cal-edit')) calendarEditor(ctx,byId.get(button.dataset.wcCalEdit),button);
      else if(button?.hasAttribute('data-wc-apple')) appleChooser(ctx,button);
    };
  }
  window.JWorkCalendar={render,visibleEvents};
})();
