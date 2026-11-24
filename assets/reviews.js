/* Recordatorios en la jornada local de Lima, independientes de la fecha que se consulta en la agenda. */
(() => {
  'use strict';
  const model = window.JModel;
  const {esc, icon} = window.JUI;
  let panel;
  let currentState;
  let renderedDay;

  function scheduled(state) {
    return (state.notes || []).filter(note => note.reviewDate && note.lane !== 'resolved');
  }

  function paint(state, today) {
    const rows = scheduled(state).sort((a,b) =>
      a.reviewDate.localeCompare(b.reviewDate) || a.title.localeCompare(b.title,'es'));
    const groups = [
      ['Para hoy','today',rows.filter(note=>note.reviewDate === today)],
      ['Revisiones vencidas','overdue',rows.filter(note=>note.reviewDate < today)],
      ['Próximas revisiones','upcoming',rows.filter(note=>note.reviewDate > today)]
    ];
    const content = panel.querySelector('.wr-content');
    const focusedId = content.contains(document.activeElement) ? document.activeElement.dataset.reviewNote : null;
    content.innerHTML = rows.length ? groups.filter(([, ,notes])=>notes.length).map(([title, type, notes])=>
      '<section class="wr-group wr-'+type+'"><h3>'+title+' <span>'+notes.length+'</span></h3><ul>'+
      notes.map(note=>{
        const detail = [note.topic,model.noteLanes[note.lane]].filter(Boolean).map(esc).join(' · ');
        const dateLabel = model.formatDate(note.reviewDate,{day:'numeric',month:'short',year:'numeric'}).replace(/\./g,'');
        return '<li><button type="button" data-review-note="'+esc(note.id)+'"><span><b>'+esc(note.title)+'</b><small>'+detail+'</small></span>'+
          '<time datetime="'+esc(note.reviewDate)+'">'+esc(dateLabel)+'</time>'+icon('chevron-right',15)+'</button></li>';
      }).join('')+'</ul></section>'
    ).join('') : '<p class="wr-empty">Cuando asignes una fecha de revisión a una nota, aparecerá aquí.</p>';
    if(focusedId) [...content.querySelectorAll('[data-review-note]')].find(el=>el.dataset.reviewNote===focusedId)?.focus({preventScroll:true});
  }

  function update(button, state) {
    if(!state || !button) return;
    const today = model.today();
    const count = scheduled(state).filter(note=>note.reviewDate<=today).length;
    const badge = button.querySelector('span');
    badge.hidden = !count;
    badge.textContent = String(count);
    const label = count ? 'Notificaciones de revisión · '+count+(count===1?' pendiente':' pendientes') : 'Notificaciones de revisión';
    button.setAttribute('aria-label',label);
    button.title=label;
    if(panel?.open && (renderedDay!==today || state!==currentState)) paint(state,today);
    renderedDay=today;
    currentState=state;
  }

  function open(button, ctx) {
    if(document.querySelector('dialog[open]'))return;
    const dialog = document.createElement('dialog');
    panel=dialog;
    dialog.className='wr-panel';
    dialog.setAttribute('aria-labelledby','wr-title');
    dialog.innerHTML='<header><span class="wr-heading-icon">'+icon('bell',19)+'</span><h2 id="wr-title">Notificaciones de revisión</h2>'+
      '<button class="icon-btn" type="button" data-close aria-label="Cerrar notificaciones">'+icon('x',17)+'</button></header><div class="wr-content"></div>';
    let selected;
    dialog.addEventListener('click',e=>{
      const row=e.target.closest('[data-review-note]');
      if(row){selected=row.dataset.reviewNote;dialog.close();return;}
      if(e.target.closest('[data-close]')){dialog.close();return;}
      if(e.target===dialog){
        const r=dialog.getBoundingClientRect();
        if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();
      }
    });
    dialog.addEventListener('close',()=>{
      dialog.remove();
      panel=null;
      if(selected)ctx.openSearchNote(selected);
      else button.focus({preventScroll:true});
    },{once:true});
    document.body.append(dialog);
    dialog.showModal();
    paint(ctx.state,model.today());
    dialog.querySelector('[data-close]').focus();
  }

  window.JReviews={open,update};
})();
