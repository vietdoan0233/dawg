"use client";
import { useEffect, useState } from "react";
import { db } from "@/lib/supabase";
import { Icon } from "./Icon";

// Demo project only: seeded users share one password (supabase/seed.sql). The pilot project has
// password sign-in disabled, so this cannot work there even if shipped.
const DEMO_PASSWORD = "demo-password";
const DEMO_USERS = [
  { label: "Fuksi 1", sub: "Complete tasks, earn points", icon: "star", role: "fuksi.1" },
  { label: "Fuksi 2", sub: "Complete tasks, earn points", icon: "star", role: "fuksi.2" },
  { label: "Fuksi 3", sub: "Complete tasks, earn points", icon: "star", role: "fuksi.3" },
  { label: "Tutor A", sub: "Approve fuksis' task proofs", icon: "inbox", role: "tutor.a" },
  { label: "Tutor B", sub: "Approve fuksis' task proofs", icon: "inbox", role: "tutor.b" },
  { label: "Organizer", sub: "Check people in at events", icon: "scan", role: "organizer" },
  { label: "Captain", sub: "Run the guild, reveal secret tasks", icon: "crown", role: "captain" },
];

// Every visitor gets their own demo room (supabase/demo-sandbox.sql): a copy of the demo guild with its own users,
// demo.s<n>.<role>@demo.invalid. "shared" = the script isn't installed, so everyone uses the seeded users.
// The QR code opens /?fresh=1: a new scan always gets a new room; a reload or user switch keeps it.
type Room = number | "shared";
const ROOM_KEY = "demo-sandbox";
let roomOnce: Promise<Room> | null = null; // once per page load (React dev mounts twice; two switchers on a page)

const emailFor = (room: Room, role: string) => (room === "shared" ? `demo.${role}@demo.invalid` : `demo.s${room}.${role}@demo.invalid`);

function storedRoom(): number | null {
  try {
    const n = Number(localStorage.getItem(ROOM_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function storeRoom(n: number | null) {
  try {
    if (n) localStorage.setItem(ROOM_KEY, String(n));
    else localStorage.removeItem(ROOM_KEY);
  } catch {
    // private mode: the room lasts until the page is closed
  }
}

async function createRoom(): Promise<Room> {
  // not in the generated types: the function only exists on demo databases
  const { data, error } = await db().rpc("create_demo_sandbox" as never);
  if (error) {
    if (error.code === "PGRST202") return "shared"; // script not installed (local dev)
    throw new Error(error.message);
  }
  storeRoom(Number(data));
  return Number(data);
}

function getRoom(): Promise<Room> {
  roomOnce ??= (async () => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("fresh") !== "1") return storedRoom() ?? (await createRoom());
    try {
      storeRoom(null);
      await db().auth.signOut();
      return await createRoom();
    } finally {
      url.searchParams.delete("fresh");
      window.history.replaceState(window.history.state, "", url);
    }
  })().catch((e: Error) => {
    roomOnce = null; // let the next try ask again
    throw e;
  });
  return roomOnce;
}

// the stored room is gone (the demo database was reset): make a new one
function replaceRoom(): Promise<Room> {
  storeRoom(null);
  roomOnce = createRoom();
  return roomOnce;
}

export function DemoSwitcher({ current, compact = false }: { current?: string; compact?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const on = process.env.NEXT_PUBLIC_DEMO === "1";

  useEffect(() => {
    if (!on) return;
    getRoom().then(setRoom, (e: Error) => {
      setRoom("shared");
      setError(`Couldn't make your own demo room, so you're in the shared one. (${e.message})`);
    });
  }, [on]);

  if (!on) return null;

  const logInAs = async (role: string) => {
    setError(null);
    setBusy(role);
    try {
      let r = room ?? (await getRoom());
      let { error } = await db().auth.signInWithPassword({ email: emailFor(r, role), password: DEMO_PASSWORD });
      if (error && r !== "shared") {
        // the room is gone: make a new one and try once more
        r = await replaceRoom();
        setRoom(r);
        ({ error } = await db().auth.signInWithPassword({ email: emailFor(r, role), password: DEMO_PASSWORD }));
      }
      if (error) throw error;
    } catch (e) {
      setError(`Couldn't log in as this demo user. Please try again. (${(e as Error).message})`);
    } finally {
      setBusy(null);
    }
  };

  if (compact) {
    return (
      <select className="demo-compact" value="" aria-label="Switch to another demo user" onChange={(e) => e.target.value && void logInAs(e.target.value)}>
        <option value="">{current ? `Demo: ${current}` : "Switch user…"}</option>
        {DEMO_USERS.map((u) => (
          <option key={u.role} value={u.role}>
            {u.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <section className="characters" aria-label="Choose a demo user to try the app">
      <h2>Choose your character</h2>
      {typeof room === "number" && (
        <p className="hint">
          Your own demo room #{room}: your changes don&apos;t affect anyone else.
        </p>
      )}
      <div className="character-grid">
        {DEMO_USERS.map((u) => (
          <button key={u.role} type="button" className="character" aria-busy={busy === u.role} onClick={() => void logInAs(u.role)}>
            <Icon name={u.icon} size={28} />
            <strong>{u.label}</strong>
            <span>{u.sub}</span>
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
