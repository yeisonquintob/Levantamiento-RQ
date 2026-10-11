const { NxAppWebpackPlugin } = require("@nx/webpack/app-plugin");
const { dirname, join } = require("path");
module.exports = {
  resolve: {
    alias: {
      "class-transformer/storage$": join(
        dirname(require.resolve("class-transformer/package.json")),
        "cjs",
        "storage.js",
      ),
    },
  },
  output: { path: join(__dirname, "dist"), clean: true },
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
    }),
  ],
};
