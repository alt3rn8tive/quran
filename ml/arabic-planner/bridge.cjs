// Node bridge: use the production compiler for dataset validation and evaluation.
const fs = require("node:fs"),
    vm = require("node:vm"),
    path = require("node:path");
const dir = __dirname,
    context = {};
vm.createContext(context);
vm.runInContext(
    fs.readFileSync(path.join(dir, "../../js/query-builder.js"), "utf8"),
    context,
);
const builder = context.QuranQueryBuilder,
    core = require("./browser/planner-core.js");
const catalog = JSON.parse(fs.readFileSync(path.join(dir, "catalog.json"))),
    refs = JSON.parse(fs.readFileSync(path.join(dir, "references.json")));
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((k) => [k, canonical(value[k])]),
        );
    return value;
}
function signature(plan) {
    return plan.status === "suggestion"
        ? JSON.stringify(
              canonical({
                  status: plan.status,
                  intent: plan.intent,
                  blocks: builder.normalise(plan.blocks),
                  reference: plan.reference || { ayah: null, surah: null },
                  settings: plan.settings || {
                      searchFromBeginning: false,
                      searchOnEnd: false,
                      removeLastHarakah: false,
                  },
              }),
          )
        : JSON.stringify({ status: "clarify" });
}
let data = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (data += c));
process.stdin.on("end", () => {
    try {
        const input = JSON.parse(data);
        if (
            !["prepare", "evaluate", "predict", "candidate"].includes(
                input.operation,
            )
        )
            throw new Error("Unknown bridge operation");
        const rows = input.rows.map((row) => {
            let prepared;
            try {
                prepared = core.extract(row.request).modelInput;
            } catch (e) {
                prepared = null;
            }
            const result = ["evaluate", "predict"].includes(input.operation)
                ? core.decide(
                      row.request,
                      row.scores,
                      input.policy,
                      catalog,
                      refs,
                      builder,
                  )
                : core.assemble(
                      row.request,
                      row.intent,
                      catalog,
                      refs,
                      builder,
                  );
            if (input.operation === "predict") return result;
            const correct = signature(result) === signature(row.expected);
            if (input.operation === "prepare" && !correct)
                throw new Error(
                    row.id +
                        ": target and compiler/assembler disagree: " +
                        JSON.stringify(result),
                );
            return input.operation === "prepare"
                ? Object.assign({}, row, { model_input: prepared })
                : {
                      id: row.id,
                      gold_intent: row.intent,
                      intent: result.intent || null,
                      status: result.status,
                      correct,
                      reviewed: row.reviewed === true,
                      reviewed_by: row.reviewed_by || null,
                  };
        });
        process.stdout.write(JSON.stringify(rows));
    } catch (e) {
        process.stderr.write(String(e.stack));
        process.exitCode = 1;
    }
});
