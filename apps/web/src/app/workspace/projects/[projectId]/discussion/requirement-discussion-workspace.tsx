"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type {
  ProcessRequirementDiscussionResponse,
  ProjectDetail,
  ProjectSummary,
  RequirementDiscussionEngine,
  SourceDetail,
  SourceListResponse,
  ViabilityConfiguration,
} from "@levantamiento-rq/shared-contracts";
import {
  evaluateDiscussionViability,
  evaluateViability,
  isInsufficientDiscussionAnswer,
} from "@levantamiento-rq/shared-contracts";
import {
  RqActionButton,
  RqKpiCard,
  RqKpiGrid,
} from "@levantamiento-rq/shared-ui";

import {
  AiProcessingMenu,
  useAiEngineSelection,
} from "../../../ai-engine-selection";
import { calculateAnswerDefinitionLevel } from "../../../home-stage-progress";
import { WorkspaceKpiIcon } from "../../../workspace-kpi-icon";
import { REQUIREMENTS_QUESTIONNAIRE } from "../../../sources/source-capture-helpers";
import { useAutoDismiss } from "../../../../use-auto-dismiss";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

const CONVERSATION_LIMIT = 200_000;
const DEFAULT_COMPARISON_COLUMNS = [0.75, 1, 1, 1];

const ANSWER_LIMIT = 20_000;

interface HumanAnswer {
  answer: string;
  score: number;
}

type DiscussionAnswerOrigin = "ORIGINAL" | RequirementDiscussionEngine;

const PROTOTYPE_REQUIREMENT_QUESTION =
  "¿El requerimiento necesita la generación de un prototipo?";

interface ProcessedDiscussionResult {
  answers: Record<string, string>;
  processedAt: string;
  provider: ProcessRequirementDiscussionResponse["provider"];
  model: string;
}

interface DiscussionState {
  answers: Record<string, HumanAnswer>;
  conversation: string;
  needsPrototype: boolean | null;
  localResult: ProcessedDiscussionResult | null;
  cloudResult: ProcessedDiscussionResult | null;
  selectedAnswers: Record<string, DiscussionAnswerOrigin>;
  includeConversation: boolean;
  sourceId: string | null;
}

interface LegacyDiscussionState {
  processedAnswers?: Record<string, string>;
  processedAt?: string | null;
  provider?: ProcessRequirementDiscussionResponse["provider"] | null;
  model?: string | null;
  solutionType?: string;
  solutionTypeDetail?: string;
}

interface AlertState {
  tone: "success" | "danger" | "information";
  message: string;
}

interface DiscussionProcessingState {
  status:
    "idle" | "running" | "stopping" | "completed" | "cancelled" | "failed";
  progress: number;
  completedEngines: number;
  totalEngines: number;
  reprocessing: boolean;
  message: string;
}

const EMPTY_PROCESSING_STATE: DiscussionProcessingState = {
  status: "idle",
  progress: 0,
  completedEngines: 0,
  totalEngines: 0,
  reprocessing: false,
  message: "",
};

// RQ DISCUSION MOTORES INDEPENDIENTES TIMEOUT V1.2
const DISCUSSION_ENGINE_TIMEOUT_MS = 300_000;

function emptyAnswers(): Record<string, HumanAnswer> {
  return Object.fromEntries(
    REQUIREMENTS_QUESTIONNAIRE.flatMap((section) =>
      section.questions.map((question) => [
        question.id,
        { answer: "", score: 1 },
      ]),
    ),
  );
}

function emptyState(): DiscussionState {
  return {
    answers: emptyAnswers(),
    conversation: "",
    needsPrototype: null,
    localResult: null,
    cloudResult: null,
    selectedAnswers: {},
    includeConversation: false,
    sourceId: null,
  };
}

function storageKey(projectId: string): string {
  return `rq-requirement-discussion-v1:${projectId}`;
}

// RQ DISCUSION PROCESAMIENTO PERSISTENTE NAVEGACION V1
function processingStorageKey(projectId: string): string {
  return `rq-requirement-discussion-processing-v1:${projectId}`;
}

function parseStoredProcessingState(
  raw: string | null,
): DiscussionProcessingState {
  if (!raw) return EMPTY_PROCESSING_STATE;

  try {
    const stored = JSON.parse(raw) as Partial<DiscussionProcessingState>;
    const validStatuses: readonly DiscussionProcessingState["status"][] = [
      "idle",
      "running",
      "stopping",
      "completed",
      "cancelled",
      "failed",
    ];

    if (
      !stored.status ||
      !validStatuses.includes(stored.status) ||
      typeof stored.progress !== "number" ||
      typeof stored.completedEngines !== "number" ||
      typeof stored.totalEngines !== "number" ||
      typeof stored.reprocessing !== "boolean" ||
      typeof stored.message !== "string"
    ) {
      return EMPTY_PROCESSING_STATE;
    }

    return {
      status: stored.status,
      progress: Math.max(0, Math.min(100, Math.round(stored.progress))),
      completedEngines: Math.max(0, Math.round(stored.completedEngines)),
      totalEngines: Math.max(0, Math.round(stored.totalEngines)),
      reprocessing: stored.reprocessing,
      message: stored.message,
    };
  } catch {
    return EMPTY_PROCESSING_STATE;
  }
}

function persistProcessingState(
  projectId: string,
  processingState: DiscussionProcessingState,
): void {
  window.localStorage.setItem(
    processingStorageKey(projectId),
    JSON.stringify(processingState),
  );
}

function parsedProcessedResult(
  candidate: unknown,
  validQuestionIds: ReadonlySet<string>,
): ProcessedDiscussionResult | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const result = candidate as Partial<ProcessedDiscussionResult>;
  if (
    !result.answers ||
    typeof result.answers !== "object" ||
    typeof result.processedAt !== "string" ||
    typeof result.model !== "string" ||
    (result.provider !== "LOCAL" &&
      result.provider !== "CLOUD" &&
      result.provider !== "FAKE")
  ) {
    return null;
  }
  return {
    answers: Object.fromEntries(
      Object.entries(result.answers)
        .filter(
          (entry): entry is [string, string] =>
            validQuestionIds.has(entry[0]) && typeof entry[1] === "string",
        )
        .map(([key, value]) => [key, value.slice(0, ANSWER_LIMIT)]),
    ),
    processedAt: result.processedAt,
    provider: result.provider,
    model: result.model,
  };
}

function parseStoredState(raw: string | null): DiscussionState {
  if (!raw) return emptyState();
  try {
    const stored = JSON.parse(raw) as Partial<DiscussionState> &
      LegacyDiscussionState;
    const answers = emptyAnswers();
    const validQuestionIds = new Set(Object.keys(answers));
    for (const questionId of Object.keys(answers)) {
      const candidate = stored.answers?.[questionId];
      if (!candidate) continue;
      answers[questionId] = {
        answer:
          typeof candidate.answer === "string"
            ? candidate.answer.slice(0, ANSWER_LIMIT)
            : "",
        score:
          Number.isInteger(candidate.score) &&
          candidate.score >= 1 &&
          candidate.score <= 10
            ? candidate.score
            : 1,
      };
    }
    let localResult = parsedProcessedResult(
      stored.localResult,
      validQuestionIds,
    );
    let cloudResult = parsedProcessedResult(
      stored.cloudResult,
      validQuestionIds,
    );
    if (
      !localResult &&
      !cloudResult &&
      stored.processedAnswers &&
      typeof stored.processedAnswers === "object"
    ) {
      const migrated = parsedProcessedResult(
        {
          answers: stored.processedAnswers,
          processedAt: stored.processedAt ?? new Date(0).toISOString(),
          provider: stored.provider ?? "FAKE",
          model: stored.model ?? "modelo anterior",
        },
        validQuestionIds,
      );
      if (stored.provider === "CLOUD") cloudResult = migrated;
      else localResult = migrated;
    }

    const selectedAnswers =
      stored.selectedAnswers && typeof stored.selectedAnswers === "object"
        ? Object.fromEntries(
            Object.entries(stored.selectedAnswers).filter(
              (entry): entry is [string, DiscussionAnswerOrigin] =>
                validQuestionIds.has(entry[0]) &&
                (entry[1] === "ORIGINAL" ||
                  entry[1] === "LOCAL" ||
                  entry[1] === "CLOUD"),
            ),
          )
        : {};

    return {
      answers,
      conversation:
        typeof stored.conversation === "string"
          ? stored.conversation.slice(0, CONVERSATION_LIMIT)
          : "",
      needsPrototype:
        typeof stored.needsPrototype === "boolean"
          ? stored.needsPrototype
          : stored.solutionType === "PROTOTYPE"
            ? true
            : typeof stored.solutionType === "string" && stored.solutionType
              ? false
              : null,
      localResult,
      cloudResult,
      selectedAnswers,
      includeConversation: stored.includeConversation === true,
      sourceId: typeof stored.sourceId === "string" ? stored.sourceId : null,
    };
  } catch {
    return emptyState();
  }
}

function prototypeRequirementAnswer(state: DiscussionState): string {
  if (state.needsPrototype === true) return "Sí";
  if (state.needsPrototype === false) return "No";
  return "";
}

async function parseError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `La solicitud no pudo completarse (${response.status}).`;
  try {
    const payload = JSON.parse(text) as Readonly<Record<string, unknown>>;
    const message = payload.message ?? payload.detail ?? payload.title;
    if (typeof message === "string" && message.trim()) return message.trim();
  } catch {
    return text;
  }
  return `La solicitud no pudo completarse (${response.status}).`;
}

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${GATEWAY_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(options?.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (response.status === 401) {
    window.location.assign("/sign-in");
    throw new Error("Sesión vencida.");
  }
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as T;
}

function selectedAnswer(
  state: DiscussionState,
  questionId: string,
): { origin: string; answer: string } | null {
  const selected = state.selectedAnswers[questionId];
  const answer =
    selected === "ORIGINAL"
      ? state.answers[questionId]?.answer.trim()
      : selected === "LOCAL"
        ? state.localResult?.answers[questionId]?.trim()
        : selected === "CLOUD"
          ? state.cloudResult?.answers[questionId]?.trim()
          : "";
  if (!selected || !answer) return null;
  return {
    origin:
      selected === "ORIGINAL"
        ? "Respuesta original"
        : selected === "LOCAL"
          ? "IA local"
          : "IA nube",
    answer,
  };
}

function discussionEvidence(project: ProjectDetail, state: DiscussionState) {
  return [
    "RESPUESTAS SELECCIONADAS PARA EL LEVANTAMIENTO",
    `Proyecto: ${project.code} · ${project.title}`,
    ...REQUIREMENTS_QUESTIONNAIRE.flatMap((section) => {
      const selectedQuestions = section.questions.flatMap((question) => {
        const selected = selectedAnswer(state, question.id);
        if (!selected) return [];
        const score = state.answers[question.id]?.score ?? 1;
        return [
          `Pregunta: ${question.text}`,
          `Origen seleccionado: ${selected.origin}`,
          `Valoración: ${score}/10`,
          `Respuesta: ${selected.answer}`,
        ];
      });
      return selectedQuestions.length > 0
        ? [
            "",
            `${section.number}. ${section.title}`,
            section.objective,
            ...selectedQuestions,
          ]
        : [];
    }),
    ...(prototypeRequirementAnswer(state)
      ? [
          "",
          "PREGUNTA COMPLEMENTARIA · PROTOTIPO",
          `Pregunta: ${PROTOTYPE_REQUIREMENT_QUESTION}`,
          `Respuesta: ${prototypeRequirementAnswer(state)}`,
        ]
      : []),
    ...(state.includeConversation && state.conversation.trim()
      ? ["", "CONVERSACIÓN COMPLETA SELECCIONADA", state.conversation.trim()]
      : []),
  ].join("\n");
}

function providerLabel(
  provider: ProcessRequirementDiscussionResponse["provider"] | null,
): string {
  if (provider === "LOCAL") return "IA local";
  if (provider === "CLOUD") return "IA nube";
  if (provider === "FAKE") return "Modo de prueba";
  return "Sin procesar";
}

function hasDiscussionContent(state: DiscussionState): boolean {
  return (
    Boolean(prototypeRequirementAnswer(state)) ||
    Boolean(state.conversation.trim()) ||
    Object.values(state.answers).some((answer) =>
      Boolean(answer.answer.trim()),
    ) ||
    Object.values(state.localResult?.answers ?? {}).some((answer) =>
      Boolean(answer.trim()),
    ) ||
    Object.values(state.cloudResult?.answers ?? {}).some((answer) =>
      Boolean(answer.trim()),
    )
  );
}

export function RequirementDiscussionWorkspace({
  project,
  projects,
  viability,
}: {
  project: ProjectDetail;
  projects: readonly ProjectSummary[];
  viability?: ViabilityConfiguration;
}) {
  const router = useRouter();
  const [state, setState] = useState<DiscussionState>(emptyState);
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<"CAPTURE" | "PROCESSED">("CAPTURE");
  const [openQuestionSectionId, setOpenQuestionSectionId] = useState(
    () => REQUIREMENTS_QUESTIONNAIRE[0]?.id ?? "",
  );
  const [savingSource, setSavingSource] = useState(false);
  const [processingAi, setProcessingAi] = useState(false);
  const [processingState, setProcessingState] =
    useState<DiscussionProcessingState>(EMPTY_PROCESSING_STATE);
  const processingAbortRef = useRef<AbortController | null>(null);
  const lifecycleStartedRef = useRef(project.status !== "DRAFT");
  const aiEngines = useAiEngineSelection(project.id, "discussion");
  const [selectionMode, setSelectionMode] = useState(false);
  const [alert, setAlert] = useState<AlertState | null>(null);
  useAutoDismiss(alert, () => setAlert(null));

  useEffect(() => {
    const storedProcessing = parseStoredProcessingState(
      window.localStorage.getItem(processingStorageKey(project.id)),
    );
    setProcessingState(storedProcessing);
    setProcessingAi(
      storedProcessing.status === "running" ||
        storedProcessing.status === "stopping",
    );
    if (storedProcessing.status === "completed") {
      setTab("PROCESSED");
    }
  }, [project.id]);

  useEffect(() => {
    if (processingState.status !== "running") return;

    const interval = window.setInterval(() => {
      setProcessingState((current) => {
        const persisted = parseStoredProcessingState(
          window.localStorage.getItem(processingStorageKey(project.id)),
        );

        if (
          persisted.status === "completed" ||
          persisted.status === "cancelled" ||
          persisted.status === "failed"
        ) {
          return persisted;
        }

        if (current.status !== "running" || current.progress >= 85) {
          return current;
        }

        const nextProcessingState: DiscussionProcessingState = {
          ...current,
          progress: Math.min(85, current.progress + 4),
          message:
            current.progress < 35
              ? "Analizando la evidencia disponible…"
              : current.progress < 65
                ? "Consolidando respuestas por pregunta…"
                : "Redactando el borrador interpretado por IA…",
        };
        persistProcessingState(project.id, nextProcessingState);
        return nextProcessingState;
      });
    }, 700);

    return () => window.clearInterval(interval);
  }, [processingState.status, project.id]);

  useEffect(() => {
    if (
      processingState.status !== "running" &&
      processingState.status !== "stopping"
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      const persistedProcessing = parseStoredProcessingState(
        window.localStorage.getItem(processingStorageKey(project.id)),
      );

      if (
        persistedProcessing.status === "completed" ||
        persistedProcessing.status === "cancelled" ||
        persistedProcessing.status === "failed"
      ) {
        setProcessingState(persistedProcessing);
        setProcessingAi(false);
        setState(
          parseStoredState(window.localStorage.getItem(storageKey(project.id))),
        );
        if (persistedProcessing.status === "completed") {
          setTab("PROCESSED");
        }
      }
    }, 500);

    return () => window.clearInterval(interval);
  }, [processingState.status, project.id]);

  useEffect(() => {
    let active = true;
    const stored = parseStoredState(
      window.localStorage.getItem(storageKey(project.id)),
    );
    const query = new URLSearchParams({
      page: "1",
      pageSize: "50",
      sourceType: "CONVERSATION",
      status: "ACTIVE",
    });
    void requestJson<SourceListResponse>(
      `/api/v1/projects/${encodeURIComponent(project.id)}/sources?${query.toString()}`,
    )
      .then((sources) => {
        const title = `Preguntas de análisis · ${project.code}`;
        const existing = sources.items.find((source) => source.title === title);
        if (active) {
          setState({ ...stored, sourceId: existing?.id ?? null });
        }
      })
      .catch(() => {
        if (active) setState(stored);
      })
      .finally(() => {
        if (active) setHydrated(true);
      });

    return () => {
      active = false;
    };
  }, [project.code, project.id]);

  const latestStateRef = useRef(state);
  latestStateRef.current = state;

  const [comparisonColumns, setComparisonColumns] = useState<number[]>(
    DEFAULT_COMPARISON_COLUMNS,
  );

  useEffect(() => {
    try {
      const stored = JSON.parse(
        window.localStorage.getItem("rq-discussion-comparison-columns-v1") ??
          "null",
      ) as unknown;
      if (
        Array.isArray(stored) &&
        stored.length === 4 &&
        stored.every((value) => typeof value === "number" && value > 0)
      )
        setComparisonColumns(stored as number[]);
    } catch {
      // Sin preferencia guardada: se usan los anchos predeterminados.
    }
  }, []);

  function startComparisonResize(
    event: ReactPointerEvent<HTMLElement>,
    boundary: number,
  ): void {
    const headings = event.currentTarget.closest(
      ".rq-discussion-processed__headings",
    );
    if (!headings) return;
    event.preventDefault();
    const widths = Array.from(headings.children)
      .filter((child) => child.tagName === "STRONG")
      .map((child) => child.getBoundingClientRect().width);
    if (widths.length !== 4) return;
    const total = widths.reduce((sum, width) => sum + width, 0);
    const startX = event.clientX;
    const minimum = 110;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const delta = Math.max(
        -(widths[boundary - 1] - minimum),
        Math.min(widths[boundary] - minimum, moveEvent.clientX - startX),
      );
      const next = [...widths];
      next[boundary - 1] += delta;
      next[boundary] -= delta;
      setComparisonColumns(next.map((width) => width / total));
    };
    const onEnd = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onEnd);
      target.removeEventListener("pointercancel", onEnd);
      try {
        window.localStorage.setItem(
          "rq-discussion-comparison-columns-v1",
          JSON.stringify(comparisonColumnsRef.current),
        );
      } catch {
        // La preferencia visual es opcional.
      }
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onEnd);
    target.addEventListener("pointercancel", onEnd);
  }
  const comparisonColumnsRef = useRef(comparisonColumns);
  comparisonColumnsRef.current = comparisonColumns;

  function resetComparisonColumns(): void {
    setComparisonColumns(DEFAULT_COMPARISON_COLUMNS);
    try {
      window.localStorage.removeItem("rq-discussion-comparison-columns-v1");
    } catch {
      // La preferencia visual es opcional.
    }
  }

  useEffect(() => {
    if (!hydrated) return;
    const flush = () =>
      window.localStorage.setItem(
        storageKey(project.id),
        JSON.stringify(latestStateRef.current),
      );
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [hydrated, project.id]);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = window.setTimeout(() => {
      window.localStorage.setItem(
        storageKey(project.id),
        JSON.stringify(state),
      );
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [hydrated, project.id, state]);

  useEffect(() => {
    if (
      !hydrated ||
      lifecycleStartedRef.current ||
      !hasDiscussionContent(state)
    )
      return;
    lifecycleStartedRef.current = true;
    void requestJson<ProjectDetail>(
      `/api/v1/projects/${encodeURIComponent(project.id)}`,
      { method: "PATCH", body: JSON.stringify({ status: "DISCUSSION" }) },
    ).catch(() => {
      lifecycleStartedRef.current = false;
    });
  }, [hydrated, project.id, state]);

  useEffect(() => {
    if (!alert) return;
    const timeout = window.setTimeout(() => setAlert(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [alert]);

  useEffect(() => {
    if (!aiEngines.error) return;
    setAlert({ tone: "danger", message: aiEngines.error });
  }, [aiEngines.error]);

  const allQuestions = useMemo(
    () => REQUIREMENTS_QUESTIONNAIRE.flatMap((section) => section.questions),
    [],
  );
  const answeredCount = allQuestions.filter((question) =>
    state.answers[question.id]?.answer.trim(),
  ).length;
  const localProcessedCount = allQuestions.filter((question) =>
    state.localResult?.answers[question.id]?.trim(),
  ).length;
  const cloudProcessedCount = allQuestions.filter((question) =>
    state.cloudResult?.answers[question.id]?.trim(),
  ).length;
  const processedCount = Math.max(localProcessedCount, cloudProcessedCount);
  const selectedCount = allQuestions.filter((question) =>
    selectedAnswer(state, question.id),
  ).length;
  const canSaveSelection =
    selectedCount > 0 ||
    Boolean(prototypeRequirementAnswer(state)) ||
    (state.includeConversation && Boolean(state.conversation.trim()));
  const evidence = (answers: Readonly<Record<string, string>> | undefined) =>
    Object.fromEntries(
      allQuestions.flatMap((question) => {
        const answer = answers?.[question.id];
        return typeof answer === "string"
          ? [
              [
                question.id,
                {
                  answer,
                  definitionPercentage: calculateAnswerDefinitionLevel(answer),
                },
              ],
            ]
          : [];
      }),
    );
  const manualEvidence = Object.fromEntries(
    allQuestions.map((question) => {
      const answer = state.answers[question.id] ?? { answer: "", score: 0 };
      return [
        question.id,
        { answer: answer.answer, definitionPercentage: answer.score * 10 },
      ];
    }),
  );
  const viabilitySummary = viability
    ? evaluateDiscussionViability({
        questionIds: allQuestions.map((item) => item.id),
        manual: manualEvidence,
        local: evidence(state.localResult?.answers),
        cloud: evidence(state.cloudResult?.answers),
        criteria: viability.criteria,
        discrepancyThreshold: viability.discrepancyThreshold,
      })
    : null;
  // Color del valor: verde si es viable, naranja si no lo es.
  const viabilityTone: "success" | "warning" | "neutral" = !viabilitySummary
    ? "neutral"
    : viabilitySummary.consolidated.evaluation.viable
      ? "success"
      : "warning";
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!moreOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        !event.target.closest(".rq-discussion-more")
      ) {
        setMoreOpen(false);
      }
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [moreOpen]);
  const answerViability = (answer: string, percentage: number) =>
    viability
      ? evaluateViability(
          isInsufficientDiscussionAnswer(answer) ? 0 : percentage,
          viability.criteria,
        )
      : null;

  function updateHumanAnswer(
    questionId: string,
    changes: Partial<HumanAnswer>,
  ): void {
    setState((current) => ({
      ...current,
      answers: {
        ...current.answers,
        [questionId]: {
          ...(current.answers[questionId] ?? { answer: "", score: 1 }),
          ...changes,
        },
      },
    }));
  }

  const persistDiscussionSource = useCallback(
    async (
      sourceState: DiscussionState,
    ): Promise<{ source: SourceDetail; updated: boolean }> => {
      const content = discussionEvidence(project, sourceState);
      if (content.length > 200_000) {
        throw new Error(
          "La fuente supera 200.000 caracteres. Reduce la conversación o las respuestas antes de guardarla.",
        );
      }

      const title = `Preguntas de análisis · ${project.code}`;
      const body = {
        sourceType: "CONVERSATION" as const,
        title,
        content,
      };
      const query = new URLSearchParams({
        page: "1",
        pageSize: "50",
        sourceType: "CONVERSATION",
        status: "ACTIVE",
        search: title,
      });
      const activeSources = await requestJson<SourceListResponse>(
        `/api/v1/projects/${encodeURIComponent(project.id)}/sources?${query.toString()}`,
      );
      const activeSource = activeSources.items.find(
        (source) => source.title === title,
      );

      if (activeSource) {
        const source = await requestJson<SourceDetail>(
          `/api/v1/projects/${encodeURIComponent(project.id)}/sources/${encodeURIComponent(activeSource.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              title: body.title,
              content: body.content,
            }),
          },
        );
        return { source, updated: true };
      }

      const source = await requestJson<SourceDetail>(
        `/api/v1/projects/${encodeURIComponent(project.id)}/sources`,
        { method: "POST", body: JSON.stringify(body) },
      );
      return { source, updated: false };
    },
    [project],
  );

  async function addToSources(): Promise<void> {
    if (!selectionMode) {
      if (!hasDiscussionContent(state)) {
        setAlert({
          tone: "information",
          message:
            "Escribe una respuesta, pega una conversación o procesa con IA antes de seleccionar contenido.",
        });
        return;
      }
      setSelectionMode(true);
      setTab("PROCESSED");
      setAlert({
        tone: "information",
        message:
          "Selecciona para cada pregunta la respuesta original, la IA local o la IA nube que deseas guardar.",
      });
      return;
    }
    if (!canSaveSelection) {
      setAlert({
        tone: "information",
        message:
          "Selecciona al menos una respuesta o la conversación completa antes de guardar la fuente.",
      });
      return;
    }
    setSavingSource(true);
    try {
      const { source, updated } = await persistDiscussionSource(state);
      let lifecycleUpdated = true;
      if (project.status === "DRAFT" || project.status === "DISCUSSION") {
        try {
          await requestJson<ProjectDetail>(
            `/api/v1/projects/${encodeURIComponent(project.id)}`,
            {
              method: "PATCH",
              body: JSON.stringify({ status: "SOURCES" }),
            },
          );
        } catch {
          lifecycleUpdated = false;
        }
      }
      setState((current) => ({ ...current, sourceId: source.id }));
      setSelectionMode(false);
      setAlert({
        tone: lifecycleUpdated ? "success" : "information",
        message: lifecycleUpdated
          ? updated
            ? `La fuente fue actualizada con ${selectedCount} respuesta(s) seleccionada(s).`
            : `Se agregó a Fuentes una selección de ${selectedCount} respuesta(s) y el proyecto pasó a elaboración.`
          : "La discusión quedó guardada en Fuentes, pero el estado del proyecto no pudo actualizarse.",
      });
    } catch (error) {
      setAlert({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible agregar la discusión a Fuentes.",
      });
    } finally {
      setSavingSource(false);
    }
  }

  function toggleSelectedAnswer(
    questionId: string,
    origin: DiscussionAnswerOrigin,
  ): void {
    setState((current) => {
      const next = { ...current.selectedAnswers };
      if (next[questionId] === origin) delete next[questionId];
      else next[questionId] = origin;
      return { ...current, selectedAnswers: next };
    });
  }

  function selectSectionAnswers(
    questionIds: readonly string[],
    origin: DiscussionAnswerOrigin | null,
  ): void {
    setState((current) => {
      const next = { ...current.selectedAnswers };

      for (const questionId of questionIds) {
        if (origin === null) {
          delete next[questionId];
          continue;
        }

        const answer =
          origin === "ORIGINAL"
            ? current.answers[questionId]?.answer
            : origin === "LOCAL"
              ? current.localResult?.answers[questionId]
              : current.cloudResult?.answers[questionId];

        if (answer?.trim()) next[questionId] = origin;
        else delete next[questionId];
      }

      return { ...current, selectedAnswers: next };
    });
  }

  function updateProcessedAnswer(
    engine: RequirementDiscussionEngine,
    questionId: string,
    answer: string,
  ): void {
    setState((current) => {
      const key = engine === "LOCAL" ? "localResult" : "cloudResult";
      const result = current[key];
      if (!result) return current;
      return {
        ...current,
        [key]: {
          ...result,
          answers: { ...result.answers, [questionId]: answer },
        },
      };
    });
  }

  function updatePrototypeRequirement(value: boolean | null): void {
    window.localStorage.removeItem(
      `rq-prototype-processing-override-v2:${project.id}`,
    );
    setState((current) => ({ ...current, needsPrototype: value }));
  }

  async function processWithAi(): Promise<void> {
    if (
      !state.conversation.trim() &&
      answeredCount === 0 &&
      !prototypeRequirementAnswer(state)
    ) {
      setAlert({
        tone: "information",
        message:
          "Escribe una respuesta o pega una conversación antes de procesar.",
      });
      return;
    }

    if (aiEngines.engines.length === 0) {
      setAlert({
        tone: "information",
        message: "Enciende la IA local, la IA nube o ambas antes de procesar.",
      });
      return;
    }

    setProcessingAi(true);

    const controller = new AbortController();
    processingAbortRef.current?.abort();
    processingAbortRef.current = controller;

    const reprocessing = Boolean(state.localResult || state.cloudResult);
    const totalEngines = aiEngines.engines.length;

    const runningProcessingState: DiscussionProcessingState = {
      status: "running",
      progress: 5,
      completedEngines: 0,
      totalEngines,
      reprocessing,
      message: reprocessing
        ? "Preparando el reprocesamiento de las respuestas…"
        : "Preparando las respuestas y la conversación…",
    };

    persistProcessingState(project.id, runningProcessingState);
    setProcessingState(runningProcessingState);

    const payload = {
      answers: allQuestions.map((question) => ({
        questionId: question.id,
        question: question.text,
        answer: state.answers[question.id]?.answer ?? "",
        score: state.answers[question.id]?.score ?? 1,
      })),
      conversation: [
        prototypeRequirementAnswer(state)
          ? `PREGUNTA COMPLEMENTARIA · PROTOTIPO\nPregunta: ${PROTOTYPE_REQUIREMENT_QUESTION}\nRespuesta: ${prototypeRequirementAnswer(state)}`
          : "",
        state.conversation,
      ]
        .filter(Boolean)
        .join("\n\n"),
    };

    let completedEngines = 0;

    const runEngine = async (
      engine: RequirementDiscussionEngine,
    ): Promise<{
      engine: RequirementDiscussionEngine;
      result: ProcessRequirementDiscussionResponse;
    }> => {
      const engineController = new AbortController();
      let timedOut = false;

      const abortFromMainController = () => engineController.abort();
      controller.signal.addEventListener("abort", abortFromMainController, {
        once: true,
      });

      let timeout = 0;

      try {
        const request = requestJson<ProcessRequirementDiscussionResponse>(
          `/api/v1/projects/${encodeURIComponent(project.id)}/analysis-requests/discussion/process`,
          {
            method: "POST",
            body: JSON.stringify({
              ...payload,
              engine,
              providerConfigurationId: aiEngines.providerSelections?.[engine],
            }),
            signal: engineController.signal,
          },
        );
        const deadline = new Promise<never>((_, reject) => {
          timeout = window.setTimeout(() => {
            timedOut = true;
            engineController.abort();
            reject(
              new Error(
                `${engine === "LOCAL" ? "La IA local" : "La IA nube"} excedió el tiempo máximo de 5 minutos.`,
              ),
            );
          }, DISCUSSION_ENGINE_TIMEOUT_MS);
        });
        const result = await Promise.race([request, deadline]);

        const processedResult: ProcessedDiscussionResult = {
          answers: Object.fromEntries(
            result.answers.map((answer) => [answer.questionId, answer.answer]),
          ),
          processedAt: new Date().toISOString(),
          provider: result.provider,
          model: result.model,
        };

        const resultKey = engine === "LOCAL" ? "localResult" : "cloudResult";

        /*
         * Guarda el resultado inmediatamente. Así un motor terminado
         * no depende de que el segundo motor también finalice.
         */
        const latestStoredState = parseStoredState(
          window.localStorage.getItem(storageKey(project.id)),
        );

        window.localStorage.setItem(
          storageKey(project.id),
          JSON.stringify({
            ...latestStoredState,
            [resultKey]: processedResult,
          }),
        );

        setState((current) => ({
          ...current,
          [resultKey]: processedResult,
        }));
        setTab("PROCESSED");

        return { engine, result };
      } catch (error) {
        if (controller.signal.aborted) {
          throw error;
        }

        if (timedOut) {
          throw new Error(
            `${
              engine === "LOCAL" ? "La IA local" : "La IA nube"
            } excedió el tiempo máximo de 5 minutos.`,
          );
        }

        throw error;
      } finally {
        window.clearTimeout(timeout);
        controller.signal.removeEventListener("abort", abortFromMainController);

        completedEngines += 1;

        const currentProcessing = parseStoredProcessingState(
          window.localStorage.getItem(processingStorageKey(project.id)),
        );

        if (
          currentProcessing.status === "running" &&
          !controller.signal.aborted
        ) {
          const engineProgress = Math.round(
            (completedEngines / totalEngines) * 90,
          );

          const nextProcessingState: DiscussionProcessingState = {
            ...currentProcessing,
            completedEngines,
            progress: Math.max(currentProcessing.progress, engineProgress),
            message:
              completedEngines < totalEngines
                ? `${completedEngines} de ${totalEngines} motor(es) terminaron. Esperando el motor restante…`
                : "Finalizando los resultados generados…",
          };

          persistProcessingState(project.id, nextProcessingState);
          setProcessingState(nextProcessingState);
        }
      }
    };

    try {
      const results = await Promise.allSettled(
        aiEngines.engines.map((engine) => runEngine(engine)),
      );

      /*
       * stopProcessing() V1.1 es quien finaliza el estado cancelado.
       * No lo sobrescribimos aquí.
       */
      if (controller.signal.aborted) {
        return;
      }

      const succeeded = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );

      const failed = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );

      if (succeeded.length === 0) {
        const currentProcessing = parseStoredProcessingState(
          window.localStorage.getItem(processingStorageKey(project.id)),
        );

        const failedProcessingState: DiscussionProcessingState = {
          ...currentProcessing,
          status: "failed",
          progress: Math.max(currentProcessing.progress, 90),
          completedEngines: totalEngines,
          totalEngines,
          reprocessing,
          message: "El procesamiento no pudo finalizar.",
        };

        persistProcessingState(project.id, failedProcessingState);
        setProcessingState(failedProcessingState);

        throw failed[0] ?? new Error("No fue posible procesar la discusión.");
      }

      const completedProcessingState: DiscussionProcessingState = {
        status: "completed",
        progress: 100,
        completedEngines: totalEngines,
        totalEngines,
        reprocessing,
        message:
          failed.length > 0
            ? `Procesamiento finalizado: ${succeeded.length} motor(es) completaron y ${failed.length} fallaron.`
            : `100% procesado con ${succeeded.length} motor(es) de IA.`,
      };

      persistProcessingState(project.id, completedProcessingState);
      setProcessingState(completedProcessingState);
      setTab("PROCESSED");

      setAlert({
        tone: failed.length > 0 ? "danger" : "success",
        message:
          failed.length > 0
            ? `Se conservó el resultado de ${succeeded.length} motor(es). ${failed.length} motor(es) fallaron o excedieron el tiempo límite: ${
                failed[0] instanceof Error
                  ? failed[0].message
                  : "error no identificado"
              }`
            : `Se generaron ${succeeded.length} borrador(es) con los motores encendidos. Ya puedes comparar y seleccionar respuestas.`,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      setAlert({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible procesar la discusión con IA.",
      });
    } finally {
      if (processingAbortRef.current === controller) {
        processingAbortRef.current = null;
      }
      setProcessingAi(false);
    }
  }

  // RQ DISCUSION DETENER PROCESAMIENTO V1.1
  async function stopProcessing(): Promise<void> {
    const currentProcessing = parseStoredProcessingState(
      window.localStorage.getItem(processingStorageKey(project.id)),
    );

    if (
      currentProcessing.status !== "running" &&
      currentProcessing.status !== "stopping"
    ) {
      return;
    }

    const stoppingProcessingState: DiscussionProcessingState = {
      ...currentProcessing,
      status: "stopping",
      message: "Deteniendo el procesamiento…",
    };
    persistProcessingState(project.id, stoppingProcessingState);
    setProcessingState(stoppingProcessingState);

    processingAbortRef.current?.abort();

    try {
      await requestJson<{ cancelled: number }>(
        `/api/v1/projects/${encodeURIComponent(project.id)}/analysis-requests/discussion/cancel`,
        { method: "POST" },
      );

      const latestProcessing = parseStoredProcessingState(
        window.localStorage.getItem(processingStorageKey(project.id)),
      );

      if (latestProcessing.status === "completed") {
        setProcessingState(latestProcessing);
        setProcessingAi(false);
        setState(
          parseStoredState(window.localStorage.getItem(storageKey(project.id))),
        );
        setTab("PROCESSED");
        return;
      }

      const cancelledProcessingState: DiscussionProcessingState = {
        ...latestProcessing,
        status: "cancelled",
        message:
          "Procesamiento detenido. Las respuestas anteriores se conservaron.",
      };

      persistProcessingState(project.id, cancelledProcessingState);
      setProcessingState(cancelledProcessingState);
      setProcessingAi(false);
      setAlert({
        tone: "information",
        message: "El procesamiento con IA fue detenido.",
      });
    } catch (error) {
      const latestProcessing = parseStoredProcessingState(
        window.localStorage.getItem(processingStorageKey(project.id)),
      );

      if (latestProcessing.status === "completed") {
        setProcessingState(latestProcessing);
        setProcessingAi(false);
        setState(
          parseStoredState(window.localStorage.getItem(storageKey(project.id))),
        );
        setTab("PROCESSED");
        return;
      }

      const failedStopState: DiscussionProcessingState = {
        ...latestProcessing,
        status: "failed",
        message: "No fue posible confirmar la detención del procesamiento.",
      };

      persistProcessingState(project.id, failedStopState);
      setProcessingState(failedStopState);
      setProcessingAi(false);
      setAlert({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible detener el procesamiento con IA.",
      });
    }
  }

  return (
    <div className="rq-discussion-workspace">
      {alert ? (
        <div className="rq-project-alert" data-tone={alert.tone} role="status">
          <span>{alert.message}</span>
          <button
            aria-label="Cerrar mensaje"
            onClick={() => setAlert(null)}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}

      <section
        aria-label="Indicadores y acciones de discusión"
        className="rq-module-commandbar rq-discussion-commandbar"
      >
        <RqKpiGrid label="Indicadores de discusión">
          <RqKpiCard
            description="Capturadas / total"
            icon={<WorkspaceKpiIcon name="answers" />}
            title="Respuestas"
            value={`${answeredCount}/${allQuestions.length}`}
          />
          <RqKpiCard
            description={
              viabilitySummary
                ? `Manual ${viabilitySummary.manual.definitionPercentage}% · Local ${viabilitySummary.local.definitionPercentage}% · Nube ${viabilitySummary.cloud.definitionPercentage}%`
                : "Sin criterios configurados"
            }
            icon={<WorkspaceKpiIcon name="progress" />}
            title="Viabilidad"
            value={
              viabilitySummary
                ? `${viabilitySummary.consolidated.definitionPercentage}%`
                : "—"
            }
            valueTone={viabilityTone}
          />
          <RqKpiCard
            description={
              viabilitySummary
                ? `${viabilitySummary.consolidated.usable}/${allQuestions.length} útiles · ${
                    viabilitySummary.local.requiresReview +
                    viabilitySummary.cloud.requiresReview
                  } por revisar${
                    viabilitySummary.hasSignificantDiscrepancy
                      ? ` · discrepancia ${viabilitySummary.discrepancyPoints} ptos.`
                      : ""
                  }`
                : "Evaluación no disponible"
            }
            icon={<WorkspaceKpiIcon name="viable" />}
            title="Clasificación"
            value={
              viabilitySummary
                ? `${viabilitySummary.consolidated.evaluation.name} · ${
                    viabilitySummary.consolidated.evaluation.viable
                      ? "Viable"
                      : "No viable"
                  }`
                : "—"
            }
            valueTone={viabilityTone}
          />
        </RqKpiGrid>

        <div className="rq-module-commandbar__actions rq-discussion-toolbar__control-area">
          <AiProcessingMenu
            includePrototype={state.needsPrototype === true}
            label="IA"
            togglePrototype={() =>
              updatePrototypeRequirement(state.needsPrototype !== true)
            }
            providerSelections={aiEngines.providerSelections}
            selectProvider={aiEngines.selectProvider}
            capabilities={aiEngines.capabilities}
            locked={processingAi}
            loading={aiEngines.loading}
            selection={aiEngines.selection}
            toggle={aiEngines.toggle}
          />

          <RqActionButton
            disabled={
              processingAi
                ? processingState.status === "stopping"
                : aiEngines.loading ||
                  aiEngines.engines.length === 0 ||
                  savingSource
            }
            onClick={processingAi ? stopProcessing : () => void processWithAi()}
            tone={processingAi ? "danger" : "operation"}
          >
            {processingAi
              ? processingState.status === "stopping"
                ? "Deteniendo…"
                : "Cancelar procesamiento"
              : "Generar borrador"}
          </RqActionButton>

          <div
            className="rq-projects-menu rq-discussion-more"
            onBlur={(event) => {
              // Al perder el foco el menú se minimiza.
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              ) {
                setMoreOpen(false);
              }
            }}
          >
            <button
              aria-controls="rq-discussion-more-panel"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-label="Más acciones de la discusión"
              className="rq-projects-menu__trigger"
              onClick={() => setMoreOpen((current) => !current)}
              title="Más acciones"
              type="button"
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="20"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="20"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            {moreOpen ? (
              <div
                className="rq-projects-menu__panel"
                id="rq-discussion-more-panel"
                role="menu"
              >
                <button
                  disabled={savingSource || processingAi}
                  onClick={() => {
                    setMoreOpen(false);
                    void addToSources();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    fill="none"
                    height="18"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                    viewBox="0 0 24 24"
                    width="18"
                  >
                    {selectionMode ? (
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    ) : state.sourceId ? (
                      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4" />
                    ) : (
                      <path d="M12 5v14M5 12h14" />
                    )}
                  </svg>
                  <span>
                    {savingSource
                      ? "Guardando…"
                      : selectionMode
                        ? state.sourceId
                          ? "Actualizar fuente seleccionada"
                          : "Guardar selección en Fuentes"
                        : state.sourceId
                          ? "Seleccionar para actualizar"
                          : "Agregar a fuentes"}
                  </span>
                </button>
                {selectionMode ? (
                  <button
                    disabled={savingSource}
                    onClick={() => {
                      setMoreOpen(false);
                      setSelectionMode(false);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <svg
                      aria-hidden="true"
                      fill="none"
                      height="18"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeWidth="1.8"
                      viewBox="0 0 24 24"
                      width="18"
                    >
                      <path d="m6 6 12 12M18 6 6 18" />
                    </svg>
                    <span>Cancelar selección</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div className="rq-discussion-context-row">
        <div className="rq-discussion-context-main">
          <label className="rq-projects-filter rq-discussion-project-filter">
            <span>Proyecto:</span>
            <select
              aria-label="Proyecto seleccionado"
              id="discussion-project"
              onChange={(event) =>
                router.push(
                  `/workspace/projects/${encodeURIComponent(event.target.value)}/discussion`,
                )
              }
              value={project.id}
            >
              {projects.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.code} · {candidate.title}
                </option>
              ))}
            </select>
          </label>

          <div className="rq-discussion-tabs" role="tablist">
            <button
              aria-controls="rq-discussion-panel"
              aria-selected={tab === "CAPTURE"}
              id="rq-discussion-tab-CAPTURE"
              onClick={() => setTab("CAPTURE")}
              role="tab"
              type="button"
            >
              Mi levantamiento
            </button>
            <button
              aria-controls="rq-discussion-panel"
              aria-selected={tab === "PROCESSED"}
              id="rq-discussion-tab-PROCESSED"
              onClick={() => setTab("PROCESSED")}
              role="tab"
              type="button"
            >
              Procesado con IA
              {processedCount > 0 ? <span>{processedCount}</span> : null}
            </button>
          </div>
        </div>

        <section
          aria-live="polite"
          className="rq-discussion-processing"
          data-status={processingState.status}
        >
          <div className="rq-discussion-processing__content">
            <header>
              <strong>
                {processingState.reprocessing ||
                state.localResult ||
                state.cloudResult
                  ? "Reprocesamiento con IA"
                  : "Procesamiento con IA"}
              </strong>
              <p>
                {processingState.status === "idle"
                  ? "Listo para procesar."
                  : processingState.message}
              </p>
              <span>{processingState.progress}%</span>
            </header>
            <progress max="100" value={processingState.progress}>
              {processingState.progress}%
            </progress>
          </div>
        </section>
      </div>

      {tab === "CAPTURE" ? (
        <section
          aria-labelledby="rq-discussion-tab-CAPTURE"
          className="rq-discussion-capture"
          id="rq-discussion-panel"
          role="tabpanel"
        >
          <div className="rq-discussion-questionnaire">
            <header className="rq-discussion-column-headings">
              <strong>Etapa y pregunta</strong>
              <strong>Respuesta editable y valoración</strong>
            </header>
            {REQUIREMENTS_QUESTIONNAIRE.map((section) => {
              const completed = section.questions.filter((question) =>
                state.answers[question.id]?.answer.trim(),
              ).length;
              return (
                <details
                  key={section.id}
                  open={openQuestionSectionId === section.id}
                >
                  <summary
                    onClick={(event) => {
                      event.preventDefault();
                      setOpenQuestionSectionId((current) =>
                        current === section.id ? "" : section.id,
                      );
                    }}
                  >
                    <span>
                      {section.number}. {section.title}
                    </span>
                    <small>
                      {completed}/{section.questions.length}
                    </small>
                  </summary>
                  <p>{section.objective}</p>
                  {section.questions.map((question, questionIndex) => {
                    const answer = state.answers[question.id] ?? {
                      answer: "",
                      score: 1,
                    };
                    return (
                      <div
                        className="rq-discussion-question-row"
                        key={question.id}
                      >
                        <div className="rq-discussion-question">
                          <span>Pregunta {questionIndex + 1}</span>
                          <p>{question.text}</p>
                        </div>
                        <div className="rq-discussion-answer">
                          <textarea
                            aria-label={`Respuesta a: ${question.text}`}
                            maxLength={ANSWER_LIMIT}
                            onChange={(event) =>
                              updateHumanAnswer(question.id, {
                                answer: event.target.value,
                              })
                            }
                            placeholder="Escribe la respuesta obtenida…"
                            rows={2}
                            value={answer.answer}
                          />
                          <div
                            aria-label="Nivel de definición"
                            className="rq-discussion-score"
                            role="radiogroup"
                          >
                            <span className="rq-discussion-score__label">
                              Nivel de definición
                            </span>
                            <div className="rq-discussion-score__scale">
                              {Array.from({ length: 10 }, (_, index) => {
                                const value = index + 1;
                                return (
                                  <button
                                    aria-checked={answer.score === value}
                                    aria-label={`Nivel ${value} de 10`}
                                    data-filled={value <= answer.score}
                                    key={value}
                                    onClick={() =>
                                      updateHumanAnswer(question.id, {
                                        score: value,
                                      })
                                    }
                                    role="radio"
                                    type="button"
                                  >
                                    {value}
                                  </button>
                                );
                              })}
                            </div>
                            <output>{answer.score}/10</output>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </details>
              );
            })}
          </div>

          <aside className="rq-discussion-conversation">
            <section className="rq-discussion-prototype-request">
              <header>
                <span>Pregunta complementaria · Prototipo</span>
                <small>No suma al 31</small>
              </header>
              <div className="rq-discussion-prototype-request__row">
                <p>{PROTOTYPE_REQUIREMENT_QUESTION}</p>
                <span className="rq-discussion-prototype-request__answer">
                  <button
                    aria-checked={state.needsPrototype === true}
                    aria-label={PROTOTYPE_REQUIREMENT_QUESTION}
                    className="rq-mini-switch"
                    onClick={() =>
                      updatePrototypeRequirement(state.needsPrototype !== true)
                    }
                    role="switch"
                    type="button"
                  >
                    <span aria-hidden="true" className="rq-mini-switch__knob">
                      {state.needsPrototype === true ? "✓" : ""}
                    </span>
                  </button>
                  <strong>
                    {state.needsPrototype === null
                      ? "Sin respuesta"
                      : state.needsPrototype
                        ? "Sí"
                        : "No"}
                  </strong>
                </span>
              </div>
              <small>
                Define el valor predeterminado de Prototipo en Fuentes y se
                envía a la IA como contexto.
              </small>
            </section>
            <header>
              <span>Conversación completa</span>
              <strong>Notas, reunión o transcripción</strong>
              <p>
                Pega aquí una conversación larga. La IA la leerá junto con las
                respuestas de cada pregunta.
              </p>
            </header>
            <textarea
              maxLength={CONVERSATION_LIMIT}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  conversation: event.target.value,
                }))
              }
              placeholder="Pega aquí la conversación completa…"
              value={state.conversation}
            />
            <small>
              {state.conversation.length.toLocaleString("es-CO")}/
              {CONVERSATION_LIMIT.toLocaleString("es-CO")}
            </small>
          </aside>
        </section>
      ) : (
        <section
          aria-labelledby="rq-discussion-tab-PROCESSED"
          className="rq-discussion-processed"
          id="rq-discussion-panel"
          role="tabpanel"
          style={
            {
              "--rq-cmp-cols": comparisonColumns
                .map((ratio) => `minmax(0, ${ratio}fr)`)
                .join(" "),
            } as CSSProperties
          }
        >
          <header className="rq-discussion-processed__header">
            <div>
              <h2>Comparación de respuestas</h2>
              <p>
                Compara la respuesta original, la propuesta local y la propuesta
                de nube. Los resultados de un motor no reemplazan a los del
                otro.
              </p>
            </div>
            <div className="rq-discussion-processed__metadata">
              <small>
                Manual {answeredCount}/{allQuestions.length} · IA local{" "}
                {localProcessedCount}/{allQuestions.length} · IA nube{" "}
                {cloudProcessedCount}/{allQuestions.length}
              </small>
              {state.localResult ? (
                <small>
                  {providerLabel(state.localResult.provider)} ·{" "}
                  {state.localResult.model} ·{" "}
                  {new Date(state.localResult.processedAt).toLocaleString(
                    "es-CO",
                  )}
                </small>
              ) : null}
              {state.cloudResult ? (
                <small>
                  {providerLabel(state.cloudResult.provider)} ·{" "}
                  {state.cloudResult.model} ·{" "}
                  {new Date(state.cloudResult.processedAt).toLocaleString(
                    "es-CO",
                  )}
                </small>
              ) : null}
            </div>
          </header>
          {selectionMode ? (
            <div className="rq-discussion-selection-banner" role="status">
              <div>
                <strong>Selecciona el contenido de la fuente</strong>
                <span>
                  Puedes elegir una alternativa por pregunta y, opcionalmente,
                  incluir la conversación completa.
                </span>
              </div>
              <strong>{selectedCount} respuesta(s) seleccionada(s)</strong>
            </div>
          ) : null}
          {!hasDiscussionContent(state) ? (
            <div className="rq-discussion-empty">
              <strong>Aún no hay evidencia para comparar.</strong>
              <span>
                Completa el levantamiento o pega una conversación antes de
                procesar con IA.
              </span>
            </div>
          ) : (
            <>
              <div className="rq-discussion-processed__headings">
                <strong>Pregunta</strong>
                <strong>
                  Respuesta original
                  <span
                    aria-hidden="true"
                    className="rq-cmp-resizer"
                    onDoubleClick={resetComparisonColumns}
                    onPointerDown={(event) => startComparisonResize(event, 1)}
                    title="Arrastra para ajustar el ancho (doble clic restablece)"
                  />
                </strong>
                <strong>
                  Respuesta IA local
                  <span
                    aria-hidden="true"
                    className="rq-cmp-resizer"
                    onDoubleClick={resetComparisonColumns}
                    onPointerDown={(event) => startComparisonResize(event, 2)}
                    title="Arrastra para ajustar el ancho (doble clic restablece)"
                  />
                </strong>
                <strong>
                  Respuesta IA nube
                  <span
                    aria-hidden="true"
                    className="rq-cmp-resizer"
                    onDoubleClick={resetComparisonColumns}
                    onPointerDown={(event) => startComparisonResize(event, 3)}
                    title="Arrastra para ajustar el ancho (doble clic restablece)"
                  />
                </strong>
              </div>
              {REQUIREMENTS_QUESTIONNAIRE.flatMap((section) => {
                const sectionQuestionIds = section.questions.map(
                  (question) => question.id,
                );
                const hasOriginalAnswers = sectionQuestionIds.some((id) =>
                  Boolean(state.answers[id]?.answer.trim()),
                );
                const hasLocalAnswers = sectionQuestionIds.some((id) =>
                  Boolean(state.localResult?.answers[id]?.trim()),
                );
                const hasCloudAnswers = sectionQuestionIds.some((id) =>
                  Boolean(state.cloudResult?.answers[id]?.trim()),
                );

                return [
                  <div
                    className="rq-discussion-processed__stage"
                    key={section.id}
                  >
                    <h3>
                      {section.number}. {section.title}
                    </h3>
                    {selectionMode ? (
                      <div
                        aria-label={`Selección por bloque: ${section.title}`}
                        className="rq-discussion-processed__stage-actions"
                        role="group"
                      >
                        <span>Seleccionar bloque:</span>
                        <RqActionButton
                          compact
                          disabled={!hasOriginalAnswers}
                          onClick={() =>
                            selectSectionAnswers(sectionQuestionIds, "ORIGINAL")
                          }
                          tone="consult"
                        >
                          Originales
                        </RqActionButton>
                        <RqActionButton
                          compact
                          disabled={!hasLocalAnswers}
                          onClick={() =>
                            selectSectionAnswers(sectionQuestionIds, "LOCAL")
                          }
                          tone="consult"
                        >
                          IA local
                        </RqActionButton>
                        <RqActionButton
                          compact
                          disabled={!hasCloudAnswers}
                          onClick={() =>
                            selectSectionAnswers(sectionQuestionIds, "CLOUD")
                          }
                          tone="consult"
                        >
                          IA nube
                        </RqActionButton>
                        <RqActionButton
                          compact
                          onClick={() =>
                            selectSectionAnswers(sectionQuestionIds, null)
                          }
                          tone="secondary"
                        >
                          Quitar
                        </RqActionButton>
                      </div>
                    ) : null}
                  </div>,
                  ...section.questions.map((question) => {
                    const human = state.answers[question.id] ?? {
                      answer: "",
                      score: 1,
                    };
                    const originalAnswer = human.answer.trim();
                    const localAnswer =
                      state.localResult?.answers[question.id] ?? "";
                    const cloudAnswer =
                      state.cloudResult?.answers[question.id] ?? "";
                    const originalEvaluation = answerViability(
                      originalAnswer,
                      human.score * 10,
                    );
                    const localEvaluation = answerViability(
                      localAnswer,
                      calculateAnswerDefinitionLevel(localAnswer),
                    );
                    const cloudEvaluation = answerViability(
                      cloudAnswer,
                      calculateAnswerDefinitionLevel(cloudAnswer),
                    );
                    return (
                      <article
                        className="rq-discussion-processed__row"
                        key={question.id}
                      >
                        <div>
                          <span>Pregunta</span>
                          <p>{question.text}</p>
                        </div>
                        <div
                          className="rq-discussion-answer-option rq-discussion-original-answer"
                          data-selected={
                            state.selectedAnswers[question.id] === "ORIGINAL"
                          }
                        >
                          <div className="rq-discussion-answer-option__heading">
                            {selectionMode && originalAnswer ? (
                              <label>
                                <input
                                  checked={
                                    state.selectedAnswers[question.id] ===
                                    "ORIGINAL"
                                  }
                                  onChange={() =>
                                    toggleSelectedAnswer(
                                      question.id,
                                      "ORIGINAL",
                                    )
                                  }
                                  type="checkbox"
                                />
                                Usar respuesta original
                              </label>
                            ) : (
                              <span>Definición {human.score}/10</span>
                            )}
                            {originalEvaluation ? (
                              <span
                                aria-label={
                                  originalEvaluation.viable
                                    ? "Respuesta viable"
                                    : "Respuesta no viable"
                                }
                                className="rq-discussion-viability-marker"
                                data-viable={originalEvaluation.viable}
                                role="img"
                                title={
                                  originalEvaluation.viable
                                    ? "Viable"
                                    : "No viable"
                                }
                              >
                                {originalEvaluation.viable ? "✓" : "×"}
                              </span>
                            ) : null}
                          </div>
                          <p>{originalAnswer || "Sin respuesta directa."}</p>
                        </div>
                        <div
                          className="rq-discussion-answer-option"
                          data-selected={
                            state.selectedAnswers[question.id] === "LOCAL"
                          }
                        >
                          <div className="rq-discussion-answer-option__heading">
                            <span>
                              Nivel de definición IA local:{" "}
                              {calculateAnswerDefinitionLevel(localAnswer)}%
                            </span>
                            {localEvaluation ? (
                              <span
                                aria-label={
                                  localEvaluation.viable
                                    ? "Respuesta viable"
                                    : "Respuesta no viable"
                                }
                                className="rq-discussion-viability-marker"
                                data-viable={localEvaluation.viable}
                                role="img"
                                title={
                                  localEvaluation.viable
                                    ? "Viable"
                                    : "No viable"
                                }
                              >
                                {localEvaluation.viable ? "✓" : "×"}
                              </span>
                            ) : null}
                          </div>
                          {selectionMode && localAnswer.trim() ? (
                            <label>
                              <input
                                checked={
                                  state.selectedAnswers[question.id] === "LOCAL"
                                }
                                onChange={() =>
                                  toggleSelectedAnswer(question.id, "LOCAL")
                                }
                                type="checkbox"
                              />
                              Usar IA local
                            </label>
                          ) : null}
                          {state.localResult ? (
                            <textarea
                              aria-label={`Respuesta de IA local para: ${question.text}`}
                              maxLength={ANSWER_LIMIT}
                              onChange={(event) =>
                                updateProcessedAnswer(
                                  "LOCAL",
                                  question.id,
                                  event.target.value,
                                )
                              }
                              rows={3}
                              value={localAnswer}
                            />
                          ) : (
                            <p>Sin procesar con IA local.</p>
                          )}
                        </div>
                        <div
                          className="rq-discussion-answer-option"
                          data-selected={
                            state.selectedAnswers[question.id] === "CLOUD"
                          }
                        >
                          <div className="rq-discussion-answer-option__heading">
                            <span>
                              Nivel de definición IA nube:{" "}
                              {calculateAnswerDefinitionLevel(cloudAnswer)}%
                            </span>
                            {cloudEvaluation ? (
                              <span
                                aria-label={
                                  cloudEvaluation.viable
                                    ? "Respuesta viable"
                                    : "Respuesta no viable"
                                }
                                className="rq-discussion-viability-marker"
                                data-viable={cloudEvaluation.viable}
                                role="img"
                                title={
                                  cloudEvaluation.viable
                                    ? "Viable"
                                    : "No viable"
                                }
                              >
                                {cloudEvaluation.viable ? "✓" : "×"}
                              </span>
                            ) : null}
                          </div>
                          {selectionMode && cloudAnswer.trim() ? (
                            <label>
                              <input
                                checked={
                                  state.selectedAnswers[question.id] === "CLOUD"
                                }
                                onChange={() =>
                                  toggleSelectedAnswer(question.id, "CLOUD")
                                }
                                type="checkbox"
                              />
                              Usar IA nube
                            </label>
                          ) : null}
                          {state.cloudResult ? (
                            <textarea
                              aria-label={`Respuesta de IA nube para: ${question.text}`}
                              maxLength={ANSWER_LIMIT}
                              onChange={(event) =>
                                updateProcessedAnswer(
                                  "CLOUD",
                                  question.id,
                                  event.target.value,
                                )
                              }
                              rows={3}
                              value={cloudAnswer}
                            />
                          ) : (
                            <p>Sin procesar con IA nube.</p>
                          )}
                        </div>
                      </article>
                    );
                  }),
                ];
              })}
              <div className="rq-discussion-processed__stage">
                <h3>Pregunta complementaria · Prototipo</h3>
                <small>No suma al 31</small>
              </div>
              <article className="rq-discussion-processed__row rq-discussion-processed__row--complementary">
                <div>
                  <span>Pregunta complementaria</span>
                  <p>{PROTOTYPE_REQUIREMENT_QUESTION}</p>
                </div>
                <div className="rq-discussion-answer-option rq-discussion-processed__complementary-answer">
                  <span>Respuesta seleccionada o escrita</span>
                  <p>
                    {prototypeRequirementAnswer(state) ||
                      "Sin respuesta seleccionada."}
                  </p>
                </div>
              </article>
              {state.conversation.trim() ? (
                <details
                  className="rq-discussion-processed__conversation"
                  open={selectionMode}
                >
                  <summary>
                    Conversación completa utilizada como evidencia
                  </summary>
                  {selectionMode ? (
                    <label>
                      <input
                        checked={state.includeConversation}
                        onChange={(event) =>
                          setState((current) => ({
                            ...current,
                            includeConversation: event.target.checked,
                          }))
                        }
                        type="checkbox"
                      />
                      Incluir la conversación completa en la fuente
                    </label>
                  ) : null}
                  <pre>{state.conversation}</pre>
                </details>
              ) : null}
            </>
          )}
        </section>
      )}

      <p className="rq-discussion-autosave" aria-live="polite">
        {hydrated
          ? state.sourceId
            ? "Guardado automático activo en este navegador. La selección confirmada ya existe en Fuentes."
            : "Guardado automático activo en este navegador. Fuentes solo recibirá el contenido que selecciones."
          : "Cargando discusión…"}
      </p>
    </div>
  );
}
