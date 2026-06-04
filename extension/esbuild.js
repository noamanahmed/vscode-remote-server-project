const esbuild = require("esbuild");

const baseConfig = {
  bundle: true,
  minify: process.argv.includes("--minify"),
  sourcemap: process.argv.includes("--sourcemap"),
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  outfile: "dist/extension.js",
  entryPoints: ["src/extension.ts"],
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
