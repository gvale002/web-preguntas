# G IOTK

Plataforma interactiva de preguntas en vivo para presentaciones, inspirada en Kahoot/Mentimeter y personalizada para Altronics.

## Funciones
- Administración y persistencia de cuestionarios.
- Tipos: selección única, múltiples respuestas correctas, verdadero/falso y texto libre.
- Tiempo configurable por pregunta (20 s por defecto).
- Sala de espera con QR, código aleatorio de 6 dígitos y URL visible para ingreso manual.
- Hasta 100 jugadores por sala, sin registro: solo nombre/apodo.
- Actualizaciones en tiempo real mediante Server-Sent Events (SSE).
- Puntuación proporcional a rapidez para respuestas correctas.
- Ganador de cada pregunta y ranking acumulado.
- Resultado mostrando letra/alternativa y texto de la respuesta correcta.
- Música generada en el navegador: ritmo latino animado en espera, ambiente suave en revisión y redoble/fiesta en el podio.
- Control de música ON/OFF y activación explícita para cumplir restricciones de autoplay del navegador.
- Avance manual del presentador.
- Podio final.
- Identidad visual G IOTK con logo Altronics.

## Ejecutar
Requiere Node.js 18+ y Python 3 con el paquete `qrcode` instalado.

```bash
npm start
```

Abrir `http://localhost:3000/admin`.

## Variables
- `PORT`: puerto HTTP (por defecto `3000`).
- `HOST`: interfaz de escucha (por defecto `0.0.0.0`).

## Producción / Render
El proyecto incluye `Dockerfile`. En Render usar Runtime `Docker`, rama `main`, Root Directory vacío y Dockerfile Path `./Dockerfile`.

Para que el QR funcione con móviles, el servidor debe ser accesible desde esos dispositivos usando un hostname/IP público o de la misma red local. Si se publica detrás de un proxy HTTPS, este debe enviar `X-Forwarded-Proto`.

Los cuestionarios se guardan en `data/quizzes.json`. Las partidas activas se mantienen en memoria; al reiniciar el servidor, las salas activas se cierran, pero los cuestionarios permanecen mientras el almacenamiento del despliegue sea persistente.


## Cambios 1.7.0
- Pantalla del presentador simplificada.
- Logo PNG original `public/assets/lOGO Iotek Latam.png` sobre el QR, sin fondo CSS.
- Eliminado el boton Música ON/OFF de la barra del presentador.
- Boton Administración ubicado a la izquierda de Iniciar primera pregunta.


## v1.7.0
- Imagen opcional por pregunta desde Administración (PNG/JPG/WEBP).
- La imagen se guarda con el cuestionario y se muestra a la izquierda de la pregunta en el modo presentador.

## Cambios 1.8.1
- Vista previa de cada pregunta desde Administración en una pestaña nueva, sin iniciar una partida.
- Control por pregunta del tamaño del texto (24–64 px).
- Control por pregunta de la ubicación de respuestas: 2 columnas debajo, una fila debajo o a la derecha.
- Control por pregunta del tamaño de la imagen (20–48% del ancho del área de pregunta).
- Modo presentador ampliado y compactado para priorizar que las respuestas permanezcan visibles sin scroll en pantallas de presentación habituales.


## Cambios 1.8.1
- Colores consistentes por alternativa en jugador, presentador y vista previa: A rojo, B azul, C amarillo, D verde.


## Cambios 1.8.5
- Barra superior de Administración compactada.
- Música ON/OFF reemplazada por icono.
- Control de volumen reducido.
- Botones Eliminar reemplazados por iconos.
- Nuevo control por pregunta para el espacio bajo el nombre del cuestionario (0–80 px), aplicado a presentador y vista previa.

## Acceso por correo (v1.8.5)

- `/admin` requiere ingresar un correo electrónico en `/login`.
- No se solicita ni almacena contraseña.
- Cada correo queda registrado en `data/users.json` con fecha de creación y último ingreso.
- Los correos que terminan en `@altronics.cl` ven el botón **Usuarios** y pueden habilitar, deshabilitar o eliminar otros usuarios.
- Al deshabilitar o eliminar un usuario se invalidan sus sesiones activas.
- Los jugadores siguen usando `/play` con código y apodo; no necesitan correo.

> Importante: este modo registra el correo escrito por el usuario, pero no verifica que la persona sea propietaria de esa dirección. Por lo tanto, la regla `@altronics.cl` es adecuada para control informal/registro, no para seguridad fuerte.


## Cambios 1.8.7
- Los usuarios con correo @altronics.cl pueden ver, editar, eliminar e iniciar partidas con todos los cuestionarios.
- Los demás usuarios solo ven y gestionan los cuestionarios que ellos mismos crean.
- Los cuestionarios nuevos guardan ownerUserId y ownerEmail.
- Los cuestionarios antiguos sin propietario quedan visibles solo para usuarios @altronics.cl.
