# Infraestructura local

## Alcance

Docker Compose prepara únicamente los servicios locales compartidos:

| Servicio | Uso | Puerto local |
|---|---|---:|
| Redis | BullMQ, caché y coordinación | 6381 |
| RabbitMQ | Eventos entre servicios | 5673 |
| RabbitMQ Management | Consola administrativa | 15673 |
| Azurite Blob | Archivos y evidencias | 10000 |
| Azurite Queue | Pruebas de colas de Azure Storage | 10001 |
| Azurite Table | Pruebas de tablas de Azure Storage | 10002 |

SQL Server no se ejecuta en un contenedor local. El desarrollo utilizará
una instancia remota de SQL Server o Azure SQL cuando se creen los
servicios y sus bases de datos.

## Imágenes fijadas

- Redis `8.2.8-alpine`.
- RabbitMQ `4.3.4-management-alpine`.
- Azurite `3.36.0`.

Las versiones se fijan para que el entorno no cambie silenciosamente.
Una actualización requiere validación explícita.

## Variables locales

El archivo real está ubicado en:

```text
infrastructure/docker/.env
```

Este archivo contiene contraseñas locales generadas automáticamente y
no se publica en Git. El archivo `.env.example` sí se versiona.

## Comandos

```bash
bash scripts/infrastructure-up.sh
bash scripts/infrastructure-status.sh
bash scripts/infrastructure-logs.sh
bash scripts/infrastructure-logs.sh rabbitmq
bash scripts/infrastructure-down.sh
```

Para eliminar también los datos persistentes:

```bash
bash scripts/infrastructure-down.sh --volumes
```

La eliminación de volúmenes borra los datos locales de Redis, RabbitMQ
y Azurite.

## Direcciones

- RabbitMQ Management: `http://127.0.0.1:15673`
- Azurite Blob: `http://127.0.0.1:10000/devstoreaccount1`
- Azurite Queue: `http://127.0.0.1:10001/devstoreaccount1`
- Azurite Table: `http://127.0.0.1:10002/devstoreaccount1`

El usuario y la contraseña de RabbitMQ se consultan en el archivo `.env`.

## Restricciones

- Los puertos se publican solamente en `127.0.0.1`.
- No se incluye SQL Server local.
- No se incluye MinIO.
- No se crean colas, exchanges, contenedores Blob ni bases de datos.
- No se almacenan secretos en Git.
