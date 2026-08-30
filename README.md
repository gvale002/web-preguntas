# Web Preguntas

Plataforma de preguntas en vivo para presentaciones, inspirada en Kahoot/Mentimeter.

## Funciones
- Administración y persistencia de cuestionarios.
- Tipos: selección única, múltiples respuestas correctas, verdadero/falso y texto libre.
- Tiempo configurable por pregunta (20 s por defecto).
- Sala de espera con QR y código aleatorio de 6 dígitos.
- Hasta 100 jugadores por sala, sin registro: solo nombre/apodo.
- Actualizaciones en tiempo real mediante Server-Sent Events (SSE).
- Puntuación proporcional a rapidez para respuestas correctas.
- Ganador de cada pregunta y ranking acumulado.
- Música generada en el navegador, sin archivos externos.
- Avance manual del presentador.
- Podio final.

## Ejecutar
Requiere Node.js 18+ y Python 3 con el paquete `qrcode` instalado.

```bash
npm start
```

Abrir `http://localhost:3000/admin`.

## Variables
- `PORT`: puerto HTTP (por defecto `3000`).
- `HOST`: interfaz de escucha (por defecto `0.0.0.0`).

## Producción
Para que el QR funcione con móviles, el servidor debe ser accesible desde esos dispositivos usando un hostname/IP público o de la misma red local. Si se publica detrás de un proxy HTTPS, este debe enviar `X-Forwarded-Proto`.

Los cuestionarios se guardan en `data/quizzes.json`. Las partidas activas se mantienen en memoria; al reiniciar el servidor, las salas activas se cierran, pero los cuestionarios permanecen.
