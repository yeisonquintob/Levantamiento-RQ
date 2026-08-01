# ADR-0013: Base backend con NestJS y Fastify

## Estado

Aceptada.

## Decisión

Las aplicaciones backend se crearán con NestJS dentro del monorepo Nx
y utilizarán Fastify como adaptador HTTP.

Cada aplicación tendrá un scope arquitectónico explícito y un puerto
local independiente. La creación de los esqueletos no implica que los
servicios ya estén implementados funcionalmente.
