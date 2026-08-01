# Límites de servicios

## Gateway / BFF

Responsable de autenticación de solicitudes, enrutamiento, agregación,
rate limiting, Correlation ID, OpenAPI y adaptación de respuestas.
No contiene reglas de negocio ni accede directamente a bases de datos.

## Identity Service

Propietario de usuarios, organizaciones, membresías, roles, permisos,
sesiones, refresh tokens y auditoría de seguridad.

## Projects Service

Propietario de proyectos, clientes o áreas solicitantes, participantes,
roles del proyecto, responsables, estado general y reglas de acceso.

## Sources Service

Propietario de metadatos de archivos, archivos originales, texto
extraído, conversaciones, notas, transcripciones, hashes, estado de
procesamiento y referencias de almacenamiento.

## Documents Service

Propietario de plantillas, versiones, secciones, campos, documentos,
versiones de documento, requerimientos, reglas, criterios de aceptación,
evidencias y contenido aprobado.

## AI Analysis Service

Propietario de prompts, configuración de modelos, ejecuciones,
resultados estructurados, contradicciones, preguntas abiertas,
evidencias, consumo, costos y evaluaciones de calidad.

Produce propuestas; no sobrescribe contenido aprobado.

## ERP Knowledge Service

Capacidad futura y opcional. Será propietario de sistemas ERP
catalogados, snapshots, módulos, procesos, capacidades, artefactos
técnicos, personalizaciones, evidencias y resultados de búsqueda.

No operará Dynamics 365, no creará transacciones, no modificará su
configuración, no consultará producción directamente y no sustituirá
el criterio de expertos funcionales o técnicos.

## Workflow Service

Propietario de solicitudes de revisión, revisores, aprobadores,
comentarios, correcciones, aprobaciones, rechazos, bloqueos e historial.

## Operations Service

Propietario de solicitudes de exportación, PDF, exportaciones futuras a
DOCX, notificaciones, entregas de correo e historial de publicaciones.
