/* Exploración de los intervalos reales de la jornada, incluidos los huecos. */
(() => {
  'use strict';
  const {esc,icon} = window.JUI;
  const model = window.JModel;
  const clamp = (value,low,high) => Math.max(low,Math.min(high,value));

  function track(entries,low,high,accent,hourLabel) {
    const slots = [];
    let cursor=low;
    function add(start,end,index=-1) {
      const entry=entries[index];
      const kind=!entry ? 'gap' : entry.segment.end ? 'closed' : entry.live ? 'live' : 'unknown';
      const color=entry ? accent(entry.goal) : '#85939c';
      const range=hourLabel(start)+' – '+(!entry || entry.segment.end ? hourLabel(end) : entry.live ? 'ahora' : 'sin cierre');
      const label=(entry?.task.title || 'Sin registro')+', '+range;
      slots.push(`<button type="button" class="jt-slot jt-${kind}" data-start="${start}" data-end="${end}" data-entry="${index}" tabindex="${slots.length ? -1 : 0}" aria-label="${esc(label)}" style="--event-accent:${color};left:${100*(start-low)/(high-low)}%;width:${100*(end-start)/(high-low)}%"></button>`);
    }
    entries.forEach((entry,index)=>{
      if (entry.start>cursor) add(cursor,entry.start);
      // Hasta conocer el cierre de otro día, sólo la marca de inicio es tiempo conocido.
      const visualEnd=!entry.segment.end && !entry.live ? high : entry.end;
      add(entry.start,visualEnd,index);
      cursor=Math.max(entry.start,visualEnd);
    });
    if (cursor<high) add(cursor,high);
    return `<p class="jd-sr" id="jt-instructions">Usa las flechas para recorrer los tramos y Escape para cerrar el detalle.</p>
      <div class="jt-track" role="group" aria-label="Tramos de la línea de tiempo" aria-describedby="jt-instructions" data-low="${low}" data-high="${high}">${slots.join('')}<i class="jt-cursor" aria-hidden="true" hidden></i></div>
      <div class="jt-popup" popover="manual" hidden><div class="jt-info" id="jt-info" role="tooltip">
          <div class="jt-tip-kicker"><span><i></i><span class="jt-kind"></span></span><time class="jt-point" aria-hidden="true"></time></div>
          <strong class="jt-title"></strong>
          <div class="jt-timing">${icon('clock',14)} <span></span><b></b></div>
          <dl class="jt-facts"><dt>Objetivo general</dt><dd></dd><dt>Categoría</dt><dd></dd><dt>Estado</dt><dd></dd></dl>
          <div class="jt-comment"><b>Comentario</b><p></p></div>
        </div>
        <div class="jt-touch-tools" hidden><button type="button" data-jt-step="-1" aria-label="Intervalo anterior">${icon('chevron-left',17)}</button><button type="button" data-jt-step="1" aria-label="Intervalo siguiente">${icon('chevron-right',17)}</button><button type="button" data-jt-close>Cerrar</button></div>
      </div>`;
  }

  function timeDetail(entry,slot,hourLabel,date) {
    const {start,end}=slot;
    if (!entry || entry.segment.end) return [hourLabel(start)+' – '+hourLabel(end),model.duration(end-start)];
    const [h,m]=model.timeNow().split(':').map(Number);
    const now=h*60+m;
    if (date===model.today() && now>=entry.start) {
      return [entry.segment.start+' – ahora ('+hourLabel(now)+')',model.duration(now-entry.start)+' en curso'];
    }
    return [entry.segment.start+' · sin cierre','Duración pendiente'];
  }

  // La consulta por id descarta automáticamente las vistas que la navegación retiró.
  function visibleCard() {
    const popup=document.getElementById('jt-info')?.parentElement;
    return popup && !popup.hidden ? popup : null;
  }
  document.addEventListener('pointerdown',event=>{
    const popup=visibleCard();
    if (popup && !popup.contains(event.target) && !popup.previousElementSibling?.contains(event.target)) popup.dispatchEvent(new Event('jt-close'));
  },true);
  document.addEventListener('keydown',event=>{
    if (event.key!=='Escape') return;
    const popup=visibleCard();
    if (popup) { event.preventDefault(); popup.dispatchEvent(new Event('jt-close')); }
  },true);
  document.addEventListener('scroll',event=>{
    const popup=visibleCard();
    if (popup && !popup.contains(event.target)) popup.dispatchEvent(new Event('jt-reposition'));
  },true);
  window.addEventListener('resize',()=>visibleCard()?.dispatchEvent(new Event('jt-reposition')));

  function bind(root,entries,ctx,hourLabel) {
    const bar=root.querySelector('.jt-track'), popup=root.querySelector('.jt-popup');
    const info=popup.querySelector('.jt-info'), tools=popup.querySelector('.jt-touch-tools');
    const marker=bar.querySelector('.jt-cursor');
    const point=info.querySelector('.jt-point'), kicker=info.querySelector('.jt-kind'), title=info.querySelector('.jt-title');
    const range=info.querySelector('.jt-timing span'), duration=info.querySelector('.jt-timing b');
    const facts=info.querySelector('.jt-facts'), labels=Array.from(facts.querySelectorAll('dt'));
    const comment=info.querySelector('.jt-comment'), note=comment.querySelector('p');
    const previous=tools.querySelector('[data-jt-step="-1"]'), next=tools.querySelector('[data-jt-step="1"]');
    const slots=Array.from(bar.querySelectorAll('.jt-slot'),(node,index)=>({
      node,index,start:Number(node.dataset.start),end:Number(node.dataset.end),entry:entries[Number(node.dataset.entry)]
    }));
    const slotByNode=new Map(slots.map(slot=>[slot.node,slot]));
    const instants=slots.filter(slot=>slot.start===slot.end);
    const low=Number(bar.dataset.low), high=Number(bar.dataset.high);
    const topLayer=typeof popup.showPopover==='function';
    let active=null,tabTarget=slots[0],blocked=null,touchMode=false;
    let geometry=null,cardWidth=null,anchor=0,pointMinute=null,markerX=null,popupX=null;
    let pendingX=null,frame=null,hideTimer=0,liveTimer=0;
    popup.classList.toggle('jt-inline',!topLayer);

    function clear() {
      if (frame!==null) window.cancelAnimationFrame(frame);
      frame=null; pendingX=null; geometry=null; cardWidth=null;
      clearTimeout(hideTimer); clearTimeout(liveTimer);
      observer?.disconnect();
      if (!active) return;
      active.node.removeAttribute('aria-describedby');
      active.node.classList.remove('jt-selected');
      if (topLayer && popup.isConnected && !popup.hidden) popup.hidePopover();
      popup.hidden=true; marker.hidden=true; active=null;
    }
    function readGeometry() {
      if (!geometry) {
        const barRect=bar.getBoundingClientRect();
        const origin=topLayer ? {left:0,top:0} : root.getBoundingClientRect();
        geometry={bar:barRect,origin,width:document.documentElement.clientWidth,height:document.documentElement.clientHeight};
      }
      return geometry;
    }
    // La altura de la tarjeta sólo se mide cuando cambia su contenido o el espacio disponible.
    function position() {
      const {bar:rect,width,height,origin}=readGeometry();
      if (rect.bottom<0 || rect.top>height) { clear(); return; }
      const pad=8,gap=4;
      if (cardWidth===null) {
        const below=height-rect.bottom-gap-pad, above=rect.top-gap-pad;
        const room=Math.max(44,Math.max(above,below)-(touchMode ? tools.offsetHeight : 0)-3)+'px';
        if (popup.style.getPropertyValue('--jt-room')!==room) popup.style.setProperty('--jt-room',room);
        const card=popup.getBoundingClientRect();
        cardWidth=card.width;
        const top=card.height<=below || below>=above ? rect.bottom+gap : rect.top-card.height-gap;
        popup.style.left=(pad-origin.left)+'px';
        popup.style.top=(clamp(top,pad,height-card.height-pad)-origin.top)+'px';
      }
      const cursor=anchor*rect.width;
      if (cursor!==markerX) { marker.style.transform='translate3d('+cursor+'px,0,0)'; markerX=cursor; }
      const offset=clamp(rect.left+cursor-cardWidth/2,pad,width-cardWidth-pad)-pad;
      if (offset!==popupX) { popup.style.transform='translate3d('+offset+'px,0,0)'; popupX=offset; }
    }
    function refreshTime(slot) {
      const [interval,length]=timeDetail(slot.entry,slot,hourLabel,ctx.date);
      range.textContent=interval; duration.textContent=length;
      clearTimeout(liveTimer);
      if (slot.entry?.live) liveTimer=setTimeout(()=>{
        if (!root.isConnected || active!==slot) return;
        refreshTime(slot); cardWidth=null; queueFrame();
      },60000-Date.now()%60000);
    }
    function fill(slot) {
      const entry=slot.entry, task=entry?.task;
      kicker.textContent=task?.kind==='space' ? 'Espacio sin objetivo' : entry ? entry.count>1 ? 'Tramo '+entry.index+' de '+entry.count : 'Tramo de actividad' : 'Intervalo sin actividad';
      title.textContent=task?.title || 'Sin registro';
      refreshTime(slot);
      const values=[task?.kind==='space' ? '' : entry?.goal?.title,task?.kind==='space' ? '' : task?.category,task?.status];
      labels.forEach((dt,index)=>{
        const dd=dt.nextElementSibling, value=values[index] || '';
        dt.hidden=dd.hidden=!value;
        dd.textContent=value;
      });
      facts.hidden=!values.some(Boolean);
      note.textContent=task?.comment?.trim() ? task.comment : '';
      comment.hidden=!note.textContent;
      info.scrollTop=0;
      popup.style.setProperty('--event-accent',slot.node.style.getPropertyValue('--event-accent'));
    }
    function show(slot,ratio=null,touch=false) {
      if (!slot) return;
      clearTimeout(hideTimer);
      const changed=active!==slot;
      if (changed) {
        active?.node.classList.remove('jt-selected');
        active?.node.removeAttribute('aria-describedby');
        active=slot;
        fill(slot);
        slot.node.classList.add('jt-selected');
        slot.node.setAttribute('aria-describedby','jt-info');
        cardWidth=null;
      }
      if (touchMode!==touch) {touchMode=touch; tools.hidden=!touch; cardWidth=null;}
      if (touch && (changed || cardWidth===null)) {
        previous.setAttribute('aria-disabled',String(slot===slots[0]));
        next.setAttribute('aria-disabled',String(slot===slots.at(-1)));
      }
      anchor=ratio===null ? ((slot.start+slot.end)/2-low)/(high-low) : ratio;
      const minute=ratio===null ? null : clamp(Math.floor(low+anchor*(high-low)),low,high-1);
      if (minute!==pointMinute) { point.textContent=minute===null ? '' : hourLabel(minute); pointMinute=minute; }
      if (popup.hidden) {
        popup.hidden=false; marker.hidden=false;
        if (topLayer) popup.showPopover();
        observer?.observe(root);
      }
      position();
    }
    function atPosition(clientX) {
      const rect=readGeometry().bar;
      const ratio=clamp((clientX-rect.left)/(rect.width||1),0,1);
      const minute=low+ratio*(high-low);
      const instant=instants.find(slot=>Math.abs((slot.start-minute)*rect.width/(high-low))<=2);
      let left=0,right=slots.length-1;
      while (left<right) {
        const middle=Math.floor((left+right)/2);
        if (minute<slots[middle].end) right=middle;
        else left=middle+1;
      }
      return {slot:instant || slots[left],ratio};
    }
    function paint() {
      frame=null;
      if (!root.isConnected) { clear(); return; }
      if (pendingX===null) { if (active) position(); return; }
      const {slot,ratio}=atPosition(pendingX);
      pendingX=null;
      if (slot!==blocked) {blocked=null; show(slot,ratio);}
    }
    function queueFrame() {
      if (frame!==null) return;
      if (window.requestAnimationFrame) frame=window.requestAnimationFrame(paint);
      else paint();
    }
    function invalidate() {geometry=null; cardWidth=null; if (active) queueFrame();}
    const observer=window.ResizeObserver ? new window.ResizeObserver(invalidate) : null;
    function tabStop(slot) {
      if (tabTarget===slot) return;
      tabTarget?.node.setAttribute('tabindex','-1'); slot.node.tabIndex=0; tabTarget=slot;
    }
    function delayedClear() { clearTimeout(hideTimer); hideTimer=setTimeout(clear,145); }
    function focusSlot(slot) {
      pendingX=null; blocked=null; tabStop(slot); slot.node.focus({preventScroll:true});
      // focusin no vuelve a dispararse sobre un botón que ya tiene el foco.
      if (active!==slot || touchMode || pointMinute!==null) show(slot);
    }
    bar.addEventListener('pointerenter',()=>{geometry=null; cardWidth=null; clearTimeout(hideTimer);});
    bar.addEventListener('pointermove',event=>{
      if (event.pointerType==='touch') return;
      pendingX=event.clientX; queueFrame();
    },{passive:true});
    bar.addEventListener('pointerleave',()=>{pendingX=null; blocked=null; if (!touchMode) delayedClear();});
    bar.addEventListener('pointerdown',()=>{pendingX=null; blocked=null;});
    bar.addEventListener('click',event=>{
      const slot=slotByNode.get(event.target.closest('.jt-slot'));
      if (!slot) return;
      pendingX=null; blocked=null;
      if (!event.detail) { show(slot); return; }
      const hit=atPosition(event.clientX);
      tabStop(hit.slot);
      show(hit.slot,hit.ratio,event.pointerType==='touch' || (!event.pointerType && matchMedia('(pointer: coarse)').matches));
    });
    bar.addEventListener('focusin',event=>{
      const slot=slotByNode.get(event.target.closest('.jt-slot'));
      if (slot && slot!==blocked) {pendingX=null; tabStop(slot); show(slot);}
    });
    root.addEventListener('focusout',event=>{
      if (!bar.contains(event.relatedTarget) && !popup.contains(event.relatedTarget)) clear();
    });
    bar.addEventListener('keydown',event=>{
      const current=slotByNode.get(event.target);
      if (!current) return;
      const target={ArrowRight:current.index+1,ArrowLeft:current.index-1,Home:0,End:slots.length-1}[event.key];
      if (target===undefined) return;
      event.preventDefault(); focusSlot(slots[clamp(target,0,slots.length-1)]);
    });
    popup.addEventListener('jt-close',()=>{
      const focused=popup.contains(document.activeElement), previousSlot=active;
      blocked=active; clear();
      if (focused) previousSlot?.node.focus({preventScroll:true});
    });
    popup.addEventListener('jt-reposition',invalidate);
    popup.addEventListener('pointerenter',()=>clearTimeout(hideTimer));
    popup.addEventListener('pointerleave',()=>{ if (!touchMode) delayedClear(); });
    tools.addEventListener('click',event=>{
      const button=event.target.closest('button');
      if (button?.hasAttribute('data-jt-close')) popup.dispatchEvent(new Event('jt-close'));
      else if (button?.dataset.jtStep && active) {
        const slot=slots[clamp(active.index+Number(button.dataset.jtStep),0,slots.length-1)];
        pendingX=null; blocked=null; tabStop(slot); show(slot,null,true);
      }
    });
  }
  window.JTimeline={track,bind};
})();
