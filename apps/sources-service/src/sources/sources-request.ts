import type { MultipartFile } from "@fastify/multipart";

import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

interface MultipartField {
  type: "field";
  fieldname: string;
  value: unknown;
}

type SourcesMultipartPart = MultipartFile | MultipartField;

export interface SourcesRequest {
  headers: Readonly<Record<string, string | string[] | undefined>>;
  authPrincipal?: AuthenticatedUser;
  accessToken?: string;
  isMultipart(): boolean;
  parts(): AsyncIterableIterator<SourcesMultipartPart>;
}
