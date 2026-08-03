# Arquitectura de Levantamiento RQ

## Principios

1. Separación por capacidades de negocio.
2. Cada servicio será propietario de sus datos.
3. Ningún servicio consultará tablas de otro servicio.
4. El frontend consumirá únicamente el Gateway/BFF.
5. Los contratos públicos deberán versionarse.
6. Los eventos transportarán información mínima.
7. Los consumidores deberán ser idempotentes.
8. La IA producirá propuestas sujetas a revisión humana.
9. Los archivos físicos se almacenarán fuera de SQL Server.
10. Cada servicio podrá desplegarse y escalarse de forma independiente.
11. El conocimiento ERP será una fuente opcional para análisis fit-gap.
12. La IA no tendrá acceso directo a bases productivas de Dynamics 365.
13. La estructura documental se definirá antes de implementar Documents.
14. Las plantillas serán configurables y versionadas.

## Componentes

| Componente    | Responsabilidad                                    |
| ------------- | -------------------------------------------------- |
| Web           | Interfaz responsive y experiencia PWA              |
| Gateway       | Entrada, seguridad, agregación y enrutamiento      |
| Identity      | Usuarios, organizaciones, roles y permisos         |
| Projects      | Proyectos, participantes y acceso                  |
| Sources       | Archivos, conversaciones, notas y extracción       |
| Documents     | Plantillas, editor, requerimientos y versiones     |
| AI Analysis   | Análisis, evidencias, contradicciones y propuestas |
| ERP Knowledge | Conocimiento ERP y análisis fit-gap                |
| Workflow      | Revisión, correcciones, aprobación y rechazo       |
| Operations    | PDF, exportaciones y notificaciones                |

## Documentos relacionados

- [Contexto del sistema](system-context.md)
- [Límites de servicios](service-boundaries.md)
- [Propiedad de datos](data-ownership.md)
- [Comunicación](communication.md)
- [Seguridad](security.md)
- [Flujo de IA](ai-analysis-flow.md)
- [Conocimiento ERP y fit-gap](erp-knowledge-fit-gap.md)
- [Límites Nx](nx-boundaries.md)
- [Catálogo técnico](service-catalog.yaml)
- [Aplicaciones backend](backend-applications.md)

- [Librerías compartidas y contratos](shared-libraries.md)

## Configuración técnica

- [Variables de entorno](environment-configuration.md)
- [Base técnica del Gateway](gateway-foundation.md)

## Frontend

- [Base frontend responsive y estándar visual](frontend-visual-foundation.md)
- [Identidad, autenticación y autorización base](identity-authentication-foundation.md)
- [Activación real de identidad](identity-real-activation.md)
- [OpenAPI y Swagger](../api/openapi-swagger.md)
- [Projects Service y Workspace](projects-service-foundation.md)
- [Sources Service y fuentes textuales](sources-service-foundation.md)
