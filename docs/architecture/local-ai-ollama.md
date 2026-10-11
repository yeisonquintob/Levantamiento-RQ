# IA local con Ollama

## Arquitectura

AI Analysis puede preprocesar cada snapshot de fuente individualmente con Ollama y `gemma4:12b`. El resultado JSON se valida, se guarda en `RqAiDb` y se consolida en un `ProjectKnowledgeSnapshot`. La selección de motores determina quién redacta: solo nube usa OpenAI, solo local usa Ollama y local+nube consolida con Ollama antes de redactar con OpenAI. Web y Gateway nunca se conectan a Ollama.

El flujo con análisis local es `Sources -> AnalysisRequestSources -> local-source-analysis -> Ollama -> SourceLocalAnalyses -> ProjectKnowledgeSnapshots -> generador seleccionado`. No existen claves foráneas hacia bases de otros dominios.

## Instalación en macOS

```bash
brew install ollama
ollama serve
ollama pull gemma4:12b
curl http://127.0.0.1:11434/api/tags
```

Antes de habilitarlo, confirme que el nombre exacto del modelo aparece en `/api/tags`. Ollama requiere memoria y almacenamiento suficientes para el modelo elegido.

## Variables

```dotenv
LOCAL_AI_ENABLED=true
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma4:12b
LOCAL_AI_MAX_CONCURRENT_JOBS=1
LOCAL_AI_TIMEOUT_MS=600000
LOCAL_AI_CONTEXT_TOKENS=131072
LOCAL_AI_FALLBACK_TO_RAW_SOURCES=false
LOCAL_AI_MAX_RESPONSE_BYTES=2097152
LOCAL_AI_ALLOW_DOCKER_HOST=false
```

Estas variables constituyen el arranque seguro. Un administrador puede crear
un proveedor `OLLAMA` desde `Configuración > Inteligencia artificial >
Proveedores`, elegir endpoint y modelo, habilitarlo, marcarlo como
predeterminado y ejecutar **Probar**. Una configuración guardada prevalece
sobre el `.env`; para activarse debe estar habilitada, predeterminada y haber
superado la prueba de conexión. Ollama nunca solicita API key. OpenAI conserva
su propio proveedor predeterminado independiente.

Solo se aceptan `127.0.0.1`, `localhost` y `::1`. Para un backend ejecutado dentro de Docker puede habilitarse explícitamente `LOCAL_AI_ALLOW_DOCKER_HOST=true` y usar `host.docker.internal`; no se permiten hosts arbitrarios, credenciales en URL ni HTTPS remoto.

## Caché, consolidación y tokens

La clave lógica de caché es `SourceId + SourceSha256 + Model + PromptVersion`. Un cambio de hash produce un análisis nuevo; una fuente ya completada no se reprocesa. Los fallos se conservan con código y mensaje sanitizado. La cola BullMQ `local-source-analysis` usa concurrencia inicial 1, jobId determinista, retry exponencial, recuperación Redis y cancelación de trabajos pendientes. La consolidación combina categorías, deduplica descripciones normalizadas y acumula todos los `sourceIds`; las contradicciones permanecen como hallazgos pendientes y no se resuelven automáticamente. Si el conjunto excede el 80 % del contexto se divide en bloques, se consolidan los bloques y se ejecuta una segunda pasada determinista sin truncar contenido.

Cada snapshot conserva caracteres y tokens estimados del original, análisis local y consolidado, además del porcentaje de reducción. La estimación determinista vigente es `ceil(caracteres / 4)`; los tokens reales de OpenAI siguen viniendo de su respuesta.

## Fallback y seguridad

En el modo de ejecución real, seleccionar IA local activa la validación obligatoria de cobertura: un fallo local bloquea la generación incluso si `LOCAL_AI_FALLBACK_TO_RAW_SOURCES=true`. En los modos que permiten ese fallback se registra `RAW_SOURCE_FALLBACK` en `RqAiDb`. No se registran prompts, fuentes, documentos ni respuestas completas. El cliente aplica timeout, AbortSignal, máximo de respuesta y validación estricta de JSON y `sourceIds`.

Las fuentes de texto usan el snapshot ya extraído. Para PNG, JPG/JPEG y WEBP, AI Analysis emite un JWT de servicio de cinco minutos y consume `internal-ai-image`; Sources verifica `service=ai-analysis-service`, conserva las credenciales Blob, limita MIME, marca `no-store` y entrega bytes con SHA-256. AI Analysis verifica el hash y envía la imagen directamente a Ollama. Nunca se transporta base64 por Web o Gateway.

## Diagnóstico

- `OLLAMA_UNAVAILABLE`: compruebe `ollama serve`, puerto y firewall local.
- `OLLAMA_MODEL_NOT_INSTALLED`: ejecute `ollama pull gemma4:12b`.
- `OLLAMA_TIMEOUT`: reduzca carga local o aumente el timeout dentro del máximo validado.
- `OLLAMA_OUTPUT_SCHEMA_INVALID`: inspeccione versión del modelo y mantenga temperatura cero.
- Para volver al flujo anterior, use `LOCAL_AI_ENABLED=false`.

## Smoke real

`pnpm ai:local:smoke` verifica `/api/tags`, salida JSON textual, defensa frente a instrucciones incrustadas, trazabilidad y una inferencia multimodal PNG real sin llamar OpenAI.


## Generación local del borrador por secciones (contrato 4.1)

`OllamaDraftProvider` usa `LocalDraftStages` cuando la solicitud selecciona solo LOCAL.
La nube y el modo combinado conservan su generador. El preanálisis local recibe las
orientaciones de la plantilla también en modo local solo.

1. Genera encabezado, objetivos, problema y alcance.
2. Genera la planificación y desarrolla una HU-F por cada HU-P, con título y enlace
   estables. Los arreglos de objetos se enumeran primero y se desarrollan elemento
   a elemento; no se pide todo el documento en una respuesta.
3. Genera flujos, entidades, pruebas, Scrum cuando corresponda, RNF y las secciones
   restantes usando evidencia común y referencias de los bloques ya generados.
4. Valida cada fragmento con el mismo JSON Schema de la nube, incluidos los sourceIds
   permitidos. Reintenta hasta tres veces un fragmento inválido; si un objeto resulta
   truncado lo divide en sus campos. No recorta evidencia para hacerlo caber.
5. Ensambla en orden canónico, aplica el parser documental y las comprobaciones de
   estructura explícita, alineación HU-P/HU-F y cobertura funcional. Los errores
   identificables permiten hasta tres correcciones del bloque afectado y sus
   dependientes. No se publica un borrador parcial como resultado completo.

Cada llamada reserva espacio de salida y comprueba el contexto incluyendo el schema.
Siguen vigentes el límite efectivo de 32.768 tokens de contexto y 8.192 de salida por
llamada, o los límites menores configurados. Un contexto compartido excesivo produce
un error explícito. Dividir la salida no elimina los límites de entrada del modelo.
Los tokens locales se acumulan como estimaciones y cada fragmento tiene traza propia.

Los fragmentos válidos se conservan en memoria durante esta ejecución. Esta versión
no añade checkpoints persistentes: un reinicio del servicio puede requerir generar
el borrador de nuevo, aunque el análisis de fuentes conserve su caché. Se consulta
la cancelación antes de cada llamada y al terminar; una llamada en curso puede tardar
hasta su timeout en liberarse. Pasados tres minutos, la vista continúa siguiendo el
trabajo en segundo plano sin presentarlo como un fallo.

Validación automatizada sin modelos externos:

```bash
TSX_TSCONFIG_PATH=apps/ai-analysis-service/tsconfig.app.json node --import tsx --test tests/ai-analysis/local-draft-stages.test.ts
```

Las pruebas verifican contrato, reintentos, truncación, referencias, reparación de
relaciones, Scrum y cancelación con respuestas controladas. La equivalencia semántica
con un modelo de nube exige comparar una ejecución real contra sus fuentes; no se
deduce de que el JSON sea válido.
