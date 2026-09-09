const fs = require("node:fs");
const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8").match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (!/^v\d+\.\d+\.\d+$/.test(process.env.RELEASE_TAG || "") ||
    process.env.RELEASE_TAG !== `v${pkg.version}` || pkg.version !== config.version || pkg.version !== cargo) {
  throw new Error("Release tag must match the version in package.json, Cargo.toml and tauri.conf.json.");
}
if (!process.env.TAURI_SIGNING_PRIVATE_KEY?.trim()) {
  throw new Error("Configure the TAURI_SIGNING_PRIVATE_KEY repository secret before publishing updates.");
}
if (!config.bundle.createUpdaterArtifacts || !config.plugins?.updater?.pubkey) {
  throw new Error("Updater artifacts and public signing key must be configured.");
}
console.log("Release version and signing configuration are present.");
