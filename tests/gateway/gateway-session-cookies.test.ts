import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";

import { AuthGatewayController } from "../../apps/gateway/src/auth/auth-gateway.controller";
import { IdentityClientService } from "../../apps/gateway/src/auth/identity-client.service";
import { AuthRateLimitGuard } from "../../apps/gateway/src/security/auth-rate-limit.guard";

/** @nestjs/common tal como lo resuelve el Gateway: el controlador reconoce las excepciones por instancia. */
const { HttpException } = createRequire(
  resolve("apps/gateway/src/auth/auth-gateway.controller.ts"),
)("@nestjs/common") as typeof import("@nestjs/common");

function httpStatus(expected: number) {
  return (error: unknown) =>
    typeof (error as { getStatus?: () => number }).getStatus === "function" &&
    (error as { getStatus: () => number }).getStatus() === expected;
}

const WEB = "https://app.example.test";
const OTHER_WEB = "https://otra.example.test";

function config(cookieSecure = true) {
  return { cookieSecure, webOrigins: [WEB, OTHER_WEB] } as never;
}

function session(mustChangePassword = false) {
  return {
    accessToken: "ACCESS-TOKEN",
    refreshToken: "REFRESH-TOKEN",
    accessTokenExpiresInSeconds: 900,
    refreshTokenExpiresInSeconds: 604_800,
    user: { id: "u1", displayName: "Ana", mustChangePassword },
  };
}

function reply() {
  const state: {
    headers: Record<string, string | string[]>;
    redirected?: [string, number];
  } = { headers: {} };
  return {
    state,
    reply: {
      header(name: string, value: string | string[]) {
        state.headers[name] = value;
      },
      redirect(url: string, status: number) {
        state.redirected = [url, status];
      },
    },
  };
}

function cookies(state: {
  headers: Record<string, string | string[]>;
}): string[] {
  const value = state.headers["set-cookie"];
  return Array.isArray(value) ? value : value ? [value] : [];
}

function cookie(list: string[], name: string, path?: string): string {
  const found = list.find(
    (item) =>
      item.startsWith(`${name}=`) && (!path || item.includes(`Path=${path}`)),
  );
  assert.ok(found, `falta la cookie ${name}${path ? ` en ${path}` : ""}`);
  return found;
}

function controller(identity: Record<string, unknown>, cookieSecure = true) {
  return new AuthGatewayController(identity as never, config(cookieSecure));
}

const request = (cookieHeader?: string) =>
  ({
    headers: {
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      "user-agent": "navegador",
    },
    ip: "10.0.0.5",
  }) as never;

test("el inicio de sesión entrega los tokens solo en cookies HttpOnly y nunca en el cuerpo", async () => {
  const received: unknown[] = [];
  const auth = controller({
    signIn: async (...args: unknown[]) => {
      received.push(args);
      return session();
    },
  });
  const { state, reply: res } = reply();

  const body = await auth.signIn(
    { email: "a@b.c", password: "x" },
    request(),
    res as never,
  );

  assert.deepEqual(Object.keys(body).sort(), [
    "accessTokenExpiresInSeconds",
    "user",
  ]);
  assert.equal(JSON.stringify(body).includes("TOKEN"), false);
  const list = cookies(state);
  const access = cookie(list, "rq_access");
  const refresh = cookie(list, "rq_refresh");
  for (const item of [access, refresh]) {
    assert.match(item, /HttpOnly/u);
    assert.match(item, /SameSite=Lax/u);
    assert.match(item, /Secure/u);
  }
  assert.match(access, /Max-Age=900/u);
  assert.match(access, /Path=\//u);
  assert.match(refresh, /Max-Age=604800/u);
  // La renovación solo viaja a las rutas de autenticación.
  assert.match(refresh, /Path=\/api\/v1\/auth/u);
  // Se informa a Identity del navegador y la IP de origen.
  assert.deepEqual((received[0] as unknown[])[1], {
    userAgent: "navegador",
    ipAddress: "10.0.0.5",
  });
});

test("las cookies llevan Secure solo cuando la configuración lo indica (desarrollo sin HTTPS)", async () => {
  const auth = controller({ signIn: async () => session() }, false);
  const { state, reply: res } = reply();

  await auth.signIn({}, request(), res as never);

  for (const item of cookies(state)) assert.doesNotMatch(item, /Secure/u);
});

test("quien debe cambiar la contraseña recibe un acceso limitado a las rutas de autenticación", async () => {
  const auth = controller({ signIn: async () => session(true) });
  const { state, reply: res } = reply();

  await auth.signIn({}, request(), res as never);

  assert.match(cookie(cookies(state), "rq_access"), /Path=\/api\/v1\/auth/u);
});

test("renovar sin cookie de renovación responde 401 y no consulta a Identity", async () => {
  let called = false;
  const auth = controller({
    refresh: async () => ((called = true), session()),
  });
  const { reply: res } = reply();

  await assert.rejects(
    auth.refresh(request("otra=1"), res as never),
    httpStatus(401),
  );
  assert.equal(called, false);
});

test("renovar con la cookie de renovación pasa el token a Identity y emite cookies nuevas", async () => {
  let token = "";
  const auth = controller({
    refresh: async (value: string) => ((token = value), session()),
  });
  const { state, reply: res } = reply();

  const body = await auth.refresh(
    request("rq_refresh=REFRESH-ANTERIOR"),
    res as never,
  );

  assert.equal(token, "REFRESH-ANTERIOR");
  assert.equal(body.user.id, "u1");
  assert.equal(cookies(state).length, 2);
});

test("cerrar sesión borra las cookies aunque Identity no responda", async () => {
  const auth = controller({
    signOut: async () => {
      throw Object.assign(new Error("caído"), { getStatus: () => 503 });
    },
  });
  const { state, reply: res } = reply();

  await assert.rejects(
    auth.signOut(request("rq_refresh=R"), res as never),
    /caído/u,
  );

  const list = cookies(state);
  assert.equal(list.length, 3);
  for (const item of list) assert.match(item, /Max-Age=0/u);
  cookie(list, "rq_access", "/");
  cookie(list, "rq_refresh", "/api/v1/auth");
});

test("cerrar sesión sin cookie de renovación no llama a Identity y responde que se cerró", async () => {
  let called = false;
  const auth = controller({ signOut: async () => ((called = true), {}) });
  const { state, reply: res } = reply();

  assert.deepEqual(await auth.signOut(request(), res as never), {
    signedOut: true,
  });
  assert.equal(called, false);
  assert.equal(cookies(state).length, 3);
});

test("cambiar la contraseña y consultar el usuario exigen la cookie de acceso", async () => {
  const auth = controller({
    changePassword: async (token: string) => ({
      ...session(true),
      accessToken: token,
    }),
    me: async (token: string) => ({ token }),
  });
  const { state, reply: res } = reply();

  await assert.rejects(
    auth.changePassword({}, request(), res as never),
    httpStatus(401),
  );
  assert.throws(() => auth.me(request("rq_refresh=R")), httpStatus(401));

  await auth.changePassword({}, request("rq_access=ACC"), res as never);
  // Tras cambiarla, el acceso deja de estar restringido a las rutas de autenticación.
  assert.match(cookie(cookies(state), "rq_access"), /Path=\//u);
  assert.doesNotMatch(cookie(cookies(state), "rq_access"), /Path=\/api/u);
  assert.deepEqual(await auth.me(request("rq_access=ACC")), { token: "ACC" });
});

test("el acceso con Microsoft redirige y guarda la transacción en una cookie acotada y de corta vida", async () => {
  const auth = controller({
    microsoftAuthorize: async (origin: string) => ({
      authorizationUrl: `https://login.microsoft.test/authorize?o=${encodeURIComponent(origin)}`,
      transaction: "TX-1",
    }),
  });
  const { state, reply: res } = reply();

  await auth.microsoftStart(OTHER_WEB, res as never);

  assert.deepEqual(state.redirected, [
    `https://login.microsoft.test/authorize?o=${encodeURIComponent(OTHER_WEB)}`,
    302,
  ]);
  const tx = cookie(cookies(state), "rq_ms_tx");
  assert.match(tx, /Max-Age=600/u);
  assert.match(tx, /Path=\/api\/v1\/auth\/microsoft/u);
  assert.match(tx, /HttpOnly/u);
});

test("un origen de retorno que no está en la lista se sustituye por el primero permitido", async () => {
  const origins: string[] = [];
  const auth = controller({
    microsoftAuthorize: async (origin: string) => (
      origins.push(origin),
      { authorizationUrl: "https://m.test", transaction: "t" }
    ),
  });
  for (const candidate of [
    "https://malo.example",
    undefined,
    "",
    `${OTHER_WEB}/`,
  ]) {
    const { reply: res } = reply();
    await auth.microsoftStart(candidate, res as never);
  }

  assert.deepEqual(origins, [WEB, WEB, WEB, OTHER_WEB]);
});

test("si Microsoft falla al iniciar, se vuelve a la pantalla de acceso con el motivo", async () => {
  const reasons: [number, string][] = [
    [401, "microsoft-denied"],
    [403, "microsoft-denied"],
    [503, "microsoft-unavailable"],
    [500, "microsoft-failed"],
  ];
  for (const [status, reason] of reasons) {
    const failing = controller({
      microsoftAuthorize: async () => {
        throw new HttpException("x", status);
      },
    });
    const { state, reply: res } = reply();
    await failing.microsoftStart(undefined, res as never);
    assert.deepEqual(state.redirected, [
      `${WEB}/sign-in?reason=${reason}`,
      302,
    ]);
  }
});

test("el retorno de Microsoft sin código, estado o transacción cancela y borra la transacción", async () => {
  const auth = controller({
    microsoftCallback: async () => assert.fail("no debe llamarse"),
  });

  for (const [query, reason] of [
    [{ error: "access_denied", code: "c", state: "s" }, "microsoft-cancelled"],
    [{ code: undefined, state: "s" }, "microsoft-failed"],
    [{ code: "c", state: undefined }, "microsoft-failed"],
  ] as const) {
    const { state, reply: res } = reply();
    await auth.microsoftCallback(
      (query as { code?: string }).code,
      (query as { state?: string }).state,
      (query as { error?: string }).error,
      request("rq_ms_tx=TX"),
      res as never,
    );
    assert.deepEqual(state.redirected, [
      `${WEB}/sign-in?reason=${reason}`,
      302,
    ]);
    assert.match(cookie(cookies(state), "rq_ms_tx"), /Max-Age=0/u);
  }

  // Sin la cookie de transacción tampoco se continúa.
  const { state, reply: res } = reply();
  await auth.microsoftCallback("c", "s", undefined, request(), res as never);
  assert.deepEqual(state.redirected, [
    `${WEB}/sign-in?reason=microsoft-failed`,
    302,
  ]);
});

test("un retorno de Microsoft correcto crea la sesión y lleva al espacio de trabajo o al cambio de contraseña", async () => {
  for (const [mustChange, destination] of [
    [false, "/workspace"],
    [true, "/change-password"],
  ] as const) {
    const auth = controller({
      microsoftCallback: async (input: Record<string, string>) => {
        assert.deepEqual(input, { code: "C", state: "S", transaction: "TX" });
        return { session: session(mustChange), webOrigin: OTHER_WEB };
      },
    });
    const { state, reply: res } = reply();

    await auth.microsoftCallback(
      "C",
      "S",
      undefined,
      request("rq_ms_tx=TX"),
      res as never,
    );

    assert.deepEqual(state.redirected, [`${OTHER_WEB}${destination}`, 302]);
    const list = cookies(state);
    assert.equal(
      list.length,
      3,
      "borra la transacción y emite acceso y renovación",
    );
    assert.match(cookie(list, "rq_ms_tx"), /Max-Age=0/u);
    cookie(list, "rq_access");
    cookie(list, "rq_refresh");
  }
});

test("si Identity rechaza el retorno de Microsoft, se vuelve a acceder con el motivo y sin sesión", async () => {
  const auth = controller({
    microsoftCallback: async () => {
      throw new HttpException("no", 403);
    },
  });
  const { state, reply: res } = reply();

  await auth.microsoftCallback(
    "C",
    "S",
    undefined,
    request("rq_ms_tx=TX"),
    res as never,
  );

  assert.deepEqual(state.redirected, [
    `${WEB}/sign-in?reason=microsoft-denied`,
    302,
  ]);
  assert.equal(
    cookies(state).some((item) => item.startsWith("rq_access=")),
    false,
  );
});

// ------------------------------------------------------------ cliente HTTP hacia Identity

const identityConfig = {
  identityServiceUrl: "http://identity.test",
  identityTimeoutMs: 1000,
} as never;

function stubFetch(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("el cliente de Identity reenvía el navegador, la IP y el token, y los datos como JSON", async () => {
  const stub = stubFetch(
    () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  try {
    const client = new IdentityClientService(identityConfig);
    await client.signIn(
      { email: "a@b.c" },
      { userAgent: "navegador", ipAddress: "10.0.0.5" },
    );
    await client.changePassword("ACC", { x: 1 }, {});
    await client.me("ACC");

    const first = stub.calls[0]!;
    assert.equal(first.url, "http://identity.test/api/v1/auth/sign-in");
    const headers = first.init.headers as Record<string, string>;
    assert.equal(headers["x-client-user-agent"], "navegador");
    assert.equal(headers["x-client-ip"], "10.0.0.5");
    assert.equal(headers["content-type"], "application/json");
    assert.equal(headers.authorization, undefined);
    assert.equal(first.init.body, JSON.stringify({ email: "a@b.c" }));

    const change = stub.calls[1]!.init.headers as Record<string, string>;
    assert.equal(change.authorization, "Bearer ACC");
    const me = stub.calls[2]!;
    assert.equal(me.init.method, "GET");
    assert.equal(me.init.body, undefined);
    assert.equal(
      (me.init.headers as Record<string, string>)["content-type"],
      undefined,
    );
  } finally {
    stub.restore();
  }
});

test("el cliente de Identity propaga el estado y el cuerpo de los errores, y trata la caída como 503", async () => {
  const client = new IdentityClientService(identityConfig);

  let stub = stubFetch(
    () =>
      new Response(JSON.stringify({ message: "Credenciales inválidas." }), {
        status: 401,
      }),
  );
  try {
    await assert.rejects(
      client.signIn({}, {}),
      (error: unknown) =>
        httpStatus(401)(error) &&
        JSON.stringify(
          (error as { getResponse: () => unknown }).getResponse(),
        ).includes("Credenciales inválidas"),
    );
  } finally {
    stub.restore();
  }

  stub = stubFetch(() => new Response("Bad Gateway", { status: 502 }));
  try {
    await assert.rejects(
      client.signIn({}, {}),
      (error: unknown) =>
        httpStatus(502)(error) &&
        JSON.stringify(
          (error as { getResponse: () => unknown }).getResponse(),
        ).includes("Bad Gateway"),
    );
  } finally {
    stub.restore();
  }

  stub = stubFetch(() => new Response("", { status: 500 }));
  try {
    await assert.rejects(
      client.signIn({}, {}),
      (error: unknown) =>
        httpStatus(500)(error) &&
        JSON.stringify(
          (error as { getResponse: () => unknown }).getResponse(),
        ).includes("Identity Service rechazó"),
    );
  } finally {
    stub.restore();
  }

  stub = stubFetch(() => {
    throw new Error("ECONNREFUSED");
  });
  try {
    await assert.rejects(client.signIn({}, {}), httpStatus(503));
  } finally {
    stub.restore();
  }
});

// ------------------------------------------------------------ límite de intentos de acceso

/** Redis simulado: cuenta por clave y registra las claves que se usan. */
function rateLimitGuard(
  options: { maximum?: number; failExec?: boolean } = {},
) {
  const guard = new AuthRateLimitGuard({
    authSignInRateLimit: options.maximum ?? 2,
    authSignInRateWindowSeconds: 60,
    rateLimitRedisHost: "127.0.0.1",
    rateLimitRedisPort: 1,
    rateLimitRedisPassword: null,
  } as never);
  (guard as unknown as { redis: { disconnect(): void } }).redis.disconnect();

  const counts = new Map<string, number>();
  const calls = { expire: [] as unknown[][], quit: 0 };
  (guard as unknown as { redis: unknown }).redis = {
    multi() {
      let key = "";
      const chain = {
        incr(value: string) {
          key = value;
          return chain;
        },
        expire(...args: unknown[]) {
          calls.expire.push(args);
          return chain;
        },
        async exec() {
          if (options.failExec) return null;
          counts.set(key, (counts.get(key) ?? 0) + 1);
          return [
            [null, counts.get(key)],
            [null, 1],
          ];
        },
      };
      return chain;
    },
    async ttl() {
      return 42;
    },
    async quit() {
      calls.quit += 1;
    },
  };
  return { guard, counts, calls };
}

const attempt = (
  guard: AuthRateLimitGuard,
  ip: string,
  body?: object,
  cookie?: string,
) =>
  guard.canActivate({
    switchToHttp: () => ({
      getRequest: () => ({
        ip,
        body,
        headers: cookie ? { cookie } : {},
      }),
    }),
  } as never);

test("el límite de acceso permite los intentos configurados y luego responde 429 con el tiempo de espera", async () => {
  const { guard } = rateLimitGuard({ maximum: 2 });
  const body = { email: "ana@example.test", password: "x" };

  assert.equal(await attempt(guard, "10.0.0.1", body), true);
  assert.equal(await attempt(guard, "10.0.0.1", body), true);
  await assert.rejects(attempt(guard, "10.0.0.1", body), (error: unknown) => {
    const response = (
      error as { getResponse: () => Record<string, unknown> }
    ).getResponse();
    return (
      httpStatus(429)(error) &&
      response.code === "AUTH_RATE_LIMITED" &&
      response.retryAfterSeconds === 42 &&
      /inicio de sesión/u.test(String(response.message))
    );
  });
});

test("el límite se cuenta por IP y correo (sin distinguir mayúsculas ni espacios) y no mezcla personas", async () => {
  const { guard } = rateLimitGuard({ maximum: 1 });

  assert.equal(
    await attempt(guard, "10.0.0.1", { email: "ana@example.test" }),
    true,
  );
  // Mismo correo escrito distinto: es la misma persona, ya agotó su intento.
  await assert.rejects(
    attempt(guard, "10.0.0.1", { email: "  ANA@Example.test " }),
    httpStatus(429),
  );
  // Otro correo u otra IP tienen su propio contador.
  assert.equal(
    await attempt(guard, "10.0.0.1", { email: "luis@example.test" }),
    true,
  );
  assert.equal(
    await attempt(guard, "10.0.0.2", { email: "ana@example.test" }),
    true,
  );
});

test("la renovación de sesión tiene su propio contador y no consume el del inicio de sesión", async () => {
  const { guard, counts } = rateLimitGuard({ maximum: 1 });

  assert.equal(
    await attempt(guard, "10.0.0.1", { email: "ana@example.test" }),
    true,
  );
  assert.equal(
    await attempt(guard, "10.0.0.1", undefined, "rq_refresh=R1"),
    true,
  );
  await assert.rejects(
    attempt(guard, "10.0.0.1", undefined, "rq_refresh=R1"),
    (error: unknown) =>
      /renovaciones/u.test(
        String(
          (error as { getResponse: () => { message: string } }).getResponse()
            .message,
        ),
      ),
  );
  // Otra sesión (otro token de renovación) desde la misma IP no se ve afectada.
  assert.equal(
    await attempt(guard, "10.0.0.1", undefined, "rq_refresh=R2"),
    true,
  );

  const keys = [...counts.keys()];
  assert.ok(keys.some((key) => key.includes(":signin:")));
  assert.ok(keys.some((key) => key.includes(":refresh:")));
});

test("las claves de Redis no contienen el correo ni el token de renovación en claro", async () => {
  const { guard, counts } = rateLimitGuard();

  await attempt(guard, "10.0.0.1", { email: "ana@example.test" });
  await attempt(guard, "10.0.0.1", undefined, "rq_refresh=TOKEN-SECRETO");

  for (const key of counts.keys()) {
    assert.match(
      key,
      /^rq:gateway:rate:auth:(signin|refresh|anonymous):\d+:[0-9a-f]{64}$/u,
    );
    assert.equal(key.includes("ana@example.test"), false);
    assert.equal(key.includes("TOKEN-SECRETO"), false);
  }
});

test("las peticiones anónimas de una misma IP comparten contador", async () => {
  const { guard } = rateLimitGuard({ maximum: 1 });

  assert.equal(await attempt(guard, "10.0.0.1"), true);
  await assert.rejects(attempt(guard, "10.0.0.1", {}), httpStatus(429));
});

test("si Redis no devuelve resultado, el acceso se bloquea en lugar de dejar pasar", async () => {
  const { guard } = rateLimitGuard({ failExec: true });

  await assert.rejects(
    attempt(guard, "10.0.0.1", { email: "ana@example.test" }),
    httpStatus(429),
  );
});

test("el contador expira con la ventana configurada y la conexión se cierra al apagar", async () => {
  const { guard, calls } = rateLimitGuard();

  await attempt(guard, "10.0.0.1", { email: "ana@example.test" });
  assert.deepEqual(calls.expire[0]?.slice(1), [60, "NX"]);

  await guard.onModuleDestroy();
  assert.equal(calls.quit, 1);
});
