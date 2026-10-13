// First-time setup helper:  npm run setup
//
// Creates .env.local from .env.example with a random SESSION_SECRET and a
// random studio password. It never overwrites an existing .env.local.
// API keys (FAL_KEY, ANTHROPIC_API_KEY) are left empty for you to paste in.

import { randomBytes } from "node:crypto";
import fs from "node:fs";

const target = ".env.local";
if (fs.existsSync(target)) {
  console.log(`${target} already exists — nothing changed.`);
  console.log("Edit it in your code editor to add or change keys, then restart `npm run dev`.");
  process.exit(0);
}

const words = ["silk", "linen", "velvet", "atelier", "runway", "couture", "denim", "satin", "tweed", "chiffon", "cashmere", "organza"];
const pick = () => words[randomBytes(1)[0] % words.length];
const password = `${pick()}-${pick()}-${pick()}-${randomBytes(2).toString("hex")}`;
const secret = randomBytes(32).toString("hex");

const content = fs
  .readFileSync(".env.example", "utf8")
  .replace(/^APP_PASSWORD=.*$/m, `APP_PASSWORD=${password}`)
  .replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`);
fs.writeFileSync(target, content, { encoding: "utf8", flag: "wx" });

console.log(`Created ${target}.`);
console.log("");
console.log(`  Your studio login password:  ${password}`);
console.log("");
console.log("You can change it any time by editing APP_PASSWORD in .env.local.");
console.log("Next: add FAL_KEY (and optionally ANTHROPIC_API_KEY) to .env.local, then run `npm run dev`.");
