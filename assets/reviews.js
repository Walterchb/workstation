/* Avisos de los calendarios y revisiones de notas de la cuenta activa. */
(() => {
  'use strict';
  const model = window.JModel;
  const calendar = window.JCalendarModel;
  const {esc, icon} = window.JUI;
  const minute = 60_000;
  const alarmCache = new WeakMap();
  const announced = new WeakMap();
  let panel;

  function clock() {
    const now = Math.floor(Date.now() / minute) * minute;
    return {now, today:model.today(new Date(now))};
  }

  function alarmFor(event) {
    if (event.reminderMinutes == null) return null;
    const cached = alarmCache.get(event);
    if (cached) return cached;
    const civil = window.JCalendarICS.limaInstant;
    const start = civil(event.startDate, event.allDay ? '00:00' : event.startTime);
    const graceEnd = start + 5 * minute;
    const end = event.allDay ? graceEnd : Math.min(graceEnd, civil(event.endDate, event.endTime));
    const alarm = {event, start, trigger:start - event.reminderMinutes * minute, end};
    alarmCache.set(event, alarm);
    return alarm;
  }

  function entries(state, time, includeUpcoming = false) {
    const notes = (state.notes || []).filter(note => note.reviewDate && note.lane !== 'resolved');
    const notices = [], upcoming = [];
    const yesterday = model.shiftDate(time.today, -1);
    const tomorrow = model.shiftDate(time.today, 1);
    for (const event of calendar.events(state)) {
      if (event.startDate < yesterday || (!includeUpcoming && event.startDate > tomorrow)) continue;
      const alarm = alarmFor(event);
      if (!alarm || time.now >= alarm.end) continue;
      if (time.now >= alarm.trigger) notices.push(alarm);
      else if (includeUpcoming) upcoming.push(alarm);
    }
    const byStart = (a,b) => a.start-b.start || a.event.title.localeCompare(b.event.title,'es');
    return {
      notes, notices:notices.sort(byStart), upcoming:upcoming.sort((a,b) => a.trigger-b.trigger || byStart(a,b)),
      count:notes.filter(note => note.reviewDate <= time.today).length + notices.length
    };
  }

  function shortDate(day, today) {
    const format = {day:'numeric', month:'short'};
    if (day.slice(0,4) !== today.slice(0,4)) format.year = 'numeric';
    return model.formatDate(day,format).replace(/\./g,'');
  }

  function row(type, id, symbol, title, detail, label, hint) {
    return '<li><button type="button" data-review-'+type+'="'+esc(id)+'">'+
      '<span class="wr-row-icon">'+icon(symbol,16)+'</span>'+
      '<span class="wr-row-copy"><b>'+esc(title)+'</b><small>'+esc(detail)+'</small></span>'+
      '<span class="wr-time"'+(hint?' title="'+esc(hint)+'"':'')+'>'+esc(label)+'</span>'+
      icon('chevron-right',13)+'</button></li>';
  }

  function group(kind, title, rows) {
    if (!rows.length) return '';
    return '<section class="wr-group wr-'+kind+'"><h3><i aria-hidden="true"></i>'+title+
      '<span>'+rows.length+'</span></h3><ul>'+rows.join('')+'</ul></section>';
  }

  function noteRow(note, today) {
    const detail = [note.topic, model.noteLanes[note.lane]].filter(Boolean).join(' · ');
    return row('note',note.id,'file-text',note.title,detail,shortDate(note.reviewDate,today),model.formatDate(note.reviewDate));
  }

  function eventRow(alarm, state, time, future) {
    const event = alarm.event;
    const name = calendar.calendars(state).find(item=>item.id===event.calendarId)?.name;
    const date = shortDate(event.startDate,time.today);
    const when = event.allDay ? date+' · Todo el día' : date+' · '+event.startTime;
    const remaining = Math.ceil((alarm.start-time.now)/minute);
    let label;
    if (future) {
      const triggerDate = new Date(alarm.trigger);
      const day = model.today(triggerDate);
      const dayLabel = day===time.today ? 'hoy' : shortDate(day,time.today);
      label = 'Aviso '+dayLabel+' · '+model.timeNow(triggerDate);
    } else if (remaining > 0) {
      label = 'En '+model.duration(remaining);
    } else {
      label = remaining === 0 ? 'Ahora' : 'En curso';
    }
    const detail = [name,when].filter(Boolean).join(' · ');
    return row('event',event.id,'calendar',event.title,detail,label);
  }

  function paint(state, time, data) {
    const {dialog,filter} = panel;
    const content = dialog.querySelector('.wr-content');
    const focused = content.contains(document.activeElement) ? document.activeElement.dataset : null;
    const focusKey = focused?.reviewNote || focused?.reviewEvent;
    const focusType = focused?.reviewNote ? 'note' : 'event';
    const scrollTop = content.scrollTop;
    let html = '';
    if (filter !== 'notes') {
      html += group('events','Avisos de eventos',data.notices.map(alarm=>eventRow(alarm,state,time,false)));
    }
    if (filter !== 'calendar') {
      const sorted = [...data.notes].sort((a,b)=>a.reviewDate.localeCompare(b.reviewDate) || a.title.localeCompare(b.title,'es'));
      const groups = [
        ['today','Para hoy',sorted.filter(n=>n.reviewDate===time.today)],
        ['overdue','Revisiones vencidas',sorted.filter(n=>n.reviewDate<time.today)],
        ['upcoming','Próximas revisiones',sorted.filter(n=>n.reviewDate>time.today)]
      ];
      for (const [kind,title,notes] of groups) html += group(kind,title,notes.map(note=>noteRow(note,time.today)));
    }
    if (filter === 'calendar') {
      html += group('scheduled','Avisos programados',data.upcoming.map(alarm=>eventRow(alarm,state,time,true)));
    }
    const empty = filter === 'calendar' ? ['Sin avisos programados','Elige un aviso al crear o editar un evento.'] :
      filter === 'notes' ? ['Sin revisiones programadas','Asigna una fecha de revisión a una nota para verla aquí.'] :
      ['Estás al día','Aquí aparecen las revisiones de tus notas y los avisos de tus eventos.'];
    content.innerHTML = html || '<div class="wr-empty"><span>'+icon('check-circle',26)+'</span><b>'+empty[0]+'</b><p>'+empty[1]+'</p></div>';
    dialog.querySelector('.wr-date').textContent = model.formatDate(time.today,{weekday:'long',day:'numeric',month:'long'});
    for (const button of dialog.querySelectorAll('[data-wr-filter]')) {
      button.setAttribute('aria-pressed',String(button.dataset.wrFilter===filter));
    }
    if (focusKey) {
      const buttons = content.querySelectorAll('[data-review-'+focusType+']');
      const next = [...buttons].find(button=>button.getAttribute('data-review-'+focusType)===focusKey);
      (next || dialog.querySelector('[data-wr-filter="'+filter+'"]')).focus({preventScroll:true});
    }
    content.scrollTop = scrollTop;
    panel.now = time.now;
    panel.today = time.today;
    panel.state = state;
  }

  function announce(button, alarms, time, notify) {
    if (!notify || document.hidden) return;
    const previous = announced.get(button) || new Set();
    const current = new Set();
    const fresh = [];
    for (const alarm of alarms) {
      const key = alarm.event.id+'@'+alarm.trigger;
      current.add(key);
      if (!previous.has(key) && time.now < alarm.trigger + 5*minute) fresh.push(alarm.event);
    }
    announced.set(button,current);
    if (!fresh.length || panel?.dialog.open) return;
    if (fresh.length>1) notify(fresh.length+' eventos tienen un aviso de calendario.');
    else {
      const event = fresh[0];
      notify('Aviso de calendario · '+event.title+' · '+(event.allDay?'Todo el día':event.startTime));
    }
  }

  function update(button, state, notify) {
    if (!state || !button) return;
    const time = clock();
    const dirty = panel?.dialog.open && (panel.now!==time.now || panel.today!==time.today || panel.state!==state);
    const data = entries(state,time,dirty && panel.filter==='calendar');
    const badge = button.querySelector('span');
    badge.hidden = !data.count;
    badge.textContent = data.count>99 ? '99+' : String(data.count);
    const label = data.count ? 'Notificaciones · '+data.count+(data.count===1?' pendiente':' pendientes') : 'Notificaciones';
    button.setAttribute('aria-label',label);
    button.title = label;
    if (dirty) paint(state,time,data);
    announce(button,data.notices,time,notify);
  }

  function position(dialog, button) {
    const bounds = button.getBoundingClientRect?.();
    if (!bounds || !window.innerWidth || !window.innerHeight) return;
    const width = window.innerWidth, maxRight = Math.max(12,width-444-12);
    const right = Math.max(12,Math.min(maxRight,width-bounds.right));
    const top = Math.max(12,Math.min(bounds.bottom+9,window.innerHeight-240));
    dialog.style.setProperty('--wr-right',right+'px');
    dialog.style.setProperty('--wr-top',top+'px');
  }

  function open(button, ctx) {
    if (document.querySelector('dialog[open]')) return;
    const dialog = document.createElement('dialog');
    panel = {dialog,filter:'all'};
    dialog.className = 'wr-panel';
    dialog.setAttribute('aria-labelledby','wr-title');
    dialog.innerHTML = '<header><span class="wr-heading-icon">'+icon('bell',20)+'</span><div><h2 id="wr-title">Notificaciones</h2><p class="wr-date"></p></div>'+
      '<button class="icon-btn" type="button" data-close aria-label="Cerrar notificaciones">'+icon('x',17)+'</button></header>'+
      '<div class="wr-filters" role="group" aria-label="Filtrar notificaciones">'+
      [['all','Todas'],['notes','Notas'],['calendar','Calendario']].map(([id,title])=>
        '<button type="button" data-wr-filter="'+id+'">'+title+'</button>').join('')+'</div><div class="wr-content"></div>';
    let selected;
    dialog.addEventListener('click',e=>{
      const row = e.target.closest('[data-review-note],[data-review-event]');
      if (row) { selected=row.dataset; dialog.close(); return; }
      const filter = e.target.closest('[data-wr-filter]');
      if (filter) {
        panel.filter = filter.dataset.wrFilter;
        const time = clock();
        paint(panel.state,time,entries(panel.state,time,panel.filter==='calendar'));
        dialog.querySelector('.wr-content').scrollTop = 0;
        return;
      }
      if (e.target.closest('[data-close]')) { dialog.close(); return; }
      if (e.target===dialog) {
        const r=dialog.getBoundingClientRect();
        if (e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom) dialog.close();
      }
    });
    const align = ()=>position(dialog,button);
    dialog.addEventListener('close',()=>{
      window.removeEventListener('resize',align);
      dialog.remove();
      panel = null;
      button.setAttribute('aria-expanded','false');
      if (selected?.reviewNote) ctx.openSearchNote(selected.reviewNote);
      else if (selected?.reviewEvent) ctx.openCalendarEvent(selected.reviewEvent);
      else button.focus({preventScroll:true});
    },{once:true});
    const time = clock();
    document.body.append(dialog);
    align();
    window.addEventListener('resize',align);
    button.setAttribute('aria-expanded','true');
    dialog.showModal();
    paint(ctx.state,time,entries(ctx.state,time));
    dialog.querySelector('[data-close]').focus();
  }

  window.JReviews = {open,update};
})();
