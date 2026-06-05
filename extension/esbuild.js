const esbuild = require("esbuild");

const baseConfig = {
  bundle: true,
  minify: process.argv.includes("--minify"),
  sourcemap: process.argv.includes("--sourcemap"),
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  outdir: "dist",
  entryPoints: {
    extension: "src/extension.ts",
    "test/runTest": "src/test/runTest.ts",
    "test/suite/index": "src/test/suite/index.ts",
    "test/suite/extension.test": "src/test/suite/extension.test.ts",
  },
};

async function main() {
  if (process.argv.includes("--watch")) {
    console.log("watching...");
    const ctx = await esbuild.context(baseConfig);
    await ctx.watch();
  } else {
    await esbuild.build(baseConfig);
    console.log("build complete");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
