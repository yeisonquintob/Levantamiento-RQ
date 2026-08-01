# ADR-0014: Librerías técnicas compartidas y límites Nx

## Estado

Aceptada.

## Contexto

Las aplicaciones backend necesitan contratos y utilidades técnicas comunes,
pero compartir entidades o reglas de negocio generaría acoplamiento entre
dominios.

## Decisión

Crear seis librerías compartidas de alcance técnico:

- Configuración.
- Contratos.
- Errores.
- HTTP.
- Observabilidad.
- Pruebas.

Las dependencias entre proyectos se controlarán con etiquetas `scope:*` y
`type:*` mediante la regla `@nx/enforce-module-boundaries`.

## Consecuencias

- Los contratos comunes tienen una ubicación estable.
- Los dominios conservan la propiedad de su lógica.
- Las importaciones indebidas fallan durante lint.
- No se comparten entidades TypeORM.
- Las excepciones a los límites deberán documentarse mediante ADR.
