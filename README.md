# Work Hub

Agenda personal para planificar antes de las 08:00, registrar el tiempo efectivo de cada actividad y relacionar varios días de trabajo con un resultado. El sitio se publica como archivos estáticos. Supabase gestiona las cuentas y los registros.

**[Abrir la guía de instalación y uso](./GUIA.html)**. Para leerla desde Windows, extrae el ZIP y abre `GUIA.html` con Edge o Chrome. En GitHub se verá su código fuente. Cuando actives Pages, podrás leerla en `/jornada-personal/GUIA.html` desde el dominio de tu sitio.

## Actualizar una instalación existente

Extrae el contenido del ZIP de actualización sobre la carpeta del repositorio que contiene `index.html`. En GitHub Desktop revisa **Changes**, crea el commit y pulsa **Push origin**. El cambio de nombre conserva la URL del sitio, la configuración de Supabase y tus registros existentes.

## Probar la agenda

En el Explorador de archivos, haz clic derecho en el ZIP y elige **Extraer todo**. Abre `index.html` dentro de la carpeta extraída. Con los dos valores de `config.js` vacíos, se abre una demostración con actividades ficticias. Sus cambios pertenecen a ese navegador. Al configurar Supabase, cada cuenta empieza con una agenda vacía.

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
5. Introduce el correo y la contraseña de **Authentication → Users**. En **Mi jornada**, pulsa **Editar actividades**. En una fila vacía escribe «Prueba de guardado» en **Actividades** y pulsa **Guardar jornada**. Cierra sesión y vuelve a entrar desde otra ventana o dispositivo. Comprueba que la actividad sigue en la fecha elegida. Para verificar el aislamiento, crea una segunda cuenta de prueba desde el panel e inicia en una ventana privada. Su agenda debe empezar vacía.

Tu sesión de Work Hub pertenece a la pestaña actual. Si la cierras, vuelve a ingresar para consultar los mismos datos. Las solicitudes de la cuenta real van directamente a Supabase y la tipografía Manrope está incluida en el paquete.

## Uso diario

- **Consultar el día**. Elige la fecha en la barra superior. Bajo los indicadores y la línea de tiempo, elige **Horario** para ver los tramos a escala y los espacios rayados **Sin registro**, o **Lista** para leerlos por orden de inicio. Cada hora parte de una altura reducida y se amplía cuando sus actividades necesitan más espacio. Las horas anotadas y las duraciones permanecen exactas. Pulsa el título de cualquier tramo para ver su detalle completo, incluso si dura pocos minutos. Las actividades sin horas aparecen en **Sin horario**. Las 08:00 son tu referencia de entrada.
- **Consultar la semana**. En **Semana**, las columnas siguen el orden de lunes a viernes. El sábado y el domingo se incorporan por separado cuando tienen alguna actividad, incluso sin horas. Las flechas de la barra avanzan o retroceden siete días. Pulsa el encabezado de un día para abrirlo.
- **Editar el plan**. Pulsa **Editar actividades**. Las ocho columnas de datos son **Estado**, **Actividades**, **Contexto**, **¿Se hizo?**, **Hora de inicio**, **Hora de cierre**, **Duración** y **Comentarios**. Pulsa **Añadir fila** para agregar al final. Para insertar entre dos actividades, selecciona una celda y elige **Opciones de fila → Insertar encima** o **Insertar debajo**. También puedes pegar un bloque de Excel desde su celda de destino con **Ctrl + V**. Para repetir reportes de otro día, usa **Reutilizar**.
- **Registrar horas y avances**. Anota el inicio real y guarda la jornada. Al terminar, completa el cierre y los comentarios en la hoja. Puedes cambiar **Estado** y marcar **¿Se hizo?** por separado desde **Horario**, **Lista** o **Sin horario**. Los comentarios y ambos controles se comparten entre los tramos de la misma actividad. Así puedes dar por cumplido el avance de hoy mientras el encargo sigue **En proceso**. Si retomas una actividad, selecciona su fila y usa **Añadir tramo**. **Duración** suma los tramos cerrados. **Detalle de fila** permite vincular un objetivo o marcar el origen como imprevisto. **Guardar jornada** o **Ctrl + S** aplica los cambios de la hoja en conjunto.
- **Categorías**. Gestiona los nombres, colores y la categoría predeterminada desde el menú lateral. Un cambio de nombre se aplica también a tus registros anteriores. Archivar una categoría la conserva en el historial. En el editor, asigna la categoría a la actividad desde **Detalle de fila**.
- **Objetivos**. Crea un resultado como «Emitir bonos corporativos» y vincula actividades conforme avances. Un comentario como «Se recibió la respuesta pendiente del due diligence» documenta qué cambió. Cuando el resultado se concrete, marca el objetivo como alcanzado y registra el resultado y su fecha.
- **Análisis**. Elige el período y revisa la distribución de minutos por objetivo o por categoría, el cumplimiento de lo previsto y los resultados registrados. Puedes tener una actividad en proceso tras haber cumplido el avance previsto para hoy. Selecciona **Diario** para revisar las horas de una fecha, o **Semanal** para explicar la distribución del trabajo en varios días. Abre **Informe gerencial** y pulsa **Descargar PDF** para obtener el archivo maquetado directamente. **Exportar CSV** descarga el detalle por tramo para Excel.

## Si algo falla

| Señal | Qué revisar |
| --- | --- |
| El sitio sigue en demostración | Comprueba que el `config.js` publicado contiene ambos valores reales, que el último cambio se publicó y actualiza con **Ctrl + F5**. |
| El formulario rechaza la cuenta | Verifica el proveedor Email, el correo, la contraseña y la confirmación de usuario en el mismo proyecto de la URL y la clave publicable. |
| Inicio de sesión correcto, pero falla la lectura o el guardado | Comprueba la conexión, que el proyecto esté activo y que ejecutaste todo el SQL. En la configuración de la Data API debe estar habilitada la API y expuesto el esquema `public`, donde viven las funciones. Mantén `jornada_private` fuera de la lista de esquemas expuestos. |
| Aparece un cambio en otra sesión | En la hoja, **Opciones de fila → Copiar hoja** permite respaldar el borrador en Excel antes de recargar. Revisa lo guardado por la otra sesión y vuelve a aplicar tu edición. |
| GitHub Pages muestra 404 | En **Settings → Pages**, confirma la rama, **/(root)** y la URL que muestra **Visit site**. En **Code**, verifica que `index.html` está en la raíz y que respetaste los nombres originales. |

**Documentación oficial** · [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) · [Supabase Auth](https://supabase.com/docs/guides/auth/general-configuration) · [Claves de API](https://supabase.com/docs/guides/getting-started/api-keys) · [Seguridad por fila](https://supabase.com/docs/guides/database/postgres/row-level-security).
