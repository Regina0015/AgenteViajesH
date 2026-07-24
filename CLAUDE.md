# Claude — Contexto y reglas de este proyecto

Hackatón TGIF (HEB México), un solo día. Specs oficiales: `hackaton-tgif-agente-gastos.html`
(deck de 17 slides: caso de Laura, política de gastos, 5 casos de prueba del jurado, rúbrica).
Prioridad: velocidad y demo funcional. Modo hack — sin burocracia, salvo las dos reglas duras.

## El reto en corto
- App completa: solicitud de anticipo → registro de gastos (texto o **foto de ticket**) →
  agente de IA valida contra política → todo persiste en BD → liquidación con descuento de nómina.
- Caso jurado: anticipo $2,000, gastado $2,500, alcohol $140 rechazado, excedente $360 →
  **descuento de nómina $500.00**. Los 5 casos de prueba del deck deben pasar antes de la demo.
- La política vive en la BD (no quemada en el prompt): alcohol prohibido, sin comprobante >$100,
  propinas >15%, límites por categoría (comida $600/evento, hotel $1,800/noche,
  transporte $500/día, otros $400/viaje).

## Stack decidido (2026-07-24)
- Frontend: React + Vite. Captura con cámara (getUserMedia) + subir/arrastrar imagen.
- Backend: Node + Express (la key de Azure nunca va en el navegador).
- BD: SQLite (sin Docker por decisión del usuario; ver nota).
- IA: modelo con visión en Azure AI Foundry (GPT-4o o equivalente) — una sola llamada hace
  OCR + separación de conceptos + clasificación. Sin Document Intelligence.
- Diseño: estilo propio y único (rúbrica da 20 pts a diseño/UX).
- NOTA Docker: el usuario decidió quitarlo, pero el deck lo lista como MVP obligatorio y
  la rúbrica da ~15 pts a "Docker funcionando". Revisar al final del día si conviene
  agregar un docker-compose de última milla. No usar Docker durante el desarrollo.

## Decisiones locales (proceder sin preguntar)
- Todo lo del repo: código, dependencias, estructura, seeds, migraciones aditivas, git local.
- Llamar a los endpoints de IA de Azure con las credenciales que el usuario proporcione.

## REGLA DURA 1 — Base de datos
Nunca borrar ni destruir datos de ninguna BD sin consulta explícita caso por caso.
Incluye: borrar el archivo `.db` de SQLite, `DROP`, `TRUNCATE`, `DELETE`/`UPDATE` masivos,
o sobrescribir la BD con otra. Aplica siempre, incluso "para limpiar" o al final del día.
Antes de un cambio riesgoso de esquema: copia de respaldo del archivo `.db` y avisar dónde quedó.

## REGLA DURA 2 — Hacia afuera
Consultar antes de: crear/eliminar recursos en Azure, exponer la app fuera de la máquina
(túneles HTTPS incluidos), push a repos remotos, despliegues, o enviar datos reales a
servicios no acordados.

## Credenciales
Keys en `.env` (incluido en `.gitignore`), nunca versionadas ni impresas en logs/commits.
