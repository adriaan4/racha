# 🔥 RACHA OBLIGATORIA

PWA para que **Claudia** y **Carla** no se olviden nunca de activar la racha de TikTok.
Cada una marca su estado, los dos móviles ven lo mismo en tiempo real y el servidor les manda
notificaciones push (aunque la app esté cerrada) hasta que marquen **SÍ**.

## Qué hace

- Dos tarjetas independientes (CLAUDIA / CARLA) con **✅ SÍ** y **❌ NO**.
- Contador de días de racha seguidos (se suma cuando **las dos** marcan SÍ el mismo día) + récord.
- Pantalla **🔥 MISIÓN CUMPLIDA** cuando las dos han marcado SÍ.
- Estados compartidos entre móviles (base de datos en el servidor) y persistentes.
- Reinicio automático cada día a las **00:00** (hora de Madrid).
- Recordatorios push varias veces al día (por defecto 10:00, 12:30, 15:00, 17:30, 19:30, 21:00, 22:15 y 23:15).
  Cuando alguien marca SÍ deja de recibirlos ese día; a la otra persona se los sigue mandando.
- Mensajes: "🚨 CLAUDIA, ACTIVA LA RACHA YA", "🔥 CARLA, NO DEJES MORIR LA RACHA",
  "¿PERO QUÉ HACÉIS? ¡LA RACHA NO SE ACTIVA SOLA!" y "ÚLTIMO AVISO, QUE TIKTOK NO PERDONA" (el último del día).
- Instalable en Android y iPhone (manifest + service worker).
- Panel **/admin** para mandar avisos a mano, personalizados o programados (ver abajo).

## Panel /admin 🛠️

Entra en `https://TU-APP/admin` (define `ADMIN_PASSWORD` en las variables de entorno para que pida contraseña).

- **Enviar ahora** un aviso a CLAUDIA, CARLA o las dos, con título y texto personalizados (o una plantilla).
  `{nombre}` se sustituye por el nombre de quien lo recibe. Opción *Solo a quien aún no ha marcado SÍ*.
- **📨 Probar en este móvil**: manda lo que hayas escrito solo al móvil con el que estás en el admin
  (tiene que tener los avisos activados desde la app). Así ves cómo queda antes de enviarlo a nadie.
- **Programar** un aviso para un día y una hora (hora de Madrid), una sola vez o todos los días. Se puede borrar desde la lista.
- Ves cuántos móviles tiene registrados cada una y los últimos envíos.

Los avisos programados los dispara el mismo planificador de cada minuto, así que con un hosting que "duerme"
también necesitan el cron externo de `/api/tick`.

## Estructura

```
server.js            API + planificador de recordatorios (corre cada minuto)
lib/store.js         Base de datos compartida (Postgres o fichero JSON)
lib/time.js          Fechas en hora de Madrid
public/              La PWA (index.html, app.js, styles.css, sw.js, manifest.json, icons/) y el panel (admin.html, admin.js, admin.css)
scripts/             Generador de iconos y de claves VAPID (opcionales)
Dockerfile, Procfile Para desplegar en casi cualquier hosting
.env.example         Variables de entorno (todas opcionales)
```

## Probar en local

```bash
npm install
cp .env.example .env     # opcional
npm start
```

Abre http://localhost:3000. Las notificaciones push exigen HTTPS en el móvil, así que para probarlas
de verdad despliega primero (localhost sí funciona en el propio ordenador).

## Subir a GitHub

```bash
git init
git add .
git commit -m "🔥 Racha obligatoria"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/racha-obligatoria.git
git push -u origin main
```

(`.env` y `data/` ya están en `.gitignore`.)

## Desplegar

La app es un servidor Node.js estándar (`npm install` + `npm start`, escucha en `$PORT`), así que
funciona en cualquier plataforma que ejecute Node o Docker conectada a GitHub.

1. Crea un servicio nuevo desde tu repositorio de GitHub.
   - Build: `npm install`  ·  Start: `npm start` (o usa el `Dockerfile`).
2. **Base de datos (recomendado):** crea una base Postgres en la misma plataforma y pon su cadena de
   conexión en la variable `DATABASE_URL`. Así no se pierde nada al redesplegar.
   Sin `DATABASE_URL` se guarda en `./data/db.json`, que solo sobrevive si el hosting tiene un disco/volumen persistente.
3. Variables opcionales: ver `.env.example`. Si no pones claves VAPID, se generan solas la primera vez y se guardan en la base de datos.
4. Abre la URL pública (HTTPS) en el móvil de cada una.

### ⚠️ Importante: la app tiene que estar siempre encendida

Los recordatorios los dispara el servidor. Si tu plan gratuito "duerme" la app por inactividad,
los avisos no saldrán. Dos soluciones:

- Usar un plan que no se duerma, **o**
- Poner un cron externo gratuito (cron-job.org, UptimeRobot…) que visite cada minuto
  `https://TU-APP/api/tick?key=TU_SECRETO` (define `CRON_SECRET=TU_SECRETO`). Eso despierta
  al servidor y dispara los avisos aunque esté dormido.

## Instalar en el móvil y activar avisos

**Android (Chrome):** abre la URL → menú ⋮ → *Instalar aplicación* → ábrela → *🔔 Activar avisos* → elige quién eres → Permitir.

**iPhone (Safari, iOS 16.4 o superior):** abre la URL → *Compartir* → *Añadir a pantalla de inicio* →
abre la app **desde el icono** (si no, iOS no permite notificaciones) → *🔔 Activar avisos* → elige quién eres → Permitir.

Cada una elige su nombre en su móvil ("LAS DOS" sirve si compartís dispositivo). Con *📨 Probar aviso* comprobáis que llega.

## Personalizar

- Horas de aviso: variable `REMINDER_TIMES` (ej. `09:00,14:00,20:00,23:00`). El último de la lista es siempre el "ÚLTIMO AVISO".
- Zona horaria: `APP_TZ` (por defecto `Europe/Madrid`).
- Textos de los mensajes: función `buildMessage` en `server.js`.
- Logo: sale de `public/img/foto.jpg`. Para cambiarlos, sustituye esa foto (cuadrada) y ejecuta
  `npm run icons` (necesita Python 3 y `pip install pillow`); regenera todos los iconos.
- Tras cambiar el icono, desinstala y vuelve a instalar la app en el móvil para que se actualice.

## Notas

- No hay login: cualquiera con la URL puede marcar estados. Para dos amigas es lo más sencillo; no compartáis el enlace.
- Si una notificación deja de llegar (por ejemplo tras reinstalar la app), pulsad *🔔 Activar avisos* de nuevo.
