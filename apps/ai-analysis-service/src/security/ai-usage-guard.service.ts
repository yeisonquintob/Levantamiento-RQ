import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleDestroy,
} from "@nestjs/common";
import Redis from "ioredis";

import {
  AI_ANALYSIS_PROCESSING_CONFIG,
  type AiAnalysisProcessingConfig,
} from "../execution/ai-analysis-processing.config";

const RESERVE_SCRIPT = `
local limits = {}
for index = 1, 12 do limits[index] = tonumber(ARGV[index]) end
local amount = tonumber(ARGV[13])
local requestId = ARGV[14]
local counterAmounts = {1, 1, 1, 1, 1, 1, amount, amount, amount}
for index = 1, 9 do
  local current = tonumber(redis.call('GET', KEYS[index]) or '0')
  if current + counterAmounts[index] > limits[index] then
    local ttl = redis.call('TTL', KEYS[index])
    if ttl < 1 then ttl = 60 end
    return {0, ttl, index}
  end
end
for index = 10, 12 do
  if redis.call('SCARD', KEYS[index]) >= limits[index] then
    return {0, 60, index}
  end
end
for index = 1, 9 do
  redis.call('INCRBY', KEYS[index], counterAmounts[index])
  if redis.call('TTL', KEYS[index]) < 0 then
    redis.call('EXPIRE', KEYS[index], (index == 1 or index == 3 or index == 5) and 3600 or 86400)
  end
end
for index = 10, 12 do
  redis.call('SADD', KEYS[index], requestId)
  redis.call('EXPIRE', KEYS[index], 86400)
end
return {1, 0, 0}
`;

const RESERVE_BUDGET_SCRIPT = `
if redis.call('EXISTS', KEYS[3]) == 1 then return {1, 0} end
local daily = tonumber(redis.call('GET', KEYS[1]) or '0')
local monthly = tonumber(redis.call('GET', KEYS[2]) or '0')
local amount = tonumber(ARGV[1])
if daily + amount > tonumber(ARGV[2]) or monthly + amount > tonumber(ARGV[3]) then
  local ttl = redis.call('TTL', KEYS[1]); if ttl < 1 then ttl = 3600 end
  return {0, ttl}
end
redis.call('INCRBY', KEYS[1], amount); redis.call('EXPIRE', KEYS[1], 172800, 'NX')
redis.call('INCRBY', KEYS[2], amount); redis.call('EXPIRE', KEYS[2], 2764800, 'NX')
redis.call('HSET', KEYS[3], 'amount', amount, 'dayKey', KEYS[1], 'monthKey', KEYS[2])
redis.call('EXPIRE', KEYS[3], 2764800)
return {1, math.floor(math.max((daily + amount) * 100 / tonumber(ARGV[2]), (monthly + amount) * 100 / tonumber(ARGV[3]))}
`;

const RECONCILE_BUDGET_SCRIPT = `
local dayKey = redis.call('HGET', KEYS[1], 'dayKey')
local monthKey = redis.call('HGET', KEYS[1], 'monthKey')
if not dayKey or not monthKey then return 0 end
local newAmount = tonumber(ARGV[1])
local alreadyReconciled = redis.call('HGET', KEYS[1], 'actual')
if alreadyReconciled == '1' then
  -- Un reintento sobre la misma solicitud ya reconcilió su estimado antes;
  -- este costo es consumo adicional real y debe sumarse, no reemplazarlo.
  redis.call('INCRBY', dayKey, newAmount)
  redis.call('INCRBY', monthKey, newAmount)
  redis.call('HINCRBY', KEYS[1], 'amount', newAmount)
else
  local estimated = tonumber(redis.call('HGET', KEYS[1], 'amount') or '0')
  local difference = newAmount - estimated
  if difference ~= 0 then redis.call('INCRBY', dayKey, difference); redis.call('INCRBY', monthKey, difference) end
  redis.call('HSET', KEYS[1], 'amount', newAmount, 'actual', 1)
end
return 1
`;

const ROLLBACK_BUDGET_SCRIPT = `
local alreadyReconciled = redis.call('HGET', KEYS[1], 'actual')
if alreadyReconciled == '1' then return 0 end
local amount = tonumber(redis.call('HGET', KEYS[1], 'amount') or '0')
local dayKey = redis.call('HGET', KEYS[1], 'dayKey')
local monthKey = redis.call('HGET', KEYS[1], 'monthKey')
if dayKey and amount > 0 then redis.call('DECRBY', dayKey, amount) end
if monthKey and amount > 0 then redis.call('DECRBY', monthKey, amount) end
redis.call('DEL', KEYS[1]); return 1
`;

interface AiUsageReservation {
  requestId: string;
  userId: string;
  projectId: string;
  estimatedTokens: number;
  estimatedCostUsd?: number;
}

type AiUsageRelease = Pick<
  AiUsageReservation,
  "requestId" | "userId" | "projectId"
>;

interface AiUsageLimits {
  userRequestsHour: number;
  userRequestsDay: number;
  projectRequestsHour: number;
  projectRequestsDay: number;
  globalRequestsHour: number;
  globalRequestsDay: number;
  userTokensDay: number;
  projectTokensDay: number;
  globalTokensDay: number;
  userConcurrent: number;
  projectConcurrent: number;
  globalConcurrent: number;
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
}

function integer(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = value?.trim() ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} debe ser un entero positivo.`);
  }
  return parsed;
}

function positiveMoney(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = value?.trim() ? Number(value) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000) {
    throw new Error(`${name} debe ser un valor monetario positivo.`);
  }
  return parsed;
}

export function loadAiUsageLimits(
  environment: NodeJS.ProcessEnv = process.env,
): AiUsageLimits {
  return {
    userRequestsHour: integer(
      environment.AI_QUOTA_USER_REQUESTS_HOUR,
      5,
      "AI_QUOTA_USER_REQUESTS_HOUR",
    ),
    userRequestsDay: integer(
      environment.AI_QUOTA_USER_REQUESTS_DAY,
      20,
      "AI_QUOTA_USER_REQUESTS_DAY",
    ),
    projectRequestsHour: integer(
      environment.AI_QUOTA_PROJECT_REQUESTS_HOUR,
      10,
      "AI_QUOTA_PROJECT_REQUESTS_HOUR",
    ),
    projectRequestsDay: integer(
      environment.AI_QUOTA_PROJECT_REQUESTS_DAY,
      50,
      "AI_QUOTA_PROJECT_REQUESTS_DAY",
    ),
    globalRequestsHour: integer(
      environment.AI_QUOTA_GLOBAL_REQUESTS_HOUR,
      50,
      "AI_QUOTA_GLOBAL_REQUESTS_HOUR",
    ),
    globalRequestsDay: integer(
      environment.AI_QUOTA_GLOBAL_REQUESTS_DAY,
      200,
      "AI_QUOTA_GLOBAL_REQUESTS_DAY",
    ),
    userTokensDay: integer(
      environment.AI_QUOTA_USER_TOKENS_DAY,
      500_000,
      "AI_QUOTA_USER_TOKENS_DAY",
    ),
    projectTokensDay: integer(
      environment.AI_QUOTA_PROJECT_TOKENS_DAY,
      2_000_000,
      "AI_QUOTA_PROJECT_TOKENS_DAY",
    ),
    globalTokensDay: integer(
      environment.AI_QUOTA_GLOBAL_TOKENS_DAY,
      10_000_000,
      "AI_QUOTA_GLOBAL_TOKENS_DAY",
    ),
    userConcurrent: integer(
      environment.AI_QUOTA_USER_CONCURRENT,
      1,
      "AI_QUOTA_USER_CONCURRENT",
    ),
    projectConcurrent: integer(
      environment.AI_QUOTA_PROJECT_CONCURRENT,
      2,
      "AI_QUOTA_PROJECT_CONCURRENT",
    ),
    globalConcurrent: integer(
      environment.AI_QUOTA_GLOBAL_CONCURRENT,
      4,
      "AI_QUOTA_GLOBAL_CONCURRENT",
    ),
    dailyBudgetUsd: positiveMoney(
      environment.AI_BUDGET_DAILY_USD,
      50,
      "AI_BUDGET_DAILY_USD",
    ),
    monthlyBudgetUsd: positiveMoney(
      environment.AI_BUDGET_MONTHLY_USD,
      500,
      "AI_BUDGET_MONTHLY_USD",
    ),
  };
}

@Injectable()
export class AiUsageGuardService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly limits = loadAiUsageLimits();

  constructor(
    @Inject(AI_ANALYSIS_PROCESSING_CONFIG) config: AiAnalysisProcessingConfig,
  ) {
    this.redis = new Redis(config.connection);
  }

  async reserve(input: AiUsageReservation): Promise<void> {
    const hour = new Date().toISOString().slice(0, 13);
    const day = new Date().toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    const estimatedMicroUsd = Math.max(
      1,
      Math.ceil((input.estimatedCostUsd ?? 0.25) * 1_000_000),
    );
    const budgetResult = await this.redis.eval(
      RESERVE_BUDGET_SCRIPT,
      3,
      `rq:ai:budget:global:day:${day}`,
      `rq:ai:budget:global:month:${month}`,
      `rq:ai:budget:reservation:${input.requestId}`,
      estimatedMicroUsd,
      Math.round(this.limits.dailyBudgetUsd * 1_000_000),
      Math.round(this.limits.monthlyBudgetUsd * 1_000_000),
    ) as [number, number];
    if (Number(budgetResult[0]) !== 1) {
      throw new HttpException(
        {
          code: "AI_BUDGET_EXCEEDED",
          message: "El presupuesto de IA alcanzó su límite.",
          retryAfterSeconds: Math.max(
            1,
            Number(budgetResult[1]) || 3600,
          ),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const keys = [
      `rq:ai:quota:user:${input.userId}:hour:${hour}`,
      `rq:ai:quota:user:${input.userId}:day:${day}`,
      `rq:ai:quota:project:${input.projectId}:hour:${hour}`,
      `rq:ai:quota:project:${input.projectId}:day:${day}`,
      `rq:ai:quota:global:hour:${hour}`,
      `rq:ai:quota:global:day:${day}`,
      `rq:ai:quota:user:${input.userId}:tokens:${day}`,
      `rq:ai:quota:project:${input.projectId}:tokens:${day}`,
      `rq:ai:quota:global:tokens:${day}`,
      `rq:ai:active:user:${input.userId}`,
      `rq:ai:active:project:${input.projectId}`,
      "rq:ai:active:global",
    ];
    const result = await this.redis.eval(
      RESERVE_SCRIPT,
      keys.length,
      ...keys,
      this.limits.userRequestsHour,
      this.limits.userRequestsDay,
      this.limits.projectRequestsHour,
      this.limits.projectRequestsDay,
      this.limits.globalRequestsHour,
      this.limits.globalRequestsDay,
      this.limits.userTokensDay,
      this.limits.projectTokensDay,
      this.limits.globalTokensDay,
      this.limits.userConcurrent,
      this.limits.projectConcurrent,
      this.limits.globalConcurrent,
      Math.max(1, Math.ceil(input.estimatedTokens)),
      input.requestId,
    ) as [number, number, number];

    if (Number(result[0]) !== 1) {
      await this.rollbackBudget(input.requestId);
      const retryAfterSeconds = Math.max(1, Number(result[1]) || 60);
      throw new HttpException(
        {
          code: "AI_QUOTA_EXCEEDED",
          message: "Se alcanzó un límite de uso de IA. Intenta nuevamente más tarde.",
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async reconcileActualCost(
    requestId: string,
    actualCostUsd: number,
  ): Promise<void> {
    if (!Number.isFinite(actualCostUsd) || actualCostUsd < 0) return;
    const reservation = `rq:ai:budget:reservation:${requestId}`;
    await this.redis.eval(
      RECONCILE_BUDGET_SCRIPT,
      1,
      reservation,
      Math.max(0, Math.ceil(actualCostUsd * 1_000_000)),
    );
  }

  private async rollbackBudget(requestId: string): Promise<void> {
    await this.redis.eval(
      ROLLBACK_BUDGET_SCRIPT,
      1,
      `rq:ai:budget:reservation:${requestId}`,
    );
  }

  async release(input: AiUsageRelease): Promise<void> {
    // AI_ANALYSIS_USAGE_RELEASE_BUDGET_V1
    // release() liberaba únicamente los cupos de concurrencia; una solicitud
    // cancelada o que nunca llegó a consumir IA conservaba su costo estimado
    // reservado en el presupuesto diario/mensual. ROLLBACK_BUDGET_SCRIPT ya
    // protege el caso donde sí hubo consumo real reconciliado (no revierte).
    // Se agrega al mismo pipeline que los SREM para no pagar un round-trip
    // adicional a Redis.
    await this.redis
      .multi()
      .srem(`rq:ai:active:user:${input.userId}`, input.requestId)
      .srem(`rq:ai:active:project:${input.projectId}`, input.requestId)
      .srem("rq:ai:active:global", input.requestId)
      .eval(ROLLBACK_BUDGET_SCRIPT, 1, `rq:ai:budget:reservation:${input.requestId}`)
      .exec();
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
