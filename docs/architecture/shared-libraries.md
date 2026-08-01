# Librerías compartidas y contratos base

## Objetivo

Centralizar únicamente capacidades técnicas estables que puedan ser utilizadas
por varios servicios sin compartir entidades ni reglas de negocio.

## Librerías

| Proyecto Nx          | Ruta                      | Importación                            | Responsabilidad                     |
| -------------------- | ------------------------- | -------------------------------------- | ----------------------------------- |
| shared-config        | libs/shared/config        | @levantamiento-rq/shared-config        | Configuración técnica base          |
| shared-contracts     | libs/shared/contracts     | @levantamiento-rq/shared-contracts     | Contratos públicos técnicos         |
| shared-errors        | libs/shared/errors        | @levantamiento-rq/shared-errors        | Errores de aplicación               |
| shared-http          | libs/shared/http          | @levantamiento-rq/shared-http          | Correlación y errores HTTP          |
| shared-observability | libs/shared/observability | @levantamiento-rq/shared-observability | Registros estructurados             |
| shared-testing       | libs/shared/testing       | @levantamiento-rq/shared-testing       | Constructores técnicos para pruebas |

## Contratos iniciales

- Identificador de correlación.
- Fecha UTC tipada.
- Health check.
- Paginación.
- Problem Details.
- Sobre de eventos de integración.

## Reglas

1. Las librerías compartidas no contienen entidades TypeORM.
2. No contienen reglas de negocio de Identity, Projects, Sources, Documents,
   AI, ERP Knowledge, Workflow u Operations.
3. Ninguna librería importa desde `apps`.
4. Los dominios no importan elementos internos de otros dominios.
5. Los servicios se comunican mediante contratos públicos.
6. `shared-testing` no debe utilizarse en código productivo.
7. Los límites se verifican mediante ESLint y etiquetas Nx.

## Estado

Base técnica creada en el Paso 6. Las aplicaciones todavía no registran
globalmente los interceptores o filtros; esa integración se realizará cuando
se configure la base técnica del Gateway y de cada servicio.

## Persistencia técnica

El Paso 8 incorpora `@levantamiento-rq/shared-persistence` como librería técnica sin entidades ni repositorios compartidos. Su etiqueta Nx es `scope:shared,type:data-access`.
