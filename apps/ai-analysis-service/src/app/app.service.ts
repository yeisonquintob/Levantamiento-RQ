import { Injectable } from "@nestjs/common";

export interface HealthResponse {
  service: string;
  status: "ok";
  timestampUtc: string;
}

@Injectable()
export class AppService {
  getHealth(): HealthResponse {
    return {
      service: "ai-analysis-service",
      status: "ok",
      timestampUtc: new Date().toISOString(),
    };
  }
}
