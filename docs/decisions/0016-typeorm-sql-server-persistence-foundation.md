# ADR-0016: Base de persistencia TypeORM para SQL Server

## Estado

Aceptada.

## Decisión

Crear `shared-persistence` como librería técnica sin entidades ni
reglas de negocio. Esta librería valida configuración, construye las
opciones seguras de SQL Server y registra TypeORM únicamente cuando
`DATABASE_ENABLED=true`.

Cada servicio propietario de datos conserva su `DataSource`, sus
entidades y sus migraciones. El Gateway no utiliza persistencia.

## Consecuencias

- Los servicios siguen iniciando sin una base remota mientras la
  persistencia esté deshabilitada.
- `synchronize`, `dropSchema` y la ejecución automática de migraciones
  quedan prohibidos.
- No se comparten entidades ni repositorios entre dominios.
- La conexión real y las primeras migraciones se realizarán cuando
  existan credenciales y modelos de dominio aprobados.
