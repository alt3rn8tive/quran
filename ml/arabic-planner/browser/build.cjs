const fs = require("node:fs"),
    path = require("node:path");
const esbuild = require("esbuild");
(async () => {
    const output = path.join(__dirname, "vendor");
    fs.mkdirSync(output, { recursive: true });
    await esbuild.build({
        stdin: {
            contents: 'export {pipeline,env} from "@huggingface/transformers";',
            resolveDir: __dirname,
        },
        outfile: path.join(output, "transformers.js"),
        bundle: true,
        format: "esm",
        platform: "browser",
        conditions: ["browser"],
        minify: true,
        legalComments: "eof",
    });
    const packageRoot = path.dirname(
        path.dirname(require.resolve("onnxruntime-web")),
    );
    for (const file of fs.readdirSync(path.join(packageRoot, "dist")))
        if (/^ort-wasm.*\.(wasm|mjs)$/.test(file))
            fs.copyFileSync(
                path.join(packageRoot, "dist", file),
                path.join(output, file),
            );
    // Keep the actual compiler, with its original source hash checked at load time.
    fs.writeFileSync(
        path.join(output, "query-builder.mjs"),
        fs.readFileSync(
            path.join(__dirname, "../../../js/query-builder.js"),
            "utf8",
        ) + "\nexport default QuranQueryBuilder;\n",
    );
    console.log("Browser runtime and WASM files built locally in " + output);
})();
