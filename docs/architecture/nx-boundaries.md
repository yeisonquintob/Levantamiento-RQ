# Límites arquitectónicos en Nx

## Etiquetas de scope

```text
scope:web
scope:gateway
scope:identity
scope:projects
scope:sources
scope:documents
scope:ai
scope:erp-knowledge
scope:workflow
scope:operations
scope:shared
```

## Etiquetas de tipo

```text
type:app
type:api
type:feature
type:domain
type:data-access
type:contracts
type:util
type:config
type:testing
```

## Reglas

1. Ninguna librería importará desde `apps`.
2. Un dominio no importará entidades internas de otro dominio.
3. La comunicación entre dominios usará contratos públicos.
4. `type:domain` no dependerá de infraestructura.
5. `type:data-access` pertenecerá a un único scope.
6. `type:contracts` no contendrá reglas de negocio.
7. `scope:shared` no contendrá entidades de dominio.
8. Las utilidades compartidas serán técnicas y estables.
9. El conocimiento ERP no dependerá de un proveedor específico.
10. Las excepciones se documentarán mediante ADR.
