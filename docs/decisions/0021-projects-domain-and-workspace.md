# ADR-0021: Dominio de proyectos y Workspace integrado

## Estado

Aceptada.

## Contexto

La identidad real está activa, pero el Workspace no dispone todavía de un
dominio funcional para organizar los levantamientos.

## Decisión

Projects Service será propietario de `RqProjectsDb`, de los proyectos y de
sus participantes. El frontend continuará consumiendo únicamente el Gateway.

Los identificadores de usuarios serán referencias externas sin claves
foráneas entre bases. Projects Service validará el access token emitido por
Identity Service y aplicará acceso por administrador o participante.

La creación, consulta, filtrado y actualización de proyectos se habilitan en
el Workspace responsive durante el mismo paso.

## Consecuencias

- Projects Service requiere persistencia real y el secreto de validación del
  access token.
- El Gateway incorpora enrutamiento explícito al puerto del servicio.
- La base puede evolucionar sin compartir entidades con Identity.
- La selección visual de participantes dependerá de un futuro directorio
  controlado de usuarios.
