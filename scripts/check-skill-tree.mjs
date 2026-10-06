// Run: node scripts/check-skill-tree.mjs  (Node 22.18+/24 strips the .ts types natively)
import assert from "node:assert/strict";
import { effectiveStatus, MOCK_TREE } from "../lib/skillTree.ts";

const byId = new Map(MOCK_TREE.map((n) => [n.id, n]));
const s = (id) => effectiveStatus(byId.get(id), byId);

for (const n of MOCK_TREE) for (const p of n.parents) assert.ok(byId.has(p), `${n.id}: unknown parent ${p}`);
assert.equal(s("start"), "completed");
assert.equal(s("song-night"), "available"); // parent sitsit completed
assert.equal(s("keyhole"), "locked"); // parent song-night not completed
assert.equal(s("work-sitsit"), "pending"); // stored pending wins
assert.equal(s("both-paths"), "locked"); // needs BOTH parents
const done = (id) => ({ ...byId.get(id), status: "completed" });
const tweaked = new Map(byId).set("sauna", done("sauna")).set("song-night", done("song-night"));
assert.equal(effectiveStatus(byId.get("both-paths"), tweaked), "available");
assert.equal(effectiveStatus({ ...byId.get("keyhole"), status: "available" }, byId), "locked"); // stale stored status is recomputed
console.log("skill tree: ok");
