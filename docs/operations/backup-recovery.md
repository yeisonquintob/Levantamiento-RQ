# Respaldo y recuperación

## Objetivos

- RPO de datos persistentes: 15 minutos.
- RTO de la plataforma: 4 horas.
- Las colas son transporte y no sustituyen SQL ni Blob como fuente de verdad.

## Política

- Azure SQL: restauración a un punto en el tiempo por base, retención de 35 días en producción y respaldo georredundante según la región.
- Blob Storage: GRS, versionado, borrado recuperable de blobs y contenedores por 30 días. Se valida hash SHA-256 después de restaurar.
- Key Vault: soft delete por 90 días y purge protection. Los secretos recuperados deben rotarse si hubo exposición.
- Configuración e infraestructura: Git es la fuente para Bicep, migraciones y contratos; los archivos `.env` reales nunca son respaldo válido.
- Redis, BullMQ y Service Bus: se reconstruyen desde infraestructura. Los jobs idempotentes se reenvían desde el estado persistente cuando corresponda.

## Orden de recuperación

1. Crear red, Key Vault, SQL, Storage, Redis y mensajería con IaC.
2. Restaurar cada base bajo el mismo propietario de dominio.
3. Restaurar blobs y verificar tamaño/hash de una muestra.
4. Rotar o recuperar secretos y habilitar identidades administradas.
5. Ejecutar migraciones pendientes y desplegar imágenes inmutables.
6. Iniciar servicios internos, luego Gateway y Web.
7. Ejecutar health/readiness, E2E Fake AI, descarga PDF/DOCX y auditoría.
8. Reanudar workers y comprobar que la idempotencia evita efectos duplicados.

Se debe realizar un simulacro trimestral, registrar tiempos reales, evidencia de integridad y acciones correctivas. Un respaldo no se considera válido hasta que su restauración haya sido probada.
