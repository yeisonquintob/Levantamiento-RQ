# RabbitMQ

RabbitMQ se utilizará posteriormente como bus de eventos entre los
servicios de Levantamiento RQ.

## Configuración inicial

- Imagen: `rabbitmq:4.3.4-management-alpine`.
- AMQP local: `127.0.0.1:5673`.
- Consola: `http://127.0.0.1:15673`.
- Usuario y contraseña en `infrastructure/docker/.env`.
- Volumen persistente administrado por Docker.

En esta etapa no se crean exchanges, colas, bindings ni usuarios por
dominio. Esos contratos se implementarán junto con los servicios.
