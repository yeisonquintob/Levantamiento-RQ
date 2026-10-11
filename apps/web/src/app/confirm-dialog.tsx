"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { RqActionButton } from "@levantamiento-rq/shared-ui";

import { useDialogAccessibility } from "./use-dialog-accessibility";

export interface ConfirmOptions {
  /** Texto del diálogo; los saltos de línea se respetan. */
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Acción destructiva o irreversible: el botón principal va en rojo. */
  destructive?: boolean;
}

type Confirm = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/**
 * Reemplazo del cuadro nativo `window.confirm`: mismo estilo que los demás diálogos de la app,
 * con foco atrapado, Escape para cancelar y lectura correcta por lectores de pantalla.
 */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>((options) => {
    // Una confirmación pendiente se cancela si llega otra.
    resolver.current?.(false);
    setRequest(typeof options === "string" ? { message: options } : options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setRequest(null);
  }, []);

  const dialogRef = useDialogAccessibility<HTMLElement>(Boolean(request), () =>
    settle(false),
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && typeof document !== "undefined"
        ? createPortal(
            <div
              className="rq-project-modal-backdrop"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) settle(false);
              }}
            >
              <section
                aria-describedby="rq-confirm-message"
                aria-labelledby="rq-confirm-title"
                aria-modal="true"
                className="rq-project-modal rq-confirm-dialog"
                ref={dialogRef}
                role="alertdialog"
                tabIndex={-1}
              >
                <header className="rq-project-modal__header">
                  <div>
                    <h2 id="rq-confirm-title">
                      {request.title ?? "Confirmar acción"}
                    </h2>
                  </div>
                </header>
                <p className="rq-confirm-dialog__message" id="rq-confirm-message">
                  {request.message}
                </p>
                <footer className="rq-project-modal__actions">
                  <RqActionButton
                    onClick={() => settle(false)}
                    tone="secondary"
                    type="button"
                  >
                    {request.cancelLabel ?? "Cancelar"}
                  </RqActionButton>
                  <RqActionButton
                    onClick={() => settle(true)}
                    tone={request.destructive ? "danger" : "operation"}
                    type="button"
                  >
                    {request.confirmLabel ?? "Continuar"}
                  </RqActionButton>
                </footer>
              </section>
            </div>,
            document.body,
          )
        : null}
    </ConfirmContext.Provider>
  );
}

/**
 * Sin proveedor (por ejemplo al renderizar un componente aislado en una prueba) se usa el cuadro
 * nativo del navegador, de modo que ningún componente falla por no estar dentro del shell.
 */
const nativeConfirm: Confirm = async (options) => {
  const message = typeof options === "string" ? options : options.message;
  return typeof window !== "undefined" ? window.confirm(message) : false;
};

/** `await confirm(...)` devuelve true si la persona confirma. */
export function useConfirm(): Confirm {
  return useContext(ConfirmContext) ?? nativeConfirm;
}
