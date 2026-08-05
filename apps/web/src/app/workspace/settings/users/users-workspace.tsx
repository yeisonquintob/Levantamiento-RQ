"use client";

import { useMemo, useState } from "react";

import type {
  CreateIdentityUserResponse,
  IdentityRoleSummary,
  IdentityUserDetail,
  IdentityUserListResponse,
  IdentityUserMetrics,
  IdentityUserSummary,
  ResetIdentityUserPasswordResponse,
} from "@levantamiento-rq/shared-contracts";
import {
  RqActionButton,
  RqEmptyState,
  RqKpiCard,
  RqKpiGrid,
  RqStatusBadge,
  RqTableShell,
} from "@levantamiento-rq/shared-ui";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

const EMPTY_LIST: IdentityUserListResponse = {
  items: [],
  page: 1,
  pageSize: 50,
  totalItems: 0,
  totalPages: 0,
};

const EMPTY_METRICS: IdentityUserMetrics = {
  total: 0,
  active: 0,
  inactive: 0,
  administrators: 0,
};

type ModalMode = "create" | "view" | "edit" | "reset" | "deactivate" | "password";

interface UserForm {
  displayName: string;
  email: string;
  roleCodes: string[];
  temporaryPassword: string;
}

interface Props {
  initialList?: IdentityUserListResponse;
  initialMetrics?: IdentityUserMetrics;
  initialRoles?: readonly IdentityRoleSummary[];
  initialError?: string;
}

function emptyForm(): UserForm {
  return { displayName: "", email: "", roleCodes: [], temporaryPassword: "" };
}

function dateTime(value: string | null): string {
  if (!value) return "Sin registro";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function failure(response: Response): Promise<string> {
  if (response.status === 401) {
    window.location.assign("/sign-in");
    return "Sesión vencida.";
  }

  const payload = (await response.json().catch(() => null)) as unknown;

  if (payload && typeof payload === "object") {
    if ("detail" in payload && typeof payload.detail === "string") {
      return payload.detail;
    }
    if ("message" in payload && typeof payload.message === "string") {
      return payload.message;
    }
  }

  return "La operación no pudo completarse.";
}

export function UsersWorkspace({
  initialList,
  initialMetrics,
  initialRoles,
  initialError,
}: Props) {
  const [list, setList] = useState(initialList ?? EMPTY_LIST);
  const [metrics, setMetrics] = useState(initialMetrics ?? EMPTY_METRICS);
  const [roles] = useState(initialRoles ?? []);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [roleCode, setRoleCode] = useState("");
  const [alert, setAlert] = useState(initialError ?? "");
  const [alertTone, setAlertTone] = useState<"success" | "danger">("danger");
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<ModalMode | null>(null);
  const [selected, setSelected] = useState<IdentityUserDetail | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm());
  const [oneTimePassword, setOneTimePassword] = useState("");

  const modalTitle = useMemo(() => {
    if (modal === "create") return "Nueva cuenta";
    if (modal === "edit") return "Editar usuario";
    if (modal === "reset") return "Restablecer contraseña";
    if (modal === "deactivate") return "Desactivar usuario";
    if (modal === "password") return "Contraseña temporal";
    return "Detalle del usuario";
  }, [modal]);

  function show(message: string, tone: "success" | "danger"): void {
    setAlert(message);
    setAlertTone(tone);
  }

  function close(force = false): void {
    if (busy && !force) return;
    setModal(null);
    setSelected(null);
    setForm(emptyForm());
    setOneTimePassword("");
  }

  async function refresh(nextSearch = search, nextStatus = status, nextRole = roleCode) {
    const query = new URLSearchParams({ page: "1", pageSize: "50" });
    if (nextSearch.trim()) query.set("search", nextSearch.trim());
    if (nextStatus) query.set("status", nextStatus);
    if (nextRole) query.set("roleCode", nextRole);

    const [usersResponse, metricsResponse] = await Promise.all([
      fetch(`${GATEWAY_URL}/api/v1/users?${query}`, { credentials: "include" }),
      fetch(`${GATEWAY_URL}/api/v1/users/summary`, { credentials: "include" }),
    ]);

    if (!usersResponse.ok || !metricsResponse.ok) {
      throw new Error(
        !usersResponse.ok
          ? await failure(usersResponse)
          : await failure(metricsResponse),
      );
    }

    setList((await usersResponse.json()) as IdentityUserListResponse);
    setMetrics((await metricsResponse.json()) as IdentityUserMetrics);
  }

  async function load(user: IdentityUserSummary, mode: "view" | "edit" | "reset" | "deactivate") {
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/users/${encodeURIComponent(user.id)}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error(await failure(response));
      const detail = (await response.json()) as IdentityUserDetail;
      setSelected(detail);
      setForm({
        displayName: detail.displayName,
        email: detail.email,
        roleCodes: detail.roles.map((role) => role.code),
        temporaryPassword: "",
      });
      setModal(mode);
      setAlert("");
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(false);
    }
  }

  function toggleRole(code: string): void {
    setForm((current) => ({
      ...current,
      roleCodes: current.roleCodes.includes(code)
        ? current.roleCodes.filter((item) => item !== code)
        : [...current.roleCodes, code],
    }));
  }

  async function submitCreate() {
    setBusy(true);
    try {
      const response = await fetch(`${GATEWAY_URL}/api/v1/users`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: form.displayName,
          email: form.email,
          roleCodes: form.roleCodes,
          ...(form.temporaryPassword
            ? { temporaryPassword: form.temporaryPassword }
            : {}),
        }),
      });
      if (!response.ok) throw new Error(await failure(response));
      const result = (await response.json()) as CreateIdentityUserResponse;
      await refresh();
      setSelected(result.user);
      setOneTimePassword(result.temporaryPassword);
      setModal("password");
      show("Usuario creado correctamente.", "success");
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit() {
    if (!selected) return;
    setBusy(true);
    try {
      const base = `${GATEWAY_URL}/api/v1/users/${encodeURIComponent(selected.id)}`;
      const update = await fetch(base, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: form.displayName, email: form.email }),
      });
      if (!update.ok) throw new Error(await failure(update));
      const roleUpdate = await fetch(`${base}/roles`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleCodes: form.roleCodes }),
      });
      if (!roleUpdate.ok) throw new Error(await failure(roleUpdate));
      close(true);
      await refresh();
      show("Usuario actualizado correctamente.", "success");
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/users/${encodeURIComponent(selected.id)}/reset-password`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            form.temporaryPassword
              ? { temporaryPassword: form.temporaryPassword }
              : {},
          ),
        },
      );
      if (!response.ok) throw new Error(await failure(response));
      const result = (await response.json()) as ResetIdentityUserPasswordResponse;
      await refresh();
      setSelected(result.user);
      setOneTimePassword(result.temporaryPassword);
      setModal("password");
      show("Contraseña restablecida y sesiones revocadas.", "success");
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(false);
    }
  }

  async function userAction(user: IdentityUserSummary, action: "activate" | "deactivate" | "revoke-sessions") {
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/users/${encodeURIComponent(user.id)}/${action}`,
        { method: "POST", credentials: "include" },
      );
      if (!response.ok) throw new Error(await failure(response));
      close(true);
      await refresh();
      show(
        action === "activate"
          ? "Usuario activado."
          : action === "deactivate"
            ? "Usuario desactivado y sesiones revocadas."
            : "Sesiones revocadas.",
        "success",
      );
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rq-users-workspace">
      <section className="rq-module-commandbar">
        <RqKpiGrid label="Resumen de usuarios">
          <RqKpiCard description="Cuentas registradas" icon="U" title="Total" value={String(metrics.total)} />
          <RqKpiCard description="Acceso habilitado" icon="A" title="Activos" value={String(metrics.active)} />
          <RqKpiCard description="Acceso bloqueado" icon="I" title="Inactivos" value={String(metrics.inactive)} />
          <RqKpiCard description="Rol global ADMIN" icon="R" title="Administradores" value={String(metrics.administrators)} />
        </RqKpiGrid>
        <div className="rq-module-commandbar__actions">
          <RqActionButton
            disabled={busy}
            onClick={() => {
              setForm(emptyForm());
              setModal("create");
            }}
            tone="affirmative"
          >
            Nuevo usuario
          </RqActionButton>
        </div>
      </section>

      {alert ? (
        <div className="rq-project-alert" data-tone={alertTone} role="alert">
          <span>{alert}</span>
          <button aria-label="Cerrar mensaje" onClick={() => setAlert("")} type="button">×</button>
        </div>
      ) : null}

      <form
        className="rq-filter-bar rq-users-filter"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void refresh()
            .catch((error: unknown) => show(error instanceof Error ? error.message : String(error), "danger"))
            .finally(() => setBusy(false));
        }}
      >
        <label className="rq-field"><span>Buscar</span><input onChange={(event) => setSearch(event.target.value)} placeholder="Nombre o correo" value={search} /></label>
        <label className="rq-field"><span>Estado</span><select onChange={(event) => setStatus(event.target.value)} value={status}><option value="">Todos</option><option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo</option></select></label>
        <label className="rq-field"><span>Rol</span><select onChange={(event) => setRoleCode(event.target.value)} value={roleCode}><option value="">Todos</option>{roles.map((role) => <option key={role.id} value={role.code}>{role.name}</option>)}</select></label>
        <div className="rq-filter-bar__actions">
          <RqActionButton disabled={busy} tone="consult" type="submit">Consultar</RqActionButton>
          <RqActionButton disabled={busy} onClick={() => { setSearch(""); setStatus(""); setRoleCode(""); void refresh("", "", ""); }}>Limpiar</RqActionButton>
        </div>
      </form>

      <RqTableShell count={list.totalItems} description="Cuentas, roles globales, estado y actividad de sesiones." title="Usuarios">
        {list.items.length === 0 ? (
          <RqEmptyState description="No hay usuarios que coincidan con los filtros." title="Sin resultados" />
        ) : (
          <table className="rq-table rq-users-table">
            <thead><tr><th>Usuario</th><th>Roles</th><th>Estado</th><th>Sesiones</th><th>Último acceso</th><th>Actualización</th><th>Acciones</th></tr></thead>
            <tbody>{list.items.map((user) => (
              <tr key={user.id}>
                <td><span className="rq-users-table__identity"><strong>{user.displayName}</strong><span>{user.email}</span>{user.mustChangePassword ? <small>Cambio de contraseña pendiente</small> : null}</span></td>
                <td>{user.roles.map((role) => role.code).join(", ") || "Sin rol"}</td>
                <td><RqStatusBadge tone={user.status === "ACTIVE" ? "success" : "inactive"}>{user.status === "ACTIVE" ? "Activo" : "Inactivo"}</RqStatusBadge></td>
                <td>{user.activeSessionCount}</td><td>{dateTime(user.lastLoginAt)}</td><td>{dateTime(user.updatedAt)}</td>
                <td><div className="rq-users-table__actions">
                  <RqActionButton compact disabled={busy} onClick={() => void load(user, "view")} tone="consult">Ver</RqActionButton>
                  <RqActionButton compact disabled={busy} onClick={() => void load(user, "edit")} tone="operation">Editar</RqActionButton>
                  <RqActionButton compact disabled={busy} onClick={() => void load(user, "reset")} tone="operation">Restablecer</RqActionButton>
                  <RqActionButton compact disabled={busy || user.activeSessionCount === 0} onClick={() => void userAction(user, "revoke-sessions")} tone="danger">Revocar sesiones</RqActionButton>
                  {user.status === "ACTIVE" ? <RqActionButton compact disabled={busy} onClick={() => void load(user, "deactivate")} tone="danger">Desactivar</RqActionButton> : <RqActionButton compact disabled={busy} onClick={() => void userAction(user, "activate")} tone="affirmative">Activar</RqActionButton>}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </RqTableShell>

      {modal ? (
        <div aria-modal="true" className="rq-project-modal-backdrop" role="dialog">
          <section className="rq-project-modal rq-users-modal">
            <header className="rq-project-modal__header"><div><span>Configuración · Usuarios</span><h2>{modalTitle}</h2></div><button aria-label="Cerrar" disabled={busy} onClick={() => close()} type="button">×</button></header>

            {modal === "password" ? (
              <div className="rq-users-password"><p><strong>Esta contraseña se mostrará una sola vez. El usuario deberá cambiarla al iniciar sesión.</strong></p><output>{oneTimePassword}</output><div className="rq-project-modal__actions"><RqActionButton onClick={() => close()}>Entendido</RqActionButton></div></div>
            ) : modal === "view" && selected ? (
              <div className="rq-users-detail"><dl><div><dt>Nombre</dt><dd>{selected.displayName}</dd></div><div><dt>Correo</dt><dd>{selected.email}</dd></div><div><dt>Estado</dt><dd>{selected.status}</dd></div><div><dt>Roles</dt><dd>{selected.roles.map((role) => role.name).join(", ")}</dd></div><div><dt>Creación</dt><dd>{dateTime(selected.createdAt)}</dd></div><div><dt>Última modificación</dt><dd>{dateTime(selected.updatedAt)}</dd></div><div><dt>Último acceso</dt><dd>{dateTime(selected.lastLoginAt)}</dd></div><div><dt>Sesiones activas</dt><dd>{selected.activeSessionCount}</dd></div></dl><div className="rq-project-modal__actions"><RqActionButton onClick={() => close()}>Cerrar</RqActionButton></div></div>
            ) : modal === "deactivate" && selected ? (
              <div className="rq-users-confirm"><p>¿Deseas desactivar a <strong>{selected.displayName}</strong>? No podrá iniciar sesión y sus sesiones abiertas serán revocadas.</p><div className="rq-project-modal__actions"><RqActionButton disabled={busy} onClick={() => close()}>Cancelar</RqActionButton><RqActionButton disabled={busy} onClick={() => void userAction(selected, "deactivate")} tone="danger">Confirmar desactivación</RqActionButton></div></div>
            ) : modal === "reset" ? (
              <form className="rq-project-form" onSubmit={(event) => { event.preventDefault(); void resetPassword(); }}><label className="rq-field"><span>Contraseña temporal (opcional)</span><input disabled={busy} maxLength={256} minLength={12} onChange={(event) => setForm((current) => ({ ...current, temporaryPassword: event.target.value }))} placeholder="Dejar vacío para generar" type="password" value={form.temporaryPassword} /></label><p>Se revocarán todas las sesiones y se exigirá cambio al iniciar.</p><div className="rq-project-modal__actions"><RqActionButton disabled={busy} onClick={() => close()}>Cancelar</RqActionButton><RqActionButton disabled={busy} tone="affirmative" type="submit">Restablecer</RqActionButton></div></form>
            ) : (
              <form className="rq-project-form rq-users-form" onSubmit={(event) => { event.preventDefault(); void (modal === "create" ? submitCreate() : submitEdit()); }}>
                <label className="rq-field"><span>Nombre</span><input disabled={busy} maxLength={200} minLength={2} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} required value={form.displayName} /></label>
                <label className="rq-field"><span>Correo</span><input disabled={busy} maxLength={320} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required type="email" value={form.email} /></label>
                <fieldset className="rq-users-roles"><legend>Roles globales</legend>{roles.map((role) => <label key={role.id}><input checked={form.roleCodes.includes(role.code)} disabled={busy} onChange={() => toggleRole(role.code)} type="checkbox" />{role.name} <small>{role.code}</small></label>)}</fieldset>
                {modal === "create" ? <label className="rq-field"><span>Contraseña temporal (opcional)</span><input disabled={busy} maxLength={256} minLength={12} onChange={(event) => setForm((current) => ({ ...current, temporaryPassword: event.target.value }))} placeholder="Dejar vacío para generar" type="password" value={form.temporaryPassword} /></label> : null}
                <div className="rq-project-modal__actions"><RqActionButton disabled={busy} onClick={() => close()}>Cancelar</RqActionButton><RqActionButton disabled={busy || form.roleCodes.length === 0} tone="affirmative" type="submit">Guardar</RqActionButton></div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
