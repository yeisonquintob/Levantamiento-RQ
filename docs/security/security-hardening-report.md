# Informe de hardening integral de seguridad

Fecha de verificación: 2026-08-20. Alcance: monorepo Levantamiento RQ. Criterios de referencia: OWASP ASVS/API/LLM, NIST SSDF, mínimo privilegio, Zero Trust, defensa en profundidad y fail closed.

Los estados describen lo comprobado directamente en el código y las pruebas; no implican que recursos externos de Azure estén aprovisionados.

| ID | Control | Estado anterior | Estado final | Archivos modificados | Prueba | Riesgo residual |
|---|---|---|---|---|---|---|
| SEC-01 | JWT asimétrico y rotación `kid` | HS256 compartido | CUMPLE | `libs/shared/http/src/lib/jwt-access.ts`, Identity y guards/config de servicios, `scripts/generate-local-jwt-keys.mjs` | JWT con algoritmo, issuer, audience y expiración adversos en `tests/ai-analysis/ai-analysis-security.test.ts`; `pnpm test:unit` | La custodia/rotación productiva de las claves depende de Key Vault/Managed Identity. |
| SEC-02 | Identidades workload con mínimo privilegio | Workers con `ADMIN`/`system.admin` | CUMPLE | clientes de AI, Documents, Projects y Operations | Pruebas de escalamiento y binding de `principal`/`kid`; búsqueda sin `system.admin` en actors | Los permisos deberán reflejarse también en RBAC productivo. |
| SEC-03 | Cuotas IA distribuidas | Límites parciales y locales | PARCIAL | `apps/ai-analysis-service/src/security/ai-usage-guard.service.ts`, controller/worker/queue | `tests/ai-analysis/ai-usage-limits.test.ts` | Redis cubre usuario/proyecto/global, solicitudes, tokens, simultaneidad y presupuesto; faltan límites distribuidos separados para output real y alertas externas. |
| SEC-04 | Control económico OpenAI | `EstimatedCost` sin cálculo central | PARCIAL | `ai-cost-pricing.ts`, execution/provider entities/services | `tests/ai-analysis/ai-cost-pricing.test.ts` | Precio versionado y costo real conciliado; los umbrales se calculan, pero falta entrega a un canal externo y override administrativo step-up. |
| SEC-05 | Rate limiting distribuido | Login en memoria | PARCIAL | `apps/gateway/src/security/auth-rate-limit.guard.ts`, AI usage guard | pruebas de auth y AI | Login/refresh/AI están coordinados por Redis; uploads, exportaciones y todas las mutaciones administrativas aún no poseen políticas específicas por operación. |
| SEC-06 | Trazas de proveedores sin payload sensible | Requests/responses completos en archivos | CUMPLE | `ai-provider-trace.ts`, `scripts/ai-provider-trace.sh` | `ai-provider-trace-security.test.ts`, `pnpm check:secrets` | Las trazas previas fueron eliminadas; el acceso al directorio de logs sigue sujeto a permisos del host. |
| SEC-07 | DLP antes de OpenAI | Sin frontera explícita | CUMPLE | `ai-data-loss-prevention.ts`, execution service, audit entity | `ai-data-loss-prevention.test.ts` | Detectores heurísticos pueden requerir reglas corporativas/PII adicionales. |
| SEC-08 | Prompt injection y salida estructurada | Defensa por prompt y schema | CUMPLE | prompt builder, local AI contract/execution | pruebas adversariales en suite AI | Ningún clasificador elimina por completo el riesgo semántico; la autorización posterior sigue siendo obligatoria. |
| SEC-09 | Cuarentena y antimalware | Validación de firma/tamaño sin scanner | PARCIAL | Source entity/migration, `source-antimalware.service.ts`, processing service/worker | pruebas de Sources; build/typecheck | Estado, adapter, mock seguro y fail closed listos; scanner corporativo real requiere infraestructura. Descarga y procesamiento exigen `CLEAN`. |
| SEC-10 | OOXML/ZIP bomb | Solo firma ZIP | CUMPLE | `source-file-validation.ts` | path traversal, profundidad, ratio y expansión simulada en Sources | ZIP64 se rechaza conservadoramente; no se soporta OOXML legítimo que requiera ZIP64. |
| SEC-11 | Límites de parsers | Límites incompletos | PARCIAL | storage/extraction config y worker | pruebas Sources, build | Hay páginas/hojas/filas/columnas/celdas/caracteres/timeout y retry finito; el aislamiento es BullMQ, no sandbox de proceso/OS con límite duro de memoria. |
| SEC-12 | Argon2id con migración scrypt | scrypt | CUMPLE | `password-hasher.ts`, auth/store, dependencia `argon2` | 19/19 pruebas Identity | Falta integrar un corpus corporativo o servicio k-anonymity para contraseñas comprometidas. |
| SEC-13 | MFA/step-up administrativo | No disponible | REQUIERE INFRAESTRUCTURA | documentación de backlog | revisión arquitectónica | Requiere Entra ID/WebAuthn, registro de credenciales y política organizacional. |
| SEC-14 | Refresh family/reuse detection | Rotación individual | CUMPLE | refresh entity/migration, auth/token/store | replay revoca familia e incrementa `sessionVersion` | Revocación inmediata depende de consulta de sesión para operaciones críticas; access JWT permanece corto. |
| SEC-15 | Revocación de access token | `sessionVersion` parcial | CUMPLE | Identity auth/store/token y guards | prueba de token anterior tras replay/cambio de contraseña | Ventana residual limitada por TTL en endpoints que solo verifican JWT localmente. |
| SEC-16 | CSRF para cookies | SameSite/CORS | CUMPLE | `gateway-security.ts`, Gateway bootstrap | pruebas Origin, Fetch Metadata y CORS | Clientes legacy sin Fetch Metadata deben enviar Origin válido en mutaciones browser. |
| SEC-17 | CSP/XSS | `script-src unsafe-inline` | CUMPLE | `apps/web/src/proxy.ts`, `next.config.js` | build Next y prueba CSP nonce | `style-src unsafe-inline` se conserva por compatibilidad visual; scripts usan nonce/strict-dynamic. HSTS debe terminarse también en edge productivo. |
| SEC-18 | SQL/aislamiento de datos | Bases separadas y TypeORM | CUMPLE | migraciones nuevas y scripts verify | typecheck/build; integración bloqueada sin Docker | Los grants SQL de mínimo privilegio deben aplicarse en la plataforma desplegada. |
| SEC-19 | SSRF | Restricciones parciales | PARCIAL | validadores OpenAI/Ollama/Key Vault/antimalware | pruebas de endpoint Ollama/OpenAI | Los clientes inspeccionados usan destinos configurados; falta una política HTTP común para futuras integraciones. |
| SEC-20 | Secretos | Keychain/Key Vault, riesgo en trazas | CUMPLE | trace sanitizer, env examples, key generation | `pnpm check:secrets`, audit de persistencia AI | Aprovisionamiento productivo de Key Vault/Managed Identity es externo. |
| SEC-21 | Docker runtime | Non-root y healthchecks | PARCIAL | `Dockerfile`, `infrastructure/docker/compose.yaml` | build de aplicaciones; workflow Trivy | Compose endurecido con caps/no-new-privileges/read-only donde es viable; faltan digests de imágenes y límites de recursos ajustados al entorno. |
| SEC-22 | Supply chain/DevSecOps | CI básico | CUMPLE | `.github/workflows/ci.yml`, `security.yml`, `pnpm-workspace.yaml`, lockfile | CodeQL/SCA/SBOM/Trivy configurados; audit productivo sin vulnerabilidades | Provenance/attestation depende de permisos y entorno GitHub. |
| SEC-23 | Azure Zero Trust | Recursos mayormente públicos | REQUIERE INFRAESTRUCTURA | `infrastructure/azure/main.bicep` | validación estática de Bicep | VNet y acceso público condicional preparados; Private Endpoints/DNS y parámetros corporativos deben aprovisionarse externamente. |
| SEC-24 | Health y metrics | `/metrics` público | CUMPLE | `libs/shared/observability/src/lib/runtime-metrics.ts` | lint/typecheck/build | El token/ACL de infraestructura debe inyectarse y rotarse en producción. |
| SEC-25 | Auditoría de seguridad | Eventos funcionales dispersos | PARCIAL | Identity store, AI security audit entity/migration | pruebas Identity/AI | Login, replay, password, AI/DLP están cubiertos; faltan eventos uniformes para reset, desactivación, roles, malware, upload y cambios administrativos. |
| SEC-26 | Seguridad de frontend y errores | Headers estáticos y mensajes mixtos | CUMPLE | proxy CSP, exception filter, gateway policies | pruebas Identity, build web | Mantener sanitización al incorporar nuevos proveedores. |
| SEC-27 | Supply-chain vulnerable `nanoid` | `3.3.17`, advisory high | CUMPLE | `pnpm-workspace.yaml`, `pnpm-lock.yaml` | `pnpm audit --prod --audit-level high`: 0 vulnerabilidades | Revisar periódicamente nuevas advisories. |

## Decisiones técnicas

- Ed25519/EdDSA con JWKS local verificable y `kid`; cada JWK declara el principal autorizado. La clave de Identity no se comparte con workloads.
- Los workloads que deben firmar llamadas internas tienen claves independientes y permisos exactos; un `kid` de workload no puede acuñar privilegios humanos.
- El consumo distribuido se reserva atómicamente en Redis antes de crear/enviar jobs. Los rechazos no llegan a BullMQ.
- Los archivos nacen en cuarentena, pasan por scanner y solo se extraen/descargan en estado `CLEAN`.
- La CSP se genera por solicitud con nonce y `strict-dynamic`; se eliminó `unsafe-inline` de `script-src`.

## Evidencia de validación

| Comando | Resultado |
|---|---|
| `pnpm lint:all` | Correcto, 19 proyectos |
| `pnpm typecheck:all` | Correcto, 18 proyectos y dependencias |
| `pnpm build:all` | Correcto, 19 proyectos; warnings de source maps de dependencias |
| `pnpm test:unit` | Dominios verificados; Identity 19, Projects 9, Sources 24, Documents 76, AI 97, Workflow 11 y Operations 21 |
| `pnpm test:events` | Correcto, 3/3 |
| `pnpm check:secrets` | Correcto |
| `pnpm audit --prod --audit-level high` | Correcto, 0 vulnerabilidades conocidas |
| `pnpm test:integration` | Bloqueado: Docker Desktop/SQL Server no están activos |
| `pnpm swagger:validate` | Gateway correcto; servicios restantes bloqueados al arrancar sin SQL |
| `pnpm validate:all` | Detectó y permitió corregir `nanoid`; repetición integral requiere Docker Desktop |
| `pnpm test:e2e:v1` | Bloqueado: SQL Server `127.0.0.1:1433` no disponible |

No se ejecutaron reset, restore, checkout ni clean. Se conservaron los cambios previos del working tree.
