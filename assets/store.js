/* Almacenamiento de Work Hub. Cargar después de config.js y del modelo. */
(() => {
  "use strict";

  const conflictMessage = "La agenda cambió en otra pestaña o dispositivo. Recarga la página y vuelve a aplicar tu cambio.";
  const authMessage = "Tu sesión venció. Vuelve a iniciar sesión para guardar.";
  // GitHub Pages puede alojar varias aplicaciones en el mismo dominio.
  const appPath = location.pathname.replace(/index\.html$/i, "").replace(/\/$/, "");
  let config;
  let mode = "auth";
  let user = null;
  let session = null;
  let revision = null;
  let pendingWrite = null;
  let busy = false;
  let renewal = null;
  let chatRequest = null;

  function failure(code, message, status = 0) {
    return Object.assign(new Error(message), { code, status });
  }

  function readConfig() {
    const value = window.JORNADA_CONFIG;
    if (!value) throw failure("CONFIG", "No se pudo cargar config.js. Comprueba que esté junto a index.html.");
    const url = String(value.supabaseUrl || "").trim().replace(/\/+$/, "");
    const key = String(value.supabasePublishableKey || "").trim();
    if (!url || !key) throw failure("CONFIG", "Completa la URL de tu proyecto Supabase y su clave publicable en config.js para habilitar el acceso.");
    let parsed;
    try { parsed = new URL(url); } catch { /* Se valida abajo. */ }
    if (!parsed || parsed.protocol !== "https:" || parsed.username || parsed.password ||
        parsed.search || parsed.hash || parsed.pathname !== "/") {
      throw failure("CONFIG", "La URL en config.js debe ser la URL HTTPS de tu proyecto Supabase.");
    }
    if (!key.startsWith("sb_publishable_")) {
      let role;
      try {
        const payload = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        role = JSON.parse(atob(payload)).role;
      } catch { /* También descarta claves secretas y tokens mal formados. */ }
      if (role !== "anon") throw failure("CONFIG", "Usa la clave publicable de Supabase o la clave anon heredada en config.js.");
    }
    if (typeof fetch !== "function" || typeof AbortController !== "function") {
      throw failure("CONFIG", "Abre Work Hub en un navegador actualizado con conexión HTTPS a Supabase.");
    }
    return { url: parsed.origin, key, sessionKey: "jornada:v1:sesion:" + parsed.origin + appPath };
  }

  function validDocument(doc) {
    return !!doc && doc.version === 1 && Array.isArray(doc.tasks) && Array.isArray(doc.goals);
  }

  function view(state = null) {
    return { mode, user, state };
  }

  function forgetSession() {
    chatRequest?.abort();
    session = null;
    user = null;
    revision = null;
    pendingWrite = null;
    mode = "auth";
    try { if (config) sessionStorage.removeItem(config.sessionKey); } catch { /* Sesión en memoria cerrada. */ }
  }

  function setSession(value) {
    if (!value?.access_token || !value?.refresh_token || !value?.user?.id) {
      throw failure("AUTH", "Supabase no devolvió una sesión válida. Vuelve a ingresar.");
    }
    // Esta clave contiene exclusivamente la credencial de la pestaña, nunca el documento de trabajo.
    session = {
      access_token: value.access_token, refresh_token: value.refresh_token,
      expires_at: Number(value.expires_at) || Math.floor(Date.now() / 1000) + (Number(value.expires_in) || 0),
      user: { id: value.user.id, email: value.user.email || "" }
    };
    try { sessionStorage.setItem(config.sessionKey, JSON.stringify(session)); }
    catch { /* Sigue en memoria si el navegador impide guardar la sesión. */ }
  }

  function post(path, body, token, signal, accept) {
    const headers = { "Content-Type": "application/json", apikey: config.key };
    if (token) headers.Authorization = "Bearer " + token;
    if (accept) headers.Accept = accept;
    return fetch(config.url + path, {
      method: "POST", headers, body: JSON.stringify(body), signal,
      cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer"
    });
  }

  async function request(path, body, token) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let response;
    let raw;
    try {
      response = await post(path, body, token, controller.signal);
      raw = await response.text();
    } catch {
      throw failure("NETWORK", "No se pudo confirmar la operación. Revisa tu conexión y vuelve a intentarlo.");
    } finally { clearTimeout(timeout); }
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); }
      catch {
        if (response.ok) throw failure("NETWORK", "No se pudo confirmar la respuesta de Supabase. Vuelve a intentar.");
      }
    }
    if (!response.ok) {
      const status = response.status;
      if (status === 409 || data?.code === "PT409") throw failure("CONFLICT", conflictMessage, status);
      if (status === 429) throw failure("RATE_LIMIT", "Demasiados intentos. Espera un momento y vuelve a ingresar.", status);
      if (status >= 500 || status === 408) throw failure("NETWORK", "Supabase no pudo confirmar la operación. Intenta nuevamente.", status);
      if (path.startsWith("/rest/") && (data?.code === "PGRST202" || status === 404)) {
        if (path.endsWith("/workhub_chat_budget_sync")) {
          throw failure("CONFIG", "Para sincronizar el saldo, ejecuta supabase/chat-budget.sql en el SQL Editor de tu proyecto.", status);
        }
        throw failure("CONFIG", "Supabase no encuentra la función de Work Hub. Ejecuta supabase/schema.sql en el proyecto configurado.", status);
      }
      if (data?.code === "42501" || status === 403) {
        throw failure("ACCESS", "Supabase denegó el acceso. Verifica que ejecutaste el esquema completo y que tu cuenta está habilitada.", status);
      }
      if (data?.code === "invalid_credentials" || data?.error_code === "invalid_credentials") {
        throw failure("CREDENTIALS", "El correo o la contraseña son incorrectos.", status);
      }
      if (data?.code === "email_not_confirmed" || data?.error_code === "email_not_confirmed") {
        throw failure("CREDENTIALS", "Confirma tu correo antes de ingresar.", status);
      }
      if (status === 401) throw failure("AUTH", "No se pudo autenticar la solicitud. Revisa tu sesión y la clave publicable en config.js.", status);
      throw failure("REQUEST", "Supabase rechazó la solicitud. Verifica los datos y la configuración del proyecto.", status);
    }
    return data;
  }

  async function renewSession(current) {
    try {
      const updated = await request("/auth/v1/token?grant_type=refresh_token", { refresh_token: current.refresh_token });
      if (session !== current || updated?.user?.id !== current.user.id) throw failure("AUTH", authMessage);
      setSession(updated);
    } catch (error) {
      if (error.code === "AUTH" || [400, 401, 403].includes(error.status)) {
        if (session === current) forgetSession();
        throw failure("AUTH", authMessage);
      }
      throw error;
    }
  }

  async function refreshSession() {
    if (!session) throw failure("AUTH", authMessage);
    // El chat puede coincidir con un guardado. El refresh token solo se canjea una vez.
    if (renewal?.session === session) return renewal.promise;
    const flight = { session, promise: renewSession(session) };
    renewal = flight;
    try { return await flight.promise; }
    finally { if (renewal === flight) renewal = null; }
  }

  async function rpc(name, body, expectedUser) {
    function checkSession() {
      if (!session || (expectedUser !== undefined &&
          (mode !== "cloud" || session.user.id !== expectedUser || user?.id !== expectedUser))) {
        throw failure("AUTH", authMessage);
      }
    }
    checkSession();
    if (Date.now() / 1000 + 45 >= session.expires_at) await refreshSession();
    const path = "/rest/v1/rpc/" + name;
    const send = () => {
      checkSession();
      return request(path, body, session.access_token);
    };
    try {
      return await send();
    } catch (error) {
      checkSession();
      if (error.status === 401) {
        await refreshSession();
        try { return await send(); }
        catch (retryError) {
          checkSession();
          if (retryError.status === 401) { forgetSession(); throw failure("AUTH", authMessage); }
          throw retryError;
        }
      }
      // Los RPC son de solo lectura o idempotentes por identificador de operación.
      if (error.code === "NETWORK") return send();
      throw error;
    }
  }

  async function syncChatBudget(owner, {reference = null, entries = []} = {}) {
    if (!owner) throw failure("AUTH", authMessage);
    const summary = await rpc("workhub_chat_budget_sync", {p_reference:reference, p_entries:entries}, owner);
    if (session?.user.id !== owner || user?.id !== owner) throw failure("AUTH", authMessage);
    if (!summary || !Number.isSafeInteger(summary.missing) || !Number.isSafeInteger(summary.sample) ||
        typeof summary.spent !== "number") {
      throw failure("DATA", "No se pudo leer el saldo de la cuenta.");
    }
    return summary;
  }

  async function openCloud() {
    // Un fallo de lectura tampoco habilita escritura sobre una revisión desconocida.
    revision = null;
    const data = await rpc("jornada_leer", {});
    if (!Number.isSafeInteger(data?.revision) || data.revision < 0 ||
        (data.revision === 0 ? data.document !== null : !validDocument(data.document))) {
      throw failure("DATA", "La versión de la agenda guardada no se puede abrir. Revisa los datos en Supabase.");
    }
    const document = data.revision === 0 ? window.JModel.empty() : data.document;
    try { window.JModel.validate(document); }
    catch { throw failure("DATA", "La agenda recibida de Supabase tiene un formato incompatible. Revisa los registros guardados antes de continuar."); }
    revision = data.revision;
    pendingWrite = null;
    mode = "cloud";
    user = session.user;
    return view(document);
  }

  async function boot() {
    config = readConfig();
    if (!session) {
      let stored;
      try { stored = JSON.parse(sessionStorage.getItem(config.sessionKey) || "null"); } catch { /* Abrir acceso. */ }
      if (stored?.user?.id && stored?.refresh_token && stored?.access_token) setSession(stored);
    }
    if (!session) {
      mode = "auth";
      return view();
    }
    try { return await openCloud(); }
    catch (error) {
      if (error.code === "AUTH" && !session) return view();
      throw error;
    }
  }

  async function signIn(email, password) {
    config = readConfig();
    const data = await request("/auth/v1/token?grant_type=password", { email: String(email).trim(), password });
    chatRequest?.abort();
    setSession(data);
    return openCloud();
  }

  async function signOut() {
    mode = "auth";
    chatRequest?.abort();
    try {
      if (session) {
        if (Date.now() / 1000 >= session.expires_at) await refreshSession();
        await request("/auth/v1/logout?scope=local", {}, session.access_token);
      }
    } catch { /* Si se perdió la red, el acceso local también debe terminar. */ }
    finally { forgetSession(); }
    return view();
  }

  const chatErrors = Object.freeze({
    CHAT_AUTH: "Vuelve a iniciar sesión en Work Station para consultar el chat.",
    CHAT_NOT_CONFIGURED: "La configuración del chat está incompleta. Consulta los registros de workhub-chat en Supabase para identificar la causa.",
    CHAT_SUPABASE_CONFIG: "La función workhub-chat no pudo identificar la URL o la clave pública de su proyecto de Supabase. Revisa la configuración de la función.",
    CHAT_KEY_MISSING: "La función workhub-chat no encuentra OPENAI_API_KEY. En Supabase, abre Edge Functions → Secrets y comprueba que guardaste el secreto con ese nombre en este proyecto.",
    CHAT_KEY_INVALID: "OpenAI rechazó la clave de la API. Comprueba que sigue activa y actualiza su valor en Supabase → Edge Functions → Secrets → OPENAI_API_KEY.",
    CHAT_KEY_PERMISSION: "OpenAI denegó el acceso al chat. Revisa los permisos del proyecto y de la clave de la API para usar Responses.",
    CHAT_MODEL: "El modelo configurado para el chat no está disponible para este proyecto de OpenAI. Revisa su acceso o elige un modelo habilitado en el secreto OPENAI_MODEL de Supabase.",
    CHAT_ACCESS: "Tu cuenta no tiene permiso para consultar estos registros.",
    CHAT_LIMIT: "Hay demasiadas consultas en este momento. Espera un momento y vuelve a intentar.",
    CHAT_QUOTA: "El proyecto de la API de OpenAI agotó su cuota. Revisa su saldo y sus límites de uso.",
    CHAT_INPUT: "Revisa el mensaje y su extensión antes de enviarlo.",
    CHAT_DATA: "El chat no pudo leer los registros de tu cuenta en Work Station.",
    CHAT_PROVIDER: "OpenAI no pudo completar la respuesta. Puedes volver a consultar.",
    CHAT_TIMEOUT: "La consulta superó el tiempo de espera. Prueba con un período o una pregunta más específicos.",
    CHAT_NETWORK: "Se interrumpió la conexión con el chat. Puedes volver a enviar tu pregunta."
  });

  function chatFailure(response, data) {
    const status = response.status;
    if (Object.hasOwn(chatErrors, data?.code)) return withMetering(failure(data.code, chatErrors[data.code], status), data);
    if (status === 404) return withMetering(failure("CHAT_NOT_CONFIGURED", "La función workhub-chat todavía no está desplegada en este proyecto de Supabase.", status), data);
    const fallback = {400:"CHAT_INPUT", 401:"CHAT_AUTH", 403:"CHAT_ACCESS", 413:"CHAT_INPUT", 429:"CHAT_LIMIT", 504:"CHAT_TIMEOUT"};
    const code = fallback[status] || "CHAT_PROVIDER";
    return withMetering(failure(code, chatErrors[code], status), data);
  }

  const streamType = "application/x-ndjson";
  const maxChatBytes = 1024 * 1024;
  const invalidReply = () => failure("CHAT_PROVIDER", "El chat devolvió una respuesta incompleta.");

  async function* chatChunks(response, signal) {
    if (!response.body?.getReader) {
      const text = await response.text();
      if (text.length > maxChatBytes) throw invalidReply();
      yield text;
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", {fatal:true});
    const cancel = () => { reader.cancel().catch(()=>{}); };
    let received = 0, closed = false;
    signal.addEventListener("abort", cancel, {once:true});
    try {
      if (signal.aborted) cancel();
      while (true) {
        const {value, done} = await reader.read();
        if (done) { closed = true; break; }
        received += value.byteLength;
        if (received > maxChatBytes) throw invalidReply();
        yield decoder.decode(value, {stream:true});
      }
      yield decoder.decode();
    } finally {
      signal.removeEventListener("abort", cancel);
      if (!closed) cancel();
      reader.releaseLock();
    }
  }

  function withMetering(target, data) {
    if (data?.usage && typeof data.usage === "object") target.usage = data.usage;
    if (typeof data?.requestId === "string") target.requestId = data.requestId;
    return target;
  }

  function chatAnswer(data) {
    if (typeof data?.answer !== "string" || !data.answer.trim() || !Array.isArray(data.sources))
      throw withMetering(invalidReply(),data);
    return withMetering({answer:data.answer, sources:data.sources}, data);
  }

  async function readChatStream(chunks, onUpdate, checkSession) {
    let buffer = "";
    function consume(line) {
      checkSession();
      if (!line.trim()) return;
      let event;
      try { event = JSON.parse(line); } catch { throw invalidReply(); }
      switch (event?.type) {
        case "status":
          if (!["searching","writing"].includes(event.stage)) throw invalidReply();
          onUpdate?.({type:"status",stage:event.stage});
          break;
        case "delta":
          if (typeof event.text !== "string") throw invalidReply();
          onUpdate?.({type:"delta",text:event.text});
          break;
        case "reset":
          onUpdate?.({type:"reset"});
          break;
        case "done":
          return chatAnswer(event);
        case "error":
          throw chatFailure({status:Number.isInteger(event.status) ? event.status : 502}, event);
        default:
          throw invalidReply();
      }
    }
    for await (const chunk of chunks) {
      const lines = chunk.split("\n");
      if (lines.length === 1) { buffer += chunk; continue; }
      lines[0] = buffer + lines[0];
      buffer = lines.pop();
      for (const line of lines) {
        const answer = consume(line);
        if (answer) return answer;
      }
    }
    const answer = consume(buffer);
    if (answer) return answer;
    throw failure("CHAT_NETWORK", chatErrors.CHAT_NETWORK);
  }

  async function askChat(payload, signal, onUpdate) {
    const owner = user?.id;
    if (mode !== "cloud" || !owner || session?.user.id !== owner || revision === null) throw failure("CHAT_AUTH", chatErrors.CHAT_AUTH);
    if (chatRequest && !chatRequest.signal.aborted) throw failure("CHAT_BUSY", "Ya hay una consulta en curso.");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    chatRequest = controller;
    const attemptId = operationId();
    let timedOut = false, dispatched = false, started = false;
    const timeout = setTimeout(() => { timedOut = true; cancel(); }, 100000);
    signal?.addEventListener("abort", cancel, {once:true});
    if (signal?.aborted) cancel();
    function checkSession() {
      if (timedOut) throw failure("CHAT_TIMEOUT", chatErrors.CHAT_TIMEOUT);
      if (mode !== "cloud" || session?.user.id !== owner || revision === null) throw failure("CHAT_AUTH", chatErrors.CHAT_AUTH);
      if (controller.signal.aborted) {
        throw Object.assign(failure("CHAT_ABORTED", "Consulta cancelada."), {name:"AbortError"});
      }
    }
    function updateLedger(method, ...args) {
      const ledger = window.WorkStationChatBudget;
      try {
        const update = ledger?.[method]?.(owner,attemptId,...args);
        update?.catch?.(()=>{});
      } catch { /* El estado del indicador no interrumpe el chat. */ }
    }
    function measure(result, outcome, uncertain) {
      if (!started) return;
      if (result?.usage?.rounds === 0) updateLedger("settleUnbilled");
      else if (result?.usage) updateLedger("record",result.usage,outcome);
      else if (uncertain) updateLedger("markUnknown");
      else updateLedger("settleUnbilled");
    }
    try {
      checkSession();
      if (Date.now() / 1000 + 45 >= session.expires_at) await refreshSession();
      for (let attempt = 0; attempt < 2; attempt++) {
        checkSession();
        const token = session.access_token;
        const callback = typeof onUpdate === "function" ? onUpdate : undefined;
        if (!started) {
          // Conserva el intento aunque se cierre la pestaña mientras responde el modelo.
          started = true;
          updateLedger("beginAttempt");
        }
        dispatched = true;
        const response = await post("/functions/v1/workhub-chat", payload, token, controller.signal, callback ? streamType : undefined);
        checkSession();
        const chunks = chatChunks(response, controller.signal);
        const mediaType = response.headers?.get?.("Content-Type")?.split(";")[0].trim().toLowerCase();
        if (response.ok && mediaType === streamType) {
          const answer = await readChatStream(chunks, callback, checkSession);
          checkSession();
          measure(answer,"success",true);
          return answer;
        }
        let raw = "";
        for await (const chunk of chunks) { checkSession(); raw += chunk; }
        checkSession();
        let data;
        try { data = JSON.parse(raw); } catch { /* Puede ser un error del gateway sin JSON. */ }
        if (response.ok) {
          const answer = chatAnswer(data);
          measure(answer,"success",true);
          return answer;
        }
        const error = chatFailure(response, data);
        // Si la sesión venció al leer una fuente, el modelo ya pudo haber consumido tokens.
        if (response.status !== 401 || error.code !== "CHAT_AUTH" || error.usage?.rounds > 0 || attempt > 0) throw error;
        dispatched = false;
        if (token === session.access_token) await refreshSession();
      }
    } catch (error) {
      const uncertain = !error.code || ["CHAT_PROVIDER","CHAT_NETWORK","CHAT_TIMEOUT","CHAT_ABORTED"].includes(error.code);
      measure(error,"error",dispatched && (uncertain || controller.signal.aborted));
      checkSession();
      if (error.code === "AUTH") throw failure("CHAT_AUTH", chatErrors.CHAT_AUTH);
      if (typeof error.code === "string" && error.code.startsWith("CHAT_")) throw error;
      throw failure("CHAT_NETWORK", chatErrors.CHAT_NETWORK);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      if (chatRequest === controller) chatRequest = null;
    }
  }

  function operationId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, x => x.toString(16).padStart(2, "0")).join("");
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
  }

  async function save(state) {
    if (!validDocument(state)) throw failure("DATA", "La agenda que intentas guardar tiene un formato inválido.");
    const serialized = JSON.stringify(state);
    const document = JSON.parse(serialized);
    if (mode !== "cloud" || !session || revision === null) throw failure("AUTH", authMessage);
    if (!pendingWrite || pendingWrite.serialized !== serialized) {
      pendingWrite = { id: operationId(), serialized };
    }
    const result = await rpc("jornada_guardar", { p_document: document, p_revision: revision, p_operation: pendingWrite.id });
    if (result !== revision + 1) throw failure("DATA", "Supabase devolvió una revisión inesperada. Recarga la página.");
    revision = result;
    pendingWrite = null;
  }

  function exclusive(fn) {
    return async (...args) => {
      if (busy) throw failure("BUSY", "Espera a que termine la operación anterior.");
      busy = true;
      try { return await fn(...args); } finally { busy = false; }
    };
  }

  window.JStore = Object.freeze({
    boot: exclusive(boot), signIn: exclusive(signIn), signOut: exclusive(signOut), save: exclusive(save), askChat, syncChatBudget
  });
})();
