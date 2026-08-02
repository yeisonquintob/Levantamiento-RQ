export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  roles: readonly string[];
  permissions: readonly string[];
}

export interface SignInRequest {
  email: string;
  password: string;
}

export interface RefreshSessionRequest {
  refreshToken: string;
}

export interface SignOutRequest {
  refreshToken: string;
}

export interface AuthSessionResponse {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
  refreshTokenExpiresInSeconds: number;
}

export interface GatewayAuthSessionResponse {
  user: AuthenticatedUser;
  accessTokenExpiresInSeconds: number;
}

export interface SignOutResponse {
  signedOut: true;
}
