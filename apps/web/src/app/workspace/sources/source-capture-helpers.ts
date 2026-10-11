export interface RequirementsQuestionnaireQuestion {
  readonly id: string;
  readonly text: string;
}

export interface RequirementsQuestionnaireSection {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly objective: string;
  readonly questions: readonly RequirementsQuestionnaireQuestion[];
}

export const REQUIREMENTS_QUESTIONNAIRE: readonly RequirementsQuestionnaireSection[] =
  [
    {
      id: "discovery",
      number: 1,
      title: "Descubrimiento y contexto del requerimiento",
      objective:
        "Entender el problema, su impacto y el resultado que se espera obtener.",
      questions: [
        {
          id: "discovery-current-need",
          text: "¿Qué problema o necesidad de negocio se busca resolver y cómo se gestiona actualmente?",
        },
        {
          id: "discovery-urgency-impact",
          text: "¿Por qué es necesario resolverlo ahora y qué impacto tiene actualmente en tiempo, costos, errores, riesgos, servicio o cumplimiento?",
        },
        {
          id: "discovery-expected-result",
          text: "¿Qué resultado concreto se espera alcanzar con la solución y qué debería mejorar o cambiar con respecto a la situación actual?",
        },
        {
          id: "discovery-stakeholders",
          text: "¿Quién es el dueño del proceso y qué usuarios, áreas o roles intervienen o se ven afectados?",
        },
        {
          id: "discovery-constraints",
          text: "¿Existen restricciones, fechas límite, normativas, políticas internas o dependencias que debamos considerar desde el inicio?",
        },
        {
          id: "discovery-information",
          text: "¿Qué información, documentos, archivos, sistemas o herramientas se utilizan?",
        },
        {
          id: "discovery-baseline",
          text: "¿Qué datos actuales podemos utilizar como línea base para medir el impacto del problema y demostrar, después de implementar la solución, que realmente generó una mejora?",
        },
      ],
    },
    {
      id: "as-is",
      number: 2,
      title: "Levantamiento del proceso actual — AS-IS",
      objective:
        "Conocer cómo ocurre realmente el proceso, incluyendo actividades manuales, decisiones y excepciones.",
      questions: [
        {
          id: "as-is-steps",
          text: "¿Puedes describir paso a paso cómo se realiza actualmente el proceso, desde su inicio hasta su cierre, indicando quién interviene en cada actividad?",
        },
        {
          id: "as-is-controls",
          text: "¿Qué validaciones, decisiones, aprobaciones y controles se realizan actualmente, en especial aquellos que se hacen manualmente?",
        },
        {
          id: "as-is-exceptions",
          text: "¿Qué excepciones, reprocesos, errores o situaciones especiales se presentan y cómo se resuelven actualmente?",
        },
        {
          id: "as-is-bottlenecks",
          text: "¿En qué puntos del proceso se generan actualmente las mayores demoras, errores, riesgos o esfuerzos manuales?",
        },
      ],
    },
    {
      id: "to-be",
      number: 3,
      title: "Definición del proceso futuro — TO-BE",
      objective:
        "Establecer cómo debería funcionar la solución y qué comportamiento se espera del sistema.",
      questions: [
        {
          id: "to-be-process",
          text: "¿Cómo debería funcionar el proceso idealmente desde el inicio hasta el cierre y qué actividades deberían ser manuales, automáticas o eliminadas?",
        },
        {
          id: "to-be-roles",
          text: "¿Qué debe poder hacer cada rol dentro de la solución: crear, consultar, modificar, aprobar, rechazar, cancelar o finalizar?",
        },
        {
          id: "to-be-states",
          text: "¿Qué estados o etapas debe tener el proceso, qué eventos generan cambios de estado y qué acciones están permitidas en cada uno?",
        },
        {
          id: "to-be-errors",
          text: "¿Qué debe ocurrir cuando se presenta un error, rechazo, cancelación, corrección, devolución o reproceso?",
        },
        {
          id: "to-be-priority",
          text: "¿Qué es indispensable para el primer entregable y qué funcionalidades serían deseables para una segunda etapa?",
        },
      ],
    },
    {
      id: "rules-data-ux",
      number: 4,
      title: "Reglas de negocio, datos y experiencia de usuario",
      objective:
        "Definir qué debe controlar la solución y qué información necesita para operar.",
      questions: [
        {
          id: "rules-validity",
          text: "¿Qué condiciones deben cumplirse antes de permitir cada acción y qué datos o combinaciones de datos son válidos o inválidos?",
        },
        {
          id: "rules-fields",
          text: "¿Qué información debe ingresar, consultar o modificar el usuario y qué campos, documentos o datos deben ser obligatorios, opcionales o de solo lectura?",
        },
        {
          id: "rules-limits",
          text: "¿Qué límites, montos, porcentajes, fechas, estados, perfiles o condiciones especiales debe controlar la solución?",
        },
        {
          id: "rules-interface",
          text: "¿Qué pantallas, formularios, consultas, filtros, búsquedas, cargas masivas, adjuntos o acciones necesita cada rol?",
        },
        {
          id: "rules-exceptions",
          text: "¿Qué debe suceder cuando una regla de negocio no se cumple y quién está autorizado para aprobar o gestionar una excepción?",
        },
      ],
    },
    {
      id: "integrations-security",
      number: 5,
      title: "Integraciones, notificaciones, seguridad y trazabilidad",
      objective:
        "Identificar las dependencias externas y los controles necesarios para que la solución opere correctamente.",
      questions: [
        {
          id: "integrations-systems",
          text: "¿Con qué sistemas, aplicaciones o servicios debe intercambiar información la solución y qué información se envía o recibe en cada integración?",
        },
        {
          id: "integrations-direction",
          text: "¿Cuál es el sistema origen y cuál el destino, cómo se relacionan los registros y la integración debe operar en tiempo real o mediante procesos programados?",
        },
        {
          id: "integrations-failure",
          text: "¿Qué debe ocurrir cuando una integración falla: cómo se detecta, notifica, reintenta o reprocesa?",
        },
        {
          id: "integrations-notifications",
          text: "¿Qué notificaciones o aprobaciones deben generarse, en qué momento, para quién y qué información deben contener?",
        },
        {
          id: "integrations-access",
          text: "¿Qué restricciones de acceso, segregación por empresa, área o rol y trazabilidad se requieren para saber quién hizo qué, cuándo y sobre qué información?",
        },
      ],
    },
    {
      id: "acceptance",
      number: 6,
      title: "Criterios de aceptación, reportes y cierre",
      objective:
        "Definir cómo se comprobará que la solución realmente resuelve la necesidad.",
      questions: [
        {
          id: "acceptance-scenarios",
          text: "¿Qué escenarios debemos probar para demostrar que el proceso funciona correctamente, incluyendo casos normales, errores y excepciones?",
        },
        {
          id: "acceptance-observable-result",
          text: "¿Qué resultado observable debe producir la solución para considerar que cada funcionalidad cumple con lo esperado?",
        },
        {
          id: "acceptance-reporting",
          text: "¿Qué información, consultas, indicadores, reportes o exportaciones necesitan los usuarios y quién puede acceder a ellos?",
        },
        {
          id: "acceptance-production",
          text: "¿Qué condiciones deben cumplirse para dar la aceptación funcional y autorizar el paso a producción?",
        },
        {
          id: "acceptance-out-of-scope",
          text: "¿Qué quedó fuera del alcance, qué pendientes o riesgos deben quedar documentados para una siguiente etapa?",
        },
      ],
    },
  ] as const;

export const REQUIREMENTS_QUESTION_IDS = REQUIREMENTS_QUESTIONNAIRE.flatMap(
  (section) => section.questions.map((question) => question.id),
);

export interface DiscussionSourceSelectionCounts {
  readonly manual: number;
  readonly local: number;
  readonly cloud: number;
}

const EMPTY_DISCUSSION_SELECTION_COUNTS: DiscussionSourceSelectionCounts = {
  manual: 0,
  local: 0,
  cloud: 0,
};

/** Counts only selections that were already persisted as a discussion source. */
export function parseDiscussionSourceSelectionCounts(
  raw: string | null,
): DiscussionSourceSelectionCounts {
  if (!raw) return EMPTY_DISCUSSION_SELECTION_COUNTS;
  try {
    const state = JSON.parse(raw) as Readonly<Record<string, unknown>>;
    if (typeof state.sourceId !== "string" || !state.sourceId.trim()) {
      return EMPTY_DISCUSSION_SELECTION_COUNTS;
    }
    if (
      !state.selectedAnswers ||
      typeof state.selectedAnswers !== "object" ||
      Array.isArray(state.selectedAnswers)
    ) {
      return EMPTY_DISCUSSION_SELECTION_COUNTS;
    }
    const validIds = new Set(REQUIREMENTS_QUESTION_IDS);
    const counts = { manual: 0, local: 0, cloud: 0 };
    for (const [questionId, origin] of Object.entries(state.selectedAnswers)) {
      if (!validIds.has(questionId)) continue;
      if (origin === "ORIGINAL") counts.manual += 1;
      if (origin === "LOCAL") counts.local += 1;
      if (origin === "CLOUD") counts.cloud += 1;
    }
    return counts;
  } catch {
    return EMPTY_DISCUSSION_SELECTION_COUNTS;
  }
}

export function composeQuestionnaireEvidence(
  notes: string,
  selectedQuestionIds: ReadonlySet<string>,
): string {
  const selectedSections = REQUIREMENTS_QUESTIONNAIRE.map((section) => ({
    ...section,
    questions: section.questions.filter((question) =>
      selectedQuestionIds.has(question.id),
    ),
  })).filter((section) => section.questions.length > 0);
  const trimmedNotes = notes.trim();

  if (selectedSections.length === 0) return trimmedNotes;

  const evidence = [
    "CUESTIONARIO DE LEVANTAMIENTO APLICADO",
    "Las siguientes preguntas fueron realizadas y tenidas en cuenta durante el levantamiento:",
    ...selectedSections.flatMap((section) => [
      "",
      `${section.number}. ${section.title}`,
      ...section.questions.map((question) => `- [x] ${question.text}`),
    ]),
  ].join("\n");

  return trimmedNotes ? `${trimmedNotes}\n\n---\n\n${evidence}` : evidence;
}

export interface SourceFileDescriptor {
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
}

export interface SourceFileMergeResult<T extends SourceFileDescriptor> {
  readonly files: readonly T[];
  readonly addedCount: number;
  readonly duplicateCount: number;
  readonly overflowCount: number;
}

export function sourceFileSelectionKey(file: SourceFileDescriptor): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export function appendUniqueSourceFiles<T extends SourceFileDescriptor>(
  current: readonly T[],
  incoming: Iterable<T>,
  limit = 20,
): SourceFileMergeResult<T> {
  const files = [...current];
  const keys = new Set(current.map(sourceFileSelectionKey));
  let addedCount = 0;
  let duplicateCount = 0;
  let overflowCount = 0;

  for (const file of incoming) {
    const key = sourceFileSelectionKey(file);
    if (keys.has(key)) {
      duplicateCount += 1;
      continue;
    }
    if (files.length >= limit) {
      overflowCount += 1;
      continue;
    }
    keys.add(key);
    files.push(file);
    addedCount += 1;
  }

  return { files, addedCount, duplicateCount, overflowCount };
}
