# Contexto del sistema

## Actores

- Administrador.
- Analista de procesos.
- Revisor.
- Aprobador.
- Usuario de consulta.
- Administrador de plantillas.
- Experto funcional ERP.
- Experto técnico ERP.

## Diagrama de contexto

```mermaid
flowchart LR
    U[Usuarios] --> W[Frontend responsive]
    W --> G[API Gateway / BFF]

    G --> I[Identity Service]
    G --> P[Projects Service]
    G --> S[Sources Service]
    G --> D[Documents Service]
    G --> A[AI Analysis Service]
    G --> E[ERP Knowledge Service]
    G --> F[Workflow Service]
    G --> O[Operations Service]

    S --> B[(Azurite / Azure Blob Storage)]
    A --> AI[Proveedor de IA]
    A --> E

    K[Snapshots y documentación ERP] --> E
    DY[Dynamics 365] -. extracción futura y controlada .-> K

    I --> SQL1[(RqIdentityDb)]
    P --> SQL2[(RqProjectsDb)]
    S --> SQL3[(RqSourcesDb)]
    D --> SQL4[(RqDocumentsDb)]
    A --> SQL5[(RqAiDb)]
    E --> SQL6[(RqErpKnowledgeDb)]
    F --> SQL7[(RqWorkflowDb)]
    O --> SQL8[(RqOperationsDb)]

    S --> MQ[(RabbitMQ / Service Bus)]
    A --> MQ
    D --> MQ
    E --> MQ
    F --> MQ
    O --> MQ

    S --> R[(Redis / BullMQ)]
    A --> R
    E --> R
    O --> R
```

## Regla de entrada

El frontend no conocerá las direcciones internas de los servicios.
Toda solicitud de usuario pasará por el Gateway/BFF.

## Dynamics 365

Dynamics 365 será considerado un sistema empresarial existente durante
el análisis de requerimientos.

En la primera etapa:

- No habrá integración operacional.
- No habrá acceso directo a producción.
- No se consultarán transacciones en tiempo real.
- No se ejecutarán operaciones sobre el ERP.
- No se reemplazará Dynamics como sistema maestro.

En una fase futura se podrán importar snapshots controlados de módulos,
procesos, capacidades, tablas, campos, entidades de datos, formularios,
menús, workflows, reportes, roles, extensiones, personalizaciones y
documentación funcional o técnica.
