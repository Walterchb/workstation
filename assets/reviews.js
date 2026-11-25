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

  function group(kind, title, rows) {
    if (!rows.length) return '';
    return '<section class="wr-group wr-'+kind+'"><h3><i aria-hidden="true"></i>'+title+
      '<span>'+rows.length+'</span></h3><ul>'+rows.join('')+'</ul></section>';
  }

  function noteRow(note, today) {
    const detail = [note.topic, model.noteLanes[note.lane]].filter(Boolean).join(' · ');
    return '<li><button type="button" data-review-note="'+esc(note.id)+'">'+
      '<span class="wr-row-icon">'+icon('file-text',16)+'</span>'+
      '<span class="wr-row-copy"><b>'+esc(note.title)+'</b><small>'+esc(detail)+'</small></span>'+
      '<span class="wr-time" title="'+esc(model.formatDate(note.reviewDate))+'">'+esc(shortDate(note.reviewDate,today))+'</span>'+
      icon('chevron-right',13)+'</button></li>';
  }

  function dayLabel(day, today) {
    if (day === today) return 'Hoy';
    if (day === model.shiftDate(today,1)) return 'Mañana';
    return shortDate(day,today);
  }

  function eventCard(alarm, state, time, future = false) {
    const {event} = alarm;
    const name = calendar.calendars(state).find(item=>item.id===event.calendarId)?.name || '';
    const category = calendar.eventCategory(state,event);
    const source = [name,category?.name].filter(Boolean).join(' · ');
    const month = model.formatDate(event.startDate,{month:'short'}).replace(/\./g,'');
    const startDay = dayLabel(event.startDate,time.today);
    const endDay = dayLabel(event.endDate,time.today);
    let when;
    if (event.allDay) {
      when = (event.startDate===event.endDate ? startDay : startDay+' – '+endDay)+' · Todo el día';
    } else {
      const until = event.startDate===event.endDate ? event.endTime : endDay+' '+event.endTime;
      when = startDay+' · '+event.startTime+' – '+until;
    }
    const remaining = Math.ceil((alarm.start-time.now)/minute);
    let label;
    if (future) {
      const triggerDate = new Date(alarm.trigger);
      const triggerDay = dayLabel(model.today(triggerDate),time.today).toLocaleLowerCase('es-PE');
      label = 'Aviso '+triggerDay+' · '+model.timeNow(triggerDate);
    } else if (remaining > 0) {
      label = 'En '+model.duration(remaining);
    } else {
      label = remaining === 0 ? 'Ahora' : 'En curso';
    }
    const details = event.location ? when+' · '+event.location : when;
    return '<span class="wr-card-content">'+
      '<span class="wr-date-tile" aria-hidden="true"><span>'+esc(month)+'</span><b>'+Number(event.startDate.slice(8))+'</b></span>'+
      '<span class="wr-event-copy"><span class="wr-event-head"><span class="wr-event-source">'+esc(source)+'</span>'+
      '<span class="wr-time">'+esc(label)+'</span></span><strong>'+esc(event.title)+'</strong>'+
      '<span class="wr-event-details">'+esc(details)+'</span></span></span>';
  }

  function eventRow(alarm, state, time, future) {
    const {event} = alarm;
    return '<li><button type="button" class="wr-event-card" data-review-event="'+esc(event.id)+
      '" style="--wr-event-color:'+esc(calendar.eventColor(state,event))+'">'+eventCard(alarm,state,time,future)+'</button></li>';
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

  function showBanner(button, fresh, state, time, openEvent) {
    const alarm = fresh[0];
    const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
    const returnFocus = dialog?.contains(document.activeElement) ? document.activeElement : button;
    const host = dialog || document.getElementById('notices');
    const banner = document.createElement('div');
    banner.className = 'wr-banner';
    banner.dataset.alarmKey = alarm.event.id+'@'+alarm.trigger;
    banner.style.setProperty('--wr-event-color',calendar.eventColor(state,alarm.event));
    const card = eventCard(alarm,state,time);
    const additional = fresh.length>1 ? 'Ver los '+fresh.length+' avisos' : '';
    // En un editor abierto el aviso se puede cerrar sin interrumpir lo que se está escribiendo.
    if (dialog) banner.setAttribute('role','status');
    banner.innerHTML = (dialog ? card : '<button type="button" class="wr-open-event" data-wr-open-event="'+esc(alarm.event.id)+'">'+card+'</button>') +
      '<button type="button" class="wr-dismiss" data-wr-dismiss aria-label="Cerrar aviso">'+icon('x',14)+'</button>'+
      (additional && !dialog ? '<button type="button" class="wr-extra" data-wr-more>'+additional+'</button>' : '');
    host.append(banner);
    let timer;
    function close(restoreFocus = false) {
      clearTimeout(timer);
      banner.remove();
      if (restoreFocus && returnFocus.isConnected) returnFocus.focus({preventScroll:true});
    }
    function expire() {
      clearTimeout(timer);
      timer = setTimeout(()=>{ if (!banner.contains(document.activeElement)) close(); },11000);
    }
    banner.onclick = e=>{
      if (e.target.closest('[data-wr-dismiss]')) { close(true); return; }
      if (e.target.closest('[data-wr-more]')) { close(); button.click(); return; }
      if (e.target.closest('[data-wr-open-event]')) { close(); openEvent(alarm.event.id); }
    };
    banner.addEventListener('pointerenter',()=>clearTimeout(timer));
    banner.addEventListener('pointerleave',expire);
    banner.addEventListener('focusin',()=>clearTimeout(timer));
    banner.addEventListener('focusout',expire);
    expire();
  }

  function announce(button, alarms, state, time, openEvent) {
    if (!openEvent || document.hidden) return;
    const previous = announced.get(button) || new Set();
    const current = new Set();
    const fresh = [];
    for (const alarm of alarms) {
      const key = alarm.event.id+'@'+alarm.trigger;
      current.add(key);
      if (!previous.has(key) && time.now < alarm.trigger + 5*minute) fresh.push(alarm);
    }
    announced.set(button,current);
    const visible = document.querySelector('.wr-banner');
    if (visible && (!current.has(visible.dataset.alarmKey) || fresh.length)) visible.remove();
    if (fresh.length && !panel?.dialog.open) showBanner(button,fresh,state,time,openEvent);
  }

  function update(button, state, openEvent) {
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
    announce(button,data.notices,state,time,openEvent);
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
    document.querySelector('.wr-banner')?.remove();
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
