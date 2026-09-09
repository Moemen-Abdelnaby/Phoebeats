const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (`v${manifest.version}` !== process.env.RELEASE_TAG) throw new Error("Updater manifest version does not match the release tag.");
for (const platform of ["windows-x86_64-nsis", "linux-x86_64-deb", "linux-x86_64-rpm"]) {
  const asset = manifest.platforms?.[platform];
  if (!asset?.signature?.trim() || !asset?.url?.startsWith("https://")) {
    throw new Error(`Missing signed update for ${platform}. Release remains a draft.`);
  }
}
console.log("Signed update entries found for every supported installer.");
