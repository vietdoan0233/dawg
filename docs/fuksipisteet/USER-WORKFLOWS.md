# User workflows

What each role sees and can do, traced from the code (`app/`, `components/`). Plain-language companion to
`SDD.md` and `ARCHITECTURE-SIMPLE.md`.

```
EVERYONE
  / ─► not logged in ─► aalto.fi email-code login  (demo: "Choose your character")
  /join/<code> ─► log in ─► join_guild ─► member as fuksi ─► /
  Top bar: logo → home · guild switcher · sound on/off · log out
  Logged in but in no guild → "Ask your guild captain for an invite link"

FUKSI  (skill-tree home)
  Track chips ─► fly the tree to that branch
  Tap node ─► info card ─► "Submit proof" ─► sheet (note / photo) ─► submit_task
     (double-tap a node = straight to the sheet)
     └─► node shows "Waiting for review" (dashed, pulsing)
  Reviewer approves ─► next poll (~5 s) ─► neon line draws on + chime + toast
     └─► new tier reached ─► level-up overlay ─► tap to continue
  Captain reveals a secret ─► keyhole node unlocks + toast
  Dock: My QR (show at the door; "make a new one" if lost) · Ranks (levels + tutor-group board)

TUTOR  (tabs: Review · Check-in · Ranks · Projector)
  Review ─► pending submissions RLS lets them see, minus captain-reviewed nodes
     each: Reject | Approve Np  ·  or "Approve all" (each node's minimum points)
     a row reviewed by someone else meanwhile → list refreshes, try again
  Check-in / Ranks / Projector: same as organizer

ORGANIZER  (tabs: Check-in · Ranks · Projector; no Review)
  Check-in ─► pick event ─► scan QR with camera, or type the code ─► Add
     └─► queued on the device (offline-first) ─► flushed when online
         └─► Checked in | Already checked in | Node full | Unknown code | Outside event time
  Ranks ─► leaderboard · Projector ─► /board/<guild> (full-screen live board)

CAPTAIN  (all tabs)
  Review ─► everything tutors see + captain-reviewed nodes
  Secrets ─► Reveal ─► unlocks on every phone and the projector within ~5 s
  People ─► invite links: create / copy / revoke (links only ever make fuksis)
         ─► set each member's role and tutor group (not their own)
```
