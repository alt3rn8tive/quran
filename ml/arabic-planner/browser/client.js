// Optional UI adapter. Call only after the user requests/downloads the Arabic assistant.
export async function createPlanner(
    base,
    { loadTimeout = 120000, requestTimeout = 15000 } = {},
) {
    const worker = new Worker(new URL("./planner-worker.js", import.meta.url), {
        type: "module",
    });
    let next = 0,
        closed = false;
    const pending = new Map();
    function stop(reason = "Planner closed") {
        if (closed) return;
        closed = true;
        worker.terminate();
        for (const item of pending.values()) {
            clearTimeout(item.timer);
            item.reject(new Error(reason));
        }
        pending.clear();
    }
    function request(type, payload, timeout) {
        if (closed) return Promise.reject(new Error("Planner closed"));
        return new Promise((resolve, reject) => {
            const id = ++next;
            const timer = setTimeout(
                () => stop("Planner timed out; use the manual builder."),
                timeout,
            );
            pending.set(id, { resolve, reject, timer });
            worker.postMessage({ id, type, ...payload });
        });
    }
    worker.onmessage = ({ data }) => {
        const item = pending.get(data.id);
        if (!item) return;
        pending.delete(data.id);
        clearTimeout(item.timer);
        if (data.error) item.reject(new Error(data.error));
        else item.resolve(data.result);
    };
    worker.onerror = () =>
        stop("Planner worker failed; use the manual builder.");
    try {
        await request(
            "load",
            { base: new URL(base, location.href).href },
            loadTimeout,
        );
    } catch (error) {
        stop();
        throw error;
    }
    return {
        propose(text) {
            if (typeof text !== "string" || text.length > 640)
                return Promise.resolve({
                    status: "clarify",
                    reason: "اكتب طلباً أقصر.",
                });
            return request("propose", { text }, requestTimeout);
        },
        dispose() {
            stop();
        },
    };
}
