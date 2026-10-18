# Cerrojo — plan del hackatón

Nombre provisional. Hackatón: Nebius x NVIDIA Global AI Hackathon, categoría **Coding and Agentic Engineering**.
Entrega: **30-10-2026, 10:00 PT**. El repo debe ser público con licencia MIT; los materiales van en inglés.

## La idea en una línea

Un agente que audita apps hechas con IA (Lovable, Bolt, v0) sobre Supabase, **demuestra** cada fuga de datos con un ataque real en una base de datos aislada, escribe la migración que la cierra y vuelve a atacar para comprobar que quedó corregida.

Diferenciador frente a un linter: no dice "esto podría ser inseguro"; enseña la fila que se filtra y la prueba que pasa después de corregirla.

## Arquitectura

```
repo (ruta local o URL de GitHub)
  │
  ├─ 1. Descubrir   supabase/migrations/*.sql, uso de supabase-js en el frontend
  │                 (.from('tabla'), storage, claves en el cliente)
  ├─ 2. Sandbox     PGlite (Postgres en WASM, sin Docker) + capa que imita Supabase:
  │                 roles anon/authenticated/service_role, auth.uid(), auth.jwt(),
  │                 storage.buckets/objects. Se aplican las migraciones del repo.
  ├─ 3. Estático    tablas sin RLS, políticas `using (true)`, SECURITY DEFINER sin
  │                 search_path, grants a anon, service_role en el frontend
  ├─ 4. Atacar      Nemotron genera datos semilla y ataques en SQL ("como usuario B,
  │                 leer pedidos de A"); se ejecutan en el sandbox con el rol y claims
  │                 del atacante → hallazgo CONFIRMADO o descartado
  ├─ 5. Corregir    Nemotron escribe una migración; sandbox nuevo; se repiten los
  │                 ataques (deben fallar) y los accesos legítimos (deben seguir
  │                 funcionando). Hasta N iteraciones.
  └─ 6. Entregar    informe en Markdown + migración + PR opcional con `gh`
```

### Uso de modelos (Token Factory, API compatible con OpenAI)

- Base URL: `https://api.tokenfactory.nebius.com/v1`. La clave va en `.env` y la pone el usuario.
- **Nemotron Ultra**: planear ataques y escribir la corrección (razonamiento).
- **Nemotron Nano/Super**: clasificar archivos y resumir el uso de cada tabla (llamadas rápidas y baratas).
- Los IDs de los modelos se configuran por variables de entorno; se confirman con `GET /v1/models` cuando haya clave.

### Stack

TypeScript en Node 24, `@electric-sql/pglite`, SDK `openai` apuntando a Token Factory, CLI con `commander`.
Demo web: página sencilla donde se pega una URL de repo y se ven los ataques en vivo. Despliegue en Nebius Serverless Endpoint si da tiempo (suma puntos); si no, en un hosting gratuito.

## Calendario

| Fecha | Trabajo |
|---|---|
| 18-10 | Prueba de PGlite + RLS (hecha), plan, esqueleto |
| 19-10 | Capa que imita Supabase y aplicación de migraciones reales (hecha el 18-10) |
| 20-10 | App de ejemplo vulnerable (`fixtures/`) con 4 o 5 fugas típicas |
| 21-10 | Análisis estático + motor de ataques (ejecutar SQL como rol y usuario) |
| 22-10 | Cliente de Token Factory; Nemotron genera ataques y datos semilla |
| 23-10 | Bucle de corrección: migración → reataque → accesos legítimos |
| 24-10 | CLI completa + informe en Markdown + PR con `gh` |
| 25-10 | Demo web con progreso en vivo |
| 26-10 | Despliegue de la demo; probar con 2 o 3 repos públicos reales |
| 27-10 | README en inglés, diagrama, comentarios sobre Token Factory |
| 28-10 | Guion y grabación del video (<3 min) |
| 29-10 | Margen y envío en Devpost |
| 30-10 | Cierre a las 10:00 PT (≈ madrugada/mañana en LATAM) |

## Pendiente del usuario

- [ ] Inscribirse en el Nebius Builder Program (créditos gratis).
- [ ] Crear la clave de Token Factory y guardarla en `.env` (nunca en el repo).
- [ ] Confirmar el nombre del proyecto.
- [ ] Autorizar la creación del repo público en GitHub.

## Fuera de alcance

- Auditar proyectos que no sean Supabase/Postgres.
- Atacar instancias en producción: el agente solo ataca su propio sandbox.
