import {
  DOCUMENT_SCRUM_SECTION_DEFINITION,
  DOCUMENT_SECTION_DEFINITIONS,
  type DocumentJsonValue,
  type DocumentTemplateType,
  type DocumentVersionDetail,
  type ProjectDetail,
  type RequirementDocumentDetail,
} from "../../libs/shared/contracts/src/index.js";
import type { RenderApprovedDocumentInput } from "../../apps/operations-service/src/operations/export-document.renderer.js";

const SOURCE_ID = "10000000-0000-4000-8000-000000000001";

function depth(type: DocumentTemplateType): number {
  if (type === "SMALL_REQUIREMENT") return 1;
  if (type === "MEDIUM_REQUIREMENT") return 3;
  return 6;
}

function structuredStories(count: number): readonly DocumentJsonValue[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      code: `HU-${String(number).padStart(3, "0")}`,
      featureCode: `FE-${String(Math.ceil(number / 2)).padStart(3, "0")}`,
      title: `Ventas - Registrar necesidad funcional ${number}`,
      role: "persona usuaria del proceso comercial",
      want: `gestionar la necesidad funcional ${number}`,
      benefit: "mantener información trazable para la toma de decisiones",
      context:
        "La operación necesita información verificable y no admite aprobaciones automáticas.",
      premises: ["La persona cuenta con permisos vigentes."],
      impactedSystems: ["CRM", "Portal interno"],
      fields: [
        {
          name: `Campo ${number}`,
          dataType: "Texto",
          required: true,
          validation: "Debe contener un valor respaldado por la fuente.",
          sourceIds: [SOURCE_ID],
        },
      ],
      acceptanceCriteria: [
        {
          code: `CA-${String(number).padStart(3, "0")}`,
          given: "una persona autenticada con permisos",
          when: `gestiona la necesidad ${number}`,
          then: "el sistema conserva el resultado y su trazabilidad",
          sourceIds: [SOURCE_ID],
        },
      ],
      sourceIds: [SOURCE_ID],
    };
  });
}

function sectionContent(
  key: string,
  type: DocumentTemplateType,
  includesScrum: boolean,
): DocumentJsonValue {
  const count = depth(type);
  const stories = structuredStories(count);
  const featureCount = Math.ceil(count / 2);
  switch (key) {
    case "header":
      return {
        title: "Gestión de necesidades comerciales",
        projectCode: "RQ-2026-000777",
        documentVersion: "2.0.0",
        createdDate: "2026-08-10",
        requestingArea: "Planeación comercial",
        preparedBy: { name: "Analista funcional", position: "TIC" },
        reviewedBy: { name: "Líder funcional", position: "Negocio" },
        approvedBy: { name: "Product Owner", position: "Negocio" },
        status: "APROBADO",
      };
    case "objectives":
      return {
        general: "Mejorar la trazabilidad de necesidades comerciales.",
        specific: ["Registrar información verificable", "Facilitar pruebas de aceptación"],
      };
    case "problemDescription":
      return {
        currentState: "La información se consolida manualmente.",
        operationalImpact: ["Demoras", "Dificultad de trazabilidad"],
      };
    case "scope":
      return {
        included: ["Registro", "Consulta", "Trazabilidad"],
        excluded: ["Aprobaciones automáticas"],
        involvedSystems: ["CRM", "Portal interno"],
      };
    case "processFlow":
      return {
        title: "Registro y validación de la necesidad",
        nodes: [
          { id: "start", kind: "START", label: "Inicio" },
          { id: "actor", kind: "ACTOR", label: "Solicitante" },
          { id: "capture", kind: "PROCESS", label: "Registrar necesidad" },
          { id: "decision", kind: "DECISION", label: "¿Información completa?" },
          { id: "system", kind: "SYSTEM", label: "Guardar trazabilidad" },
          { id: "end", kind: "END", label: "Fin" },
        ],
        edges: [
          { from: "start", to: "actor", label: null },
          { from: "actor", to: "capture", label: null },
          { from: "capture", to: "decision", label: null },
          { from: "decision", to: "system", label: "Sí" },
          { from: "system", to: "end", label: null },
        ],
        sourceIds: [SOURCE_ID],
      };
    case "milestones":
      return {
        features: Array.from({ length: featureCount }, (_, index) => {
          const number = index + 1;
          return {
            code: `FE-${String(number).padStart(3, "0")}`,
            title: `Feature funcional ${number}`,
            objective: "Agrupar necesidades relacionadas bajo un objetivo funcional.",
            description: "Contenedor funcional con alcance verificable.",
            inScope: ["Registro trazable"],
            outOfScope: ["Decisión automática"],
            userStoryCodes: stories
              .filter(
                (story) =>
                  (story as Readonly<Record<string, DocumentJsonValue>>).featureCode ===
                  `FE-${String(number).padStart(3, "0")}`,
              )
              .map(
                (story) =>
                  (story as Readonly<Record<string, DocumentJsonValue>>).code,
              ),
            sourceIds: [SOURCE_ID],
          };
        }),
        userStories: stories,
      };
    case "nonFunctionalRequirements":
      return {
        security: ["Respetar los permisos existentes."],
        traceability: ["Registrar las operaciones relevantes."],
        performance: ["[PENDIENTE POR DEFINIR] Métrica objetivo."],
        accessibility: ["Mantener navegación por teclado."],
      };
    case "tests":
      return {
        scenarios: stories.map((story, index) => {
          const number = index + 1;
          return {
            code: `CP-${String(number).padStart(3, "0")}`,
            title: `Validar HU-${String(number).padStart(3, "0")}`,
            userStoryCodes: [`HU-${String(number).padStart(3, "0")}`],
            acceptanceCriterionCodes: [`CA-${String(number).padStart(3, "0")}`],
            precondition: "Existe una persona autenticada.",
            action: "Ejecutar el flujo funcional.",
            expectedResult: "Se cumple el criterio y queda evidencia.",
            sourceIds: [SOURCE_ID],
          };
        }),
      };
    case "assumptionsDependenciesPending":
      return {
        assumptions: ["Los permisos actuales permanecen vigentes."],
        dependencies: ["Disponibilidad del CRM"],
        pendingItems: ["[PENDIENTE POR DEFINIR] Métrica de rendimiento."],
        contradictions: [],
      };
    case "approvalsAndChangeControl":
      return {
        approvals: [
          {
            responsible: "Product Owner",
            date: "2026-08-10",
            decision: "APROBADO",
            evidence: "Registrado en Workflow",
            version: "2.0.0",
          },
        ],
        changeControl: [
          {
            version: "2.0.0",
            date: "2026-08-10",
            change: "Consolidación estructurada",
          },
        ],
      };
    case "writingRules":
    case "visualFormat":
    case "automationInstruction":
      return { templateControlled: true };
    case "scrumPlan":
      return includesScrum
        ? {
            cadenceDays: 15,
            scheduleBasis: "RELATIVE_DAY",
            confirmedStartDate: null,
            sourceIds: [SOURCE_ID],
            sprints: [
              {
                code: "SP-001",
                number: 1,
                period: "Día 1 al Día 15",
                startDay: 1,
                endDay: 15,
                startDate: null,
                endDate: null,
                objective: "Validar el primer incremento funcional.",
                featureCodes: ["FE-001"],
                userStoryCodes: ["HU-001"],
                tasks: [
                  {
                    code: "T-001",
                    type: "DEVELOPMENT",
                    description: "Implementar el registro trazable.",
                    userStoryCode: "HU-001",
                    suggestedRole: "Desarrollo",
                    dependencyCodes: [],
                    expectedResult: "Funcionalidad disponible para pruebas.",
                  },
                ],
                dependencies: [],
                testCodes: ["CP-001"],
                deliverables: ["Incremento funcional"],
                closingCriterion: "CP-001 validado por revisión humana.",
                risks: ["Dependencia del CRM"],
              },
            ],
          }
        : null;
    default:
      return "Sin información";
  }
}

export function buildExportFixture(
  templateType: DocumentTemplateType,
  includesScrum = templateType !== "ERP_FDD",
): RenderApprovedDocumentInput {
  const project: ProjectDetail = {
    id: "20000000-0000-4000-8000-000000000001",
    code: "RQ-2026-000777",
    title: "Gestión de necesidades comerciales",
    requestingArea: "Planeación comercial",
    description: "Fixture determinista sin consumo de API.",
    status: "VALIDATION",
    template: null,
    ownerUserId: "20000000-0000-4000-8000-000000000002",
    participantCount: 0,
    participants: [],
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T12:00:00.000Z",
  };
  const definitions = [
    ...DOCUMENT_SECTION_DEFINITIONS,
    ...(includesScrum ? [DOCUMENT_SCRUM_SECTION_DEFINITION] : []),
  ];
  const stories = structuredStories(depth(templateType));
  const version: DocumentVersionDetail = {
    id: "30000000-0000-4000-8000-000000000001",
    versionNumber: 2,
    version: "2.0.0",
    status: "APPROVED",
    revision: 9,
    changeSummary: "Versión estructurada aprobada",
    createdByUserId: project.ownerUserId,
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T12:00:00.000Z",
    approvedByUserId: "30000000-0000-4000-8000-000000000002",
    approvedAt: "2026-08-10T12:00:00.000Z",
    sections: definitions.map((section, index) => ({
      id: `section-${index + 1}`,
      key: section.key,
      title: section.title,
      order: index + 1,
      content: sectionContent(section.key, templateType, includesScrum),
      templateControlled: index >= 10 && index <= 12,
    })),
    fields: [],
    requirements: stories.map((story, index) => {
      const record = story as Readonly<Record<string, DocumentJsonValue>>;
      return {
        id: `requirement-${index + 1}`,
        sectionKey: "milestones" as const,
        code: String(record.code),
        title: String(record.title),
        description: `COMO ${String(record.role)}\nQUIERO ${String(record.want)}\nPARA ${String(record.benefit)}`,
        requirementType: "USER_STORY",
        status: "APPROVED",
        order: index + 1,
        acceptanceCriteria: [
          {
            id: `criterion-${index + 1}`,
            description: `DADO una precondición, CUANDO ocurre la acción, ENTONCES se valida HU-${String(index + 1).padStart(3, "0")}.`,
            order: 1,
          },
        ],
      };
    }),
    evidence: [
      {
        id: "evidence-1",
        sourceId: SOURCE_ID,
        sectionKey: "milestones",
        requirementId: "requirement-1",
        excerpt: "La persona debe registrar el motivo de la necesidad.",
        note: null,
      },
      {
        id: "evidence-duplicate",
        sourceId: SOURCE_ID,
        sectionKey: "milestones",
        requirementId: "requirement-1",
        excerpt: "La persona debe registrar el motivo de la necesidad.",
        note: null,
      },
    ],
  };
  const document: RequirementDocumentDetail = {
    id: "40000000-0000-4000-8000-000000000001",
    projectId: project.id,
    title: "Levantamiento estructurado de necesidades comerciales",
    status: "APPROVED",
    revision: 9,
    currentVersionNumber: 2,
    currentVersion: "2.0.0",
    template: {
      id: "50000000-0000-4000-8000-000000000001",
      sourceTemplateId: "50000000-0000-4000-8000-000000000002",
      code: templateType.replace("_REQUIREMENT", ""),
      name: templateType,
      version: "2.0.0",
      templateType,
      includesScrum,
      appliedAt: "2026-08-10T10:00:00.000Z",
    },
    createdByUserId: project.ownerUserId,
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T12:00:00.000Z",
    archivedAt: null,
    currentVersionDetail: version,
  };
  return {
    project,
    document,
    version,
    generatedAt: new Date("2026-08-10T13:00:00.000Z"),
  };
}

export function buildVentasPerdidasExportFixture(): RenderApprovedDocumentInput {
  const base = buildExportFixture("MEDIUM_REQUIREMENT", true);
  const sourceId = "92c4e996-f407-4548-8fb2-ef7f98930b13";
  const fields = [
    ["Artículo", "Código o selección", true, "Debe existir en el maestro de artículos D365."],
    ["Cliente", "Código o selección", true, "Debe existir en el maestro de clientes D365."],
    ["Sede", "Selección", true, "Debe corresponder al cliente seleccionado."],
    ["Motivo", "Selección", true, "Debe existir en NavReasonsLostSales."],
    ["Cantidad", "Número", true, "Debe contener un valor válido para el registro."],
    ["Precio objetivo", "Número", false, "Obligatorio cuando el motivo sea Por Precio."],
    ["Competidor", "Selección o texto", false, "Obligatorio cuando el motivo sea Por Precio."],
  ].map(([name, dataType, required, validation]) => ({
    name,
    dataType,
    required,
    validation,
    sourceIds: [sourceId],
  }));
  const stories: readonly DocumentJsonValue[] = [
    {
      code: "HU-001",
      featureCode: "FE-001",
      title: "Acceso - Validar usuario antes de iniciar el chat",
      role: "usuario autorizado",
      want: "autenticarme antes de registrar una venta perdida",
      benefit: "proteger el acceso y conservar la trazabilidad del registro",
      context: "El chat debe permitir operaciones únicamente a usuarios habilitados.",
      premises: ["Existe un sistema maestro de usuarios integrable."],
      impactedSystems: ["Chat de ventas perdidas", "Sistema maestro de usuarios"],
      fields: [],
      acceptanceCriteria: [
        {
          code: "CA-001",
          given: "un usuario con credenciales vigentes y permisos",
          when: "inicia el chat",
          then: "el sistema permite continuar y asocia su identidad al registro",
          sourceIds: [sourceId],
        },
        {
          code: "CA-002",
          given: "un usuario no autorizado",
          when: "intenta iniciar el chat",
          then: "el sistema informa que no está autorizado y bloquea el registro",
          sourceIds: [sourceId],
        },
      ],
      sourceIds: [sourceId],
    },
    {
      code: "HU-002",
      featureCode: "FE-001",
      title: "Captura - Registrar venta perdida mediante conversación en texto",
      role: "asesor comercial",
      want: "registrar una venta perdida mediante un chat guiado",
      benefit: "reducir la fricción del flujo manual de ERP D365",
      context: "La Fase 1 prioriza captura por texto desde Android, iOS y Web.",
      premises: ["El usuario completó la autenticación."],
      impactedSystems: ["Chat de ventas perdidas", "ERP Microsoft Dynamics 365", "Android", "iOS", "Web"],
      fields,
      acceptanceCriteria: [
        {
          code: "CA-003",
          given: "un asesor autenticado",
          when: "completa los datos obligatorios de una venta perdida",
          then: "el chat presenta las opciones numeradas y conserva los valores capturados",
          sourceIds: [sourceId],
        },
        {
          code: "CA-004",
          given: "un mensaje ajeno a ventas perdidas",
          when: "el usuario lo envía al chat",
          then: "el sistema lo omite y orienta nuevamente el flujo funcional",
          sourceIds: [sourceId],
        },
      ],
      sourceIds: [sourceId],
    },
    {
      code: "HU-003",
      featureCode: "FE-002",
      title: "Validación - Consultar maestros D365 durante la captura",
      role: "asesor comercial",
      want: "validar artículo, cliente y motivo antes de guardar",
      benefit: "evitar registros con datos inexistentes o inconsistentes",
      context: "Las validaciones se realizan contra maestros de D365 en tiempo real.",
      premises: ["Los maestros Artículos, Clientes y NavReasonsLostSales están disponibles."],
      impactedSystems: ["Chat de ventas perdidas", "ERP Microsoft Dynamics 365"],
      fields: fields.slice(0, 5),
      acceptanceCriteria: [
        {
          code: "CA-005",
          given: "un valor existente en el maestro correspondiente",
          when: "el chat lo valida",
          then: "el sistema permite continuar con el siguiente dato",
          sourceIds: [sourceId],
        },
        {
          code: "CA-006",
          given: "un artículo, cliente o motivo inexistente",
          when: "el chat ejecuta la validación",
          then: "el sistema informa el error, solicita el dato nuevamente y no persiste el registro",
          sourceIds: [sourceId],
        },
      ],
      sourceIds: [sourceId],
    },
    {
      code: "HU-004",
      featureCode: "FE-002",
      title: "Precio - Solicitar información condicional por motivo",
      role: "asesor comercial",
      want: "registrar precio objetivo y competidor cuando el motivo sea Por Precio",
      benefit: "completar la información necesaria para analizar la venta perdida",
      context: "Los campos condicionales no deben solicitarse para otros motivos.",
      premises: ["El motivo Por Precio existe en el maestro."],
      impactedSystems: ["Chat de ventas perdidas", "ERP Microsoft Dynamics 365"],
      fields: fields.slice(5),
      acceptanceCriteria: [
        {
          code: "CA-007",
          given: "que el usuario seleccionó el motivo Por Precio",
          when: "continúa la captura",
          then: "el chat solicita precio objetivo y competidor antes del resumen",
          sourceIds: [sourceId],
        },
      ],
      sourceIds: [sourceId],
    },
    {
      code: "HU-005",
      featureCode: "FE-003",
      title: "Confirmación - Revisar y editar el resumen antes de guardar",
      role: "asesor comercial",
      want: "revisar, modificar o confirmar el resumen de la venta perdida",
      benefit: "asegurar que solo se almacene información confirmada",
      context: "El registro en D365 ocurre exclusivamente después de la confirmación explícita.",
      premises: ["Los datos obligatorios fueron capturados y validados."],
      impactedSystems: ["Chat de ventas perdidas", "ERP Microsoft Dynamics 365"],
      fields: [],
      acceptanceCriteria: [
        {
          code: "CA-008",
          given: "un resumen con datos válidos",
          when: "el usuario modifica un campo",
          then: "el chat actualiza el resumen y vuelve a validar el dato",
          sourceIds: [sourceId],
        },
        {
          code: "CA-009",
          given: "un resumen validado",
          when: "el usuario confirma el registro",
          then: "el sistema persiste la venta perdida con usuario y fecha",
          sourceIds: [sourceId],
        },
      ],
      sourceIds: [sourceId],
    },
    {
      code: "HU-006",
      featureCode: "FE-004",
      title: "Carga masiva - Validar y procesar archivo de ventas perdidas",
      role: "usuario autorizado",
      want: "cargar ventas perdidas desde archivos XLSX o CSV",
      benefit: "registrar múltiples filas con control de errores y trazabilidad",
      context: "La Fase 2 admite carga parcial de filas válidas.",
      premises: ["La plantilla estándar de carga está pendiente de definición."],
      impactedSystems: ["Módulo de carga", "ERP Microsoft Dynamics 365"],
      fields: [],
      acceptanceCriteria: [
        {
          code: "CA-010",
          given: "un archivo XLSX o CSV",
          when: "el usuario solicita la carga",
          then: "el sistema valida estructura y campos, informa filas válidas y errores y permite carga parcial",
          sourceIds: [sourceId],
        },
      ],
      sourceIds: [sourceId],
    },
    {
      code: "HU-007",
      featureCode: "FE-005",
      title: "Consulta - Filtrar el consolidado de ventas perdidas",
      role: "analista de información o profesional de planeación",
      want: "consultar el consolidado mediante filtros de negocio",
      benefit: "analizar las ventas perdidas con información actualizada y trazable",
      context: "La visualización está restringida por los roles definidos.",
      premises: ["Existen registros persistidos en D365."],
      impactedSystems: ["Consolidado de ventas perdidas", "ERP Microsoft Dynamics 365"],
      fields,
      acceptanceCriteria: [
        {
          code: "CA-011",
          given: "un usuario con permiso de consulta",
          when: "filtra por artículo, motivo, fecha, usuario, cliente, sede o competidor",
          then: "el consolidado muestra únicamente los registros que cumplen los filtros",
          sourceIds: [sourceId],
        },
      ],
      sourceIds: [sourceId],
    },
    {
      code: "HU-008",
      featureCode: "FE-006",
      title: "Voz - Capturar una venta perdida después de estabilizar texto",
      role: "asesor comercial",
      want: "dictar los datos de una venta perdida",
      benefit: "agilizar la captura en campo mediante el mismo conjunto de validaciones",
      context: "La captura por voz corresponde a la Fase 3 y depende de validar las fases anteriores.",
      premises: ["La Fase 1 fue estabilizada y el reconocimiento de voz está habilitado."],
      impactedSystems: ["Chat de ventas perdidas", "Servicio de reconocimiento de voz", "ERP Microsoft Dynamics 365"],
      fields,
      acceptanceCriteria: [
        {
          code: "CA-012",
          given: "que la función de voz está habilitada",
          when: "el asesor dicta los datos",
          then: "el sistema los reconoce, solicita faltantes, valida maestros y presenta el resumen antes de guardar",
          sourceIds: [sourceId],
        },
      ],
      sourceIds: [sourceId],
    },
  ];
  const features: readonly DocumentJsonValue[] = [
    ["FE-001", "Acceso y captura conversacional", "Chat guiado con autenticación y captura por texto", "Reducir la fricción del registro en campo", ["HU-001", "HU-002"]],
    ["FE-002", "Validaciones de negocio", "Consulta de maestros y reglas condicionales", "Evitar datos inexistentes o incompletos", ["HU-003", "HU-004"]],
    ["FE-003", "Confirmación y persistencia", "Resumen editable y confirmación explícita", "Guardar únicamente información revisada", ["HU-005"]],
    ["FE-004", "Carga masiva", "Carga XLSX/CSV con control por fila", "Procesar lotes con trazabilidad de errores", ["HU-006"]],
    ["FE-005", "Consolidado y consulta", "Vista centralizada con filtros y roles", "Facilitar el análisis de ventas perdidas", ["HU-007"]],
    ["FE-006", "Captura por voz", "Dictado sujeto a las mismas validaciones", "Extender la captura tras estabilizar texto", ["HU-008"]],
  ].map(([code, title, description, objective, userStoryCodes]) => ({
    code,
    title,
    objective,
    description,
    inScope: [description],
    outOfScope: [],
    userStoryCodes,
    sourceIds: [sourceId],
  }));
  const tests: readonly DocumentJsonValue[] = [
    ["CP-001", "Registro completo en texto", ["HU-002", "HU-003", "HU-005"], ["CA-003", "CA-005", "CA-009"], "Usuario autenticado y maestros disponibles", "Completar el chat y confirmar el resumen", "Registro persistido con trazabilidad"],
    ["CP-002", "Motivo Por Precio", ["HU-004"], ["CA-007"], "Motivo Por Precio disponible", "Seleccionar el motivo y completar campos condicionales", "Precio objetivo y competidor son solicitados y validados"],
    ["CP-003", "Dato inexistente en maestros", ["HU-003"], ["CA-006"], "Usuario autenticado", "Ingresar artículo, cliente o motivo inexistente", "El sistema informa el error y no persiste"],
    ["CP-004", "Edición del resumen", ["HU-005"], ["CA-008", "CA-009"], "Datos capturados", "Modificar un campo y confirmar", "El cambio se valida y solo se guarda tras confirmar"],
    ["CP-005", "Consulta del consolidado", ["HU-007"], ["CA-011"], "Existen registros y permisos", "Aplicar filtros de negocio", "El consolidado respeta filtros y rol"],
    ["CP-006", "Carga masiva", ["HU-006"], ["CA-010"], "Plantilla de carga definida", "Subir un XLSX o CSV con filas válidas e inválidas", "Se reportan errores y se permite procesar filas válidas"],
    ["CP-007", "Captura por voz", ["HU-008"], ["CA-012"], "Fase de voz habilitada", "Dictar una venta perdida", "Los datos se reconocen y pasan por las mismas validaciones"],
  ].map(([code, title, userStoryCodes, acceptanceCriterionCodes, precondition, action, expectedResult]) => ({
    code,
    title,
    userStoryCodes,
    acceptanceCriterionCodes,
    precondition,
    action,
    expectedResult,
    sourceIds: [sourceId],
  }));
  const replacement: Readonly<Record<string, DocumentJsonValue>> = {
    header: {
      title: "Chat de ventas perdidas",
      projectCode: "RQ-2026-000033",
      documentVersion: "1.0.15",
      createdDate: "2025-10-21",
      requestingArea: "Planificación",
      preparedBy: { name: "Yeison Quinto", position: "Elaboración" },
      reviewedBy: { name: "Mónica Álvarez", position: "Revisión" },
      approvedBy: { name: "Carlos Rivas", position: "Aprobación" },
      status: "APROBADO",
    },
    objectives: {
      general: "Implementar un chat conversacional multiplataforma para registrar ventas perdidas de forma validada y trazable, reemplazando el flujo manual de D365 y facilitando su análisis.",
      specific: [
        "Habilitar captura por texto con validación de maestros y confirmación previa.",
        "Incorporar carga masiva con reporte de errores y procesamiento parcial.",
        "Evolucionar a captura por voz después de estabilizar la fase de texto.",
      ],
    },
    problemDescription: {
      currentState: "El registro de ventas perdidas en D365 utiliza un flujo extenso y poco práctico para asesores comerciales.",
      operationalImpact: "La fricción reduce la adopción, afecta la calidad y trazabilidad de los datos y dificulta su consolidación oportuna.",
      need: "Se requiere un canal conversacional para captura en campo, validación inmediata y consulta centralizada.",
    },
    scope: {
      included: [
        "Fase 1: captura por texto, validaciones D365, resumen editable y persistencia trazable.",
        "Fase 2: carga masiva XLSX/CSV con validación y opción de carga parcial.",
        "Fase 3: captura por voz con las mismas reglas funcionales.",
        "Consolidado con filtros por artículo, motivo, fecha, usuario, cliente, sede y competidor.",
      ],
      excluded: ["Exclusiones adicionales pendientes de definición."],
      involvedSystems: ["ERP Microsoft Dynamics 365", "Android", "iOS", "Web", "Servicio de reconocimiento de voz"],
    },
    processFlow: {
      title: "Registro validado de una venta perdida",
      nodes: [
        { id: "start", kind: "START", label: "Inicio" },
        { id: "auth", kind: "DECISION", label: "¿Usuario autorizado?" },
        { id: "capture", kind: "PROCESS", label: "Capturar datos" },
        { id: "masters", kind: "SYSTEM", label: "Validar maestros D365" },
        { id: "valid", kind: "DECISION", label: "¿Datos válidos?" },
        { id: "conditional", kind: "DECISION", label: "¿Motivo Por Precio?" },
        { id: "price", kind: "PROCESS", label: "Solicitar precio y competidor" },
        { id: "summary", kind: "PROCESS", label: "Mostrar resumen editable" },
        { id: "confirm", kind: "DECISION", label: "¿Usuario confirma?" },
        { id: "persist", kind: "SYSTEM", label: "Registrar en D365" },
        { id: "report", kind: "PROCESS", label: "Actualizar consolidado" },
        { id: "end", kind: "END", label: "Fin" },
      ],
      edges: [
        { from: "start", to: "auth", label: null },
        { from: "auth", to: "capture", label: "Sí" },
        { from: "capture", to: "masters", label: null },
        { from: "masters", to: "valid", label: null },
        { from: "valid", to: "capture", label: "No" },
        { from: "valid", to: "conditional", label: "Sí" },
        { from: "conditional", to: "price", label: "Sí" },
        { from: "conditional", to: "summary", label: "No" },
        { from: "price", to: "summary", label: null },
        { from: "summary", to: "confirm", label: null },
        { from: "confirm", to: "capture", label: "Modificar" },
        { from: "confirm", to: "persist", label: "Confirmar" },
        { from: "persist", to: "report", label: null },
        { from: "report", to: "end", label: null },
      ],
      sourceIds: [sourceId],
    },
    milestones: { features, userStories: stories },
    nonFunctionalRequirements: {
      security: "Acceso restringido a usuarios y roles autorizados.",
      traceability: "Cada registro conserva usuario y fecha.",
      compatibility: "Captura por texto y carga masiva disponibles en Android, iOS y Web.",
      performance: "Métrica de latencia pendiente de definición.",
    },
    tests: { scenarios: tests },
    assumptionsDependenciesPending: {
      assumptions: ["Los maestros de D365 y el sistema maestro de usuarios estarán disponibles para integración."],
      dependencies: ["Integración con D365", "Calidad de maestros", "Definición de roles y permisos"],
      pendingItems: [
        "[PENDIENTE POR DEFINIR] Entidad D365, campos y tipos para almacenar ventas perdidas.",
        "[PENDIENTE POR DEFINIR] Endpoints, contratos y autenticación entre el chat y D365.",
        "[PENDIENTE POR DEFINIR] Plantilla estándar XLSX/CSV.",
        "[PENDIENTE POR DEFINIR] Matriz detallada de roles y permisos.",
        "[PENDIENTE POR DEFINIR] Latencia máxima y objetivos de disponibilidad.",
        "[PENDIENTE POR DEFINIR] Política de retención, privacidad y auditoría.",
      ],
    },
    approvalsAndChangeControl: {
      approvals: [
        { responsible: "Yeison Quinto", role: "Elaboró", decision: "REGISTRADO" },
        { responsible: "Mónica Álvarez", role: "Revisó", decision: "REGISTRADO" },
        { responsible: "Carlos Rivas", role: "Aprobó", decision: "APROBADO" },
      ],
      changeControl: [
        { version: "1.0.1", date: "2025-10-23", change: "Cambio registrado en el documento de origen", approvedBy: "Carlos Rivas" },
        { version: "1.1.0", date: "2025-11-05", change: "Cambio registrado en el documento de origen", approvedBy: "Carlos Rivas" },
        { version: "1.0.15", date: "2026-08-10", change: "Reorganización documental sin alterar los hechos", approvedBy: "Carlos Rivas" },
      ],
    },
    scrumPlan: {
      cadenceDays: 15,
      scheduleBasis: "RELATIVE_DAY",
      confirmedStartDate: null,
      sourceIds: [sourceId],
      sprints: [
        {
          code: "SP-001", number: 1, period: "Día 1 al Día 15", startDay: 1, endDay: 15, startDate: null, endDate: null,
          objective: "Validar acceso, contratos de integración y diseño del flujo de texto.", featureCodes: ["FE-001", "FE-002"], userStoryCodes: ["HU-001", "HU-003"],
          tasks: [{ code: "T-001", type: "ANALYSIS", description: "Definir accesos, maestros y contratos de validación.", userStoryCode: "HU-001", suggestedRole: "Análisis funcional e integración", dependencyCodes: [], expectedResult: "Flujo y contratos listos para implementación." }],
          dependencies: ["Definiciones pendientes de D365"], testCodes: ["CP-003"], deliverables: ["Diseño funcional y contratos validados"], closingCriterion: "Accesos, maestros y reglas revisados por negocio y tecnología.", risks: ["Contratos D365 no definidos"],
        },
        {
          code: "SP-002", number: 2, period: "Día 16 al Día 30", startDay: 16, endDay: 30, startDate: null, endDate: null,
          objective: "Implementar captura por texto, validaciones, resumen y persistencia.", featureCodes: ["FE-001", "FE-002", "FE-003"], userStoryCodes: ["HU-002", "HU-003", "HU-004", "HU-005"],
          tasks: [{ code: "T-002", type: "DEVELOPMENT", description: "Implementar conversación, validaciones y confirmación.", userStoryCode: "HU-002", suggestedRole: "Desarrollo", dependencyCodes: ["T-001"], expectedResult: "Incremento de texto disponible para pruebas." }],
          dependencies: ["SP-001"], testCodes: ["CP-001", "CP-002", "CP-003", "CP-004"], deliverables: ["Captura por texto integrada con D365"], closingCriterion: "Escenarios de texto y persistencia validados.", risks: ["Calidad de datos maestros"],
        },
        {
          code: "SP-003", number: 3, period: "Día 31 al Día 45", startDay: 31, endDay: 45, startDate: null, endDate: null,
          objective: "Habilitar carga masiva y consulta del consolidado.", featureCodes: ["FE-004", "FE-005"], userStoryCodes: ["HU-006", "HU-007"],
          tasks: [{ code: "T-003", type: "DEVELOPMENT", description: "Implementar validación por fila, carga parcial y filtros.", userStoryCode: "HU-006", suggestedRole: "Desarrollo y datos", dependencyCodes: ["T-002"], expectedResult: "Carga y consolidado disponibles para UAT." }],
          dependencies: ["SP-002", "Plantilla XLSX/CSV"], testCodes: ["CP-005", "CP-006"], deliverables: ["Carga masiva y consolidado consultable"], closingCriterion: "Errores, carga parcial, filtros y permisos validados.", risks: ["Plantilla de carga no definida"],
        },
        {
          code: "SP-004", number: 4, period: "Día 46 al Día 60", startDay: 46, endDay: 60, startDate: null, endDate: null,
          objective: "Validar la evolución a voz después de estabilizar las fases anteriores.", featureCodes: ["FE-006"], userStoryCodes: ["HU-008"],
          tasks: [{ code: "T-004", type: "INTEGRATION", description: "Integrar reconocimiento de voz con el flujo validado de texto.", userStoryCode: "HU-008", suggestedRole: "Integración y pruebas", dependencyCodes: ["T-002", "T-003"], expectedResult: "Captura por voz lista para validación." }],
          dependencies: ["Fases de texto y carga estabilizadas"], testCodes: ["CP-007"], deliverables: ["Prototipo funcional de captura por voz"], closingCriterion: "La voz aplica las mismas validaciones y confirmación que texto.", risks: ["Calidad del reconocimiento de voz"],
        },
      ],
    },
  };
  const sections = base.version.sections.map((section) => ({
    ...section,
    content: replacement[section.key] ?? section.content,
  }));
  const version: DocumentVersionDetail = {
    ...base.version,
    versionNumber: 16,
    version: "1.0.15",
    changeSummary: "Reorganización documental sin alterar los hechos del requerimiento",
    createdAt: "2025-10-21T12:00:00.000Z",
    updatedAt: "2026-08-10T20:55:00.000Z",
    approvedAt: "2026-08-10T20:55:00.000Z",
    sections,
    requirements: [],
    evidence: [
      {
        id: "ventas-evidence-1",
        sourceId,
        sectionKey: "milestones",
        requirementId: null,
        excerpt: "Chat de ventas perdidas con captura por texto, carga masiva, voz, validaciones D365 y consolidado.",
        note: null,
      },
    ],
  };
  const project: ProjectDetail = {
    ...base.project,
    code: "RQ-2026-000033",
    title: "Ventas perdidas",
    requestingArea: "Planificación",
    description: "Chat para captura validada y trazable de ventas perdidas.",
  };
  const document: RequirementDocumentDetail = {
    ...base.document,
    projectId: project.id,
    title: "Chat de ventas perdidas",
    currentVersionNumber: 16,
    currentVersion: "1.0.15",
    currentVersionDetail: version,
  };
  return {
    project,
    document,
    version,
    generatedAt: new Date("2026-08-10T20:55:00.000Z"),
  };
}
