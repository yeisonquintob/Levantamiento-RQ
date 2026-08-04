# ADR-0024: Catálogo de plantillas documentales versionadas

## Estado

Aceptada.

## Contexto

El documento canónico ya define trece secciones obligatorias. La plataforma
necesita perfiles pequeños, medianos, grandes y FDD ERP sin duplicar estructura
en el frontend ni permitir que una publicación cambie silenciosamente.

## Decisión

Documents Service será propietario de `RqDocumentsDb` y de
`dbo.DocumentTemplates`.

Cada plantilla tendrá:

- Código estable.
- Tipo controlado.
- Versión SemVer.
- Estado `DRAFT`, `PUBLISHED` o `RETIRED`.
- Definición JSON que inicialmente contiene las trece secciones canónicas.
- Puntos configurables en borrador: título, guía, obligatoriedad y orden.
- Entre 1 y 50 puntos por versión, con claves únicas y orden normalizado.
- Contexto de análisis para IA y reglas seguras de tratamiento de fuentes.
- Contrato JSON de salida para el documento estructurado.
- Configuración Scrum y ERP.
- Trazabilidad de creación, publicación, retiro y versión de origen.

Una versión publicada o retirada será inmutable. Los cambios de estructura,
incluidos agregar, eliminar, reordenar o redactar nuevamente un punto, se
realizarán mediante clonación hacia una versión SemVer superior en borrador.

Las plantillas pequeñas, medianas y grandes incluirán Epic, Feature, historia
de usuario y criterios de aceptación. FDD ERP no incluirá Scrum por defecto.

## Consecuencias

- Los documentos futuros podrán conservar la versión exacta usada.
- La misma versión gobierna el análisis de IA y la estructura del documento.
- Las fuentes se tratan como datos y no como instrucciones del sistema.
- El catálogo es auditable y no depende de archivos estáticos desplegados.
- El frontend administra plantillas a través del Gateway.
- El Paso 14 no implementa borradores, IA, aprobación ni exportaciones.
