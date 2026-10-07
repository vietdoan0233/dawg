// Run: node scripts/check-news.mjs  (Node 22.18+/24 strips the .ts types natively)
import assert from "node:assert/strict";
import { diffRoadmap } from "../lib/news.ts";

const node = (id, approved = 0, pending = 0) => ({ locked: false, id, category_id: 1, title: `T${id}`, approved, pending, max_repeats: 2 });
const map = (nodes, own_tier_id = null) => ({ member_id: 1, total: 0, own_tier_id, tiers: [{ id: 7, name: "Teekkari", min_total: 40 }], categories: [], nodes });

const before = map([node(1, 1), node(2, 0, 1), { locked: true, category_id: 1 }]);
assert.equal(diffRoadmap(before, before, 1, [1]), null); // nothing changed, nothing unseen: no celebration
assert.equal(diffRoadmap(null, before, 1, null), null); // projector (no tracking), first load: quiet

// first load after being away: node 1 was approved meanwhile and never shown on this device
assert.deepEqual(diffRoadmap(null, before, 1, []).fresh, [1]);
assert.equal(diffRoadmap(null, before, 1, [1]), null); // already shown: no replay

const after = map([node(1, 1), node(2, 1, 0), node(3)], 7);
const news = diffRoadmap(before, after, 5, [1]);
assert.deepEqual(news.lit.map((n) => n.id), [2]); // pending -> approved lights up
assert.deepEqual(news.fresh, [2]); // and its line draws on
assert.deepEqual(news.revealed, [3]); // the keyhole became a real node
assert.equal(news.tier, "Teekkari");
assert.deepEqual(diffRoadmap(after, map([node(1, 1), node(2, 2, 0), node(3)], 7), 6, [1, 2]).fresh, [2]); // a repeat glows again
console.log("news: ok");
