# ADR-0017: Frontend responsive y sistema visual

## Estado

Aceptada.

## Decisión

Crear la aplicación `web` con Next.js y App Router dentro del workspace Nx.
Crear `shared-ui` como librería React compartida con tokens semánticos,
componentes básicos y reglas responsive.

El estándar visual NAVI 1.0 sirve como referencia de geometría, semántica de
color y accesibilidad. Los tokens usan el prefijo `rq` para conservar la
identidad de Levantamiento RQ.

## Consecuencias

- La interfaz tiene una base común antes de implementar dominios.
- Los temas y escalas se conservan localmente en el navegador.
- Los módulos futuros deben consumir `shared-ui`.
- Los componentes no contienen reglas de negocio.
- Autenticación y comunicación con Gateway quedan para pasos posteriores.
