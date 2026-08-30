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
