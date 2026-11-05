// User-facing platform name for release folders and archives. Node's
// process.platform reports "win32" (the legacy Windows API family name);
// folders and archive names spell it out as "windows" to avoid confusion.
module.exports = function platformName(platform) {
  return platform === "win32" ? "windows" : platform;
};
