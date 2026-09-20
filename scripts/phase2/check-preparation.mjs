import { checkPlanHash, validatePreparation, evaluateStudy } from "./preparation.mjs";
import { readFileSync } from "node:fs";
console.log(JSON.stringify({ planSha256: checkPlanHash(), ...validatePreparation() }, null, 2));
if (process.argv[2]) console.log(JSON.stringify(evaluateStudy(JSON.parse(readFileSync(process.argv[2], "utf8"))), null, 2));
