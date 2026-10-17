# Publicar Tokinoto (etapa 9)

El juego se publica gratis en dos servicios:

- **Render**: un solo servicio web entrega la página del juego y atiende las
  conexiones de Socket.IO, en la misma dirección (por ejemplo
  `https://tokinoto.onrender.com`).
- **Neon**: base PostgreSQL donde se guarda el historial de los juegos (DP-21).

La configuración de Render está en [`render.yaml`](../render.yaml). No hace
falta tocar código para publicar.

## Qué tener en cuenta del plan gratuito

| Tema | Qué pasa |
|---|---|
| Servidor dormido | Tras 15 minutos sin nadie conectado, Render lo apaga. La primera visita lo despierta en alrededor de un minuto (se ve una página de carga de Render). |
| Durante un juego | No se apaga: los mensajes del juego cuentan como actividad. |
| Reinicios | Al reiniciar o publicar una versión nueva, los juegos en curso se pierden y quedan como **abortados** en el historial. **No mergees en `main` mientras tus amigos están jugando**: cada merge publica solo. |
| Horas | 750 horas gratis por mes: alcanzan para un servicio encendido todo el mes. |
| Base de datos | Neon gratis: 1 GB, sin vencimiento. Se duerme a los 5 minutos y despierta sola en menos de un segundo. |

## Paso 1: crear la base en Neon

1. Entrá a <https://console.neon.tech> y creá un proyecto.
   - Nombre: `tokinoto`.
   - Región: **AWS US East (N. Virginia)**, la misma del servidor en Render.
2. En el panel del proyecto tocá **Connect**.
3. Si ves la opción **Connection pooling**, desactivala.
4. Copiá la cadena de conexión. Empieza con `postgresql://` y termina con
   `?sslmode=require` (puede seguir con `&channel_binding=require`).
   Pegala tal cual en el paso 2: el servidor ya exige verificar el certificado.

> **Importante:** esa cadena incluye la contraseña de la base. No la subas al
> repositorio, no la pegues en el chat ni en un issue. Solo va en Render.

Las tablas se crean solas la primera vez que arranca el servidor.

## Paso 2: crear el servicio en Render

1. Entrá a <https://dashboard.render.com>.
2. Tocá **New** → **Blueprint**.
3. Conectá el repositorio `LorePB7/Tokinoto`. Si Render no lo ve, tocá
   **Configure GitHub** y dale acceso a ese repositorio.
4. Render lee `render.yaml` y muestra un servicio llamado `tokinoto`, plan
   **Free**.
5. Te pide el valor de `DATABASE_URL`: pegá la cadena de Neon del paso 1.
6. Tocá **Deploy Blueprint** (o **Apply**).

La primera publicación tarda unos minutos. En la pestaña **Logs** del
servicio tenés que ver, al final:

```
Historial en PostgreSQL listo.
Servidor de Tokinoto escuchando en el puerto 10000 (producción)
Entregando el cliente web desde /opt/render/project/src/packages/cliente/dist
Orígenes permitidos: https://tokinoto.onrender.com
```

La dirección del juego aparece arriba, en la página del servicio. Si el
nombre `tokinoto` ya estaba tomado, Render agrega unas letras
(`tokinoto-abcd.onrender.com`). No hay que configurar nada más: el servidor
toma su propia dirección de Render (`RENDER_EXTERNAL_URL`).

## Paso 3: probar

1. Abrí `https://<tu-dirección>/salud`: tiene que decir `ok`.
2. Abrí la dirección del juego, creá una sala y copiá el enlace.
3. Abrí el enlace en otras pestañas o en el celular y jugá un juego.
4. Para ver el historial guardado, desde tu PC (PowerShell):

   ```powershell
   $env:DATABASE_URL = "<cadena de Neon>"
   npm run historial -w @tokinoto/persistencia -- listar
   Remove-Item Env:DATABASE_URL
   ```

## Publicar cambios

Cada merge en `main` publica solo (`autoDeploy`). Para pausarlo, en Render:
**Settings** → **Build & Deploy** → **Auto-Deploy: No**, y publicás a mano
con **Manual Deploy**.

## Si algo falla

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| La página tarda un minuto en abrir | El servidor estaba dormido | Es normal en el plan gratuito. |
| En los logs: `En producción hay que definir TOKINOTO_ORIGENES` | El servicio no se creó desde el Blueprint | En **Environment** agregá `TOKINOTO_ORIGENES` con la dirección del juego (`https://...onrender.com`, sin barra final). |
| En los logs: error de conexión a PostgreSQL | Cadena de Neon mal copiada | En **Environment** corregí `DATABASE_URL` y tocá **Save, rebuild and deploy**. |
| En los logs: `DATABASE_URL no está definida` | Falta la variable | El juego anda igual, pero no guarda historial. Cargala en **Environment**. |
| "No se puede conectar" en la página | El servidor se reinició o la dirección no coincide con `TOKINOTO_ORIGENES` | Mirá los logs; recargá la página. |

## Seguridad (qué hace el servidor publicado)

- Toda jugada se valida en el servidor (servidor autoritativo); cada jugador
  recibe solo sus cartas.
- Solo acepta conexiones desde la dirección del juego (orígenes), y en
  producción se niega a arrancar si no la sabe.
- Límite de mensajes por conexión, tamaño máximo de mensaje (16 KB), límite de
  300 conexiones y 1000 salas simultáneas.
- Códigos de sala de 8 caracteres al azar criptográfico.
- Cabeceras de seguridad en todas las respuestas: política de contenido
  (solo scripts, estilos y fuentes del propio sitio), sin incrustar en otros
  sitios, sin enviar el enlace de la sala a otros sitios (`no-referrer`) y
  HTTPS obligatorio (HSTS).
- La página se sirve desde memoria: el servidor no lee archivos del disco
  según lo que pide el navegador.
- La conexión a Neon verifica el certificado (`sslmode=verify-full`).
- `npm audit --omit=dev`: 0 vulnerabilidades. Los avisos de `npm audit` vienen
  de `drizzle-kit`, que solo se usa en la PC para generar migraciones y no se
  ejecuta en el servidor.

🔵 Cuando el proyecto pase a un plan pago conviene sumar: límite de conexiones
por dirección IP (en el plan gratuito la IP real del jugador no llega de forma
confiable), un dominio propio y un servicio de aviso de errores (por ejemplo
Sentry).
