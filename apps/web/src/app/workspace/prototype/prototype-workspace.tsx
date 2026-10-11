"use client";

import type { ChangeEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PrototypeGeneratedImage,
  PrototypeAiOptions,
  PrototypeGenerationDetail,
  PrototypeImageActionResult,
  PrototypeImageGenerationResult,
  PrototypeImageProgress,
  PrototypePromptExport,
  PrototypePlan,
  PrototypePlanningResult,
  PrototypeScreenDetail,
  PrototypeScreenDetailResult,
  PrototypeTargetDevice,
  PrototypeVisualDevice,
  PrototypeVisualSpecification,
  PrototypeVisualSpecificationBuildResult,
} from "@levantamiento-rq/shared-contracts";
import {
  RqActionButton,
  RqKpiCard,
  RqKpiGrid,
  RqStatusBadge,
} from "@levantamiento-rq/shared-ui";
import { authenticatedFetch } from "../../authenticated-fetch";
import { downloadTextFile } from "../execution/azure-devops-csv";
import { ensureApprovedPrototypeDrafts } from "./prototype-drafts";
import { hasCompletedPrototypePlan } from "./prototype-plan-state";
import {
  buildPromptExportTxt,
  importPayload,
  promptExportFileName,
} from "./prototype-prompt-export";
import { WorkspaceKpiIcon } from "../workspace-kpi-icon";
import {
  adjacentScreenIndex,
  galleryDevices,
  orderPrototypeImages,
  PROTOTYPE_GENERATION_STORAGE_KEY,
  prototypeImageFileName,
  prototypeOriginLabel,
  selectedImageForDevice,
} from "./prototype-gallery";
import styles from "./prototype-gallery.module.css";
import {
  PROTOTYPE_FILE_ACCEPT,
  readPrototypeMarkdown,
  targetDeviceLabel,
} from "./prototype-source";
import { useAutoDismiss } from "../../use-auto-dismiss";
import { useConfirm } from "../../confirm-dialog";
import { useQueryState } from "../use-query-state";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");
const DEVICE_OPTIONS: Array<{
  value: PrototypeTargetDevice;
  title: string;
  description: string;
}> = [
  {
    value: "RESPONSIVE",
    title: "Web + móvil",
    description: "Una experiencia adaptable para ambos formatos.",
  },
  {
    value: "WEB",
    title: "Solo web",
    description: "Interfaz optimizada para escritorio y navegador.",
  },
  {
    value: "MOBILE",
    title: "Solo móvil",
    description: "Flujo enfocado en pantallas y gestos móviles.",
  },
];

export function PrototypeWorkspace() {
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const visualPipelineRef = useRef<string | null>(null);
  const [targetDevice, setTargetDevice] =
    useState<PrototypeTargetDevice>("RESPONSIVE");
  const [galleryDevice, setGalleryDevice] =
    useState<PrototypeVisualDevice>("WEB");
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [markdownContent, setMarkdownContent] = useState("");
  const [markdownSizeBytes, setMarkdownSizeBytes] = useState(0);
  const [, setMarkdownSha256] = useState<string | null>(null);
  const [generation, setGeneration] =
    useState<PrototypeGenerationDetail | null>(null);
  const [plan, setPlan] = useState<PrototypePlan | null>(null);
  const [visualResult, setVisualResult] =
    useState<PrototypeVisualSpecificationBuildResult | null>(null);
  const [images, setImages] = useState<PrototypeGeneratedImage[]>([]);
  const [imageObjectUrls, setImageObjectUrls] = useState<
    Record<string, string>
  >({});
  const [imageProgress, setImageProgress] =
    useState<PrototypeImageProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState("Preparando fuente…");
  const [error, setError] = useState<string | null>(null);
  useAutoDismiss(error, () => setError(null));
  const [progressError, setProgressError] = useState<string | null>(null);
  useAutoDismiss(progressError, () => setProgressError(null));
  const [recovering] = useState(false);
  const [aiOptions, setAiOptions] = useState<PrototypeAiOptions | null>(null);
  const [aiOptionsError, setAiOptionsError] = useState<string | null>(null);
  useAutoDismiss(aiOptionsError, () => setAiOptionsError(null));
  const [plannerConfigurationId, setPlannerConfigurationId] = useState("");
  const [imageConfigurationId, setImageConfigurationId] = useState("");
  // RQ_PROTOTYPE_PERSISTENT_TEXT_PROGRESS_V1_4
  const [resumingPlan, setResumingPlan] = useState(false);
  const [startingImages, setStartingImages] = useState(false);
  const [exportingPrompts, setExportingPrompts] = useState(false);
  // Permite detener el detalle por pantalla (una llamada de IA por pantalla, puede tardar minutos).
  const detailAbortRef = useRef<AbortController | null>(null);
  // Detalle de cada pantalla con la IA elegida: avance «n de N».
  const [detailProgress, setDetailProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [importingImages, setImportingImages] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  // RQ_PROTOTYPE_POINT3_TABS_V1_1
  const [previewTab, setPreviewTab] = useState<"TEXT" | "IMAGES">("TEXT");
  const [workspaceView, setWorkspaceViewState] = useState<"SOURCE" | "HISTORY">(
    "HISTORY",
  );
  // La vista de trabajo se refleja en la URL (?view=source): así la flecha lateral de «Volver»
  // regresa al listado sin necesitar un botón propio.
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view");
  const expectedViewParam = useRef<string | null>(null);
  const workspaceViewRef = useRef(workspaceView);
  function setWorkspaceView(next: "SOURCE" | "HISTORY") {
    expectedViewParam.current = next === "SOURCE" ? "source" : null;
    workspaceViewRef.current = next;
    const url = new URL(window.location.href);
    if (next === "SOURCE") url.searchParams.set("view", "source");
    else url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
    setWorkspaceViewState(next);
  }
  const [history, setHistory] = useState<PrototypeGenerationDetail[]>([]);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [pendingDeletion, setPendingDeletion] = useState<
    PrototypeGenerationDetail[]
  >([]);
  const deletionDialogRef = useRef<HTMLDialogElement>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyQuery, setHistoryQuery] = useQueryState<string>("q", "");
  const [historyStatus, setHistoryStatus] = useQueryState<string>("estado", "ALL");
  const [historyDateFrom, setHistoryDateFrom] = useQueryState<string>("desde", "");
  const [historyDateTo, setHistoryDateTo] = useQueryState<string>("hasta", "");
  const [historySort, setHistorySort] = useQueryState<string>("orden", "UPDATED_DESC");
  const [selectedScreenCodes, setSelectedScreenCodes] = useState<string[]>([]);

  const completedImageCacheKey = useMemo(
    () =>
      images
        .filter((image) => image.status === "COMPLETED" && image.storageKey)
        .map((image) => `${image.id}:${image.attemptNumber}`)
        .sort()
        .join("|"),
    [images],
  );

  // Las imágenes son privadas y su endpoint puede requerir renovar la sesión.
  // Una etiqueta <img> no puede ejecutar esa renovación, por eso recuperamos
  // cada PNG con authenticatedFetch y mostramos una URL Blob local.
  useEffect(() => {
    let active = true;
    const objectUrls: string[] = [];
    const completed = images.filter(
      (image) => image.status === "COMPLETED" && image.storageKey,
    );

    if (!completed.length) {
      setImageObjectUrls({});
      return;
    }

    void Promise.allSettled(
      completed.map(async (image) => {
        let response = await authenticatedFetch(
          imageUrl(image.id, image.attemptNumber),
          { cache: "no-store" },
        );

        // Una imagen recién persistida puede tardar un instante en quedar
        // disponible en almacenamiento. Reintentamos una sola vez sin
        // afectar las demás imágenes de la galería.
        if (!response.ok) {
          await new Promise((resolve) => window.setTimeout(resolve, 750));
          response = await authenticatedFetch(
            imageUrl(image.id, image.attemptNumber),
            { cache: "no-store" },
          );
        }

        if (!response.ok) {
          throw new Error(
            `No fue posible cargar ${image.screenName} (HTTP ${response.status}).`,
          );
        }

        const blob = await response.blob();
        if (!blob.size) {
          throw new Error(`La imagen ${image.screenName} llegó vacía.`);
        }

        const objectUrl = URL.createObjectURL(blob);
        objectUrls.push(objectUrl);
        return [image.id, objectUrl] as const;
      }),
    ).then((results) => {
      if (!active) return;

      const entries: Array<readonly [string, string]> = [];
      const failures: string[] = [];

      for (const result of results) {
        if (result.status === "fulfilled") {
          entries.push(result.value);
          continue;
        }

        failures.push(
          result.reason instanceof Error
            ? result.reason.message
            : "No fue posible mostrar una imagen generada.",
        );
      }

      setImageObjectUrls(Object.fromEntries(entries));
      setProgressError(failures.length ? failures[0] : null);
    });

    return () => {
      active = false;
      for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl);
    };
    // La clave cambia únicamente si aparece una imagen o una nueva versión.
  }, [completedImageCacheKey]);

  // RQ_PROTOTYPE_AUTO_OPEN_TEXT_RESULT_V1_4_3
  // En cuanto termina el punto 01 y existe una respuesta textual,
  // mostrarla inmediatamente aunque el usuario estuviera en Imágenes.
  useEffect(() => {
    if (!plan) return;
    setPreviewTab("TEXT");
    setSelectedScreenCodes(plan.screens.map((screen) => screen.code));
  }, [plan]);

  // RQ_PROTOTYPE_RESULTS_ALERTS_V1
  // Las alertas del prototipo son transitorias y también pueden cerrarse manualmente.
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 7_000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!progressError) return;
    const timer = window.setTimeout(() => setProgressError(null), 7_000);
    return () => window.clearTimeout(timer);
  }, [progressError]);

  useEffect(() => {
    if (!aiOptionsError) return;
    const timer = window.setTimeout(() => setAiOptionsError(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [aiOptionsError]);

  useEffect(() => {
    let active = true;
    void getJson<PrototypeAiOptions>("/api/v1/prototypes/generations/providers")
      .then((options) => {
        if (!active) return;
        setAiOptions(options);
        let saved: { planner?: string; images?: string } = {};
        try {
          saved = JSON.parse(
            window.localStorage.getItem("rq-prototype-ai-selection-v1") ?? "{}",
          );
        } catch {
          /* Initial selection uses a configured provider. */
        }
        const choose = (choices: PrototypeAiOptions["planning"], id?: string) =>
          id ??
          choices.find((p) => p.available && p.isDefault)?.id ??
          choices.find((p) => p.available)?.id ??
          "";
        setPlannerConfigurationId(
          (current) => current || choose(options.planning, saved?.planner),
        );
        setImageConfigurationId(
          (current) => current || choose(options.images, saved?.images),
        );
      })
      .catch(() => {
        if (active)
          setAiOptionsError(
            "No fue posible consultar las IAs disponibles. Recarga la página para intentarlo nuevamente.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  async function loadHistory(): Promise<PrototypeGenerationDetail[] | null> {
    setHistoryLoading(true);
    setError(null);
    try {
      const items = await getJson<PrototypeGenerationDetail[]>(
        "/api/v1/prototypes/generations",
      );
      setHistory(items);
      return items;
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No fue posible consultar el historial de prototipos.",
      );
    } finally {
      setHistoryLoading(false);
    }
    return null;
  }

  async function openHistoryGeneration(id: string) {
    setHistoryLoading(true);
    setError(null);
    try {
      const restored = await restoreGeneration(id);
      setGeneration(restored.generation);
      setTargetDevice(restored.generation.targetDevice);
      setGalleryDevice(
        restored.generation.targetDevice === "MOBILE" ? "MOBILE" : "WEB",
      );
      setFileName(restored.generation.sourceFileName);
      setMarkdownContent("");
      setMarkdownSizeBytes(restored.generation.sourceSizeBytes);
      setMarkdownSha256(restored.generation.sourceSha256);
      setPlan(
        hasCompletedPrototypePlan(restored.generation)
          ? planFrom(restored.generation, restored.screens)
          : null,
      );
      setVisualResult(
        visualResultFrom(restored.generation, restored.specifications),
      );
      setImages(restored.images);
      setImageProgress(restored.progress);
      setSelectedScreenId(restored.screens[0]?.id ?? null);
      window.localStorage.setItem(PROTOTYPE_GENERATION_STORAGE_KEY, id);
      setWorkspaceView("SOURCE");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No fue posible abrir el prototipo seleccionado.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  async function deleteSelectedHistory() {
    const selected = pendingDeletion;
    if (!selected.length || actionBusy) return;
    deletionDialogRef.current?.close();
    setPendingDeletion([]);
    setActionBusy("delete-selected");
    setError(null);
    const deleted = new Set<string>();
    const failed: string[] = [];
    try {
      for (const item of selected) {
        try {
          await deleteJson(
            `/api/v1/prototypes/generations/${encodeURIComponent(item.id)}`,
          );
          deleted.add(item.id);
        } catch (reason) {
          failed.push(
            `${item.applicationName || item.sourceFileName}: ${reason instanceof Error ? reason.message : "No fue posible eliminar el prototipo."}`,
          );
        }
      }
      setHistory((current) => current.filter((item) => !deleted.has(item.id)));
      setSelectedHistoryIds((current) =>
        current.filter((id) => !deleted.has(id)),
      );
      if (generation && deleted.has(generation.id)) {
        startNewPrototype();
        setWorkspaceView("HISTORY");
      }
      if (failed.length)
        setError(
          `Se eliminaron ${deleted.size} de ${selected.length}. No se pudieron eliminar: ${failed.join("; ")}`,
        );
    } finally {
      setActionBusy(null);
    }
  }

  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLocaleLowerCase("es");
    const from = historyDateFrom
      ? new Date(`${historyDateFrom}T00:00:00`).getTime()
      : null;
    const to = historyDateTo
      ? new Date(`${historyDateTo}T23:59:59.999`).getTime()
      : null;
    return history
      .filter((item) => {
        if (historyStatus !== "ALL" && item.status !== historyStatus)
          return false;
        const updatedAt = Date.parse(item.updatedAt);
        if (from !== null && updatedAt < from) return false;
        if (to !== null && updatedAt > to) return false;
        if (!query) return true;
        return [
          item.applicationName,
          item.sourceFileName,
          item.projectId,
          item.requestedByUserId,
        ].some((value) => value?.toLocaleLowerCase("es").includes(query));
      })
      .sort((left, right) => {
        if (historySort === "UPDATED_ASC")
          return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
        if (historySort === "NAME_ASC")
          return (left.applicationName || left.sourceFileName).localeCompare(
            right.applicationName || right.sourceFileName,
            "es",
          );
        if (historySort === "NAME_DESC")
          return (right.applicationName || right.sourceFileName).localeCompare(
            left.applicationName || left.sourceFileName,
            "es",
          );
        if (historySort === "STATUS_ASC")
          return prototypeStatusLabel(left.status).localeCompare(
            prototypeStatusLabel(right.status),
            "es",
          );
        if (historySort === "SCREENS_DESC")
          return right.totalScreens - left.totalScreens;
        return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      });
  }, [
    history,
    historyDateFrom,
    historyDateTo,
    historyQuery,
    historySort,
    historyStatus,
  ]);

  const selectedHistoryCount = filteredHistory.filter((item) =>
    selectedHistoryIds.includes(item.id),
  ).length;

  const historyMetrics = useMemo(
    () => ({
      total: filteredHistory.length,
      completed: filteredHistory.filter((item) => item.status === "COMPLETED")
        .length,
      active: filteredHistory.filter((item) =>
        [
          "PLANNING",
          "PLANNED",
          "VISUAL_SPEC_BUILDING",
          "VISUAL_SPEC_READY",
          "IMAGE_GENERATING",
        ].includes(item.status),
      ).length,
      failed: filteredHistory.filter((item) => item.status === "FAILED").length,
    }),
    [filteredHistory],
  );

  useEffect(() => {
    // Navegación externa (flecha lateral): sin ?view=source se vuelve al listado.
    if (
      viewParam !== "source" &&
      expectedViewParam.current === "source" &&
      workspaceViewRef.current === "SOURCE"
    ) {
      expectedViewParam.current = null;
      workspaceViewRef.current = "HISTORY";
      setWorkspaceViewState("HISTORY");
      void loadHistory();
    }
  }, [viewParam]);

  useEffect(() => {
    // El módulo abre siempre en el listado completo. Una generación se carga
    // únicamente cuando el usuario decide verla o inicia una nueva.
    window.localStorage.removeItem(PROTOTYPE_GENERATION_STORAGE_KEY);
    void (async () => {
      const current = await loadHistory();
      // Un proyecto aprobado con prototipo debe tener su borrador: se crea al abrir el módulo.
      if (current && (await ensureApprovedPrototypeDrafts(current).catch(() => 0)) > 0) {
        await loadHistory();
      }
    })();
  }, []);

  useEffect(() => {
    if (!generation || busy) return;
    if (!["SOURCE_READY", "PLANNING"].includes(generation.status)) return;

    let cancelled = false;
    let running = false;

    const refreshPlanning = async () => {
      if (cancelled || running || document.hidden) return;
      running = true;
      setResumingPlan(true);

      try {
        if (generation.status === "SOURCE_READY") {
          const planned = await postJson<PrototypePlanningResult>(
            `/api/v1/prototypes/generations/${encodeURIComponent(generation.id)}/plan`,
          );

          if (cancelled) return;

          setGeneration(planned.generation);
          setPlan(planned.plan);
          setPreviewTab("TEXT");
          setProgressError(null);
          await detailScreens(planned.generation);
          return;
        }

        const restored = await restoreGeneration(generation.id);
        if (cancelled) return;

        setGeneration(restored.generation);

        if (hasCompletedPrototypePlan(restored.generation)) {
          setPlan(planFrom(restored.generation, restored.screens));
          setPreviewTab("TEXT");
          setProgressError(null);
          return;
        }

        if (restored.generation.status === "FAILED") {
          setPlan(null);
          setError(
            restored.generation.errorMessage ||
              "No fue posible interpretar el Markdown.",
          );
        }
      } catch (reason) {
        if (!cancelled) {
          setProgressError(
            reason instanceof Error
              ? reason.message
              : "No fue posible recuperar el procesamiento del Markdown.",
          );
        }
      } finally {
        running = false;
        if (!cancelled) setResumingPlan(false);
      }
    };

    const visibility = () => {
      if (!document.hidden) void refreshPlanning();
    };

    void refreshPlanning();
    document.addEventListener("visibilitychange", visibility);
    const timer = window.setInterval(() => void refreshPlanning(), 2_500);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", visibility);
      window.clearInterval(timer);
    };
  }, [generation?.id, generation?.status, busy]);

  useEffect(() => {
    if (!generation || generation.status !== "IMAGE_GENERATING") return;
    let cancelled = false;
    let polling = false;
    const poll = async () => {
      if (cancelled || document.hidden || polling) return;
      polling = true;
      try {
        const [progress, nextImages] = await Promise.all([
          getJson<PrototypeImageProgress>(
            `/api/v1/prototypes/generations/${encodeURIComponent(generation.id)}/image-progress`,
          ),
          getJson<PrototypeGeneratedImage[]>(
            `/api/v1/prototypes/generations/${encodeURIComponent(generation.id)}/images`,
          ),
        ]);
        if (cancelled) return;
        setProgressError(null);
        setImageProgress(progress);
        setImages(nextImages);
        setGeneration((current) =>
          current
            ? {
                ...current,
                status: progress.status,
                totalImages: progress.totalImages,
                completedImages: progress.completedImages,
                failedImages: progress.failedImages,
              }
            : current,
        );
      } catch {
        if (!cancelled)
          setProgressError(
            "Se perdió la conexión durante la consulta del progreso.",
          );
      } finally {
        polling = false;
      }
    };
    const visibility = () => {
      if (!document.hidden) void poll();
    };
    void poll();
    document.addEventListener("visibilitychange", visibility);
    const timer = window.setInterval(() => void poll(), 3_500);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", visibility);
      window.clearInterval(timer);
    };
  }, [generation?.id, generation?.status]);

  const availableDevices = generation
    ? galleryDevices(generation.targetDevice)
    : galleryDevices(targetDevice);
  const visibleImages = useMemo(
    () =>
      orderPrototypeImages(
        images.filter((image) => image.device === galleryDevice),
      ),
    [images, galleryDevice],
  );
  const selectedImage = selectedImageForDevice(
    images,
    galleryDevice,
    selectedScreenId,
  );
  const selectedIndex = selectedImage
    ? visibleImages.findIndex((image) => image.id === selectedImage.id)
    : -1;
  const progressPercent = imageProgress?.totalImages
    ? Math.round(
        (imageProgress.completedImages / imageProgress.totalImages) * 100,
      )
    : 0;

  // RQ_PROTOTYPE_POINT1_FULL_TEXT_V1_4_3
  // Punto 01 = flujo textual completo. Solo llega a 100% cuando el plan
  // generado por la IA ya está disponible para mostrar al usuario.
  const sourceStagePercent = detailProgress
    ? 70 + Math.round((detailProgress.done / Math.max(1, detailProgress.total)) * 30)
    : plan
    ? 100
    : generation?.status === "PLANNING" || resumingPlan
      ? 70
      : generation?.status === "SOURCE_READY"
        ? 35
        : busy && busyLabel === "Preparando Markdown…"
          ? 20
          : 0;
  const sourceStageLabel = detailProgress
    ? `Detallando pantallas ${detailProgress.done}/${detailProgress.total}…`
    : plan
    ? "Respuesta procesada lista"
    : generation?.status === "FAILED"
      ? "Error en procesamiento"
      : generation?.status === "PLANNING" || resumingPlan
        ? "Interpretando con IA…"
        : generation?.status === "SOURCE_READY"
          ? "Fuente preparada · iniciando IA…"
          : busy && busyLabel === "Preparando Markdown…"
            ? "Preparando fuente…"
            : fileName
              ? "Listo para procesar"
              : "Esperando Markdown";

  const planningStagePercent =
    generation?.status === "COMPLETED" ||
    generation?.status === "PARTIALLY_COMPLETED"
      ? 100
      : generation?.status === "IMAGE_GENERATING"
        ? Math.max(60, progressPercent)
        : generation?.status === "VISUAL_SPEC_READY"
          ? 55
          : generation?.status === "VISUAL_SPEC_BUILDING" || startingImages
            ? 30
            : plan
              ? 10
              : 0;
  const planningStageLabel =
    generation?.status === "COMPLETED"
      ? "Imágenes generadas"
      : generation?.status === "PARTIALLY_COMPLETED"
        ? "Generación parcial"
        : generation?.status === "IMAGE_GENERATING"
          ? "Generando imágenes…"
          : generation?.status === "VISUAL_SPEC_READY"
            ? "Diseño preparado · iniciando imágenes…"
            : generation?.status === "VISUAL_SPEC_BUILDING" || startingImages
              ? "Preparando diseño…"
              : plan
                ? "Texto listo · preparando diseño…"
                : "Esperando respuesta del punto 01";

  useEffect(() => {
    if (selectedImage && selectedImage.screenId !== selectedScreenId)
      setSelectedScreenId(selectedImage.screenId);
  }, [selectedImage, selectedScreenId]);

  async function loadMarkdown(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    resetGeneration();
    try {
      const source = await readPrototypeMarkdown(file);
      setFileName(source.fileName);
      setMarkdownContent(source.markdownContent);
      setMarkdownSizeBytes(source.markdownSizeBytes);
    } catch (reason) {
      setFileName("");
      setMarkdownContent("");
      setMarkdownSizeBytes(0);
      setError(
        reason instanceof Error
          ? reason.message
          : "No fue posible leer el archivo Markdown.",
      );
    }
  }

  const selectedPlannerOption = aiOptions?.planning.find(
    (provider) => provider.id === plannerConfigurationId,
  );
  const selectedImageOption = aiOptions?.images.find(
    (provider) => provider.id === imageConfigurationId,
  );
  const providerBlockReason =
    !generation && aiOptions
      ? selectedPlannerOption && !selectedPlannerOption.available
        ? "Prueba la IA del Markdown en Configuración"
        : selectedImageOption && !selectedImageOption.available
          ? "Prueba la IA de imágenes en Configuración"
          : null
      : null;

  async function processMarkdown(force = false) {
    const planningProviderAvailable = aiOptions?.planning.some(
      (provider) =>
        provider.id === plannerConfigurationId && provider.available,
    );
    const imageProviderAvailable = aiOptions?.images.some(
      (provider) => provider.id === imageConfigurationId && provider.available,
    );

    if (!generation && !planningProviderAvailable) {
      setError("Selecciona una IA disponible para interpretar el Markdown.");
      return;
    }

    if (!generation && !imageProviderAvailable) {
      setError("Selecciona una IA disponible para generar las imágenes.");
      return;
    }

    if (!generation && (!fileName || !markdownContent.trim())) {
      setError("Importa un archivo Markdown con contenido antes de continuar.");
      return;
    }

    if (plan && !force) {
      setPreviewTab("TEXT");
      return;
    }

    if (force) {
      if (
        generation?.status === "VISUAL_SPEC_READY" &&
        !(await confirm({
          title: "Procesar el texto de nuevo",
          message:
            "Se volverá a interpretar el Markdown y se descartarán el diseño preparado y la selección de pantallas.",
          confirmLabel: "Procesar de nuevo",
        }))
      )
        return;
      setPlan(null);
      setVisualResult(null);
      setSelectedScreenCodes([]);
    }

    setBusy(true);
    setError(null);
    setPreviewTab("TEXT");

    try {
      let current = generation;

      if (!current) {
        setBusyLabel("Preparando Markdown…");
        current = await postJson<PrototypeGenerationDetail>(
          "/api/v1/prototypes/generations",
          {
            sourceFileName: fileName,
            markdown: markdownContent,
            targetDevice,
            plannerConfigurationId,
            ...(imageConfigurationId ? { imageConfigurationId } : {}),
          },
        );

        window.localStorage.setItem(
          PROTOTYPE_GENERATION_STORAGE_KEY,
          current.id,
        );
        setGeneration(current);
        setMarkdownSha256(current.sourceSha256);
      }

      if (
        current.status === "SOURCE_READY" ||
        (current.status === "FAILED" && current.totalImages === 0) ||
        force
      ) {
        setBusyLabel("Interpretando Markdown…");

        const planned = await postJson<PrototypePlanningResult>(
          `/api/v1/prototypes/generations/${encodeURIComponent(current.id)}/plan`,
        );

        current = planned.generation;
        setGeneration(current);
        setPlan(planned.plan);
        setPreviewTab("TEXT");
        setBusyLabel("Detallando pantallas…");
        await detailScreens(current);
        setBusyLabel("Texto procesado");
        return;
      }

      if (hasCompletedPrototypePlan(current)) {
        setPreviewTab("TEXT");
        return;
      }

      throw new Error(
        "La generación no está en un estado válido para interpretar el Markdown.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No fue posible interpretar el Markdown.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function continueWithImages(current: PrototypeGenerationDetail) {
    if (visualPipelineRef.current === current.id) return;
    visualPipelineRef.current = current.id;
    setStartingImages(true);
    setError(null);

    try {
      let next = current;
      if (next.status === "PLANNED") {
        const visual = await postJson<PrototypeVisualSpecificationBuildResult>(
          `/api/v1/prototypes/generations/${encodeURIComponent(next.id)}/visual-specifications`,
          { screenCodes: selectedScreenCodes },
        );
        if (visualPipelineRef.current !== current.id) return;
        setVisualResult(visual);
        next = visual.generation;
        setGeneration(next);
      }

      if (next.status === "VISUAL_SPEC_READY") {
        const result = await postJson<PrototypeImageGenerationResult>(
          `/api/v1/prototypes/generations/${encodeURIComponent(next.id)}/images`,
        );
        if (visualPipelineRef.current !== current.id) return;
        applyImageResult(result);
        setPreviewTab("IMAGES");
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No fue posible iniciar la generación de imágenes.",
      );
    } finally {
      setStartingImages(false);
      if (visualPipelineRef.current === current.id)
        visualPipelineRef.current = null;
    }
  }

  /**
   * Pide a la IA elegida (por ejemplo la local) el detalle completo de cada pantalla, una a la
   * vez y con la pantalla como foco. Si una falla se conserva su detalle anterior.
   */
  async function detailScreens(target: PrototypeGenerationDetail) {
    setError(null);
    let failed = 0;
    let doneCount = 0;
    let totalCount = 0;
    const controller = new AbortController();
    detailAbortRef.current = controller;
    try {
      const screens = await getJson<PrototypeScreenDetail[]>(
        `/api/v1/prototypes/generations/${encodeURIComponent(target.id)}/screens`,
        controller.signal,
      );
      totalCount = screens.length;
      setDetailProgress({ done: 0, total: screens.length });
      for (const [index, screen] of screens.entries()) {
        if (controller.signal.aborted) break;
        try {
          const result = await postJson<PrototypeScreenDetailResult>(
            `/api/v1/prototypes/generations/${encodeURIComponent(target.id)}/screens/${encodeURIComponent(screen.id)}/detail`,
            undefined,
            controller.signal,
          );
          doneCount += 1;
          setPlan((current) =>
            current
              ? {
                  ...current,
                  screens: current.screens.map((item) =>
                    item.code === result.screen.code
                      ? {
                          ...item,
                          objective: result.screen.objective,
                          components: result.screen.components,
                        }
                      : item,
                  ),
                }
              : current,
          );
        } catch {
          // Una pantalla interrumpida por el usuario no cuenta como fallo de la IA.
          if (!controller.signal.aborted) failed += 1;
        }
        setDetailProgress({ done: index + 1, total: screens.length });
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "No fue posible detallar las pantallas.",
        );
    } finally {
      setDetailProgress(null);
      detailAbortRef.current = null;
    }
    if (controller.signal.aborted) {
      setProgressError(
        `Detalle detenido: ${doneCount} de ${totalCount} pantallas detalladas; el resto conserva su detalle básico. Puedes continuar con «Detallar de nuevo con la IA».`,
      );
      return;
    }
    if (failed)
      setProgressError(
        `La IA no pudo detallar ${failed} pantalla${failed === 1 ? "" : "s"}; se conservó su detalle básico. Puedes reintentar con «Detallar de nuevo».`,
      );
  }

  /** Prepara las pantallas elegidas y descarga un TXT con un prompt por imagen para otra IA. */
  async function exportPrompts() {
    if (!generation || exportingPrompts) return;
    setExportingPrompts(true);
    setError(null);
    try {
      let current = generation;
      if (current.status === "PLANNED") {
        const visual = await postJson<PrototypeVisualSpecificationBuildResult>(
          `/api/v1/prototypes/generations/${encodeURIComponent(current.id)}/visual-specifications`,
          { screenCodes: selectedScreenCodes },
        );
        setVisualResult(visual);
        current = visual.generation;
        setGeneration(current);
      }
      const exported = await getJson<PrototypePromptExport>(
        `/api/v1/prototypes/generations/${encodeURIComponent(current.id)}/prompt-export`,
      );
      downloadTextFile(
        buildPromptExportTxt(exported),
        promptExportFileName(exported.applicationName),
        "text/plain;charset=utf-8",
      );
      setImportNotice(
        `${exported.items.length} prompts exportados. Genera cada imagen en tu IA, guárdala con el nombre indicado e impórtala en la pestaña Imágenes.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No fue posible exportar los prompts.",
      );
    } finally {
      setExportingPrompts(false);
    }
  }

  /** Importa a la galería imágenes generadas fuera del sistema; cada una se asigna por su nombre. */
  async function importImages(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!generation || files.length === 0) return;
    setImportingImages(true);
    setError(null);
    setImportNotice(null);
    const rejected: string[] = [];
    let imported = 0;
    for (const file of files) {
      try {
        const result = await postJson<PrototypeImageActionResult>(
          `/api/v1/prototypes/generations/${encodeURIComponent(generation.id)}/images/import`,
          await importPayload(file),
        );
        imported += 1;
        setGeneration(result.generation);
        setImageProgress(result.progress);
        setImages((current) =>
          current.some((image) => image.id === result.image.id)
            ? current.map((image) =>
                image.id === result.image.id ? result.image : image,
              )
            : [...current, result.image],
        );
        setSelectedScreenId((current) => current ?? result.image.screenId);
      } catch (reason) {
        rejected.push(
          reason instanceof Error ? reason.message : `«${file.name}» falló.`,
        );
      }
    }
    setImportingImages(false);
    setImportNotice(
      `${imported} imagen${imported === 1 ? "" : "es"} importada${imported === 1 ? "" : "s"} de ${files.length}.${rejected.length ? ` No se importaron: ${rejected.join(" · ")}` : ""}`,
    );
  }

  async function imageAction(imageId: string, action: "retry" | "regenerate") {
    setActionBusy(imageId);
    setError(null);
    try {
      const result = await postJson<PrototypeImageActionResult>(
        `/api/v1/prototypes/images/${encodeURIComponent(imageId)}/${action}`,
      );
      setGeneration(result.generation);
      setImageProgress(result.progress);
      setImages((current) =>
        current.map((image) =>
          image.id === result.image.id ? result.image : image,
        ),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No fue posible actualizar la imagen.",
      );
    } finally {
      setActionBusy(null);
    }
  }
  async function retryFailed() {
    if (!generation) return;
    setActionBusy("all");
    setError(null);
    try {
      applyImageResult(
        await postJson<PrototypeImageGenerationResult>(
          `/api/v1/prototypes/generations/${encodeURIComponent(generation.id)}/images/retry-failed`,
        ),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No fue posible reintentar las imágenes fallidas.",
      );
    } finally {
      setActionBusy(null);
    }
  }
  async function regenerateImage(image: PrototypeGeneratedImage) {
    if (
      !(await confirm({
        title: "Regenerar imagen",
        message:
          "Se generará nuevamente esta vista y puede producir consumo adicional de IA.",
        confirmLabel: "Regenerar",
      }))
    )
      return;
    await imageAction(image.id, "regenerate");
  }
  async function downloadImage(image: PrototypeGeneratedImage) {
    setActionBusy(`download-${image.id}`);
    setError(null);
    try {
      const response = await authenticatedFetch(
        imageUrl(image.id, image.attemptNumber),
      );
      if (!response.ok) throw new Error("No fue posible descargar la imagen.");
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = prototypeImageFileName(image);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No fue posible descargar la imagen.",
      );
    } finally {
      setActionBusy(null);
    }
  }
  function applyImageResult(result: PrototypeImageGenerationResult) {
    setGeneration(result.generation);
    setImages(result.images);
    setImageProgress(result.progress);
    setSelectedScreenId(
      (current) => current ?? result.images[0]?.screenId ?? null,
    );
  }
  function resetGeneration() {
    window.localStorage.removeItem(PROTOTYPE_GENERATION_STORAGE_KEY);
    setBusy(false);
    setResumingPlan(false);
    setStartingImages(false);
    setActionBusy(null);
    setError(null);
    setProgressError(null);
    setGeneration(null);
    setPlan(null);
    setVisualResult(null);
    setImages([]);
    setImageProgress(null);
    setSelectedScreenId(null);
    setMarkdownSha256(null);
    setPreviewTab("TEXT");
    setSelectedScreenCodes([]);
    visualPipelineRef.current = null;
  }
  function startNewPrototype() {
    resetGeneration();
    setFileName("");
    setMarkdownContent("");
    setMarkdownSizeBytes(0);
    setTargetDevice("RESPONSIVE");
    setGalleryDevice("WEB");
    setWorkspaceView("SOURCE");
  }
  async function stopCurrentGeneration() {
    // Mientras la IA detalla pantallas, «Detener» interrumpe solo ese paso y no la generación.
    if (detailAbortRef.current) {
      detailAbortRef.current.abort();
      return;
    }
    if (!generation) return;
    setActionBusy("stop");
    setError(null);
    try {
      applyImageResult(
        await postJson<PrototypeImageGenerationResult>(
          `/api/v1/prototypes/generations/${encodeURIComponent(generation.id)}/stop`,
        ),
      );
      visualPipelineRef.current = null;
      setStartingImages(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No fue posible detener la generación.",
      );
    } finally {
      setActionBusy(null);
    }
  }
  function chooseDevice(device: PrototypeVisualDevice) {
    setGalleryDevice(device);
    const equivalent = images.find(
      (image) => image.device === device && image.screenId === selectedScreenId,
    );
    if (!equivalent)
      setSelectedScreenId(
        orderPrototypeImages(
          images.filter((image) => image.device === device),
        )[0]?.screenId ?? null,
      );
  }
  function navigate(direction: -1 | 1) {
    const next =
      visibleImages[
        adjacentScreenIndex(selectedIndex, visibleImages.length, direction)
      ];
    if (next) setSelectedScreenId(next.screenId);
  }

  const textProcessingActive =
    busy || resumingPlan || generation?.status === "PLANNING";
  const isActive =
    generation?.status === "IMAGE_GENERATING" ||
    textProcessingActive ||
    startingImages;
  // Pantallas que se generarán: las marcadas y, una vez preparadas, las que ya tienen diseño.
  const generationScreenCount =
    generation?.status === "PLANNED"
      ? selectedScreenCodes.length
      : new Set(visualResult?.specifications.map((item) => item.screenId)).size ||
        selectedScreenCodes.length;
  // Antes de generar imágenes el texto se puede volver a procesar (por ejemplo con otro modelo).
  const canReprocess = Boolean(
    plan &&
      generation &&
      ["PLANNED", "VISUAL_SPEC_READY"].includes(generation.status) &&
      generation.totalImages === 0,
  );
  const mainLabel = textProcessingActive
    ? "Procesando Markdown…"
    : startingImages || generation?.status === "IMAGE_GENERATING"
      ? "Generando imágenes…"
      : canReprocess
        ? "Procesar texto de nuevo"
        : plan
          ? "Prototipo procesado"
        : "Procesar Markdown";

  return (
    <section className="rq-prototype-workspace">
      {workspaceView === "SOURCE" ? (
        <div
          className={`${styles.workspaceMenu} ${styles.workspaceMenuSource}`}
        >
          <div aria-hidden="true" className={styles.workspaceActions} />

          <p className={styles.workspaceSourceTitle}>
            Importa el Markdown aprobado y elige el formato del prototipo.
          </p>

          <div className={styles.workflowHeader}>
            <ol aria-label="Pasos para generar el prototipo">
              <li data-active="true">
                <span>1</span>Markdown
              </li>
              <li data-active={Boolean(generation?.totalScreens)}>
                <span>2</span>Formato
              </li>
              <li data-active={Boolean(generation?.totalImages)}>
                <span>3</span>Prototipo
              </li>
            </ol>
            {isActive && generation ? (
              <button
                className={styles.stopPrototype}
                disabled={actionBusy === "stop"}
                onClick={() => void stopCurrentGeneration()}
                type="button"
              >
                {actionBusy === "stop" ? "Deteniendo…" : "Detener"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {aiOptionsError ? (
        <div className="rq-project-alert" data-tone="danger" role="alert">
          <span>{aiOptionsError}</span>
          <button
            aria-label="Cerrar mensaje"
            onClick={() => setAiOptionsError(null)}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="rq-project-alert" data-tone="danger" role="alert">
          <span>{error}</span>
          <button
            aria-label="Cerrar mensaje"
            onClick={() => setError(null)}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}
      {progressError ? (
        <div className="rq-project-alert" data-tone="warning" role="alert">
          <span>{progressError}</span>
          <button
            aria-label="Cerrar mensaje"
            onClick={() => setProgressError(null)}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}
      {workspaceView === "HISTORY" ? (
        <section className={`rq-clean-card ${styles.history}`}>
          <dialog
            ref={deletionDialogRef}
            className={styles.deletionDialog}
            aria-labelledby="delete-prototypes-title"
            onCancel={() => setPendingDeletion([])}
          >
            <h2 id="delete-prototypes-title">
              Eliminar prototipos seleccionados
            </h2>
            <p>
              Se eliminarán definitivamente estos {pendingDeletion.length}{" "}
              prototipos y todas sus imágenes. Esta acción no se puede deshacer.
            </p>
            <ul>
              {pendingDeletion.map((item) => (
                <li key={item.id}>
                  <strong>
                    {item.applicationName || "Prototipo sin nombre"}
                  </strong>
                  <br />
                  {item.sourceFileName}
                </li>
              ))}
            </ul>
            <div className={styles.historyToolbar}>
              <button
                type="button"
                onClick={() => {
                  deletionDialogRef.current?.close();
                  setPendingDeletion([]);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={styles.deleteSelected}
                disabled={Boolean(actionBusy) || !pendingDeletion.length}
                onClick={() => void deleteSelectedHistory()}
              >
                Eliminar definitivamente ({pendingDeletion.length})
              </button>
            </div>
          </dialog>
          <div className={styles.historyTopRow}>
            <RqKpiGrid label="Resumen del historial de prototipos">
              <RqKpiCard
                description="Registros visibles"
                icon={<WorkspaceKpiIcon name="layers" />}
                title="Total"
                value={String(historyMetrics.total)}
              />
              <RqKpiCard
                description="Completados (generación terminada) / en proceso (planificando o generando)"
                icon={<WorkspaceKpiIcon name="check" />}
                title="Completados / en proceso"
                value={`${historyMetrics.completed} / ${historyMetrics.active}`}
              />
              <RqKpiCard
                description="Requieren revisión"
                icon={<WorkspaceKpiIcon name="alert" />}
                title="Fallidos"
                value={String(historyMetrics.failed)}
              />
            </RqKpiGrid>
            <div className={styles.historyToolbar}>
              <button
                className={styles.newPrototype}
                disabled={Boolean(actionBusy)}
                onClick={startNewPrototype}
                type="button"
              >
                + Nuevo
              </button>
              <button
                className={styles.deleteSelected}
                disabled={
                  !selectedHistoryCount || Boolean(actionBusy) || historyLoading
                }
                onClick={() => {
                  setPendingDeletion(
                    filteredHistory.filter((item) =>
                      selectedHistoryIds.includes(item.id),
                    ),
                  );
                  deletionDialogRef.current?.showModal();
                }}
                type="button"
              >
                {actionBusy === "delete-selected"
                  ? "Eliminando…"
                  : `Eliminar${selectedHistoryCount ? ` (${selectedHistoryCount})` : ""}`}
              </button>
            </div>
          </div>
          <form
            className="rq-projects-filters rq-prototype-filters"
            onSubmit={(event) => event.preventDefault()}
          >
            <label className="rq-projects-filter rq-projects-filter--search">
              <span>Buscar prototipo:</span>
              <svg
                aria-hidden="true"
                fill="none"
                height="17"
                viewBox="0 0 24 24"
                width="17"
              >
                <circle
                  cx="10.5"
                  cy="10.5"
                  r="6.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="m15.5 15.5 5 5"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.8"
                />
              </svg>
              <input
                aria-label="Buscar por nombre, archivo, proyecto u organizador"
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder="Nombre, archivo, proyecto"
                type="search"
                value={historyQuery}
              />
            </label>
            <label className="rq-projects-filter">
              <span>Estado:</span>
              <select
                aria-label="Estado"
                onChange={(event) => setHistoryStatus(event.target.value)}
                value={historyStatus}
              >
                <option value="ALL">Todos</option>
                <option value="COMPLETED">Completado</option>
                <option value="PARTIALLY_COMPLETED">Parcial</option>
                <option value="IMAGE_GENERATING">Generando</option>
                <option value="SOURCE_READY">Borrador</option>
                <option value="PLANNED">Planificado</option>
                <option value="FAILED">Fallido</option>
              </select>
            </label>
            <div className="rq-prototype-filters__dates">
              <label className="rq-projects-filter">
                <span>Desde:</span>
                <input
                  aria-label="Fecha desde"
                  max={historyDateTo || undefined}
                  onChange={(event) => setHistoryDateFrom(event.target.value)}
                  type="date"
                  value={historyDateFrom}
                />
              </label>
              <label className="rq-projects-filter">
                <span>Hasta:</span>
                <input
                  aria-label="Fecha hasta"
                  min={historyDateFrom || undefined}
                  onChange={(event) => setHistoryDateTo(event.target.value)}
                  type="date"
                  value={historyDateTo}
                />
              </label>
            </div>
            <label className="rq-projects-filter">
              <span>Ordenar:</span>
              <select
                aria-label="Ordenar por"
                onChange={(event) => setHistorySort(event.target.value)}
                value={historySort}
              >
                <option value="UPDATED_DESC">Fecha: más reciente</option>
                <option value="UPDATED_ASC">Fecha: más antigua</option>
                <option value="NAME_ASC">Nombre: A a Z</option>
                <option value="NAME_DESC">Nombre: Z a A</option>
                <option value="STATUS_ASC">Estado</option>
                <option value="SCREENS_DESC">Más pantallas</option>
              </select>
            </label>
            <RqActionButton
              onClick={() => {
                setHistoryQuery("");
                setHistoryStatus("ALL");
                setHistoryDateFrom("");
                setHistoryDateTo("");
                setHistorySort("UPDATED_DESC");
              }}
              tone="secondary"
              type="button"
            >
              Limpiar
            </RqActionButton>
            <RqActionButton
              onClick={() => void loadHistory()}
              tone="secondary"
              type="button"
            >
              Actualizar
            </RqActionButton>
          </form>
          <div className={styles.historyCount}>
            {filteredHistory.length} registro
            {filteredHistory.length === 1 ? "" : "s"}
            {selectedHistoryCount > 0
              ? ` · ${selectedHistoryCount} seleccionados visibles`
              : ""}
          </div>
          <div className="rq-table-shell__scroll">
            <table className="rq-table">
              <thead>
                <tr>
                  <th scope="col">Prototipo / fuente</th>
                  <th scope="col">Organizador</th>
                  <th scope="col">Formato</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Pantallas</th>
                  <th scope="col">Pantallas generadas</th>
                  <th scope="col">Actualización</th>
                  <th className={styles.historyActionHeader} scope="col">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <label className={styles.historySelection}>
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${item.applicationName || "Prototipo sin nombre"} — ${item.sourceFileName}`}
                          checked={selectedHistoryIds.includes(item.id)}
                          disabled={Boolean(actionBusy) || historyLoading}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setSelectedHistoryIds((current) =>
                              checked
                                ? [...current, item.id]
                                : current.filter((id) => id !== item.id),
                            );
                          }}
                        />
                        <span>
                          <strong>
                            {item.applicationName || "Prototipo sin nombre"}
                          </strong>
                          <small className="rq-table-secondary">
                            {item.sourceFileName}
                          </small>
                        </span>
                      </label>
                    </td>
                    <td title={item.requestedByUserId}>
                      {shortId(item.requestedByUserId)}
                    </td>
                    <td>{targetDeviceLabel(item.targetDevice)}</td>
                    <td>
                      <RqStatusBadge tone={prototypeStatusTone(item.status)}>
                        {prototypeStatusLabel(item.status)}
                      </RqStatusBadge>
                    </td>
                    <td>{item.totalScreens}</td>
                    <td>{item.generatedScreens}</td>
                    <td>{prototypeDateTime(item.updatedAt)}</td>
                    <td className={styles.historyActionCell}>
                      <div className={styles.historyActions}>
                        <button
                          className="rq-action rq-row-open"
                          disabled={historyLoading || Boolean(actionBusy)}
                          onClick={() => void openHistoryGeneration(item.id)}
                          type="button"
                        >
                          Abrir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!historyLoading && filteredHistory.length === 0 ? (
            <p className={styles.historyEmpty}>
              No hay prototipos que coincidan con los filtros.
            </p>
          ) : null}
          {historyLoading ? (
            <p className={styles.historyEmpty}>Consultando historial…</p>
          ) : null}
        </section>
      ) : null}
      {workspaceView === "SOURCE" ? (
        <div className="rq-prototype-layout">
          <div className="rq-prototype-config">
            <section className="rq-clean-card rq-markdown-source">
              <header>
                <div>
                  <span>01 · Fuente</span>
                  <h2>Documento Markdown</h2>
                </div>
                {fileName ? (
                  <span className="rq-ready-badge">Listo</span>
                ) : null}
              </header>
              <button
                className="rq-file-card"
                disabled={isActive}
                onClick={() => fileRef.current?.click()}
                type="button"
              >
                <span className="rq-file-card__icon">MD</span>
                <span>
                  <strong>{fileName || "Selecciona un Markdown"}</strong>
                  <small>
                    {fileName
                      ? `${markdownSizeBytes.toLocaleString("es-CO")} bytes${markdownContent ? " · Puedes reemplazarlo." : " · Generación recuperada."}`
                      : "Archivos .md o .markdown, máximo 5 MB."}
                  </small>
                </span>
                <em>Importar Markdown</em>
              </button>
              <input
                accept={PROTOTYPE_FILE_ACCEPT}
                hidden
                onChange={(event) => void loadMarkdown(event)}
                ref={fileRef}
                type="file"
              />
              <label className={styles.modelSelector}>
                <strong>IA para interpretar el Markdown</strong>
                <select
                  value={plannerConfigurationId}
                  disabled={isActive || Boolean(generation) || !aiOptions}
                  onChange={(event) => {
                    setPlannerConfigurationId(event.target.value);
                    window.localStorage.setItem(
                      "rq-prototype-ai-selection-v1",
                      JSON.stringify({
                        planner: event.target.value,
                        images: imageConfigurationId,
                      }),
                    );
                  }}
                >
                  <option value="" disabled>
                    {aiOptions
                      ? "Selecciona un modelo"
                      : "Consultando modelos…"}
                  </option>
                  {plannerConfigurationId &&
                  !aiOptions?.planning.some(
                    (p) => p.id === plannerConfigurationId,
                  ) ? (
                    <option value={plannerConfigurationId} disabled>
                      Modelo no disponible
                    </option>
                  ) : null}
                  {(["OLLAMA", "OPENAI"] as const).map((provider) => (
                    <optgroup
                      key={provider}
                      label={
                        provider === "OLLAMA"
                          ? "IA local · Ollama"
                          : "IA nube · OpenAI"
                      }
                    >
                      {aiOptions?.planning
                        .filter((p) => p.provider === provider)
                        .map((p) => (
                          <option
                            key={p.id}
                            value={p.id}
                            disabled={!p.available}
                          >
                            {p.name} · {p.model}
                            {p.available ? "" : ` · ${p.message}`}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
                <small>
                  Identifica las pantallas y organiza el contenido del
                  documento.
                </small>
              </label>

              <div className={styles.stageProgress}>
                <div className={styles.stageProgressHeader}>
                  <strong>Procesamiento de fuente</strong>
                  <span>{sourceStageLabel}</span>
                  <b>{sourceStagePercent}%</b>
                </div>
                <div
                  aria-label="Avance de preparación del Markdown"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={sourceStagePercent}
                  className={styles.stageProgressTrack}
                  role="progressbar"
                >
                  <span style={{ width: `${sourceStagePercent}%` }} />
                </div>
              </div>
            </section>
            <section className="rq-clean-card rq-device-selection">
              <header>
                <div>
                  <span>02 · Formato</span>
                  <h2>¿Qué vamos a crear?</h2>
                </div>
              </header>
              <div>
                {DEVICE_OPTIONS.map((option) => (
                  <button
                    aria-pressed={targetDevice === option.value}
                    disabled={Boolean(generation) || isActive}
                    key={option.value}
                    onClick={() => {
                      resetGeneration();
                      setTargetDevice(option.value);
                      setGalleryDevice(
                        option.value === "MOBILE" ? "MOBILE" : "WEB",
                      );
                    }}
                    type="button"
                  >
                    <span
                      className={`rq-device-icon rq-device-icon--${option.value.toLowerCase()}`}
                    >
                      <i />
                      <i />
                    </span>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                    <em>
                      {targetDevice === option.value
                        ? "Seleccionado"
                        : "Elegir"}
                    </em>
                  </button>
                ))}
              </div>
              <label className={styles.modelSelector}>
                <strong>IA para generar imágenes</strong>
                <select
                  value={imageConfigurationId}
                  disabled={isActive || Boolean(generation) || !aiOptions}
                  onChange={(event) => {
                    setImageConfigurationId(event.target.value);
                    window.localStorage.setItem(
                      "rq-prototype-ai-selection-v1",
                      JSON.stringify({
                        planner: plannerConfigurationId,
                        images: event.target.value,
                      }),
                    );
                  }}
                >
                  <option value="" disabled>
                    {aiOptions
                      ? "Selecciona una IA de imágenes"
                      : "Consultando modelos…"}
                  </option>
                  {imageConfigurationId &&
                  !aiOptions?.images.some(
                    (p) => p.id === imageConfigurationId,
                  ) ? (
                    <option value={imageConfigurationId} disabled>
                      Proveedor no disponible
                    </option>
                  ) : null}
                  {aiOptions?.images.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.available}>
                      {p.name} · {p.model}
                      {p.available ? "" : ` · ${p.message}`}
                    </option>
                  ))}
                </select>
                <small>
                  Se utilizará después de validar la respuesta procesada del
                  Markdown.
                </small>
              </label>

              <div className={styles.stageProgress}>
                <div className={styles.stageProgressHeader}>
                  <strong>Preparación visual</strong>
                  <span>{planningStageLabel}</span>
                  <b>{planningStagePercent}%</b>
                </div>
                <div
                  aria-label="Avance de preparación visual"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={planningStagePercent}
                  className={styles.stageProgressTrack}
                  role="progressbar"
                >
                  <span style={{ width: `${planningStagePercent}%` }} />
                </div>
              </div>
            </section>
            <button
              className="rq-prototype-generate"
              disabled={
                recovering ||
                isActive ||
                Boolean(detailProgress) ||
                (Boolean(plan) && !canReprocess) ||
                (!generation &&
                  (!aiOptions ||
                    !aiOptions.planning.some(
                      (provider) =>
                        provider.id === plannerConfigurationId &&
                        provider.available,
                    ) ||
                    !aiOptions.images.some(
                      (provider) =>
                        provider.id === imageConfigurationId &&
                        provider.available,
                    ))) ||
                (!generation && !markdownContent)
              }
              onClick={() => void processMarkdown(canReprocess)}
              type="button"
            >
              <span>{recovering ? "Recuperando prototipo…" : mainLabel}</span>
              <small>
                {textProcessingActive
                  ? generation?.status === "PLANNING" || resumingPlan
                    ? "Interpretando Markdown con IA…"
                    : busyLabel
                  : canReprocess
                    ? "Vuelve a interpretar el Markdown con la IA elegida y detalla cada pantalla"
                    : plan
                    ? `${plan.screens.length} pantalla${plan.screens.length === 1 ? "" : "s"} identificada${plan.screens.length === 1 ? "" : "s"}`
                    : (providerBlockReason ??
                      "Las imágenes se generan después")}
              </small>
            </button>
            {imageProgress?.failedImages ? (
              <button
                className={styles.secondaryAction}
                disabled={Boolean(actionBusy)}
                onClick={() => void retryFailed()}
                type="button"
              >
                {actionBusy === "all"
                  ? "Reintentando…"
                  : `Reintentar fallidas (${imageProgress.failedImages})`}
              </button>
            ) : null}
          </div>
          <section className="rq-clean-card rq-prototype-preview">
            <header>
              <div>
                <span>03 · Vista previa</span>
                <h2>
                  {generation?.status === "COMPLETED"
                    ? "Prototipo generado"
                    : generation?.status === "PARTIALLY_COMPLETED"
                      ? "Prototipo generado parcialmente"
                      : generation?.status === "IMAGE_GENERATING"
                        ? "Generando prototipo"
                        : "Tu prototipo aparecerá aquí"}
                </h2>
              </div>
              <span>{targetDeviceLabel(targetDevice)}</span>
            </header>
            <div className={styles.gallery}>
              <div
                aria-label="Contenido de la vista previa"
                className={styles.resultTabs}
                role="tablist"
              >
                <button
                  aria-controls="prototype-text-panel"
                  aria-selected={previewTab === "TEXT"}
                  id="prototype-text-tab"
                  onClick={() => setPreviewTab("TEXT")}
                  role="tab"
                  type="button"
                >
                  <span>Respuesta procesada</span>
                  <small>{plan ? "Disponible" : "Pendiente"}</small>
                </button>
                <button
                  aria-controls="prototype-images-panel"
                  aria-selected={previewTab === "IMAGES"}
                  id="prototype-images-tab"
                  onClick={() => setPreviewTab("IMAGES")}
                  role="tab"
                  type="button"
                >
                  <span>Imágenes</span>
                  <small>
                    {images.length
                      ? `${images.filter((image) => image.status === "COMPLETED").length}/${images.length}`
                      : "Pendiente"}
                  </small>
                </button>
              </div>

              {previewTab === "TEXT" ? (
                <section
                  aria-labelledby="prototype-analysis-result-heading"
                  aria-describedby="prototype-text-tab"
                  className={styles.analysisResult}
                  id="prototype-text-panel"
                  role="tabpanel"
                >
                  <div className={styles.previewSectionHeader}>
                    <div>
                      <small>Resultado de IA</small>
                      <h3 id="prototype-analysis-result-heading">
                        Interpretación del Markdown
                      </h3>
                    </div>
                    <span>
                      {plan
                        ? `${plan.screens.length} pantalla${plan.screens.length === 1 ? "" : "s"}`
                        : "Pendiente"}
                    </span>
                  </div>

                  {plan ? (
                    <>
                      <div className={styles.analysisSummary}>
                        <strong>{plan.applicationName || "Prototipo"}</strong>
                        <p>
                          {plan.summary ||
                            "La IA identificó la estructura funcional del prototipo."}
                        </p>
                      </div>

                      <div className={styles.analysisScreens}>
                        {plan.screens.map((screen) => (
                          <details
                            className={styles.analysisScreen}
                            key={`${screen.code}-${screen.order}`}
                          >
                            <summary>
                              <input
                                aria-label={`Generar imagen de ${screen.name}`}
                                checked={selectedScreenCodes.includes(
                                  screen.code,
                                )}
                                disabled={generation?.status !== "PLANNED"}
                                onChange={(event) => {
                                  const checked = event.target.checked;
                                  setSelectedScreenCodes((current) =>
                                    checked
                                      ? [...new Set([...current, screen.code])]
                                      : current.filter(
                                          (code) => code !== screen.code,
                                        ),
                                  );
                                }}
                                onClick={(event) => event.stopPropagation()}
                                type="checkbox"
                              />
                              <span>
                                {String(screen.order).padStart(2, "0")} ·{" "}
                                {screen.code} · {screen.name}
                              </span>
                              <small>
                                {prototypeOriginLabel(screen.origin)}
                              </small>
                            </summary>
                            <div className={styles.analysisScreenContent}>
                              <p>{screen.objective}</p>
                              {screen.route ? (
                                <span>
                                  <strong>Ruta:</strong> {screen.route}
                                </span>
                              ) : null}
                              {screen.components.length ? (
                                <div>
                                  <strong>Componentes identificados</strong>
                                  <ul>
                                    {screen.components.map((component) => (
                                      <li key={component}>{component}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : (
                                <span>
                                  Sin componentes adicionales identificados.
                                </span>
                              )}
                            </div>
                          </details>
                        ))}
                      </div>
                      {generation?.status === "PLANNED" ||
                      generation?.status === "VISUAL_SPEC_READY" ? (
                        <div className={styles.selectionActions}>
                          <button
                            className={styles.generateSelection}
                            disabled={
                              (generation.status === "PLANNED" &&
                                !selectedScreenCodes.length) ||
                              startingImages ||
                              exportingPrompts ||
                              Boolean(detailProgress)
                            }
                            onClick={() => void continueWithImages(generation)}
                            type="button"
                          >
                            {startingImages
                              ? "Preparando imágenes…"
                              : `Generar ${generationScreenCount} pantalla${generationScreenCount === 1 ? "" : "s"} seleccionada${generationScreenCount === 1 ? "" : "s"}`}
                          </button>
                          <button
                            className={styles.exportSelection}
                            disabled={
                              (generation.status === "PLANNED" &&
                                !selectedScreenCodes.length) ||
                              startingImages ||
                              exportingPrompts ||
                              Boolean(detailProgress)
                            }
                            onClick={() => void exportPrompts()}
                            title="Descarga un TXT con un prompt por imagen para generarlas en otra IA"
                            type="button"
                          >
                            {exportingPrompts
                              ? "Exportando…"
                              : "Exportar prompts (TXT)"}
                          </button>
                        </div>
                      ) : null}
                      {generation?.status === "PLANNED" ? (
                        <div className={styles.selectionActions}>
                          <button
                            className={styles.secondaryAction}
                            disabled={Boolean(detailProgress) || startingImages}
                            onClick={() => void detailScreens(generation)}
                            title="La IA elegida vuelve a leer el documento y completa el detalle de cada pantalla"
                            type="button"
                          >
                            {detailProgress
                              ? `Detallando ${detailProgress.done}/${detailProgress.total}…`
                              : "Detallar de nuevo con la IA"}
                          </button>
                          {detailProgress ? (
                            <button
                              className={styles.secondaryAction}
                              onClick={() => detailAbortRef.current?.abort()}
                              title="Deja de pedir detalle a la IA; las pantallas pendientes conservan su detalle básico"
                              type="button"
                            >
                              Detener detalle
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {importNotice && previewTab === "TEXT" ? (
                        <p aria-live="polite" className={styles.compactStatus}>
                          {importNotice}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <div className={styles.analysisEmpty}>
                      <strong>
                        {busy && busyLabel === "Identificando pantallas…"
                          ? "Interpretando el Markdown…"
                          : "Resultado pendiente."}
                      </strong>
                      <span>
                        Aquí aparecerán el resumen, las pantallas identificadas,
                        sus objetivos y los componentes detectados por la IA.
                      </span>
                    </div>
                  )}
                </section>
              ) : (
                <div
                  aria-describedby="prototype-images-tab"
                  className={styles.imagePanel}
                  id="prototype-images-panel"
                  role="tabpanel"
                >
                  <div className={styles.imageSectionHeading}>
                    <div className={styles.galleryTitle}>
                      <h3>Galería generada</h3>
                      {availableDevices.length > 1 ? (
                        <div
                          aria-label="Formato de vista previa"
                          className={styles.tabs}
                          role="tablist"
                        >
                          {availableDevices.map((device) => (
                            <button
                              aria-controls="prototype-gallery-strip"
                              aria-selected={galleryDevice === device}
                              id={`prototype-device-tab-${device}`}
                              key={device}
                              onClick={() => chooseDevice(device)}
                              role="tab"
                              type="button"
                            >
                              {device === "WEB" ? "Web" : "Móvil"}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {generation &&
                    !["SOURCE_READY", "PLANNING", "PLANNED"].includes(
                      generation.status,
                    ) ? (
                      <div className={styles.importImages}>
                        <button
                          className={styles.secondaryAction}
                          disabled={importingImages || isActive}
                          onClick={() => importInputRef.current?.click()}
                          title="Importa PNG generados en otra IA; se asignan por el nombre del archivo"
                          type="button"
                        >
                          {importingImages ? "Importando…" : "Importar imágenes"}
                        </button>
                        <input
                          accept="image/png"
                          hidden
                          multiple
                          onChange={(event) => void importImages(event)}
                          ref={importInputRef}
                          type="file"
                        />
                      </div>
                    ) : null}
                    <div className={styles.galleryCounts} aria-live="polite">
                      {(["WEB", "MOBILE"] as const).map((device) => {
                        const deviceImages = images.filter(
                          (image) => image.device === device,
                        );
                        return (
                          <span key={device}>
                            {device === "WEB" ? "Web" : "Móvil"}{" "}
                            {
                              deviceImages.filter(
                                (image) => image.status === "COMPLETED",
                              ).length
                            }{" "}
                            / {deviceImages.length}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  {importNotice ? (
                    <p aria-live="polite" className={styles.compactStatus}>
                      {importNotice}
                    </p>
                  ) : null}
                  {imageProgress && imageProgress.status !== "COMPLETED" ? (
                    <div aria-live="polite" className={styles.compactStatus}>
                      {imageProgress.generatingImages > 0 ? (
                        <span>{imageProgress.generatingImages} generando</span>
                      ) : null}
                      {imageProgress.pendingImages > 0 ? (
                        <span>{imageProgress.pendingImages} pendientes</span>
                      ) : null}
                      {imageProgress.failedImages > 0 ? (
                        <span>{imageProgress.failedImages} con error</span>
                      ) : null}
                    </div>
                  ) : null}
                  {visibleImages.length ? (
                    <div
                      aria-label="Imágenes del prototipo"
                      className={styles.galleryStrip}
                      id="prototype-gallery-strip"
                    >
                      <div className={styles.thumbs}>
                        {visibleImages.map((image) => (
                          <button
                            aria-current={
                              selectedImage?.id === image.id
                                ? "true"
                                : undefined
                            }
                            className={styles.thumb}
                            key={image.id}
                            onClick={() => setSelectedScreenId(image.screenId)}
                            type="button"
                          >
                            <span
                              className={styles.thumbVisual}
                              data-device={image.device}
                            >
                              {image.storageKey && imageObjectUrls[image.id] ? (
                                <img
                                  alt=""
                                  height={image.height ?? undefined}
                                  loading="lazy"
                                  src={imageObjectUrls[image.id]}
                                  width={image.width ?? undefined}
                                />
                              ) : image.status === "GENERATING" ? (
                                "Generando…"
                              ) : image.status === "FAILED" ? (
                                "Error"
                              ) : (
                                "Pendiente"
                              )}
                            </span>
                            <strong>
                              {String(image.screenOrder).padStart(2, "0")}{" "}
                              {image.screenName}
                            </strong>
                            <small>{imageStatusLabel(image)}</small>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {selectedImage ? (
                    <div className={styles.stage}>
                      <div className={styles.screenHeader}>
                        <div>
                          <small>
                            {String(selectedIndex + 1).padStart(2, "0")} /{" "}
                            {String(visibleImages.length).padStart(2, "0")}
                          </small>
                          <h3>{selectedImage.screenName}</h3>
                        </div>
                      </div>
                      <div className={styles.frame} data-device={galleryDevice}>
                        <button
                          aria-label="Ver imagen anterior"
                          className={styles.framePrevious}
                          disabled={selectedIndex <= 0}
                          onClick={() => navigate(-1)}
                          type="button"
                        >
                          ‹
                        </button>
                        {selectedImage.storageKey &&
                        imageObjectUrls[selectedImage.id] ? (
                          <img
                            alt={`${selectedImage.screenName}, vista ${galleryDevice === "WEB" ? "web" : "móvil"}`}
                            height={selectedImage.height ?? undefined}
                            src={imageObjectUrls[selectedImage.id]}
                            width={selectedImage.width ?? undefined}
                          />
                        ) : (
                          <div className={styles.placeholder}>
                            <strong>{imageStatusLabel(selectedImage)}</strong>
                            <span>
                              {selectedImage.status === "FAILED"
                                ? selectedImage.errorMessage ||
                                  `No fue posible generar la vista ${selectedImage.screenName}.`
                                : "La imagen aparecerá automáticamente cuando esté disponible."}
                            </span>
                          </div>
                        )}
                        <button
                          aria-label="Ver imagen siguiente"
                          className={styles.frameNext}
                          disabled={selectedIndex >= visibleImages.length - 1}
                          onClick={() => navigate(1)}
                          type="button"
                        >
                          ›
                        </button>
                      </div>
                      <div className={styles.navigation}>
                        <button
                          aria-label="Pantalla anterior"
                          disabled={selectedIndex <= 0}
                          onClick={() => navigate(-1)}
                          type="button"
                        >
                          ‹ Anterior
                        </button>
                        <span>
                          {selectedImage.device === "WEB" ? "Web" : "Móvil"}
                        </span>
                        <button
                          aria-label="Pantalla siguiente"
                          disabled={selectedIndex >= visibleImages.length - 1}
                          onClick={() => navigate(1)}
                          type="button"
                        >
                          Siguiente ›
                        </button>
                      </div>
                      <div className={styles.actions}>
                        {selectedImage.storageKey ? (
                          <button
                            className={styles.secondaryAction}
                            disabled={Boolean(actionBusy)}
                            onClick={() => void downloadImage(selectedImage)}
                            type="button"
                          >
                            Descargar imagen
                          </button>
                        ) : null}
                        {selectedImage.status === "FAILED" ? (
                          <button
                            className={styles.action}
                            disabled={Boolean(actionBusy)}
                            onClick={() =>
                              void imageAction(selectedImage.id, "retry")
                            }
                            type="button"
                          >
                            Reintentar imagen
                          </button>
                        ) : null}
                        {selectedImage.status === "COMPLETED" ? (
                          <button
                            className={styles.secondaryAction}
                            disabled={Boolean(actionBusy)}
                            onClick={() => void regenerateImage(selectedImage)}
                            type="button"
                          >
                            Regenerar
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.empty}>
                      <strong>
                        {recovering
                          ? "Recuperando prototipo."
                          : busy
                            ? busyLabel
                            : fileName
                              ? "Fuente preparada."
                              : "Carga un documento Markdown."}
                      </strong>
                      <p>
                        {plan
                          ? `${plan.screens.length} pantallas identificadas.`
                          : visualResult
                            ? "Preparando diseño."
                            : "Las imágenes generadas se mostrarán aquí."}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function imageUrl(imageId: string, attemptNumber: number) {
  return `${GATEWAY_URL}/api/v1/prototypes/images/${encodeURIComponent(imageId)}/content?v=${attemptNumber}`;
}
function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…` : value;
}
function prototypeDateTime(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
function prototypeStatusLabel(
  status: PrototypeGenerationDetail["status"],
): string {
  const labels: Record<PrototypeGenerationDetail["status"], string> = {
    SOURCE_READY: "Borrador",
    PLANNING: "Procesando",
    PLANNED: "Planificado",
    VISUAL_SPEC_BUILDING: "Preparando diseño",
    VISUAL_SPEC_READY: "Diseño listo",
    IMAGE_GENERATING: "Generando",
    COMPLETED: "Completado",
    PARTIALLY_COMPLETED: "Parcial",
    FAILED: "Fallido",
  };
  return labels[status];
}
function prototypeStatusTone(
  status: PrototypeGenerationDetail["status"],
): "success" | "process" | "pending" | "danger" | "inactive" {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED") return "danger";
  if (status === "PARTIALLY_COMPLETED") return "pending";
  if (status === "SOURCE_READY") return "inactive";
  return "process";
}
function imageStatusLabel(image: PrototypeGeneratedImage) {
  return image.status === "COMPLETED"
    ? "✓ Generada"
    : image.status === "GENERATING"
      ? "Generando…"
      : image.status === "FAILED"
        ? "Error"
        : "Pendiente";
}

function planFrom(
  generation: PrototypeGenerationDetail,
  screens: PrototypeScreenDetail[],
): PrototypePlan {
  return {
    applicationName: generation.applicationName ?? "Prototipo",
    summary: generation.summary ?? "",
    targetDevice: generation.targetDevice,
    screens: [...screens]
      .sort((left, right) => left.order - right.order)
      .map((screen) => ({
        code: screen.code,
        name: screen.name,
        objective: screen.objective,
        origin: screen.origin,
        route: screen.route,
        components: screen.components,
        order: screen.order,
      })),
  };
}
function visualResultFrom(
  generation: PrototypeGenerationDetail,
  specifications: PrototypeVisualSpecification[],
): PrototypeVisualSpecificationBuildResult | null {
  return specifications.length
    ? {
        generation,
        specifications,
        webCount: specifications.filter((item) => item.device === "WEB").length,
        mobileCount: specifications.filter((item) => item.device === "MOBILE")
          .length,
        total: specifications.length,
      }
    : null;
}
async function restoreGeneration(id: string) {
  const base = `/api/v1/prototypes/generations/${encodeURIComponent(id)}`;
  const generation = await getJson<PrototypeGenerationDetail>(base);
  const [screens, specifications, images, progress] = await Promise.all([
    getJson<PrototypeScreenDetail[]>(`${base}/screens`),
    getJson<PrototypeVisualSpecification[]>(
      `${base}/visual-specifications`,
    ).catch(() => []),
    getJson<PrototypeGeneratedImage[]>(`${base}/images`).catch(() => []),
    getJson<PrototypeImageProgress>(`${base}/image-progress`).catch(() => ({
      generationId: id,
      status: generation.status,
      totalImages: generation.totalImages,
      completedImages: generation.completedImages,
      failedImages: generation.failedImages,
      pendingImages: 0,
      generatingImages: 0,
      web: { total: 0, completed: 0, failed: 0 },
      mobile: { total: 0, completed: 0, failed: 0 },
      current: null,
    })),
  ]);
  return { generation, screens, specifications, images, progress };
}
async function getJson<T extends object>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  return responsePayload<T>(
    await authenticatedFetch(`${GATEWAY_URL}${path}`, signal ? { signal } : {}),
  );
}
async function postJson<T extends object>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return responsePayload<T>(
    await authenticatedFetch(`${GATEWAY_URL}${path}`, {
      method: "POST",
      ...(signal ? { signal } : {}),
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    }),
  );
}
async function deleteJson(path: string): Promise<void> {
  await responsePayload<Record<string, unknown>>(
    await authenticatedFetch(`${GATEWAY_URL}${path}`, { method: "DELETE" }),
  );
}
async function responsePayload<T extends object>(
  response: Response,
): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | T
    | {
        message?: string | string[];
        detail?: string;
        correlationId?: string;
        metadata?: { code?: string };
      }
    | null;
  if (!response.ok) throw new Error(responseMessage(payload, response.status));
  return payload as T;
}
function responseMessage(
  payload:
    | {
        message?: string | string[];
        detail?: string;
        correlationId?: string;
        metadata?: { code?: string };
      }
    | object
    | null,
  status: number,
): string {
  const record =
    payload && typeof payload === "object"
      ? (payload as {
          message?: string | string[];
          detail?: string;
          correlationId?: string;
          metadata?: { code?: string };
        })
      : null;
  const rawMessage = record?.message;
  const message = Array.isArray(rawMessage)
    ? rawMessage[0]
    : typeof rawMessage === "string"
      ? rawMessage
      : typeof record?.detail === "string"
        ? record.detail
        : `No fue posible completar el prototipo (HTTP ${status}).`;
  const reference =
    typeof record?.correlationId === "string" && record.correlationId
      ? ` · Ref. ${record.correlationId.slice(0, 12)}`
      : "";
  return `${message || `No fue posible completar el prototipo (HTTP ${status}).`}${reference}`;
}
