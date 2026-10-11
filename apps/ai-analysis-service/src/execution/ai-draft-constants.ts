import { type DocumentTemplateType } from "@levantamiento-rq/shared-contracts";

export const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

export const ISO_DATE_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$";

export const PENDING_DEFINITION = "[PENDIENTE POR DEFINIR]";

export const PENDING_SUMMARY_LIMIT = 3;

export const CONTRADICTION_SUMMARY_LIMIT = 2;

export const DEPTH_LIMITS: Readonly<
  Record<
    DocumentTemplateType,
    {
      features: number;
      userStories: number;
      tests: number;
      requirements: number;
      sprints: number;
    }
  >
> = {
  SMALL_REQUIREMENT: {
    features: 3,
    userStories: 6,
    tests: 10,
    requirements: 20,
    sprints: 4,
  },
  MEDIUM_REQUIREMENT: {
    features: 10,
    userStories: 30,
    tests: 60,
    requirements: 100,
    sprints: 12,
  },
  LARGE_REQUIREMENT: {
    features: 40,
    userStories: 150,
    tests: 250,
    requirements: 300,
    sprints: 40,
  },
  ERP_FDD: {
    features: 20,
    userStories: 80,
    tests: 150,
    requirements: 250,
    sprints: 30,
  },
};
