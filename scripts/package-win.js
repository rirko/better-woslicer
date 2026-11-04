// Legacy entry point. Native Windows packaging now produces .7z.
if (process.platform !== "win32") throw new Error("Use npm run package on this platform");
require("./package-app.js");
