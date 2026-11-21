/* Almacenamiento de Work Hub. Cargar después de config.js y del modelo. */
(() => {
  "use strict";

  const conflictMessage = "La agenda cambió en otra pestaña o dispositivo. Recarga la página y vuelve a aplicar tu cambio.";
  const authMessage = "Tu sesión venció. Vuelve a iniciar sesión para guardar.";
  // GitHub Pages puede alojar varias aplicaciones en el mismo dominio.
  const appPath = location.pathname.replace(/index\.html$/i, "").replace(/\/$/, "");
  const demoKey = "jornada:v1:demo:" + appPath;
  let config;
  let mode = "auth";
  let user = null;
  let session = null;
  let revision = null;
  let pendingWrite = null;
  let busy = false;

  function failure(code, message, status = 0) {
    return Object.assign(new Error(message), { code, status });
  }

  function readConfig() {
    const value = window.JORNADA_CONFIG;
    if (!value) throw failure("CONFIG", "No se pudo cargar config.js. Comprueba que esté junto a index.html.");
    const url = String(value.supabaseUrl || "").trim().replace(/\/+$/, "");
    const key = String(value.supabasePublishableKey || "").trim();
    if (!url && !key) return null;
    if (!url || !key) throw failure("CONFIG", "Completa la URL del proyecto y su clave publicable en config.js.");
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
    return { url: parsed.origin, key, sessionKey: "jornada:v1:sesion:" + parsed.origin + appPath };
  }

  function validDocument(doc) {
    return !!doc && doc.version === 1 && Array.isArray(doc.tasks) && Array.isArray(doc.goals);
  }

  function view(state = null) {
    return { mode, user, state };
  }

  function forgetSession() {
    session = null;
    user = null;
    revision = null;
    pendingWrite = null;
    mode = "auth";
    try { sessionStorage.removeItem(config.sessionKey); } catch { /* Sesión en memoria cerrada. */ }
  }

  function setSession(value) {
    if (!value?.access_token || !value?.refresh_token || !value?.user?.id) {
      throw failure("AUTH", "Supabase no devolvió una sesión válida. Vuelve a ingresar.");
    }
    session = {
      access_token: value.access_token, refresh_token: value.refresh_token,
      expires_at: Number(value.expires_at) || Math.floor(Date.now() / 1000) + (Number(value.expires_in) || 3600),
      user: { id: value.user.id, email: value.user.email || "" }
    };
    try { sessionStorage.setItem(config.sessionKey, JSON.stringify(session)); }
    catch { /* Sigue en memoria si el navegador impide guardar la sesión. */ }
  }

  async function request(path, body, token) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const headers = { "Content-Type": "application/json", apikey: config.key };
    if (token) headers.Authorization = "Bearer " + token;
    let response;
    let raw;
    try {
      response = await fetch(config.url + path, {
        method: "POST", headers, body: JSON.stringify(body), signal: controller.signal,
        cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer"
      });
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
      if (data?.code === "PGRST202" || status === 404) {
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

  async function refreshSession() {
    if (!session) throw failure("AUTH", authMessage);
    try {
      const updated = await request("/auth/v1/token?grant_type=refresh_token", { refresh_token: session.refresh_token });
      if (updated?.user?.id !== session.user.id) throw failure("AUTH", authMessage);
      setSession(updated);
    } catch (error) {
      if (error.code === "AUTH" || [400, 401, 403].includes(error.status)) {
        forgetSession();
        throw failure("AUTH", authMessage);
      }
      throw error;
    }
  }

  async function rpc(name, body) {
    if (!session) throw failure("AUTH", authMessage);
    if (Date.now() / 1000 + 45 >= session.expires_at) await refreshSession();
    const path = "/rest/v1/rpc/" + name;
    try {
      return await request(path, body, session.access_token);
    } catch (error) {
      if (error.status === 401) {
        await refreshSession();
        return request(path, body, session.access_token);
      }
      // Los RPC son de solo lectura o idempotentes por identificador de operación.
      if (error.code === "NETWORK") return request(path, body, session.access_token);
      throw error;
    }
  }

  async function openCloud() {
    // Un fallo de lectura tampoco habilita escritura sobre una revisión desconocida.
    revision = null;
    const data = await rpc("jornada_leer", {});
    if (!Number.isSafeInteger(data?.revision) || data.revision < 0 ||
        (data.revision === 0 ? data.document !== null : !validDocument(data.document))) {
      throw failure("DATA", "La versión de la agenda guardada no se puede abrir. Revisa los datos en Supabase.");
    }
    revision = data.revision;
    pendingWrite = null;
    mode = "cloud";
    user = session.user;
    return view(data.revision === 0 ? window.JModel.empty() : data.document);
  }

  function demoRecord() {
    let raw;
    try { raw = localStorage.getItem(demoKey); }
    catch { throw failure("STORAGE", "El navegador está bloqueando el almacenamiento de la demostración."); }
    if (raw === null) return null;
    let record;
    try { record = JSON.parse(raw); } catch { /* No se sobrescribe un registro dañado. */ }
    if (!record || !validDocument(record.document) || !Number.isSafeInteger(record.revision) || record.revision < 1) {
      throw failure("DATA", "La agenda local tiene un formato que no se puede abrir.");
    }
    return record;
  }

  function storeDemo(document, nextRevision) {
    try { localStorage.setItem(demoKey, JSON.stringify({ revision: nextRevision, document })); }
    catch { throw failure("STORAGE", "El navegador no pudo guardar el cambio. Revisa el espacio y los permisos de almacenamiento."); }
    revision = nextRevision;
  }

  function withDemoLock(action) {
    // Los archivos locales pueden tener un origen opaco sin acceso a Web Locks.
    if (location.protocol !== "file:" && navigator.locks?.request) return navigator.locks.request(demoKey, action);
    return action();
  }

  async function boot() {
    config = readConfig();
    if (!config) {
      return withDemoLock(() => {
        const existing = demoRecord();
        const state = existing?.document || window.JModel.seed();
        if (existing) revision = existing.revision;
        else storeDemo(state, 1);
        mode = "demo";
        user = null;
        return view(state);
      });
    }
    if (!session) {
      let stored;
      try { stored = JSON.parse(sessionStorage.getItem(config.sessionKey) || "null"); } catch { /* Abrir acceso. */ }
      if (stored?.user?.id && stored?.refresh_token && stored?.access_token) session = stored;
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
    if (!config) throw failure("CONFIG", "Configura Supabase en config.js para iniciar sesión.");
    const data = await request("/auth/v1/token?grant_type=password", { email: String(email).trim(), password });
    setSession(data);
    return openCloud();
  }

  async function signOut() {
    if (!config) return boot();
    try {
      if (session) {
        if (Date.now() / 1000 >= session.expires_at) await refreshSession();
        await request("/auth/v1/logout?scope=local", {}, session.access_token);
      }
    } catch { /* Si se perdió la red, el acceso local también debe terminar. */ }
    finally { forgetSession(); }
    return view();
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
    if (mode === "demo") {
      return withDemoLock(() => {
        if (demoRecord()?.revision !== revision) throw failure("CONFLICT", conflictMessage);
        storeDemo(document, revision + 1);
      });
    }
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
    boot: exclusive(boot), signIn: exclusive(signIn), signOut: exclusive(signOut), save: exclusive(save)
  });
})();
