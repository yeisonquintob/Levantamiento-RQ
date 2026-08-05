import { Injectable, ServiceUnavailableException } from "@nestjs/common";

import type {
  IdentityStore,
  IdentityUserRecord,
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

  rotateRefreshSession(): Promise<boolean> {
    return unavailable();
  }

  revokeRefreshSession(): Promise<void> {
    return unavailable();
  }

  changePassword(): Promise<boolean> {
    return unavailable();
  }
}
