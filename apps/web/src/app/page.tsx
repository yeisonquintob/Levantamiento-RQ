import {
  RqActionButton,
  RqEmptyState,
  RqKpiCard,
  RqKpiGrid,
  RqPageHero,
  RqTableShell,
} from "@levantamiento-rq/shared-ui";

export default function HomePage() {
  return (
    <>
      <RqPageHero
        eyebrow="Base inicial"
        title="Gestión de levantamientos"
        description="La interfaz está preparada para incorporar proyectos, fuentes, documentos, revisión y aprobaciones sin inventar información."
        actions={
          <RqActionButton
            disabled
            title="Se habilitará cuando se implemente Projects Service"
            tone="affirmative"
          >
            Nuevo proyecto
          </RqActionButton>
        }
      />

      <RqKpiGrid label="Resumen del workspace">
        <RqKpiCard
          description="Registrados"
          icon="P"
          title="Proyectos"
          value="0"
        />
        <RqKpiCard description="Cargadas" icon="F" title="Fuentes" value="0" />
        <RqKpiCard
          description="En elaboración"
          icon="B"
          title="Borradores"
          value="0"
        />
        <RqKpiCard
          description="Por definir"
          icon="!"
          title="Pendientes"
          value="0"
        />
      </RqKpiGrid>

      <section className="rq-filter-bar" aria-label="Filtros de proyectos">
        <div className="rq-field">
          <label htmlFor="project-search">Buscar proyecto</label>
          <input
            disabled
            id="project-search"
            name="project-search"
            placeholder="Código, título o área solicitante"
            title="Se habilitará junto con Projects Service"
            type="search"
          />
        </div>

        <div className="rq-field">
          <label htmlFor="project-status">Estado</label>
          <select
            defaultValue=""
            disabled
            id="project-status"
            name="project-status"
            title="Se habilitará junto con Projects Service"
          >
            <option value="">Todos</option>
            <option value="draft">Borrador</option>
            <option value="validation">En validación</option>
            <option value="approved">Aprobado</option>
          </select>
        </div>

        <div className="rq-filter-bar__actions">
          <RqActionButton disabled tone="consult">
            Buscar
          </RqActionButton>
          <RqActionButton disabled tone="secondary">
            Limpiar
          </RqActionButton>
        </div>
      </section>

      <RqTableShell
        count={0}
        description="Los datos reales se incorporarán al implementar Projects Service."
        title="Proyectos"
      >
        <table className="rq-table">
          <thead>
            <tr>
              <th scope="col">Código</th>
              <th scope="col">Proyecto</th>
              <th scope="col">Área solicitante</th>
              <th scope="col">Estado</th>
              <th scope="col">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5}>
                <RqEmptyState
                  title="Sin proyectos registrados"
                  description="Esta vista no usa datos simulados. Los proyectos aparecerán cuando el dominio correspondiente esté implementado."
                />
              </td>
            </tr>
          </tbody>
        </table>
      </RqTableShell>

      <aside className="rq-foundation-note" role="status">
        <strong>Alcance del Paso 9</strong>
        <span>
          Se creó la base visual responsive. Autenticación, datos, formularios
          funcionales y conexión con el Gateway permanecen pendientes para pasos
          posteriores.
        </span>
      </aside>
    </>
  );
}
