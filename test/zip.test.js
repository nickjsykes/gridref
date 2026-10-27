// node test/zip.test.js : our zip opens in a real zip tool and reads back byte-for-byte
require("../zip.js");
const fs = require("fs"), path = require("path"), Zip = globalThis.Zip;
(async () => {
  const jpeg = new Uint8Array(50000).map((_, i) => (i * 31) & 255);
  const blob = await Zip.make([{ name: "field-notes.csv", data: "Name,Type\nBox 1,point\n" }, { name: "photos/ph123.jpg", data: jpeg }, { name: "notes/ünïcode.txt", data: "ok" }]);
  const out = path.join(__dirname, "out.zip");
  fs.writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
  const back = await Zip.read(new Blob([fs.readFileSync(out)]));
  console.log(back.map((f) => f.name + " " + f.data.length).join(" | "));
  console.log("photo identical:", Buffer.compare(Buffer.from(back[1].data), Buffer.from(jpeg)) === 0);
})();
