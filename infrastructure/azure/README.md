# Azure: base declarativa de producción

Esta carpeta prepara, pero no ejecuta, el despliegue de Levantamiento RQ. `main.bicep` declara Container Apps, ACR, ocho bases Azure SQL, Storage con versionado y borrado recuperable, Azure Cache for Redis, Service Bus, Key Vault, Log Analytics y Application Insights.

## Construcción de imágenes

Backend (repetir por cada aplicación NestJS):

```bash
docker build --build-arg APP_NAME=gateway -t <registry>/gateway:<commit> .
```

Frontend:

```bash
docker build -f Dockerfile.web \
  --build-arg NEXT_PUBLIC_GATEWAY_URL=https://<gateway-host> \
  -t <registry>/web:<commit> .
```

Use siempre etiquetas inmutables de commit. Los contenedores se ejecutan sin root y exponen probes de salud.

## Despliegue controlado

1. Crear el grupo de recursos y validar la plantilla con `az deployment group validate`.
2. Copiar `main.bicepparam.example` fuera del repositorio y completar las diez cargas: web, Gateway y ocho servicios de dominio.
3. Entregar `sqlAdministratorPassword` desde el almacén secreto del pipeline.
4. Crear en Key Vault los secretos de JWT, SQL, OpenAI y servicios; referenciarlos mediante `keyVaultSecrets`, nunca como texto en Bicep.
5. Aplicar migraciones como trabajo de despliegue, una base por servicio, antes de cambiar tráfico.
6. Verificar `/api/v1/health/ready`, `/api/v1/metrics`, login, colas, una exportación y una ejecución Fake AI.
7. Endurecer producción con VNet, private endpoints y Private DNS antes de deshabilitar el acceso público de SQL, Storage, Redis, Service Bus y Key Vault. La regla `AllowAzureServices` es solamente la base inicial de conectividad.

No se incluye ni se autoriza acceso directo a un ERP productivo. ERP Knowledge recibe únicamente snapshots o evidencias controladas.
