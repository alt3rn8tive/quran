// Development-only parity harness. Production worker never enables testing mode.
import { loadPlanner } from "../browser/runner.js";
import builder from "../browser/vendor/query-builder.mjs";
let planner, catalog, references;
self.onmessage = async ({ data }) => {
    try {
        let result;
        if (data.type === "load") {
            planner = await loadPlanner(data.base, builder, { testing: true });
            catalog = await (
                await fetch(new URL("catalog.json", data.base))
            ).json();
            references = await (
                await fetch(new URL("references.json", data.base))
            ).json();
            result = true;
        } else if (data.type === "infer")
            result = {
                tokens: planner.tokenize(data.text),
                scores: await planner.scores(data.text),
                decision: await planner.propose(data.request),
                guided: globalThis.QuranArabicPlannerCore.assemble(
                    data.request,
                    data.intent,
                    catalog,
                    references,
                    builder,
                ),
            };
        else throw new Error("Unknown harness operation");
        self.postMessage({ id: data.id, result });
    } catch (error) {
        self.postMessage({ id: data.id, error: error.message });
    }
};
