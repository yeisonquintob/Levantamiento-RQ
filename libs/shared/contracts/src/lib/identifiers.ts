export type CorrelationId = string & {
  readonly __brand: "CorrelationId";
};

export type UtcIsoDateString = string & {
  readonly __brand: "UtcIsoDateString";
};

export function asCorrelationId(value: string): CorrelationId {
  return value as CorrelationId;
}

export function asUtcIsoDateString(value: string): UtcIsoDateString {
  return value as UtcIsoDateString;
}
