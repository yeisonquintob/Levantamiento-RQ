# Selección de modelos por ejecución

Fuentes y Discusión consultan el catálogo autenticado de configuraciones de texto en AI Analysis. Cada entrada pública contiene únicamente ID, nombre, modelo, motor, disponibilidad y límite de entrada. Configuración permite habilitar múltiples registros de Ollama y OpenAI; el predeterminado sirve como selección inicial.

El navegador guarda la elección por proyecto y módulo. Envía IDs de configuraciones, nunca URLs, secretos o nombres de modelos arbitrarios. El servidor comprueba tipo, habilitación y prueba de conexión. Fuentes persiste ID, modelo y endpoint por solicitud en AI Analysis, sin credenciales, para conservar la elección en cola y reintentos. Si el modelo o endpoint del registro cambia, la solicitud falla explícitamente y requiere una nueva generación. Un cambio del predeterminado no redirige solicitudes con selección explícita. Solicitudes históricas sin selección conservan el comportamiento anterior.

El medidor y el pipeline local reciben la misma selección que la generación. La caché local distingue modelos. El reintento de aplicación documental reutiliza el resultado existente sin invocar modelos.

## Ampliación prevista para Prototipos

En el formulario de Generar prototipo, debajo de Formato y antes del botón Generar, habrá dos selecciones independientes:

| Propósito                                   | Opciones                                              |
| ------------------------------------------- | ----------------------------------------------------- |
| Interpretar Markdown y planificar pantallas | Texto local Ollama o texto nube OpenAI                |
| Generar imágenes                            | Imágenes locales ComfyUI o proveedor de imágenes nube |

ComfyUI responde en `http://127.0.0.1:8188` (verificado mediante `/system_stats` el 9 de septiembre de 2026). Es un ejecutor de workflows de imágenes, no un proveedor de texto Ollama. Su configuración tendrá capacidad IMAGE_GENERATION y un workflow validado con checkpoint, entradas y salidas identificadas. No se debe insertar este endpoint como proveedor OLLAMA ni usarlo para documentos.

Antes de activar la integración se necesita adaptar y validar el workflow real de ComfyUI, su sondeo de trabajos, cancelación, errores y recuperación de archivos. El catálogo futuro filtrará por propósito (TEXT_GENERATION, PROTOTYPE_PLANNING, IMAGE_GENERATION), manteniendo separados disponibilidad y selección. La llamada será desde el servidor; los servicios seguirán usando autenticación interna y AI Analysis mantendrá la propiedad de las credenciales de nube.

Esta mejora implementa selección de texto en Fuentes y Discusión. La conexión de generación de imágenes y los selectores de Prototipos corresponden a la ampliación posterior solicitada.
