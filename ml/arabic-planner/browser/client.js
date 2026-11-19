// Optional UI adapter. Call only after the user requests/downloads the Arabic assistant.
export async function createPlanner(
    base,
    {
        loadTimeout = 300000,
        requestTimeout = 60000,
        experimental = false,
        signal,
        onProgress,
    } = {},
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
        if (signal) signal.removeEventListener("abort", abort);
        worker.terminate();
        for (const item of pending.values()) {
            clearTimeout(item.timer);
            item.reject(new Error(reason));
        }
        pending.clear();
    }
    function abort() {
        stop("Planner cancelled");
    }
    if (signal) {
        if (signal.aborted) {
            stop();
            throw new Error("Planner cancelled");
        }
        signal.addEventListener("abort", abort, { once: true });
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
        if (data.event === "progress") {
            if (onProgress) onProgress(data.progress);
            return;
        }
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
            { base: new URL(base, location.href).href, experimental },
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
