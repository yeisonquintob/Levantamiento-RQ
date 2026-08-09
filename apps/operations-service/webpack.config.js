const { NxAppWebpackPlugin } = require("@nx/webpack/app-plugin");
const { dirname, join } = require("path");

const classTransformerStorage = join(
  dirname(require.resolve("class-transformer/package.json")),
  "cjs",
  "storage.js",
);

module.exports = {
  externals: [{ docx: "commonjs docx" }],
  resolve: {
    alias: {
      "class-transformer/storage$": classTransformerStorage,
    },
  },
  output: {
    path: join(__dirname, "dist"),
    clean: true,
    ...(process.env.NODE_ENV !== "production" && {
      devtoolModuleFilenameTemplate: "[absolute-resource-path]",
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: "node",
      compiler: "tsc",
      main: "./src/main.ts",
      tsConfig: "./tsconfig.app.json",
      assets: ["./src/assets"],
      optimization: false,
      outputHashing: "none",
      generatePackageJson: false,
      sourceMap: true,
      externalDependencies: "all",
      mergeExternals: true,
    }),
  ],
};
