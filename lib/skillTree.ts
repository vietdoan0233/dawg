// Skill-tree prototype data. MOCK ONLY: the SDD has no node dependencies (`parents`), lore or positions yet,
// so nothing here touches Supabase. Unlocking is client-side and cosmetic until the schema carries `parents`.

export type TreeStatus = "locked" | "available" | "pending" | "completed";

export type TreeNode = {
  id: string;
  title: string;
  lore: string;
  description: string; // what to actually do
  points: number;
  color: string; // category colour, as categories.color
  status: TreeStatus; // stored; locked/available are recomputed from parents
  position: { x: number; y: number }; // world px, centre node at 0,0
  parents: string[];
};

// pending/completed come from the server; locked vs available is derived: every parent completed = available.
export function effectiveStatus(node: TreeNode, byId: Map<string, TreeNode>): TreeStatus {
  if (node.status === "pending" || node.status === "completed") return node.status;
  return node.parents.every((p) => byId.get(p)?.status === "completed") ? "available" : "locked";
}

const C = { mandatory: "#fb923c", work: "#60a5fa", party: "#f472b6", culture: "#a78bfa", guild: "#34d399", other: "#94a3b8" };

// PLACEHOLDER nodes and lore: titles reuse the demo seed, the branches are illustrative, not Data Guild's map.
export const MOCK_TREE: TreeNode[] = [
  { id: "start", title: "Welcome, fuksi", lore: "Every teekkari story starts with a confused first day.", description: "Log in to the app for the first time.", points: 0, color: "#ffc24b", status: "completed", position: { x: 0, y: 0 }, parents: [] },

  { id: "orientation", title: "Orientation lecture", lore: "The elders speak. Some of it is even useful.", description: "Attend the orientation lecture and get checked in by an organizer.", points: 2, color: C.mandatory, status: "completed", position: { x: 0, y: -220 }, parents: ["start"] },
  { id: "tutor-meet", title: "Meet your tutor group", lore: "Your party assembles.", description: "Join your tutor group's first meetup.", points: 1, color: C.mandatory, status: "available", position: { x: -120, y: -420 }, parents: ["orientation"] },
  { id: "campus-run", title: "Campus orienteering", lore: "Maps are optional. Pride is not.", description: "Finish the campus orienteering course with your group.", points: 2, color: C.party, status: "locked", position: { x: -260, y: -600 }, parents: ["tutor-meet"] },

  { id: "sitsit", title: "Sitsit", lore: "Songs, a table, and rules no one fully remembers.", description: "Attend a sitsit and get checked in at the door.", points: 1, color: C.party, status: "completed", position: { x: 210, y: -70 }, parents: ["start"] },
  { id: "work-sitsit", title: "Work at Sitsit", lore: "Behind every great sitsit is someone washing glasses.", description: "Volunteer as a worker at a sitsit.", points: 2, color: C.work, status: "pending", position: { x: 420, y: -160 }, parents: ["sitsit"] },
  { id: "song-night", title: "Teekkari song night", lore: "Learn the songs before the songs learn you.", description: "Join a song night and upload a photo.", points: 2, color: C.culture, status: "available", position: { x: 420, y: 60 }, parents: ["sitsit"] },
  { id: "keyhole", title: "Keyhole", lore: "Some doors only open for those who sang.", description: "Revealed by the captain later in the year.", points: 3, color: C.culture, status: "locked", position: { x: 640, y: 120 }, parents: ["song-night"] },

  { id: "sauna", title: "Guild sauna evening", lore: "Steam, stories, and the guild's best gossip.", description: "Come to the guild sauna and upload a photo. Your tutor awards 1–3p.", points: 3, color: C.guild, status: "available", position: { x: -210, y: 90 }, parents: ["start"] },
  { id: "guild-room", title: "Visit the guild room", lore: "The couch has seen things.", description: "Visit the guild room during opening hours.", points: 1, color: C.guild, status: "locked", position: { x: -430, y: 20 }, parents: ["sauna"] },

  { id: "own-event", title: "+ my own event", lore: "Forge your own path.", description: "Attend any other event and write its name.", points: 1, color: C.other, status: "available", position: { x: 0, y: 240 }, parents: ["start"] },
  { id: "both-paths", title: "Well-rounded", lore: "Sauna and song. The balance is restored.", description: "Unlocks once both the sauna and the song night are done.", points: 2, color: C.other, status: "locked", position: { x: 110, y: 430 }, parents: ["sauna", "song-night"] },
];
