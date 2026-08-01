import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";

import {
  CORRELATION_ID_HEADER,
  type CorrelationAwareRequest,
  type HeaderCapableResponse,
  resolveCorrelationId,
  setCorrelationIdHeader,
} from "./correlation-id.js";

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<CorrelationAwareRequest>();
    const response = http.getResponse<HeaderCapableResponse>();

    const correlationId = resolveCorrelationId(
      request.headers?.[CORRELATION_ID_HEADER],
    );

    request.correlationId = correlationId;
    setCorrelationIdHeader(response, correlationId);

    return next.handle();
  }
}
