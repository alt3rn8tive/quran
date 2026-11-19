import { loadPlanner } from "./runner.js";
import builder from "./vendor/query-builder.mjs";
let planner,
    queue = Promise.resolve();
self.onmessage = ({ data }) => {
    queue = queue.then(async () => {
        try {
            let result;
            if (data.type === "load") {
                if (planner) throw new Error("Planner already loaded");
                planner = await loadPlanner(data.base, builder);
                result = { ready: true };
            } else if (data.type === "propose" && planner)
                result = await planner.propose(data.text);
            else throw new Error("Planner is not ready");
            self.postMessage({ id: data.id, result });
        } catch (error) {
            self.postMessage({ id: data.id, error: String(error.message) });
        }
    });
};
