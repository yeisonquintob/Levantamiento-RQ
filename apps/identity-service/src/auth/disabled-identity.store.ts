import { Injectable, ServiceUnavailableException } from "@nestjs/common";

import type {
  IdentityStore,
  IdentityUserRecord,
  NewRefreshSession,
  RefreshSessionRecord,
} from "./identity-store";

function unavailable(): never {
  throw new ServiceUnavailableException(
    "RqIdentityDb no está habilitada para identity-service.",
  );
}

@Injectable()
export class DisabledIdentityStore implements IdentityStore {
  findUserByEmailNormalized(): Promise<IdentityUserRecord | null> {
    return unavailable();
  }

  findUserById(): Promise<IdentityUserRecord | null> {
    return unavailable();
  }

  updateLastLogin(): Promise<void> {
    return unavailable();
  }

  createRefreshSession(): Promise<void> {
    return unavailable();
  }

  findRefreshSession(): Promise<RefreshSessionRecord | null> {
    return unavailable();
  }

  rotateRefreshSession(
    _currentSessionId: string,
    _nextSession: NewRefreshSession,
    _instant: Date,
  ): Promise<boolean> {
    return unavailable();
  }

  revokeRefreshSession(): Promise<void> {
    return unavailable();
  }
}
