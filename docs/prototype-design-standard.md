# Estándar visual de aplicaciones generadas

Todas las aplicaciones generadas desde Markdown utilizan `CORPORATE_DEFAULT_V1`, definido en `apps/prototypes-service/src/visual/prototype-design-system.ts`. El documento define la función; el sistema compartido define la presentación.

## Interpretación funcional

Interpretar encabezados, tablas, listas anidadas, historias, criterios de aceptación y referencias. Conservar etiquetas, columnas, tipos de campo, obligatoriedad, opciones, validaciones, permisos y estados documentados. Cada componente empieza por su tipo y conserva su descripción completa y referencia de requisito. No inventar datos, reglas ni rutas. Los estados y campos se integran en su pantalla, sin multiplicar vistas innecesarias.

## Identidad y navegación

Cada generación conserva el nombre de la aplicación y un menú común construido desde todas sus pantallas, incluso cuando solo se selecciona una para generar imágenes. La vista actual determina el elemento activo. Las rutas internas y referencias de requisitos no se imprimen como etiquetas de interfaz. La navegación respeta las restricciones documentadas; no representa una concesión de permisos.

- Web: menú lateral persistente de 240 px, cabecera de 64 px, contenido con margen interior de 24 px y separación de 16 px.
- Móvil: contenido de la aplicación a todo el ancho, cabecera de 56 px con acceso visible a Menú, navegación en panel desplegable, margen interior de 16 px y controles táctiles de 48 px.
- Formularios, detalles, errores y estados vacíos mantienen acceso a la navegación.
- No representar carcasas de teléfono, pantalla de inicio del sistema operativo, lanzadores, tiendas ni cuadrículas de aplicaciones ajenas.

## Apariencia

Usar la misma paleta, tipografía Inter, escala de texto, espaciado, radios, tablas, formularios, botones y estados semánticos del sistema central en cada pantalla. Fondo gris claro, superficies blancas y acento violeta corporativo. Los cambios del estándar deben hacerse en los tokens compartidos y propagarse a los prompts; no crear paletas por pantalla.

## Aplicación a resultados

La planificación común sirve a OpenAI y Ollama. Las especificaciones y el prompt visual común se utilizan antes de invocar al proveedor de imágenes. Las imágenes son resultados generativos: el estándar orienta su producción, pero no garantiza igualdad de píxeles ni convierte el prototipo en una aplicación funcional.

Los PNG existentes son instantáneas y no cambian automáticamente. Para recuperar detalles omitidos en un plan anterior, crear una nueva generación desde el Markdown y producir sus imágenes con el nuevo estándar. Una regeneración de imagen sobre una especificación antigua no recupera el detalle ausente del plan original.
