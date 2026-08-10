# Levantamiento RQ

Plataforma distribuida para levantar, analizar, editar, revisar, aprobar y
exportar requerimientos con apoyo de inteligencia artificial y revisión humana
obligatoria.

## Estado actual

La V1 está implementada de extremo a extremo y cuenta con una prueba E2E
autocontenida usando `FakeAiProvider`. La validación real de OpenAI y el
despliegue en Azure son acciones externas: requieren credenciales configuradas
por un administrador, pero no cambios de código.

ERP Knowledge permanece deliberadamente como capacidad futura opcional. Su
servicio base y su infraestructura están reservados, sin conexión directa ni
escritura sobre Dynamics 365 productivo.

El detalle auditable se mantiene en
[`docs/plans/status-application-v1.md`](docs/plans/status-application-v1.md).

## Flujo funcional V1

1. Iniciar sesión y administrar usuarios, roles y sesiones.
2. Crear un proyecto con participantes y una plantilla publicada.
3. Registrar notas o cargar TXT, CSV, XLSX, PDF, DOCX e imágenes y seleccionar
   las fuentes útiles.
4. Ejecutar **Procesar y generar borrador**: Sources deja las fuentes en
   `READY`, crea el documento o una nueva versión `DRAFT` y solicita exactamente
   una generación asíncrona con Fake u OpenAI.
5. Abrir el borrador ya aplicado, revisar y editar sus 13 secciones canónicas.
6. Crear versiones manuales sin IA o solicitar explícitamente una **Nueva
   versión con IA**; ambas conservan el historial anterior.
7. Enviar el borrador a Workflow, comentar, solicitar cambios, aprobar o
   rechazar.
8. Desde Validación, exportar la versión `APPROVED` exacta a PDF o DOCX.
9. Descargar artefactos y consultar notificaciones, historial documental,
   historial IA y auditoría técnica.

La IA nunca aprueba contenido. AI Analysis no accede a `RqDocumentsDb`: aplica
el resultado exclusivamente a una versión `DRAFT` mediante la API protegida de
Documents y siempre lo marca como contenido que requiere revisión humana.

## Arquitectura

| Componente    | Responsabilidad                                   | Persistencia                          |
| ------------- | ------------------------------------------------- | ------------------------------------- |
| Web           | Workspace responsive y PWA segura                 | Sin secretos ni JWT en `localStorage` |
| Gateway       | BFF único, cookies, origen, correlación y proxies | Sin base de datos                     |
| Identity      | Usuarios, roles, permisos y sesiones              | `RqIdentityDb`                        |
| Projects      | Proyectos, participantes y plantilla aplicada     | `RqProjectsDb`                        |
| Sources       | Fuentes, hash, extracción y archivos privados     | `RqSourcesDb` + Blob                  |
| Documents     | Plantillas, documentos, versiones y contenido     | `RqDocumentsDb`                       |
| AI Analysis   | Proveedores, prompts, ejecuciones y propuestas    | `RqAiDb`                              |
| ERP Knowledge | Reserva segura para snapshots/fit-gap futuros     | `RqErpKnowledgeDb` futura             |
| Workflow      | Revisión, comentarios, correcciones y aprobación  | `RqWorkflowDb`                        |
| Operations    | Exportaciones, notificaciones, inbox y auditoría  | `RqOperationsDb` + Blob               |

No existen claves foráneas entre bases de dominios. HTTP atiende operaciones
síncronas; RabbitMQ transporta eventos; Redis/BullMQ ejecuta extracción,
análisis y exportaciones.

## Límites de uso de IA

Una llamada al proveedor solo ocurre en dos acciones explícitas:

- **Procesar y generar borrador**, para el documento inicial o una nueva
  versión generada desde Fuentes.
- **Nueva versión con IA**, desde el editor documental.

Seleccionar fuentes, reprocesar técnicamente un archivo, abrir o guardar el
editor, crear una versión manual, consultar historiales, comparar versiones,
revisar, aprobar y exportar no invoca IA. La clave de idempotencia compartida
entre Web, AI Analysis y Documents evita generaciones o versiones duplicadas;
si la aplicación documental falla después de generar, el reintento reutiliza
el resultado persistido y no vuelve a llamar al proveedor.

## Stack

- Node.js 24, TypeScript, Nx y pnpm 11.
- NestJS, Fastify, TypeORM y SQL Server/Azure SQL.
- Next.js 16 y React 19.
- Redis/BullMQ, RabbitMQ y Azurite/Azure Blob Storage.
- OpenAI Responses API con salida JSON estructurada.
- Docker Compose local y Bicep para Azure Container Apps.

## Operación local

Los scripts resuelven la raíz oficial a partir de su propia ubicación. No
dependen del directorio desde el que se invoquen.

```bash
pnpm install --frozen-lockfile
pnpm auth:local:up
pnpm auth:local:status
pnpm auth:local:down
```

Antes de iniciar se requieren los archivos locales ignorados por Git descritos
en los `.env.example` y la infraestructura Docker configurada. El entorno de
desarrollo puede usar `AI_EXECUTION_MODE=FAKE`; producción rechaza ese modo.

Puertos:

| Aplicación                                 | Puerto |
| ------------------------------------------ | -----: |
| Gateway                                    |   3000 |
| Identity                                   |   3001 |
| Projects                                   |   3002 |
| Sources                                    |   3003 |
| Documents                                  |   3004 |
| AI Analysis                                |   3005 |
| ERP Knowledge (futuro, no iniciado por V1) |   3006 |
| Workflow                                   |   3007 |
| Operations                                 |   3008 |
| Web                                        |   4200 |

## Configuración segura de IA

Un ADMIN configura OpenAI desde:

`Configuración > Inteligencia artificial > Proveedores`

La API Key nunca regresa al navegador ni se guarda en SQL. Desarrollo macOS
usa Keychain; Azure usa Key Vault con identidad administrada. Solo se conserva
una referencia opaca en `RqAiDb`. El endpoint OpenAI está restringido al host
oficial para impedir SSRF.

## Validación

```bash
pnpm validate:all
pnpm test:e2e:v1
```

`validate:all` ejecuta instalación congelada, auditoría de dependencias de
producción, detección de secretos, límites arquitectónicos, lint, typecheck,
build, pruebas unitarias, eventos, infraestructura, migraciones, bases, Blob,
Redis/BullMQ, Swagger y smokes. El E2E crea fixtures temporales y los elimina al
terminar.

Comandos focalizados:

```bash
pnpm test:unit
pnpm test:events
pnpm test:integration
pnpm swagger:validate
pnpm lint:all
pnpm typecheck:all
pnpm build:all
```

## CI, despliegue y operación

- [Pipeline CI](.github/workflows/ci.yml)
- [Infraestructura Azure](infrastructure/azure/README.md)
- [Observabilidad](docs/operations/observability.md)
- [Respaldo y recuperación](docs/operations/backup-recovery.md)

El repositorio prepara imágenes, Container Apps, ocho Azure SQL, Storage,
Redis, Service Bus, vault de plataforma, vault aislado de IA y Application
Insights. No ejecuta despliegues ni accede a sistemas empresariales sin
autorización y credenciales externas.

## Documentación

- [Estado V1](docs/plans/status-application-v1.md)
- [Arquitectura](docs/architecture/README.md)
- [Contratos HTTP](docs/api/http-contract-guidelines.md)
- [Catálogo de eventos](docs/api/event-catalog.md)
- [Propiedad de datos](docs/database/database-ownership.md)
- [Modelo documental canónico](docs/document-model/README.md)
- [Decisiones arquitectónicas](docs/decisions/README.md)
- [Infraestructura local](infrastructure/docker/README.md)
