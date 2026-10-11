export interface LocalOnlyV2SectionDraftPolicy {
  readonly maxCharacters: number;
  readonly instruction: string;
}

const DEFAULT_POLICY: LocalOnlyV2SectionDraftPolicy = Object.freeze({
  maxCharacters: 900,
  instruction:
    "Incluye únicamente los datos solicitados por el título y la guía de esta sección.",
});

const SECTION_POLICIES: Readonly<
  Record<string, LocalOnlyV2SectionDraftPolicy>
> = Object.freeze({
  header: {
    maxCharacters: 450,
    instruction:
      "Incluye solo metadatos documentales confirmados: título, código, versión, fecha, área y estado. No describas la solución.",
  },
  objectives: {
    maxCharacters: 1_800,
    instruction:
      "Entrega únicamente tres bloques claramente rotulados y en este orden: Objetivo general, Objetivos específicos cualitativos y Objetivos específicos cuantitativos. Redacta un objetivo general, exactamente cuatro cualitativos y exactamente tres cuantitativos, todos concretos, distintos y sustentados en las fuentes. Conserva la naturaleza cualitativa de los cuatro objetivos cualitativos. Cada uno de los tres cuantitativos debe expresar una dimensión realmente medible identificable en la evidencia, por ejemplo cantidad, porcentaje, tiempo, plazo, frecuencia, tasa, volumen, duración, cobertura, cumplimiento, productividad u otro indicador respaldado. Si la evidencia identifica qué medir pero no proporciona cifra, línea base o meta, conserva el objetivo cuantitativo completo y agrega en la misma línea únicamente el dato faltante como 'meta: [PENDIENTE POR DEFINIR]' o 'línea base: [PENDIENTE POR DEFINIR]'. Nunca reemplaces un objetivo cuantitativo completo por '[PENDIENTE POR DEFINIR: objetivo cuantitativo N]' y nunca inventes cifras, porcentajes, tiempos, metas o líneas base. No dejes frases cortadas o incompletas. Evita contexto, alcance, propuesta de solución, títulos repetidos y fragmentos de otros apartados.",
  },
  problemDescription: {
    maxCharacters: 1_600,
    instruction:
      "Entrega únicamente el problema actual usando este contrato: una línea 'SITUACION_ACTUAL | descripción completa y sustentada' y después entre una y cinco líneas 'IMPACTO | consecuencia operacional completa y sustentada'. No uses encabezados adicionales, numeración, viñetas ni frases introductorias como 'Los impactos operacionales identificados son'. Cada IMPACTO debe expresar una consecuencia negativa distinta del AS-IS, por ejemplo retraso, demora, error, reproceso, riesgo, dificultad, pérdida, sobrecarga, ineficiencia, omisión, rechazo o dependencia cuando corresponda a la evidencia. No mezcles objetivos, beneficios, mejoras, recomendaciones, solución propuesta ni TO-BE. No dejes números sueltos al final de las frases. Si existe menos evidencia, devuelve menos impactos; si no existe ningún impacto sustentado, usa exactamente 'IMPACTO | [PENDIENTE POR DEFINIR]'. No inventes impactos.",
  },
  scope: {
    maxCharacters: 1_200,
    instruction:
      "Separa máximo diez elementos incluidos y máximo cinco fuera de alcance. En sistemas involucrados escribe únicamente nombres de aplicaciones o plataformas de Navitrans mencionadas literalmente; no incluyas procesos, áreas, personas ni frases descriptivas.",
  },
  solutionProposal: {
    maxCharacters: 1_200,
    instruction:
      "Expón el objetivo y los componentes de la solución sustentada, relacionando AS-IS, evaluación y TO-BE sin repetir el problema completo.",
  },
  processFlow: {
    // AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_CANONICAL_BUDGET_V1
    //
    // El punto 6 ahora se genera como tres subunidades independientes
    // (AS-IS, TO-BE, modelo entidad-relación), cada una con su propio
    // presupuesto acotado (ver LOCAL_ONLY_V2_DIAGRAM_ARTIFACT_MAX_CONTENT_CHARACTERS
    // en local-only-v2-sequential-block-generator.ts). Este máximo es el
    // límite del bloque ENSAMBLADO (la suma de las tres), con margen para
    // los encabezados de cada subunidad; nunca lo usa una sola llamada.
    maxCharacters: 12_500,
    instruction:
      "Cada subunidad de este punto entrega únicamente su propio artefacto (FLUJO AS-IS, FLUJO TO-BE o el modelo entidad-relación) usando el contrato canónico por identificador estable: CARRIL | id | nombre | ACTOR/SYSTEM; NODO | id | laneId | START/PROCESS/DECISION/SYSTEM/END | acción concreta; ARISTA | idOrigen | idDestino | etiqueta (obligatoria y distinta cuando el nodo de origen es una decisión con más de una salida, por ejemplo Sí/No/Aprobado/Rechazado); PROBLEMA | texto (solo en AS-IS); MEJORA | texto y RESULTADO | texto (solo en TO-BE); y para el modelo entidad-relación: ENTIDAD | id | nombre | descripción, ATRIBUTO | entidadId | nombre | tipo | PK/FK/NONE | SI/NO, RELACION | entidadOrigenId | entidadDestinoId | 1:1/1:N/N:1/N:M | descripción. No resumas ningún artefacto como párrafo ni como lista genérica. Conserva cada actor, rol, área, aplicación o plataforma sustentada como carril independiente; nunca uses un carril genérico como 'Proceso actual' o 'Solución propuesta' cuando la evidencia identifica al responsable. No escribas 'Pregunta:' ni 'Respuesta:' dentro de ningún nodo ni conviertas una pregunta del levantamiento en una decisión del flujo. No inventes entidades, atributos, relaciones, cardinalidades, decisiones ni resultados que la evidencia no sustente.",
  },
  milestones: {
    maxCharacters: 40_000,
    instruction:
      "Construye el punto de Requerimientos con la misma jerarquía funcional para cualquier proyecto: Hito -> Historias de usuario funcionales -> detalle -> campos -> criterios de aceptación; al final agrega los requerimientos no funcionales en una colección separada. NO resumas la sección en párrafos, viñetas ni encabezados narrativos. La salida debe ser directamente parseable y usar exclusivamente una línea por elemento con separador |. Contrato obligatorio: 'HITO | H-001 | nombre | descripción'; debajo de cada Hito debe existir al menos una 'HU | HU-F-001 | título breve | descripción funcional' cuando la evidencia sustenta una capacidad funcional. Nunca emitas un HITO vacío: si no puedes sustentar ninguna HU para ese Hito, no generes ese Hito. Para cada HU escribe exactamente una línea 'COMO | rol', una 'QUIERO | capacidad', una 'PARA | beneficio' y una 'CONTEXTO | situación sustentada'; agrega cero o más 'PREMISA | texto', cero o más 'SISTEMA | nombre literal mencionado' y cero o más 'CAMPO | nombre | tipo | SI/NO | validación'; toda HU debe tener uno o más 'CA | CA-F-001 | dado | cuando | entonces'. Después de las HU agrega únicamente los RNF sustentados como 'RNF | RNF-001 | título | descripción | categoría | medida | objetivo | criterio verificable'. Agrupa capacidades relacionadas en Hitos funcionales distintos y asigna cada HU a un solo Hito. No confundas Hito con Feature y no generes backlog, épicas, tareas ni planificación. No escribas textos como 'REQUERIMIENTOS FUNCIONALES', 'Hito:' ni listas con guion: empieza directamente con HITO |. Conserva solo información sustentada por la evidencia; si falta un dato puntual usa [PENDIENTE POR DEFINIR] únicamente en ese campo, sin eliminar una HU cuya intención sí esté respaldada. No inventes sistemas, roles, campos, cifras, reglas ni criterios.",
  },
  backlogStructure: {
    maxCharacters: 30_000,
    instruction:
      "Construye únicamente el esquema de planificación con jerarquía Épica -> Feature -> Historia de usuario de planificación -> Tarea. Usa exclusivamente líneas con separador | y este contrato: 'EPICA | EP-001 | título | descripción | número de origen opcional'; debajo, una o más 'FEATURE | FE-001 | título | descripción | número de origen opcional'; debajo, una o más 'HU-P | HU-P-001 | título | descripción | número de origen opcional | códigos HU-F relacionados separados por coma'; debajo, las 'TAREA | T-001 | título | descripción | número de origen opcional | tipo | origen | dependencias separadas por coma'. Tipos permitidos: ANALYSIS, DESIGN, DEVELOPMENT, CONFIGURATION, INTEGRATION, DATA, TESTING, UAT, DOCUMENTATION y DEPLOYMENT. Orígenes permitidos: EVIDENCE e IMPLEMENTATION_PROPOSAL. Cada elemento debe pertenecer a un único padre y tener código único. Genera una Épica por cada Hito listado en los códigos existentes, con el mismo título del Hito, y una HU-P por cada HU-F de ese Hito (una sola HU-P por HU-F, referenciando solo códigos HU-F existentes). Cada TAREA va en su propia línea. Las Épicas corresponden a los Hitos del punto de Requerimientos, pero HU-P y HU-F siguen siendo elementos diferentes; relaciónalas mediante los códigos HU-F sin copiar COMO, QUIERO, PARA, campos ni criterios. Las tareas deben ser acciones concretas necesarias para implementar su HU-P y no repetir su título. No agregues Scrum, sprints, estimaciones, responsables ni elementos sin respaldo. No escribas encabezados narrativos, totales ni texto fuera del contrato.",
  },
  tests: {
    maxCharacters: 8_000,
    instruction:
      "Genera escenarios de prueba trazables para las historias, criterios y tareas sustentados. Usa exclusivamente una línea por escenario y este contrato con separador |: 'PRUEBA | TS-001 | título concreto | códigos HU-F o HU-P separados por coma | códigos CA-F separados por coma | códigos de tareas separados por coma | precondición | acción verificable | resultado esperado observable'. Incluye casos exitosos, validaciones, reglas de negocio, integraciones y excepciones únicamente cuando estén respaldados. Cada escenario debe comprobar un comportamiento específico y referenciar solo códigos existentes en Requerimientos o Esquema; no inventes códigos, datos, métricas ni resultados. Evita escenarios duplicados, títulos genéricos, explicaciones introductorias, encabezados y texto fuera del contrato. Si falta un dato puntual, conserva el escenario sustentado y usa [PENDIENTE POR DEFINIR] solo en ese campo.",
  },
  assumptionsDependenciesPending: {
    maxCharacters: 850,
    instruction:
      "Clasifica por separado supuestos, dependencias, restricciones, preguntas, contradicciones y pendientes. No conviertas pendientes en hechos.",
  },
  approvals: {
    maxCharacters: 550,
    instruction:
      "Incluye únicamente responsables, validadores, aprobadores y decisiones formales identificadas.",
  },
  writingRules: {
    maxCharacters: 600,
    instruction:
      "Resume solo las reglas de redacción definidas por la plantilla; no agregues contenido funcional del proyecto.",
  },
  visualFormat: {
    maxCharacters: 900,
    instruction:
      "Describe únicamente el formato definido por la plantilla. No cambies ni amplíes el contenido funcional.",
  },
  automationInstruction: {
    maxCharacters: 1_200,
    instruction:
      "Propón hasta tres KPI derivados de objetivos, necesidades o problemas medibles sustentados en la evidencia. Usa exclusivamente líneas con este contrato: 'KPI | nombre del indicador | objetivo relacionado | fórmula de medición | meta'. La fórmula debe ser verificable, por ejemplo (numerador / denominador) x 100 o un promedio explícito. La meta solo puede contener una cifra que aparezca literalmente en la evidencia; si no existe, escribe [PENDIENTE POR DEFINIR]. No inventes metas, cifras ni indicadores sin respaldo: si la evidencia no sustenta un indicador, no lo escribas y se completará con un indicador estándar de ejecución. No agregues narrativa. Los valores actuales no los estima la IA: comienzan en 0 y serán actualizados con la ejecución importada desde Azure DevOps.",
  },
  scrumPlan: {
    maxCharacters: 24_000,
    instruction:
      "Devuelve únicamente líneas separadas por salto de línea y campos separados por |. Primera línea: 'PLAN | 15 | RELATIVE_DAY'. Luego una línea por Sprint: 'SPRINT | SP-001 | 1 | objetivo | FE-001,FE-002 | HU-P-001,HU-P-002 | dependencias del Sprint | TS-001,TS-002 | entregables | criterio de cierre | riesgos'. Después de cada Sprint devuelve sus tareas: 'TAREA | SP-001 | T-001 | ANALYSIS | descripción concreta | HU-P-001 | rol sugerido | códigos de tareas dependientes | resultado esperado | duración en días | día inicial absoluto | día final absoluto'. Usa Sprints consecutivos de 15 días: Sprint 1 días 1-15, Sprint 2 días 16-30 y así sucesivamente. Cada tarea debe referenciar códigos FE, HU-P, T y TS existentes en el contexto; duración = día final - día inicial + 1; una tarea dependiente inicia después de terminar su prerrequisito. Tipos permitidos: ANALYSIS, DESIGN, DEVELOPMENT, CONFIGURATION, INTEGRATION, DATA, TESTING, UAT, DOCUMENTATION, DEPLOYMENT. Incluye todas las tareas útiles del backlog, distribuidas en Sprints coherentes. No escribas párrafos, etiquetas adicionales, fechas inventadas, horas, Story Points, velocidad ni capacidad.",
  },
});

export function localOnlyV2SectionDraftPolicy(
  sectionKey: string,
): LocalOnlyV2SectionDraftPolicy {
  return SECTION_POLICIES[sectionKey] ?? DEFAULT_POLICY;
}
