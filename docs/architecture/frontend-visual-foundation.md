# Base frontend responsive y estándar visual

## Alcance

El Paso 9 incorpora una aplicación Next.js con App Router y una librería
React compartida. El objetivo es establecer geometría, tokens,
accesibilidad y componentes básicos antes de conectar lógica funcional.

## Referencia visual

La base adapta `ESTÁNDAR VISUAL NAVI ADMIN WEB 1.0` a la identidad técnica
de Levantamiento RQ. Conserva colores por función, cuatro temas, cuatro
escalas de texto, jerarquía de página, foco visible, reducción de movimiento,
tablas con desplazamiento accesible y sidebar convertido en drawer.

Los tokens usan el prefijo `--rq-` para mantener la autonomía del proyecto.

## Proyectos

- `web`: aplicación Next.js.
- `shared-ui`: componentes React y tokens visuales.

## Componentes iniciales

- `RqActionButton`
- `RqKpiCard`
- `RqKpiGrid`
- `RqPageHero`
- `RqStatusBadge`
- `RqTableShell`
- `RqEmptyState`

## Exclusiones

No se incorporan autenticación, llamadas HTTP, datos simulados, lógica
empresarial, formularios operativos, PWA, preferencias en servidor ni OpenAI.
