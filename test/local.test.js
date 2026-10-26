// node test/local.test.js : offline place and postcode search
require("../osgb.js"); require("../local.js");
const fs = require("fs"), path = require("path");
global.fetch = async (f) => ({ json: async () => JSON.parse(fs.readFileSync(path.join(__dirname, "..", f), "utf8")) });
const L = globalThis.LocalSearch, near = { lat: 54.25, lng: -3.0 };
(async () => {
  for (const q of ["Roudsea", "roudsea wood", "Gummers How", "gummer's how", "Haverthwaite", "Whitbarrow", "Gait Barrows", "Walney", "Duddon", "Scafell Pike", "Haweswater", "Hallsenna"]) {
    const r = await L.searchPlaces(q, near, 3);
    console.log(q.padEnd(14), "=>", r.map((x) => x.title + " (" + x.sub + ")").join(" | ") || "none");
  }
  console.log("LA12 8AA =>", JSON.stringify(await L.postcode("la12 8aa")));
  console.log("LA12 =>", JSON.stringify(await L.outcode("LA12")));
  console.log("covers LA / M:", L.covers("LA1 1AA"), L.covers("M1 1AA"));
})();
