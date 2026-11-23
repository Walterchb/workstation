/* Perfil privado de la cuenta. La foto se reduce en memoria antes de guardar el documento. */
(() => {
  'use strict';
  const model = window.JModel;
  const fileLimit = 12 * 1024 * 1024;
  let currentDialog = null;

  function display(state, user) {
    const profile = state?.profile || {};
    const name = profile.name?.trim() || user?.email?.split('@')[0] || 'Mi cuenta';
    const words = name.split(/[\s._-]+/).filter(Boolean);
    const parts = words.length > 1 ? [words[0],words[words.length-1]] : [words[0] || name];
    const initials = parts.map(part=>Array.from(part)[0]).join('').toLocaleUpperCase('es-PE');
    return {name, initials, photo:model.validProfilePhoto(profile.photo) ? profile.photo : ''};
  }

  async function portrait(file, signal) {
    if (!file.size || file.size > fileLimit) throw new Error('Elige una imagen de hasta 12 MB.');
    const h = new Uint8Array(await file.slice(0,12).arrayBuffer());
    const isJPEG = h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
    const isPNG = [137,80,78,71,13,10,26,10].every((byte,i)=>h[i]===byte);
    const isWebP = String.fromCharCode(...h.subarray(0,4)) === 'RIFF' && String.fromCharCode(...h.subarray(8)) === 'WEBP';
    if (!isJPEG && !isPNG && !isWebP) throw new Error('Elige una imagen JPG, PNG o WebP.');
    if (signal.aborted) throw new Error('Selección cancelada.');
    const url = URL.createObjectURL(file);
    const img = new Image();
    let abortLoad, canvas;
    try {
      await new Promise((resolve,reject)=>{
        abortLoad = () => reject(new Error('Selección cancelada.'));
        signal.addEventListener('abort',abortLoad,{once:true});
        img.onload=resolve;
        img.onerror=()=>reject(new Error('No se pudo abrir la imagen. Prueba con otro archivo.'));
        img.src=url;
      });
      const {naturalWidth:w, naturalHeight:h} = img;
      if (!w || !h || w*h > 64000000) throw new Error('Elige una imagen de hasta 64 megapíxeles.');
      const crop = Math.min(w,h);
      const size = Math.min(model.profileLimits.side,crop);
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const g = canvas.getContext('2d',{alpha:false});
      if (!g) throw new Error('Este navegador no pudo preparar la foto. Prueba con una versión actualizada.');
      g.fillStyle = '#ffffff'; g.fillRect(0,0,size,size);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(img,(w-crop)/2,(h-crop)/2,crop,crop,0,0,size,size);
      for (const quality of [.86,.70,.53]) {
        const result = canvas.toDataURL('image/jpeg',quality);
        if (model.validProfilePhoto(result)) return result;
      }
      throw new Error('No se pudo reducir esta foto al tamaño admitido. Prueba con otra imagen.');
    } finally {
      if (abortLoad) signal.removeEventListener('abort',abortLoad);
      img.onload = img.onerror = null;
      img.removeAttribute('src');
      URL.revokeObjectURL(url);
      if (canvas) canvas.width = canvas.height = 0;
    }
  }

  function open(ctx, user) {
    if (currentDialog?.open) return;
    const before = {name:ctx.state.profile?.name || '',photo:ctx.state.profile?.photo || ''};
    let photo = before.photo, conversion = null, saving = false;
    const trigger = document.activeElement;
    const dialog = document.createElement('dialog');
    currentDialog = dialog;
    dialog.className = 'jprofile-dialog';
    dialog.setAttribute('aria-labelledby','jprofile-title');
    dialog.innerHTML = `<form novalidate><header><h2 id="jprofile-title">Mi perfil</h2><button type="button" class="icon-btn" data-profile-close aria-label="Cerrar perfil">${ctx.icon('x',18)}</button></header>
      <div class="jprofile-body"><div class="jprofile-photo"><div class="jprofile-preview" aria-hidden="true"></div>
        <div class="jprofile-pick"><div><button type="button" class="btn" data-pick></button><button type="button" class="jprofile-remove" data-remove>Quitar foto</button></div>
        <small>JPG, PNG o WebP · Hasta 12 MB</small><input name="file" type="file" accept="image/jpeg,image/png,image/webp" hidden></div></div>
        <label class="jprofile-field"><span>Nombre para mostrar</span><input name="name" type="text" maxlength="${model.profileLimits.name}" autocomplete="name"></label>
        <div class="jprofile-account"><span>Correo de la cuenta</span><strong data-account></strong></div>
        <p class="jprofile-feedback" role="status" hidden></p><p class="jprofile-error" role="alert" hidden></p></div>
      <footer><button type="button" class="btn" data-profile-close>Cancelar</button><button type="submit" class="btn primary">Guardar perfil</button></footer></form>`;
    const form = dialog.querySelector('form');
    const name = form.elements.name, file = form.elements.file;
    const preview = dialog.querySelector('.jprofile-preview');
    const change = dialog.querySelector('[data-pick]'), remove = dialog.querySelector('[data-remove]');
    const submit = form.querySelector('[type=submit]');
    const status = dialog.querySelector('.jprofile-feedback'), error = dialog.querySelector('.jprofile-error');
    name.value = before.name;
    name.placeholder = display({},user).name;
    dialog.querySelector('[data-account]').textContent = user?.email || 'Cuenta privada';

    function controls() {
      submit.disabled = saving || !!conversion || (name.value.trim() === before.name && photo === before.photo);
    }
    function draw() {
      change.textContent = photo ? 'Cambiar foto' : 'Añadir foto';
      remove.hidden = !photo;
      if (photo) {
        const img=document.createElement('img'); img.src=photo; img.alt='';
        preview.replaceChildren(img);
      } else preview.textContent = display({profile:{name:name.value}},user).initials;
      controls();
    }
    function feedback(message='',isError=false) {
      status.hidden=true; error.hidden=true;
      if (!message) return;
      const node = isError ? error : status;
      node.textContent=message; node.hidden=false;
    }
    function cancelConversion() {
      if (conversion) conversion.abort();
      conversion = null; file.value = '';
    }
    name.oninput = () => { if (!photo) draw(); else controls(); };
    change.onclick = () => file.click();
    remove.onclick = () => {cancelConversion();photo='';feedback();draw();};
    file.onchange = async () => {
      const selected = file.files?.[0];
      if (!selected) return;
      cancelConversion();
      const process = new AbortController();
      conversion = process;
      feedback('Preparando la foto…'); controls();
      try {
        const result = await portrait(selected,process.signal);
        if (process.signal.aborted) return;
        photo = result; feedback('Foto lista para guardar.');
      } catch (err) {
        if (!process.signal.aborted) feedback(err.message || 'No se pudo preparar la imagen.',true);
      } finally {
        if (conversion === process) { conversion=null; draw(); }
      }
    };
    dialog.querySelectorAll('[data-profile-close]').forEach(button=>button.onclick=()=>{if (!saving) dialog.close();});
    dialog.addEventListener('cancel',e=>{if (saving) e.preventDefault();});
    dialog.addEventListener('close',()=>{
      cancelConversion(); dialog.remove(); currentDialog=null;
      if (trigger?.isConnected) trigger.focus({preventScroll:true});
    }, {once:true});
    form.onsubmit = async event => {
      event.preventDefault();
      if (submit.disabled || saving || conversion) return;
      const changes = {name:name.value.trim(),photo};
      const apply = state=>model.saveProfile(state,before,changes);
      try {
        apply({...ctx.state});
        saving=true; form.inert=true; submit.textContent='Guardando…'; controls(); feedback();
        if (await ctx.mutate(apply)) {dialog.close();ctx.toast('Perfil actualizado.');}
        else feedback('El perfil sigue abierto con tus cambios. Revisa el aviso y vuelve a guardar.',true);
      } catch (err) { feedback(err.message || 'No se pudo guardar el perfil.',true); }
      finally { saving=false; form.inert=false; submit.textContent='Guardar perfil'; controls(); }
    };
    document.body.append(dialog); draw(); dialog.showModal();
    name.focus();
  }

  window.JProfile = {open,display};
})();
