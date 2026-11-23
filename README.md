# Work Hub

Agenda personal para planificar antes de las 08:00, registrar el tiempo efectivo de cada actividad y relacionar varios días de trabajo con un resultado. El sitio se publica como archivos estáticos. Supabase gestiona las cuentas y los registros.

**[Abrir la instrucciones de instalación](./GUIA.html)**. Para leerla desde Windows, extrae el ZIP y abre `GUIA.html` con Edge o Chrome. En GitHub se verá su código fuente. Cuando actives Pages, podrás leerla en `/jornada-personal/GUIA.html` desde el dominio de tu sitio.

## Actualizar una instalación existente

Extrae el contenido del ZIP de actualización sobre la carpeta del repositorio que contiene `index.html`. En GitHub Desktop revisa **Changes**, crea el commit y pulsa **Push origin**. El ZIP incluye los archivos de la actualización. Tu instalación sigue usando los valores de conexión de su propio `config.js`.

## Acceder a la agenda

Abre tu sitio e inicia sesión con el correo y la contraseña de tu cuenta en Supabase. Work Hub carga las actividades, los objetivos generales y las categorías de esa cuenta. Una cuenta nueva tiene las actividades y los objetivos vacíos. Si falta configurar la conexión, la pantalla inicial indica qué datos completar.

## Conectar tu propia cuenta

1. En [Supabase](https://supabase.com/dashboard), crea un proyecto para Work Hub y espera a que esté disponible. Guarda por separado la contraseña de la base de datos. Para iniciar sesión en Work Hub usarás otra contraseña, la de tu usuario.
2. En tu proyecto, abre **SQL Editor → New query**. Abre [supabase/schema.sql](./supabase/schema.sql) con el Bloc de notas, copia el archivo completo en la consulta y pulsa **Run**. Espera el mensaje de éxito. El script crea la tabla privada, las funciones de lectura y guardado y las políticas por usuario.
3. En **Authentication → Sign In / Providers**, comprueba que **Email** esté habilitado. Desactiva **Allow new users to sign up** y guarda el cambio. En **Authentication → Users → Add user → Create new user**, escribe tu correo y una contraseña para Work Hub, marca **Auto confirm user?** y pulsa **Create user**.
4. En **Connect** copia la **Project URL** y la **Publishable key**. También puedes obtener la segunda en **Settings → API Keys**. En la copia extraída, abre [config.js](./config.js) con el Bloc de notas y pega ambos valores entre las comillas. Guarda con **Ctrl + S**.

```js
window.JORNADA_CONFIG = {
  supabaseUrl: "https://TU-PROYECTO.supabase.co",
  supabasePublishableKey: "sb_publishable_REEMPLAZA_ESTE_VALOR"
};
```

El navegador utiliza la clave publicable. Mantén fuera del repositorio tu contraseña y las claves de servidor `sb_secret_…` o `service_role`. El esquema privado y las políticas de acceso controlan a qué registros accede cada cuenta.

## Publicar en GitHub Pages

1. En [GitHub](https://github.com/new), crea un repositorio nuevo, por ejemplo `jornada-personal`. En GitHub Free personal, Pages requiere un repositorio público. Usa la opción privada si tu plan admite Pages para repositorios privados.
2. En el repositorio nuevo, elige **uploading an existing file** o **Add file → Upload files**. En el Explorador, entra hasta la carpeta que contiene `index.html`. Selecciona su **contenido completo**, incluidas las carpetas, y arrástralo a GitHub. Confirma con **Commit changes** en `main`. En la raíz del repositorio debes ver `index.html`, `config.js`, `assets/` y `supabase/`.
3. Abre **Settings → Pages → Build and deployment**. Elige **Deploy from a branch**, rama **main**, carpeta **/(root)** y pulsa **Save**. Si tu rama inicial tiene otro nombre, selecciona esa rama.
4. Cuando Pages indique que el sitio está disponible, abre **Visit site**. Para el repositorio de ejemplo la dirección tiene la forma `https://TU-USUARIO.github.io/jornada-personal/`. En **Authentication → URL Configuration** de Supabase puedes guardar esa dirección HTTPS como **Site URL** para los enlaces de autenticación del proyecto. El acceso directo por correo y contraseña funciona sin configurar redirecciones.
5. Inicia sesión con tu correo y contraseña. Abre **Actividades → Editar actividades → Planificar**, escribe tu primera actividad y su contexto, y guarda la jornada. Al volver a entrar desde otro dispositivo, encontrarás la actividad en la misma fecha.

Tu sesión de Work Hub pertenece a la pestaña actual. Si la cierras, vuelve a ingresar para consultar los mismos datos. Las solicitudes de la cuenta real van directamente a Supabase y la tipografía Manrope está incluida en el paquete.

## Si algo falla

| Señal | Qué revisar |
| --- | --- |
| Aparece la pantalla de configuración | Completa la URL y la clave publicable de tu proyecto en `config.js`. Publica el archivo, vuelve al sitio y pulsa **Reintentar**. |
| El formulario rechaza la cuenta | Verifica el proveedor Email, el correo, la contraseña y la confirmación de usuario en el mismo proyecto de la URL y la clave publicable. |
| Inicio de sesión correcto, pero falla la lectura o el guardado | Comprueba la conexión, que el proyecto esté activo y que ejecutaste todo el SQL. En la configuración de la Data API debe estar habilitada la API y expuesto el esquema `public`, donde viven las funciones. Mantén `jornada_private` fuera de la lista de esquemas expuestos. |
| Aparece un cambio en otra sesión | En la hoja, **Opciones de fila → Copiar hoja** permite respaldar el borrador en Excel antes de recargar. Revisa lo guardado por la otra sesión y vuelve a aplicar tu edición. |
| GitHub Pages muestra 404 | En **Settings → Pages**, confirma la rama, **/(root)** y la URL que muestra **Visit site**. En **Code**, verifica que `index.html` está en la raíz y que respetaste los nombres originales. |

**Documentación oficial** · [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) · [Supabase Auth](https://supabase.com/docs/guides/auth/general-configuration) · [Claves de API](https://supabase.com/docs/guides/getting-started/api-keys) · [Seguridad por fila](https://supabase.com/docs/guides/database/postgres/row-level-security).
