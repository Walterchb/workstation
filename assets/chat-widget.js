/* Acceso al mismo chat desde el resto del espacio de trabajo. */
(() => {
  'use strict';
  let widget = null;

  function close() {
    if (!widget) return;
    if (widget.dialog.open) widget.dialog.close();
    widget.launcher.setAttribute('aria-expanded','false');
    widget.host.replaceChildren();
  }

  function reset() {
    if (!widget) return;
    close();
    widget.root.remove();
    widget = null;
  }

  function mount(ctx) {
    const root = document.createElement('div');
    root.setAttribute('data-jchat-widget','');
    root.innerHTML =
      '<button type="button" class="jchat-widget-launcher" data-chat-launcher aria-label="Abrir chat de Work Station" aria-haspopup="dialog" aria-controls="jchat-widget-dialog" aria-expanded="false">'+
      ctx.icon('sparkles',20)+'<span class="jchat-widget-launcher-label">Chat</span></button>'+
      '<dialog id="jchat-widget-dialog" class="jchat-widget-dialog" data-chat-widget-dialog aria-labelledby="jchat-widget-heading">'+
      '<header class="jchat-widget-head"><span class="jchat-widget-mark" aria-hidden="true">'+ctx.icon('sparkles',19)+'</span>'+
      '<h2 class="jchat-widget-title" id="jchat-widget-heading" tabindex="-1">Chat de Work Station</h2>'+
      '<div class="jchat-widget-actions"><button class="jchat-widget-icon" type="button" data-chat-widget-expand aria-label="Abrir chat a página completa" title="Abrir a página completa">'+ctx.icon('arrow-up-right',18)+'</button>'+
      '<button class="jchat-widget-icon" type="button" data-chat-widget-close aria-label="Cerrar chat" title="Cerrar chat">'+ctx.icon('x',18)+'</button></div></header>'+
      '<div class="jchat-widget-content" data-chat-widget-content></div></dialog>';
    document.body.append(root);
    const launcher = root.querySelector('[data-chat-launcher]');
    const dialog = root.querySelector('dialog');
    const host = root.querySelector('[data-chat-widget-content]');
    const w = {root, dialog, launcher, host, ctx};

    function renderChat() {
      window.JChat.render(host,{...w.ctx, openChatSource(source) {
        close();
        w.ctx.openChatSource(source);
      }},{compact:true});
    }
    w.renderChat = renderChat;

    launcher.addEventListener('click',()=>{
      if (root.hidden || document.querySelector('dialog[open]') || document.querySelector('.rail.is-open')) return;
      dialog.showModal();
      launcher.setAttribute('aria-expanded','true');
      renderChat();
      const focusTarget = window.matchMedia('(pointer: coarse)').matches ? dialog.querySelector('h2') : host.querySelector('textarea');
      focusTarget?.focus({preventScroll:true});
    });
    dialog.querySelector('[data-chat-widget-close]').addEventListener('click',()=>{
      close();
      launcher.focus({preventScroll:true});
    });
    dialog.querySelector('[data-chat-widget-expand]').addEventListener('click',()=>{
      close();
      w.ctx.navigate('chat');
    });
    dialog.addEventListener('cancel',event=>{
      event.preventDefault();
      close();
      launcher.focus({preventScroll:true});
    });
    dialog.addEventListener('close',()=>{
      if (dialog.open) return;
      launcher.setAttribute('aria-expanded','false');
      host.replaceChildren();
    });
    dialog.addEventListener('keydown',event=>{
      if (event.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll('button,select,textarea,a[href],summary,[tabindex="0"]')]
        .filter(el=>!el.disabled && !el.closest('[hidden]') && el.getClientRects?.().length !== 0);
      const first = items[0], last = items.at(-1);
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.querySelector('h2'))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
    let backdropPressed = false;
    const outside = event => {
      if (event.target !== dialog) return false;
      const bounds = dialog.getBoundingClientRect();
      return event.clientX<bounds.left || event.clientX>bounds.right || event.clientY<bounds.top || event.clientY>bounds.bottom;
    };
    dialog.addEventListener('pointerdown',event=>{backdropPressed=outside(event);});
    dialog.addEventListener('click',event=>{
      if (backdropPressed && outside(event)) {
        close();
        launcher.focus({preventScroll:true});
      }
      backdropPressed=false;
    });
    return w;
  }

  function update(view,ctx) {
    if (!ctx.user?.id) { reset(); return; }
    if (widget && widget.ctx.user?.id !== ctx.user.id) reset();
    if (view === 'chat') {
      if (widget) { close(); widget.root.hidden = true; }
      return;
    }
    if (!widget) widget = mount(ctx);
    widget.ctx = ctx;
    widget.root.hidden = false;
    if (widget.dialog.open) widget.renderChat();
  }

  window.JChatWidget = Object.freeze({update,reset});
})();
