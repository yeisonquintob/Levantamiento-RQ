# Backlog de seguridad dependiente de infraestructura

Este documento contiene exclusivamente controles que no pueden completarse de forma segura solo desde el repositorio. Los controles parciales que aún requieren trabajo de código permanecen identificados en el informe principal y no se ocultan aquí.

## 1. Custodia y rotación productiva de JWT

- Crear claves Ed25519 de Identity y workloads dentro de Azure Key Vault/HSM.
- Conceder a cada Managed Identity únicamente `get/sign` sobre su clave; los servicios verificadores reciben solo JWKS público.
- Definir solapamiento de `kid`, calendario de rotación, revocación de emergencia y monitorización.

Criterio de cierre: ninguna clave privada se inyecta como secreto estático de despliegue y una rotación se demuestra sin interrupción.

## 2. Scanner antimalware corporativo

- Aprovisionar Microsoft Defender for Storage o endpoint corporativo HTTPS privado.
- Inyectar endpoint, allowlist y credencial mediante Key Vault/Managed Identity.
- Configurar alertas y retención del veredicto sin conservar contenido en logs.

Criterio de cierre: EICAR es detectado por el motor real, una indisponibilidad falla cerrada y ningún archivo sale de cuarentena.

## 3. MFA y step-up administrativo

- Elegir Microsoft Entra ID con Conditional Access o WebAuthn/FIDO2.
- Registrar credenciales, recuperación segura y políticas para administradores.
- Exigir step-up para roles, usuarios, proveedor/clave OpenAI, presupuestos y operaciones destructivas.

Criterio de cierre: un administrador sin segundo factor vigente no puede ejecutar esas operaciones y los eventos llegan al SIEM.

## 4. Red privada Azure

- Asignar rangos VNet/subnets corporativos.
- Crear Private Endpoints y Private DNS Zones para SQL, Storage, Redis, Service Bus, Key Vault y ACR.
- Vincular DNS/VNet, deshabilitar acceso público y comprobar resolución/rutas desde Container Apps.
- Mantener públicos solo Web y Gateway; los servicios de dominio deben ser internos.

Criterio de cierre: pruebas desde Internet fallan, los servicios internos resuelven direcciones privadas y los probes continúan sanos.

## 5. Operación DevSecOps y SIEM

- Habilitar permisos GitHub para CodeQL, dependency review, carga SARIF, firma de artefactos y provenance/attestation.
- Conectar eventos de auditoría, métricas de presupuesto, rate limit, DLP y malware al SIEM corporativo.
- Configurar destinatarios y escalamiento para umbrales 50/75/90/100 %.

Criterio de cierre: el pipeline bloquea hallazgos high/critical, produce SBOM/attestation verificables y las alertas se reciben fuera de la aplicación.

## 6. Validación integral local/CI

- Iniciar Docker Desktop y ejecutar `bash scripts/infrastructure-up.sh`.
- Repetir `pnpm test:integration`, `pnpm swagger:validate`, `pnpm validate:all` y `pnpm test:e2e:v1`.

Criterio de cierre: los cuatro comandos terminan correctamente con SQL Server, Redis, RabbitMQ y Azurite saludables.
