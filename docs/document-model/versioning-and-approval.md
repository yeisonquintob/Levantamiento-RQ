# Versionamiento y aprobación

## Plantillas

Estados del catálogo:

```text
BORRADOR → PUBLICADA → RETIRADA
```

- La plantilla canónica inicia en la versión `1.0.0`.
- Una versión publicada o retirada es inmutable.
- Cambiar estructura, orden o reglas exige nueva versión.
- Los documentos conservan la versión de plantilla utilizada.
- El prompt de análisis y el contrato de salida pertenecen a esa misma versión.
- Una nueva versión se crea clonando una versión publicada o retirada.
- La nueva versión debe ser SemVer superior a la versión de origen.
- Código y versión forman una combinación única dentro del catálogo.

## Documentos

Estados previstos:

```text
BORRADOR → EN VALIDACIÓN → APROBADO
```

Estados auxiliares internos podrán existir, pero no reemplazarán los estados
visibles definidos por la plantilla.

## Cambios

- Editar un borrador actualiza su revisión interna.
- Solicitar validación bloquea cambios no autorizados.
- Aprobar crea una versión inmutable.
- Modificar un aprobado crea una nueva versión en BORRADOR.
- El control de cambios registra versión, fecha, modificación y aprobó.

## Roles

- Elaboró: crea y edita.
- Revisó: valida y solicita correcciones.
- Aprobó: toma la decisión final.

Una misma persona podrá ocupar más de un rol únicamente cuando la política
de la organización lo permita y quede auditado.
