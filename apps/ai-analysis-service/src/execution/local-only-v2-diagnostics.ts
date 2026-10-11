// AI_ANALYSIS_LOCAL_ONLY_V2_DIAGNOSTICS_V1
//
// Registro mínimo para entender por qué una subunidad usó un respaldo o perdió
// contenido. Solo emite metadatos (sección, subunidad, motivo, longitudes):
// nunca contenido de fuentes, respuestas ni datos personales.
export function localOnlyV2Diagnostic(
  event: string,
  data: Readonly<Record<string, string | number | boolean | null>>,
): void {
  try {
    console.info(`[LOCAL_ONLY_V2_DIAG] ${JSON.stringify({ event, ...data })}`);
  } catch {
    // El diagnóstico nunca debe afectar la generación.
  }
}
