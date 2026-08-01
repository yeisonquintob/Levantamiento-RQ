# Flujo de análisis con IA

## Principio

La IA es un asistente del analista y no la autoridad final.

## Analizadores

### Requirement Analyst

Analiza documentos, conversaciones, notas, procesos, necesidades,
restricciones, reglas y requerimientos potenciales.

### ERP Fit-Gap Analyst

Consulta conocimiento ERP aprobado para identificar capacidades,
configuraciones, cobertura parcial, extensiones, brechas y evidencias.

### Consolidation Analyst

Combina los resultados y propone usar funcionalidad existente,
configurar el ERP, reutilizar una personalización, extender Dynamics,
integrar sistemas, crear una aplicación complementaria o pedir más datos.

## Flujo

```mermaid
sequenceDiagram
    participant U as Analista
    participant G as Gateway
    participant S as Sources
    participant A as AI Analysis
    participant E as ERP Knowledge
    participant D as Documents
    participant W as Workflow

    U->>G: Solicitar análisis
    G->>A: Crear ejecución
    A->>S: Obtener fuentes autorizadas
    S-->>A: Texto y evidencias

    opt Proyecto relacionado con ERP
        A->>E: Buscar capacidades relacionadas
        E-->>A: Capacidades y evidencias ERP
    end

    A->>A: Generar análisis estructurado
    A->>A: Ejecutar fit-gap
    A->>A: Validar resultado
    A-->>D: AnalysisCompleted
    D->>D: Crear propuesta de borrador
    D-->>U: Mostrar cambios propuestos
    U->>D: Aplicar, editar o descartar
    U->>W: Solicitar revisión
```

## Restricciones

La IA no inventará información, no resolverá contradicciones sin
reportarlas, no modificará contenido aprobado, no aplicará cambios
automáticamente, no creará referencias inexistentes, no afirmará que
algo existe en el ERP sin evidencia y no consultará producción.
