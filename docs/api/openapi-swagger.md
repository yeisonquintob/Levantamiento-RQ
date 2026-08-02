# OpenAPI y Swagger

Los nueve servicios backend exponen Swagger UI únicamente en desarrollo.

| Servicio              | Puerto | Swagger UI                       |
| --------------------- | -----: | -------------------------------- |
| Gateway               |   3000 | `http://127.0.0.1:3000/api/docs` |
| Identity Service      |   3001 | `http://127.0.0.1:3001/api/docs` |
| Projects Service      |   3002 | `http://127.0.0.1:3002/api/docs` |
| Sources Service       |   3003 | `http://127.0.0.1:3003/api/docs` |
| Documents Service     |   3004 | `http://127.0.0.1:3004/api/docs` |
| AI Analysis Service   |   3005 | `http://127.0.0.1:3005/api/docs` |
| ERP Knowledge Service |   3006 | `http://127.0.0.1:3006/api/docs` |
| Workflow Service      |   3007 | `http://127.0.0.1:3007/api/docs` |
| Operations Service    |   3008 | `http://127.0.0.1:3008/api/docs` |

El documento JSON se publica en `/api/docs-json`.

El Gateway documenta `rq_access` y `rq_refresh`. Identity Service documenta
Bearer para su endpoint interno `me`. No se incluyen credenciales reales.

## Swagger UI con Fastify

Swagger UI publica archivos JavaScript y CSS. Cuando NestJS utiliza el
adaptador Fastify, `SwaggerModule.setup()` requiere `@fastify/static` para
servir esos recursos. Los nueve servicios declaran explícitamente la versión
`10.1.2`, compatible con Fastify 5.

## Compatibilidad Webpack

`@nestjs/mapped-types` conserva una ruta histórica denominada
`class-transformer/storage`. Webpack intenta resolverla de forma estática,
aunque `class-transformer` moderno publica el almacenamiento en
`class-transformer/cjs/storage.js`.

Los nueve servicios declaran un alias Webpack exacto entre ambas rutas. No se
modifica `node_modules` ni se instala una versión antigua de
`class-transformer`.

Validación completa:

```bash
pnpm swagger:validate
```

## Recursos estáticos de Swagger UI

Los servicios compilados con Webpack usan `customSwaggerUiPath` para servir
CSS, JavaScript y favicons desde la dependencia local `swagger-ui-dist`.

La validación automática comprueba la interfaz, el documento OpenAPI y los
seis recursos estáticos necesarios. Una respuesta HTML por sí sola no se
considera una validación completa.
