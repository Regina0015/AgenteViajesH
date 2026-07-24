# 🧾 Talón — Agente de gastos de viaje

Hackatón TGIF · HEB México. Un agente de IA que lee tickets (foto o texto), separa los
conceptos, aplica la política de gastos guardada en base de datos y calcula la liquidación
con descuento de nómina.

## Correr en desarrollo

```powershell
npm run setup   # instala raíz + server + web (solo la primera vez)
npm run dev     # levanta API (:3001) y web (:5173) juntos
```

Abrir **http://localhost:5173**

## Conectar la IA de Azure

1. Copiar `.env.example` como `.env` en la raíz.
2. Llenar `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY` y `AZURE_OPENAI_DEPLOYMENT`
   (debe ser un modelo **con visión**, ej. `gpt-4o`).
3. Reiniciar `npm run dev`. El chip del header cambia de "IA simulada" a "Azure".

Sin keys, la app funciona completa con un analizador local (modo demo) — útil para
desarrollar, pero la extracción real de fotos requiere el modelo de Azure.

## Stack

- **Frontend:** React + Vite (cámara del navegador + subir foto)
- **API:** Node + Express
- **BD:** SQLite (`node:sqlite`, integrado en Node 24) — archivo `server/talon.db`
- **IA:** Azure AI Foundry (visión) + motor de reglas determinista leyendo la tabla `policies`

La base se crea y se siembra sola al arrancar (Laura, su viaje a Monterrey con los 6
gastos del caso, y la política del deck). Los 5 casos de prueba del jurado están cubiertos.
