const core = require("./browser/planner-core.js");
let text = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (text += chunk));
process.stdin.on("end", () => {
    process.stdout.write(
        JSON.stringify(
            JSON.parse(text).map((request) => {
                try {
                    return core.extract(request).modelInput;
                } catch (e) {
                    return null;
                }
            }),
        ),
    );
});
