"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "@/lib/supabase";
import { friendly } from "@/lib/roadmap";

type Scan = { id: string; event_id: number; code: string; scanned_at: string };
type Result = { id: string; text: string; ok: boolean };
type Ev = { id: number; title: string; starts_at: string; ends_at: string };

// Offline-first: every scan goes into a localStorage queue first, then flushes whenever there is a connection.
// A scan leaves the queue only once the server gave a real answer, so nothing is silently dropped.
// The queue is per scanner member: on a shared phone, the next person never sends someone else's scans.
const load = (key: string): Scan[] => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as Scan[];
  } catch {
    return [];
  }
};
const save = (key: string, q: Scan[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(q));
  } catch {
    /* storage blocked: the scan is lost on reload, but this session still shows its result */
  }
};

const LABEL: Record<string, string> = {
  ok: "Checked in",
  duplicate: "Already checked in",
  limit_reached: "Node already full for this fuksi",
  unknown: "Unknown code",
  outside_window: "Outside the event time",
};

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (o: { formats: string[] }) => Detector;
  }
}

export function Scanner({ guildId, memberId }: { guildId: number; memberId: number }) {
  const key = `checkin-queue:${guildId}:${memberId}`;
  const [events, setEvents] = useState<Ev[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [queued, setQueued] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [manual, setManual] = useState("");
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const flushing = useRef(false);
  const again = useRef(false); // a scan arrived during a flush: run once more right after

  useEffect(() => {
    db()
      .from("events")
      .select("id, title, starts_at, ends_at")
      .eq("guild_id", guildId)
      .order("starts_at")
      .then(({ data, error }) => {
        if (error) return setError(error.message);
        setEvents(data);
        const now = Date.now();
        // the live event, else the next one, else the latest: never an old finished one by default
        const live = data.find((e) => Date.parse(e.starts_at) <= now && now <= Date.parse(e.ends_at));
        const next = data.find((e) => Date.parse(e.starts_at) > now);
        setEventId((live ?? next ?? data.at(-1))?.id ?? null);
      });
  }, [guildId]);

  const flush = useCallback(async () => {
    if (!navigator.onLine) return setQueued(load(key).length);
    if (flushing.current) {
      again.current = true;
      return;
    }
    flushing.current = true;
    try {
      do {
        again.current = false;
        for (const scan of load(key)) {
          const { data, error, status } = await db().rpc("checkin", {
            p_event_id: scan.event_id,
            p_member_code: scan.code,
            p_scanned_at: scan.scanned_at,
          });
          // offline, expired login or server down: keep it queued and retry later
          if (error && (!error.code || status === 401 || status >= 500 || error.code === "28000")) return;
          save(key, load(key).filter((s) => s.id !== scan.id));
          const text = error ? friendly(error.message) : (LABEL[data] ?? data);
          setResults((r) => [{ id: scan.id, text, ok: data === "ok" }, ...r].slice(0, 20));
        }
      } while (again.current);
    } finally {
      flushing.current = false;
      setQueued(load(key).length);
    }
  }, [key]);

  useEffect(() => {
    const retry = () => void flush();
    retry();
    const timer = setInterval(retry, 15000);
    window.addEventListener("online", retry);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", retry);
    };
  }, [flush]);

  const last = useRef({ code: "", at: 0 });
  const enqueue = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (!code || !eventId) return;
      // the camera sees the same QR many times per second: ignore repeats within 3 s
      if (last.current.code === code && Date.now() - last.current.at < 3000) return;
      last.current = { code, at: Date.now() };
      save(key, [...load(key), { id: crypto.randomUUID(), event_id: eventId, code, scanned_at: new Date().toISOString() }]);
      void flush();
    },
    [eventId, flush, key],
  );

  useEffect(() => {
    if (!camera || !window.BarcodeDetector) return;
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(
      (s) => {
        stream = s;
        if (stopped || !video.current) return s.getTracks().forEach((t) => t.stop());
        video.current.srcObject = s;
        void video.current.play();
        timer = setInterval(() => {
          const v = video.current;
          if (v && v.readyState === 4) detector.detect(v).then((codes) => codes.forEach((c) => enqueue(c.rawValue)), () => {});
        }, 400);
      },
      (e: Error) => {
        setError(`Camera: ${e.message}`);
        setCamera(false);
      },
    );
    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camera, enqueue]);

  const toggleCamera = () => {
    if (!camera && !window.BarcodeDetector)
      return setError("This browser cannot scan QR codes. Type the code instead (or use Chrome on Android).");
    setError(null);
    setCamera(!camera);
  };

  return (
    <section className="panel">
      <h2>Check-in</h2>
      <label>
        Event
        <select value={eventId ?? ""} onChange={(e) => setEventId(Number(e.target.value))}>
          {events.length === 0 && <option value="">No events</option>}
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} · {new Date(e.starts_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="primary" disabled={!eventId} onClick={toggleCamera}>
        {camera ? "Stop camera" : "Scan QR with camera"}
      </button>
      {camera && <video ref={video} className="camera" muted playsInline />}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          enqueue(manual);
          setManual("");
        }}
      >
        <input className="grow" placeholder="…or type the code" aria-label="Member code" value={manual} onChange={(e) => setManual(e.target.value)} />
        <button type="submit" disabled={!eventId || !manual.trim()}>
          Add
        </button>
      </form>
      {queued > 0 && <p className="hint">{queued} scan(s) waiting for a connection…</p>}
      {error && <p className="error">{error}</p>}
      <ul className="results" aria-live="polite">
        {results.map((r) => (
          <li key={r.id} className={r.ok ? "ok" : undefined}>
            {r.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
