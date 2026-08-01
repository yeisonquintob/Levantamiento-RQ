import nxPlugin from "@nx/eslint-plugin";

const backendScopes = [
  "scope:gateway",
  "scope:identity",
  "scope:projects",
  "scope:sources",
  "scope:documents",
  "scope:ai",
  "scope:erp-knowledge",
  "scope:workflow",
  "scope:operations",
  "scope:web",
];

const scopeConstraints = backendScopes.map((scope) => ({
  sourceTag: scope,
  onlyDependOnLibsWithTags: [scope, "scope:shared"],
}));

export default [
  ...nxPlugin.configs["flat/base"],
  ...nxPlugin.configs["flat/typescript"],
  ...nxPlugin.configs["flat/javascript"],
  {
    ignores: ["**/dist", "**/node_modules", "**/.nx", "**/coverage"],
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    rules: {
      "@nx/enforce-module-boundaries": [
        "error",
        {
          enforceBuildableLibDependency: true,
          allow: ["^.*/eslint(\\.base)?\\.config\\.[cm]?js$"],
          depConstraints: [
            ...scopeConstraints,
            {
              sourceTag: "scope:shared",
              onlyDependOnLibsWithTags: ["scope:shared"],
            },
            {
              sourceTag: "type:app",
              onlyDependOnLibsWithTags: [
                "type:api",
                "type:feature",
                "type:domain",
                "type:data-access",
                "type:contracts",
                "type:util",
                "type:config",
              ],
            },
            {
              sourceTag: "type:config",
              onlyDependOnLibsWithTags: [
                "type:config",
                "type:contracts",
                "type:util",
              ],
            },
            {
              sourceTag: "type:contracts",
              onlyDependOnLibsWithTags: ["type:contracts", "type:util"],
            },
            {
              sourceTag: "type:util",
              onlyDependOnLibsWithTags: [
                "type:contracts",
                "type:util",
                "type:config",
              ],
            },
            {
              sourceTag: "type:testing",
              onlyDependOnLibsWithTags: [
                "type:contracts",
                "type:util",
                "type:config",
                "type:testing",
              ],
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    rules: {},
  },
];
