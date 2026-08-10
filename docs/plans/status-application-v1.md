# Estado integral de Levantamiento RQ V1

Fecha de cierre técnico: 2026-08-09.

## Alcance

La V1 implementa el recorrido autenticado completo desde la creación de un
proyecto hasta la aprobación y exportación de su documento. Incluye fuentes
textuales y archivos, extracción asíncrona, análisis estructurado con IA,
revisión humana, Workflow, PDF, DOCX, notificaciones internas y auditoría.

La línea base de esta fase fue `0cb20bc` (`docs: close workflow approval point
19`). El código prevalece sobre las matrices históricas de puntos.

## Estado por capacidad

| Capacidad                    | Estado V1                | Evidencia principal                                                                           |
| ---------------------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| Identity y sesiones          | Completa                 | login, refresh rotativo, logout, revocación, cambio de contraseña e inactividad de 30 minutos |
| Usuarios y roles             | Completa                 | administración protegida por `system.admin`                                                   |
| Projects                     | Completa                 | proyectos, participantes, autorización y plantilla aplicada                                   |
| Sources                      | Completa                 | carga, selección, extracción y acción única para procesar y generar borrador                  |
| Documents                    | Completa                 | plantillas, 13 secciones, editor, versiones, concurrencia e inmutabilidad                     |
| AI Analysis                  | Completa en código       | Fake y OpenAI, aplicación automática a DRAFT, idempotencia, evidencias y revisión humana      |
| Workflow                     | Completa                 | revisión, comentarios, cambios, aprobación, rechazo e historial                               |
| Operations                   | Completa                 | exportaciones, artefactos, notificaciones, inbox y auditoría                                  |
| PDF/DOCX                     | Completa                 | generación real desde versión aprobada, Blob, hash y descarga                                 |
| RabbitMQ                     | Completa para eventos V1 | publicación confirmada y consumidor idempotente con retry                                     |
| PWA/responsive/accesibilidad | Completa para V1         | manifest, caché pública limitada, breakpoints, foco, teclado y tablas                         |
| CI y preparación Azure       | Completa en código       | workflow sin secretos, Dockerfiles y Bicep                                                    |
| ERP Knowledge / fit-gap      | Futuro opcional          | servicio base y arquitectura sin acceso productivo                                            |
| OpenAI real                  | Pendiente externa        | requiere credencial ingresada por ADMIN en la aplicación                                      |
| Correo real                  | Pendiente externa        | notificación interna activa; proveedor de correo deshabilitado                                |
| Despliegue Azure             | Pendiente externo        | requiere suscripción, aprobación y secretos de despliegue                                     |

## Arquitectura y propiedad

Web consume exclusivamente Gateway. Gateway no tiene base ni reglas de
negocio. Cada dominio conserva sus entidades, repositorios y migraciones; las
referencias entre dominios son UUID sin claves foráneas cruzadas.

| Servicio      | Base               | Puerto | Estado                           |
| ------------- | ------------------ | -----: | -------------------------------- |
| Identity      | `RqIdentityDb`     |   3001 | Implementado                     |
| Projects      | `RqProjectsDb`     |   3002 | Implementado                     |
| Sources       | `RqSourcesDb`      |   3003 | Implementado                     |
| Documents     | `RqDocumentsDb`    |   3004 | Implementado                     |
| AI Analysis   | `RqAiDb`           |   3005 | Implementado                     |
| ERP Knowledge | `RqErpKnowledgeDb` |   3006 | Futuro, persistencia no activada |
| Workflow      | `RqWorkflowDb`     |   3007 | Implementado                     |
| Operations    | `RqOperationsDb`   |   3008 | Implementado                     |

Gateway usa el puerto 3000 y Web el 4200. Los archivos de Sources pertenecen
al contenedor privado `rq-sources`; los artefactos al contenedor privado
`rq-exports`.

## Superficies HTTP y Web

Gateway publica bajo `/api/v1`:

- `/auth` para sesión;
- `/users` para administración;
- `/projects` y sus participantes;
- `/projects/:projectId/sources`;
- `/templates`;
- documentos y versiones por proyecto;
- `/projects/:projectId/analysis-requests`;
- revisión y aprobación de Workflow;
- solicitudes, artefactos, notificaciones y auditoría de Operations;
- `/health`, `/health/ready` y `/metrics`.

Cada backend publica Swagger en desarrollo. El Workspace operativo ofrece
Inicio, Proyectos, Fuentes, Documentos, Validación y Notificaciones. La
administración se concentra en Configuración. El historial técnico de IA se
consulta desde Documentos; la URL histórica de Análisis redirige allí.

## Fuentes y trabajos asíncronos

Sources admite notas, conversaciones, transcripciones, TXT, CSV, XLSX, PDF,
DOCX, PNG, JPG, JPEG y WEBP. Valida extensión, tamaño, firma y duplicados; Blob
es privado y SQL solo conserva metadatos, hash y texto extraído.

La selección no procesa ni llama IA. **Procesar y generar borrador** procesa
solo los archivos que aún no están `READY`, espera el lote, crea el documento
inicial o una nueva versión `DRAFT` y solicita una única generación. El botón
individual **Reprocesar fuente** conserva su función técnica: no crea versiones
ni invoca IA.

BullMQ usa Redis para:

| Cola predeterminada      | Propietario | Función                |
| ------------------------ | ----------- | ---------------------- |
| `source-processing`      | Sources     | extracción y reproceso |
| `ai-analysis-processing` | AI Analysis | ejecución de análisis  |
| `rq-exports-v1`          | Operations  | generación PDF/DOCX    |

Los jobs usan identificadores deterministas o estados persistidos, reintentos
con backoff, concurrencia acotada, métricas y limpieza en pruebas.

## IA, proveedores y secretos

La administración de proveedores permite crear, editar, habilitar,
predeterminar, probar, rotar y eliminar configuraciones OPENAI. El navegador
solo recibe `credentialConfigured`; la API Key no se devuelve, registra ni
persiste en SQL.

`AiSecretVault` cuenta con:

- Keychain de macOS para desarrollo;
- Azure Key Vault con `DefaultAzureCredential`/identidad administrada para
  producción;
- almacén en memoria únicamente para pruebas;
- modo deshabilitado explícito.

`SecretReference` permite cambiar de vault sin alterar el dominio. La URL de
OpenAI se restringe al endpoint oficial y la URL de Key Vault a dominios Azure
HTTPS conocidos. Bicep crea un vault aislado para IA, concede Secrets Officer
únicamente a AI Analysis y no da acceso a ese vault al resto de cargas.

La credencial real no está incluida en Git. Se configura desde
`Configuración > Inteligencia artificial > Proveedores`.

## Prompt, contrato y Requirement Analyst

El worker compone seis bloques: sistema, plantilla publicada, contrato JSON,
proyecto, snapshots de fuentes seleccionadas e instrucción final. Las fuentes
se delimitan como datos no confiables y no pueden reemplazar instrucciones.

La salida principal es JSON estructurado, validado contra el contrato V1 y las
13 secciones en orden. Cada propuesta conserva valor, estado, `sourceIds`,
confianza, revisión requerida, contradicciones y metadatos de proveedor,
modelo, prompt y ejecución. Los vacíos usan `[PENDIENTE POR DEFINIR]`.

Los estados técnicos incluyen `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` y
`CANCELLED`. Cada solicitud declara `INITIAL_DRAFT` o `AI_VERSION` y conserva
una clave idempotente única por proyecto. Los intentos fallidos permanecen en
`RqAiDb`; los errores se sanitizan y una solicitud no se ejecuta dos veces. Si
el proveedor ya respondió y falla la aplicación documental, el reintento
reutiliza la salida persistida sin una segunda llamada de IA.

## Revisión humana y Documents

La IA no escribe directamente en `RqDocumentsDb`. El worker usa una identidad
interna firmada para pedir a Documents la aplicación atómica sobre la versión
`DRAFT` exacta. El resultado queda identificado como generado con IA y requiere
revisión humana; Documents registra solicitud, ejecución, fuentes, valor
original, valor final, actor y revisión optimista.

El documento canónico conserva exactamente 13 secciones. Una versión aprobada
es inmutable; toda corrección posterior crea una nueva versión. **Nueva
versión** clona sin IA y **Nueva versión con IA** es la segunda y única frontera
explícita de llamada al proveedor.

## Workflow

El flujo soporta `DRAFT -> IN_REVIEW -> APPROVED` y las rutas de correcciones o
rechazo. Conserva revisores, aprobador, comentarios, expediente, correlación e
idempotencia. La aprobación pertenece exclusivamente a Workflow.

## Eventos

RabbitMQ usa el exchange durable `rq.integration.v1` y sobres versionados con
`eventId`, `eventVersion`, productor, fecha UTC, `correlationId`,
`causationId` y payload mínimo.

Eventos V1:

- `source.ready`;
- `analysis.requested`, `analysis.started`, `analysis.completed`,
  `analysis.failed`;
- `review.requested`, `review.changes-requested`;
- `document.approved`, `document.rejected`;
- `export.requested`, `export.completed`, `export.failed`.

Operations valida productor/evento, persiste un inbox único por `eventId`,
reintenta errores temporales y evita notificaciones duplicadas.

## Operations, exportaciones y notificaciones

`RqOperationsDb` contiene `ExportRequests`, `ExportArtifacts`,
`NotificationRequests`, `NotificationDeliveries`, `AuditEvents` e
`IntegrationEventInbox`.

PDF y DOCX se generan en servidor desde la versión aprobada exacta. Incluyen
proyecto, versión, estado, las 13 secciones y trazabilidad; el artefacto se
guarda en Blob con nombre, tipo, tamaño y SHA-256. No se sobrescribe historial.
La acción de exportación vive en Validación, no en el editor, y nunca invoca IA.

Las notificaciones internas cubren revisión, correcciones, aprobación,
rechazo, fallo de análisis y exportación lista. El canal de correo permanece
`DISABLED` hasta configurar un proveedor externo.

## Auditoría y observabilidad

Operations registra actor, proyecto, acción, recurso, resultado, UTC,
correlación, IP/User-Agent permitidos y metadata sanitizada. Identity y AI
Provider conservan además sus historiales de seguridad propios. Nunca se
registran claves, contraseñas, JWT, cookies, prompts completos ni documentos.

Todos los backends ofrecen health, readiness y métricas Prometheus. Los logs
son JSON estructurado, propagan correlación y los errores 500 no exponen stack.
La preparación Azure conecta stdout/stderr con Log Analytics y Application
Insights.

## Seguridad de aplicación

- cookies HttpOnly, SameSite y Secure bajo HTTPS;
- access token corto y refresh rotativo/revocable;
- expiración por 30 minutos reales de inactividad;
- autorización por rol y por participación de proyecto;
- protección de origen para mutaciones y CORS restringido;
- rate limit de autenticación y headers seguros;
- UUID, paginación, límites y entradas validados;
- archivos privados con firma/MIME/tamaño y rutas opacas;
- endpoints configurables restringidos para impedir SSRF;
- detección de secretos y auditoría de dependencias en CI;
- `synchronize=false` y `dropSchema=false`.

## PWA, responsive y accesibilidad

La PWA instala solo el shell público y elimina cachés ajenas al prefijo público;
no guarda tokens, APIs, documentos ni respuestas privadas. Las vistas usan el
sistema visual responsive existente. Los diálogos gestionan foco inicial,
Tab/Shift+Tab, Escape, retorno de foco y bloqueo de scroll; tablas, formularios,
errores y estados de carga incorporan semántica accesible.

## Pruebas y E2E

La matriz cubre contratos, autorización, sesiones, validadores, persistencia,
vaults, proveedores, prompt, workers, eventos, exportadores y UI estructural.
Las integraciones verifican SQL, migraciones, constraints, Blob, Redis/BullMQ,
RabbitMQ y Swagger.

`pnpm test:e2e:v1` ejecuta con fixtures temporales:

`login -> proyecto -> TXT/Blob -> READY -> documento DRAFT -> Fake AI único ->
aplicación automática -> 13 secciones -> revisión/edición humana -> Workflow ->
aprobación -> Validación -> PDF/DOCX -> descarga -> auditoría/notificación ->
limpieza`.

Comprueba además hash y cabeceras de archivos descargados, inmutabilidad y la
ruta Web. Se ejecuta dos veces para detectar duplicados o dependencia de estado
residual y no usa ni elimina datos reales.

## CI/CD y Azure

GitHub Actions se ejecuta en `main` y pull requests con lockfile congelado,
auditoría de producción, detección de secretos, arquitectura, lint, typecheck,
unitarias, eventos, build y Swagger, sin credenciales reales.

Dockerfiles no-root y Bicep preparan ACR, Container Apps, ocho Azure SQL, Blob,
Redis, Service Bus, vault de plataforma, vault aislado de IA, Log Analytics y
Application Insights. El
despliegue real, red privada final, migraciones productivas y cambio de tráfico
requieren autorización externa.

## Respaldo y recuperación

La política vigente define RPO 15 minutos y RTO 4 horas, PITR por base,
versionado/soft delete de Blob, soft delete/purge protection de Key Vault,
orden de restauración y simulacro trimestral. Colas y Redis no sustituyen SQL o
Blob como fuente de verdad.

## ERP Knowledge

Continúa como `FUTURO OPCIONAL` según ADR-0006 y ADR-0007. La V1 reserva
servicio, puerto, base e infraestructura, pero no activa entidades ni rutas de
negocio. Una fase posterior solo podrá importar snapshots autorizados,
versionados y trazables para fit-gap con revisión experta. Se prohíben conexión
SQL directa, transacciones y cambios sobre Dynamics 365 productivo.

## Pendientes externos

1. Configurar y probar una API Key OpenAI desde la UI; después ejecutar la
   prueba real acotada de IA.
2. Elegir y configurar un proveedor de correo si se requiere email.
3. Aprobar y ejecutar el despliegue Azure con credenciales de la organización.
4. Decidir alcance empresarial y fuentes autorizadas antes de implementar ERP
   Knowledge.

Ninguno exige modificar el flujo local validado con Fake AI.

## Commits de la fase

| Commit    | Bloque                                   |
| --------- | ---------------------------------------- |
| `28fb012` | inactividad de sesión                    |
| `575aecd` | configuración segura de proveedores IA   |
| `f005525` | ejecución IA asíncrona                   |
| `45acaed` | revisión humana de propuestas            |
| `4490e28` | eventos de dominio                       |
| `ccf89c5` | solicitudes de exportación               |
| `1bf1b0f` | generación PDF/DOCX                      |
| `7252a31` | notificaciones y auditoría por eventos   |
| `52dc952` | Gateway y PWA segura                     |
| `4b58b26` | CI, Azure, observabilidad y recuperación |
| `15076a2` | E2E integral y regresión JSON escalar    |
| `6982449` | accesibilidad y dependencias seguras     |

El commit de documentación y cierre se consulta en el `HEAD` de `main`.
