# Iniciar Levantamiento RQ en otro PC

Guía para dejar el proyecto funcionando desde cero en un equipo nuevo. Está
escrita a partir del entorno donde hoy corre el proyecto: **macOS (Apple
Silicon, arm64)**, Node 24.19, pnpm 11.18, Docker 29.8 y Ollama 0.40.

> **Importante:** este documento no contiene contraseñas, claves ni valores de
> los archivos `.env`. Donde hace falta un secreto aparece como
> `<DEFINIR>`. Los secretos reales **no** están en Git (el repositorio es
> público) y deben llevarse al otro PC por un canal seguro (ver el apartado
> «Qué no viaja con Git»).

---

## 1. Qué es lo que se va a levantar

| Pieza | Para qué sirve | Dónde corre |
|---|---|---|
| 10 servicios Node (Gateway, Identity, Projects, Sources, Documents, AI Analysis, ERP Knowledge, Workflow, Operations, Prototypes) | Backend | Procesos Node en tu equipo |
| Web (Next.js 16) | Interfaz | Proceso Node en tu equipo, puerto 4200 |
| SQL Server 2022 | 8 bases de datos (una por servicio) | Contenedor Docker, puerto 1433 |
| Redis 8 | Colas (BullMQ) y caché | Contenedor Docker, puerto 6381 |
| RabbitMQ 4 | Eventos entre servicios | Contenedor Docker, puertos 5673 y 15673 |
| Azurite 3.37 | Almacenamiento de archivos (Blob de Azure simulado) | Contenedor Docker, puertos 10000 a 10002 |
| Ollama | IA local (opcional) | Aplicación en tu equipo, puerto 11434 |

### Puertos que deben estar libres

| Puerto | Uso |
|---:|---|
| 3000 | Gateway |
| 3001 | Identity |
| 3002 | Projects |
| 3003 | Sources |
| 3004 | Documents |
| 3005 | AI Analysis |
| 3006 | ERP Knowledge |
| 3007 | Workflow |
| 3008 | Operations |
| 3009 | Prototypes |
| 4200 | Web |
| 1433 | SQL Server |
| 6381 | Redis |
| 5673 / 15673 | RabbitMQ / su consola |
| 10000 a 10002 | Azurite |
| 11434 | Ollama |

---

## 2. Qué debes tener instalado

### Obligatorio

| Software | Versión | Notas |
|---|---|---|
| Git | cualquiera reciente | Para clonar el repositorio. |
| Node.js | **24.x** (el proyecto exige `>=24 <25`) | Instálalo con `nvm`, `fnm` o `volta`. El archivo `.nvmrc` ya dice `24`. |
| pnpm | **11.18.0** (`>=11 <12`) | Se activa con Corepack (ver paso 3). |
| Docker Desktop | con Docker Compose v2 | Debe estar abierto y en ejecución. |
| Herramientas de compilación | Xcode Command Line Tools en macOS (`xcode-select --install`) | Algunas dependencias nativas (`argon2`, `sharp`, `@swc/core`) las necesitan si no hay binario prefabricado. |
| `curl`, `lsof`, `pgrep`, `openssl` | vienen con macOS | Los usan los scripts de arranque. |

### Opcional (según lo que vayas a usar)

| Software | Para qué |
|---|---|
| **Ollama** | Generar documentos, interpretar el Markdown de prototipos y generar imágenes con IA **local**. Descarga: <https://ollama.com/download> |
| Cuenta y clave de OpenAI | Solo si usarás IA en la nube. La clave se guarda en el Llavero de macOS, no en archivos. |
| Playwright + Chromium | Solo para las pruebas de extremo a extremo (`pnpm test:e2e`). |

### Recursos recomendados

- **Disco:** unos 15 GB libres sin modelos de IA; cada modelo de Ollama suma entre 4 y 13 GB (en el PC actual: `qwen3.5:9b` 6,6 GB, `gemma4:12b` 7,6 GB, `gpt-oss:20b` 13 GB).
- **Memoria:** 16 GB como mínimo si usarás Ollama con modelos de 9 a 12 B; 8 GB bastan solo para el proyecto sin IA local.

### Sistema operativo

Los scripts de arranque son de **bash y usan comandos de macOS** (`lsof`,
`pgrep`, `route`, `ipconfig getifaddr`) y el Llavero de macOS para las claves
de IA. Lo probado es **macOS**. En Linux debería funcionar casi todo salvo el
Llavero (`AI_SECRET_VAULT=MACOS_KEYCHAIN`); en Windows se necesita **WSL 2** y
las mismas salvedades. Esta guía no se ha ejecutado en Linux ni en Windows.

---

## 3. Instalación paso a paso

Todos los comandos se ejecutan en una terminal (zsh o bash).

### Paso 1. Clonar el repositorio

```bash
git clone https://github.com/yeisonquintob/Levantamiento-RQ.git
cd Levantamiento-RQ
```

### Paso 2. Verificar Node y activar pnpm

```bash
node -v          # debe mostrar v24.x
corepack enable
corepack prepare pnpm@11.18.0 --activate
pnpm -v          # debe mostrar 11.18.0
```

### Paso 3. Instalar las dependencias

```bash
pnpm install --frozen-lockfile
```

`--frozen-lockfile` instala exactamente las versiones del `pnpm-lock.yaml`.
Si falla por una dependencia nativa, revisa que estén las herramientas de
compilación (apartado 2).

### Paso 4. Levantar SQL Server en Docker

El proyecto necesita un SQL Server en el puerto 1433 (no viene en el
`compose.yaml`). Si ya tienes uno, salta este paso y usa sus datos. Si no:

```bash
docker run -d --name rq-sqlserver --restart unless-stopped \
  -e ACCEPT_EULA=Y \
  -e MSSQL_SA_PASSWORD='<DEFINIR_CLAVE_FUERTE>' \
  -p 127.0.0.1:1433:1433 \
  -v rq-sqlserver-data:/var/opt/mssql \
  mcr.microsoft.com/mssql/server:2022-latest
```

- La clave debe tener al menos 8 caracteres con mayúsculas, minúsculas,
  números y símbolos; si no, el contenedor se detiene.
- En un Mac con Apple Silicon, si la imagen no arranca, agrega
  `--platform linux/amd64` y activa Rosetta en Docker Desktop
  (Settings > General).
- Comprueba que arrancó: `docker ps` debe mostrar `rq-sqlserver`, y
  `docker logs rq-sqlserver 2>&1 | tail -5` debe decir que está listo para
  conexiones.
- Para desarrollo local, el servicio puede conectarse con el usuario `sa`.
  Para algo compartido conviene crear un usuario propio con permisos solo
  sobre las bases `Rq*`.

### Paso 5. Preparar y levantar Redis, RabbitMQ y Azurite

```bash
cp infrastructure/docker/.env.example infrastructure/docker/.env
```

Edita `infrastructure/docker/.env` y reemplaza los `CHANGE_ME`:

- `REDIS_PASSWORD`
- `RABBITMQ_DEFAULT_PASS`

Genera contraseñas con `openssl rand -hex 24`. Deja las claves de Azurite
(`AZURITE_ACCOUNT_NAME` y `AZURITE_ACCOUNT_KEY`) como vienen: son las
públicas y conocidas del emulador, no un secreto.

Luego:

```bash
bash scripts/infrastructure-up.sh
bash scripts/infrastructure-status.sh
```

Debe mostrar Redis, RabbitMQ y Azurite como saludables. Para ver registros:
`bash scripts/infrastructure-logs.sh [servicio]`.

### Paso 6. Crear los archivos `.env` de cada servicio

Los `.env` **no están en Git**. Se necesitan estos archivos (el script de
arranque se detiene con `ERROR: Falta ...` si no existen):

```text
apps/identity-service/.env
apps/projects-service/.env
apps/sources-service/.env
apps/documents-service/.env
apps/ai-analysis-service/.env
apps/gateway/.env
apps/web/.env.local
infrastructure/docker/.env           (ya creado en el paso 5)
```

Workflow, Operations y Prototypes **reutilizan** `apps/documents-service/.env`
(más el de infraestructura) para la conexión a SQL Server y cambian solo el
nombre de la base, así que los datos de SQL Server en ese archivo deben ser
correctos.

**Opción A (la más rápida y segura): copiar los `.env` del PC actual.**
Cópialos por AirDrop, USB cifrado o un gestor de contraseñas. Nunca por Git,
correo ni chat. Ajusta solo lo que cambie en el equipo nuevo (por ejemplo
`DB_HOST`, `DB_PASSWORD` si la clave de SQL Server es distinta, y la ruta de
Ollama si no es local).

**Opción B: crearlos desde los ejemplos.**

```bash
for s in identity-service projects-service sources-service documents-service ai-analysis-service gateway; do
  cp apps/$s/.env.example apps/$s/.env
done
cp apps/web/.env.example apps/web/.env.local
```

Después edita cada archivo. Lo esencial:

| Variable | Valor para desarrollo local |
|---|---|
| `DATABASE_ENABLED` | `true` (en `identity-service` el ejemplo trae `false`) |
| `AUTH_ENABLED` | `true` en `identity-service` |
| `DB_HOST` | `127.0.0.1` |
| `DB_PORT` | `1433` |
| `DB_USERNAME` / `DB_PASSWORD` | el usuario y la clave de tu SQL Server |
| `DB_ENCRYPT` / `DB_TRUST_SERVER_CERTIFICATE` | `false` / `true` (SQL Server local con certificado propio) |
| `DB_NAME` | el que traiga cada ejemplo (`RqIdentityDb`, `RqProjectsDb`, ...) |
| `<SERVICIO>_CREATE_DATABASE` | `true`, solo mientras crees las bases en el paso 7 |
| `JWT_REFRESH_SECRET` (identity) | al menos 32 caracteres aleatorios: `openssl rand -hex 32` |
| `GATEWAY_REDIS_PASSWORD` (gateway) | el mismo `REDIS_PASSWORD` del paso 5 |
| `AI_REDIS_*` (ai-analysis) | puerto `6381` y la misma contraseña de Redis |
| `AI_EXECUTION_MODE` (ai-analysis) | `FAKE` para probar sin IA real; `OPENAI` si usarás la nube |
| `LOCAL_AI_ENABLED` / `OLLAMA_BASE_URL` | `true` / `http://127.0.0.1:11434` si usarás Ollama |
| `NEXT_PUBLIC_GATEWAY_URL` (web) | `http://127.0.0.1:3000` |

Las claves JWT de firma **no se escriben a mano**: las genera el script de
arranque en cada inicio (`tmp/local-auth/jwt-keys.env`).

`apps/web/.env.local` solo necesita `NEXT_PUBLIC_GATEWAY_URL`.

### Paso 7. Crear las bases de datos y aplicar las migraciones

Cada servicio tiene su base. Con SQL Server y los `.env` listos, ejecuta
(una sola vez; es seguro repetirlo):

```bash
pnpm identity:db:ensure   && pnpm identity:migration:run
pnpm projects:db:ensure   && pnpm projects:migration:run
pnpm sources:db:ensure    && pnpm sources:migration:run
pnpm documents:db:ensure  && pnpm documents:migration:run
pnpm ai:db:ensure         && pnpm ai:migration:run
pnpm workflow:db:ensure   && pnpm workflow:migration:run
pnpm operations:db:ensure && pnpm operations:migration:run
```

Cada `:db:ensure` solo crea la base si su variable `*_CREATE_DATABASE` vale
`true` (`IDENTITY_CREATE_DATABASE`, `PROJECTS_CREATE_DATABASE`, etc.); si no,
se niega a crearla. La base de Prototypes (`RqPrototypesDb`) y la migración de
Projects las vuelve a verificar el script de arranque del paso 9.

Comprobación opcional: `pnpm identity:db:verify`, `pnpm projects:db:verify`,
etc.

### Paso 8. Crear el primer usuario administrador

```bash
IDENTITY_ADMIN_EMAIL='tu-correo@empresa.com' \
IDENTITY_ADMIN_NAME='Tu Nombre' \
IDENTITY_ADMIN_PASSWORD='<DEFINIR_MINIMO_12_CARACTERES>' \
pnpm identity:bootstrap-admin
```

La contraseña debe tener mínimo 12 caracteres. Con ese usuario entrarás en
<http://127.0.0.1:4200/sign-in>. Más usuarios se crean luego desde la propia
aplicación (Configuración > Usuarios) o con `pnpm identity:create-user`.

### Paso 9. Compilar y arrancar

```bash
bash ./compilar_todo_levantamiento_rq.sh      # instala, hace lint y compila todo
bash ./ejecutar_y_status_levantamiento_rq.sh  # arranca los servicios y muestra el estado
```

- El primer script borra las salidas anteriores (`dist`, `.next`), ejecuta el
  lint y compila los proyectos. Si el lint falla, no sigue. Tarda varios
  minutos.
- El segundo detiene lo que hubiera en los puertos, arranca Identity,
  Projects, Sources, Documents, AI Analysis, Workflow, Operations,
  Prototypes, Gateway, la web y ERP Knowledge, y espera a que cada uno
  responda en `/api/v1/health`. Verifica que `docker` ya está corriendo.

Al terminar debe mostrar todos los servicios activos. Abre:

**<http://127.0.0.1:4200>**

Para detener todo y comprobar que los puertos quedaron libres:

```bash
bash ./detener_y_validar_levantamiento_rq.sh
```

(Docker y SQL Server permanecen activos.)

---

## 4. IA local con Ollama (opcional)

```bash
ollama --version
ollama serve                 # si no se inició sola con la aplicación
ollama pull qwen3.5:9b       # interpretar Markdown y detallar pantallas
ollama pull gemma4:12b       # generación de documentos (valor de ejemplo del .env)
```

Para imágenes de prototipos el proyecto usa el modelo
`x/z-image-turbo:latest` de Ollama. Descárgalo con
`ollama pull x/z-image-turbo:latest` (comprueba antes que tu versión de
Ollama y tu sistema lo soporten; es un modelo de imágenes experimental).

Después, en la aplicación: **Configuración > Inteligencia artificial >
Proveedores**, registra y valida el proveedor local y el de imágenes, y
elígelos en las pantallas que los piden (Fuentes y Generar prototipo). Los
modelos que uses deben estar descargados en **ese** equipo.

Si Ollama corre en otro PC de tu red, apunta `OLLAMA_BASE_URL` a su IP
privada y arráncalo allí con `OLLAMA_HOST=0.0.0.0:11434`.

## 5. IA en la nube con OpenAI (opcional)

La clave no va en archivos. Un administrador la registra desde
**Configuración > Inteligencia artificial > Proveedores**; en macOS se
guarda en el Llavero (`AI_SECRET_VAULT=MACOS_KEYCHAIN`). En Linux o Windows no
existe ese Llavero y habría que cambiar el almacén de secretos.

## 6. Login con Microsoft (opcional)

Está desactivado de forma predeterminada (`MICROSOFT_AUTH_ENABLED=false` en
`identity-service`). Para activarlo se necesita una aplicación registrada en
Microsoft Entra ID y definir `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`,
`MICROSOFT_CLIENT_SECRET` y `MICROSOFT_REDIRECT_URI`.

---

## 7. Qué no viaja con Git (y cómo llevarlo)

| Elemento | ¿Está en Git? | Cómo llevarlo al otro PC |
|---|---|---|
| Código fuente | Sí | `git clone` |
| Archivos `.env` y `.env.local` | **No** | Copiarlos por un canal seguro o crearlos (paso 6) |
| Contraseñas de Redis, RabbitMQ y SQL Server | **No** | Definirlas de nuevo o copiarlas del PC actual |
| Claves JWT locales | No | Se regeneran solas en cada arranque |
| Clave de OpenAI | No | Registrarla de nuevo en la aplicación (Llavero) |
| Datos de SQL Server (proyectos, documentos, usuarios) | **No** | Opcional: respaldo y restauración, abajo |
| Archivos subidos (Azurite) | No | Volumen de Docker `azurite-data`; opcional |
| Modelos de Ollama | No | `ollama pull` de nuevo (pesan varios GB) |

### Llevar los datos (opcional)

En el PC actual:

```bash
docker exec <contenedor-sqlserver> /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P '<DEFINIR>' \
  -Q "BACKUP DATABASE [RqProjectsDb] TO DISK='/var/opt/mssql/RqProjectsDb.bak'"
docker cp <contenedor-sqlserver>:/var/opt/mssql/RqProjectsDb.bak .
```

Repite para cada base `Rq*` (Identity, Projects, Sources, Documents, Ai,
Workflow, Operations, Prototypes), copia los `.bak` al otro PC y restáuralos
allí con `RESTORE DATABASE`. Esto es delicado: hazlo con el proyecto
detenido y comprueba el resultado antes de borrar nada. Sin datos, empiezas
con bases vacías y un usuario nuevo, que es lo más sencillo.

---

## 8. Comprobar que todo funciona

```bash
for p in 3000 3001 3002 3003 3004 3005 3006 3007 3008 3009; do
  printf "$p: "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:$p/api/v1/health
done
curl -s -o /dev/null -w "web: %{http_code}\n" http://127.0.0.1:4200/sign-in
```

Todos deben responder `200`. Luego entra a <http://127.0.0.1:4200/sign-in> con
el administrador del paso 8.

Pruebas del proyecto:

```bash
pnpm test:web          # pruebas de la web
pnpm validate:all      # validación completa (larga; requiere la infraestructura)
```

Pruebas de extremo a extremo con navegador (opcional):

```bash
pnpm exec playwright install chromium
E2E_EMAIL='<usuario-de-pruebas>' E2E_PASSWORD='<DEFINIR>' pnpm test:e2e
```

Usa un usuario de pruebas, no tu cuenta real.

---

## 9. Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `ERROR: Falta .../.env` al arrancar | No creaste ese archivo | Paso 6 |
| `Cannot connect` a SQL Server | Contenedor apagado, clave o puerto distintos | `docker ps`; revisa `DB_HOST`, `DB_PORT`, `DB_PASSWORD` |
| `Invalid object name 'ExecutionTaskStatuses'` (o similar) en Operations | Faltan migraciones | `pnpm operations:migration:run` |
| Un puerto ocupado | Otro proceso lo usa | `lsof -i :3000`; cierra el proceso o usa `detener_y_validar_levantamiento_rq.sh` |
| El script de compilar se detiene en el lint | Hay un error de lint (los avisos no frenan) | Corrige el error que muestra |
| Falta `apps/erp-knowledge-service/dist/main.js` | No se compiló todo | `bash ./compilar_todo_levantamiento_rq.sh` |
| `pnpm install` falla en `argon2` o `sharp` | Faltan herramientas de compilación | `xcode-select --install` |
| La web carga pero no inicia sesión | Gateway o Identity caídos, o sin usuario | Revisa `/api/v1/health` de 3000 y 3001; paso 8 |
| Ollama no responde | No está corriendo o el modelo no está descargado | `ollama serve`; `ollama list` |
| Docker dice que un contenedor no es saludable | Volumen o contraseña previos distintos | `bash scripts/infrastructure-logs.sh <servicio>` |

Los registros de los servicios quedan en `logs/full-project/` y
`logs/local-auth/`.

---

## 10. Lista de verificación rápida

- [ ] Node 24, pnpm 11.18.0, Docker Desktop abierto, Git
- [ ] Repositorio clonado y `pnpm install --frozen-lockfile` sin errores
- [ ] SQL Server en el puerto 1433, con clave definida
- [ ] `infrastructure/docker/.env` con contraseñas y contenedores saludables
- [ ] Los `.env` de cada servicio y `apps/web/.env.local`
- [ ] Bases creadas y migraciones aplicadas (paso 7)
- [ ] Usuario administrador creado (paso 8)
- [ ] Compilación correcta y servicios activos (paso 9)
- [ ] Ollama con los modelos que vayas a usar (opcional)
- [ ] Entrada exitosa en <http://127.0.0.1:4200/sign-in>

---

*Generado el 11 de octubre de 2026 a partir de `README.md`,
`infrastructure/docker/`, `scripts/`, los `.env.example` y los scripts
`compilar_todo_levantamiento_rq.sh` y `ejecutar_y_status_levantamiento_rq.sh`.
Las partes que no se probaron en otro equipo están indicadas en el texto.*
