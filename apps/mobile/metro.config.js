const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// The mobile client reuses pure domain rules from the repository-level src/
// directory. Metro otherwise refuses those imports because its project root
// is apps/mobile.
config.watchFolders = [path.resolve(__dirname, "../../src")];

module.exports = config;
