/**
 * Instant canned Ava lines — fire before Root Server digs.
 * No LLM. Keeps Discord feeling alive while context generation runs.
 */

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function stampNow() {
  const unix = Math.floor(Date.now() / 1000);
  return `<t:${unix}:t>`;
}

/** Wake / back-from-break — fire immediately (append stamp in poller). */
export const AVA_WAKES = [
  "yo I'm back",
  "mm alright I'm up",
  "back — what do you need",
  "ok I'm here again",
  "woke up, hit me",
  "back online, gimme the ask",
  "I'm up. one sec if it's deep",
  "hello again — listening",
  "break's over, what's up",
  "kk I'm back on",
  "resurfaced. talk to me",
  "back in the chat",
  "mm waking up — go ahead",
  "I'm here. fire away",
  "alright I'm live again",
  "back. don't make me regret it",
  "up. ask clean if you want a fast answer",
  "I'm back — dig starts after this",
  "yo. break ended",
  "online. what we doing",
  "mm hey — I'm awake",
  "back at it",
  "I'm here now",
  "okok I'm up, talk",
  "returned. what's the problem",
];

/** Instant first ack — always fire right away on ping. */
export const AVA_ACKS = [
  "mmmm..... idk.... let me search that for you",
  "one sec",
  "okok hold on, let me dig real quick…",
  "mmm not sure yet — searching…",
  "hang onnn… checking…",
  "one sec, let me look…",
  "ngl idk offhand — give me a moment…",
  "wait wait — searching that for you…",
  "kk",
  "sec, verifying against the files…",
  "bet — looking now",
  "on it, hold up",
  "lemme check the packs real quick",
  "pulling wiki + notes…",
  "okaay searching",
  "give me a beat",
  "mm",
  "checking changelogs…",
  "one moment — accuracy over vibes",
  "hold — reading",
  "sec sec",
  "looking that up",
  "alright I'm on it",
  "grabbing context…",
  "mm wait I wanna get this right",
  "on it — one sec",
  "qk check…",
  "mm — I'm with you. go on.",
  "lemme verify before I yap",
  "searching RootMC side…",
  "one sec",
  "hang tight",
  "on the hunt",
  "mmmm checking",
  "idk yet — searching",
  "gimme a sec to be accurate",
  "files first, then I answer",
  "brb in my brain",
  "loading the relevant bits…",
  "got it",
  "aye, looking",
  "checking what we actually shipped…",
  "wiki peek incoming…",
  "notes check…",
  "log/wiki scan…",
  "real quick dig",
  "I gotchu — searching",
  "wait I need the real answer",
  "hold on I'm not guessing this",
  "one sec",
  "mm starting the timer on this dig…",
  "pulling numbers + notes…",
  "sec — I wanna see the delta…",
  "analytics brain on, searching…",
];

/**
 * Transfer beat 2 — queue delay / taking longer than a snappy dig.
 * Fire when Root Server is busy or elapsed ~beat2.
 */
export const AVA_HOLD_2 = [
  "still on it",
  "mm this one's taking a sec longer",
  "still on it, not ghosting you",
  "transfer — deeper look",
  "hold up, still reading",
  "yeah still searching…",
  "almost — verifying",
  "still in the files",
  "patience, accuracy mode",
  "mmmm still pulling",
  "not done yet — keep hanging",
  "second pass…",
  "still cooking the answer",
  "queued",
  "taking a little longer, worth it",
  "still here",
  "one more check…",
  "transferring to a deeper dig",
  "brain's busy — you're next / in progress",
  "still working that ask",
  "mm wait almost",
  "don't leave — still on this",
  "longer dig than I hoped, stay",
  "still verifying against packs",
  "halfway-ish — hang on",
  "context's heavy, still going",
  "aye still searching",
  "not stuck — just careful",
  "second beat: still looking",
  "transfer 2 — keep waiting",
];

/**
 * Transfer beat 3 — deep queue / long generation.
 * Fire when 2nd–3rd job ahead or elapsed ~beat3.
 */
export const AVA_HOLD_3 = [
  "okay this is a long dig — still with you",
  "third beat: still working, not dead",
  "Root Server's chewing — hang tight",
  "queue was stacked — almost there",
  "yeah I know it's been a minute…",
  "still on it",
  "long transfer — answer incoming",
  "heavy context, still processing",
  "mmmm almost done I hope",
  "last stretch — stay",
  "still on your ask, deep pass",
  "taking forever but I'd rather be right",
  "transfer 3 — final hold",
  "brain backlog cleared soon",
  "still alive, still searching",
  "long one — thanks for waiting",
  "deep dig mode, nearly back",
  "okay seriously still going",
  "not abandoned — just slow files",
  "final hold before I reply",
  "stacked asks ahead of / with you — almost",
  "still on it",
  "mm yeah this needed the long path",
  "third ping of patience — still me",
  "coming, coming…",
];

/** When already 2+ jobs in the brain queue at ack time. */
export const AVA_QUEUE_WARN = [
  "heads up — I'm mid another dig, you're queued",
  "got you, but Root Server's busy — short wait",
  "you're 2nd in line — instant ack, real answer soon",
  "stacked ask — I'll get to you right after this",
  "queue transfer: you're next / near next",
  "queued — one reply coming",
  "mm wait I'm finishing something else first",
  "ack'd — behind one job on the Root Server",
];

/** When Root Server slots are full (all concurrent digs busy). */
export const AVA_BUSY_WAIT = [
  "hold up — I'm already running digs. give me a minute, then ping again.",
  "brain's full right now (max parallel digs). wait a beat and ask again.",
  "can't stack more Root Server jobs yet — wait, then hit me.",
  "mm busy — all agent slots taken. chill a sec and retry.",
  "already mid-dig on other asks. wait for me, then ping.",
  "slots full — I'll finish what's cooking first. try again shortly.",
];

export function pickAck() {
  return pick(AVA_ACKS);
}

export function pickWake(includeStamp = true) {
  const line = pick(AVA_WAKES);
  return includeStamp ? `${line} — ${stampNow()}` : line;
}

export function pickHold(beat = 2) {
  if (beat >= 3) return pick(AVA_HOLD_3);
  return pick(AVA_HOLD_2);
}

export function pickQueueWarn() {
  return pick(AVA_QUEUE_WARN);
}

export function pickBusyWait({ active = 0, max = 3 } = {}) {
  return `${pick(AVA_BUSY_WAIT)} (${active}/${max} digs live)`;
}

/**
 * Instant opener for a ping.
 * @param {{ fromBreak?: boolean, queueDepth?: number, slotsFull?: boolean, active?: number, max?: number }} opts
 */
export function pickInstantOpen({
  fromBreak = false,
  queueDepth = 0,
  slotsFull = false,
  active = 0,
  max = 3,
} = {}) {
  if (fromBreak) return pickWake(true);
  if (slotsFull) return pickBusyWait({ active, max });
  if (queueDepth >= 2) return `${pickQueueWarn()} · ${pickAck()}`;
  if (queueDepth >= 1) {
    return `${pickAck()} (${active || queueDepth}/${max} digs running — you're in)`;
  }
  return pickAck();
}

/** Beat delays (ms) — human "still here" pacing while a dig runs. */
export function holdBeatDelays(queueDepth = 0) {
  const q = Math.max(0, Number(queueDepth) || 0);
  if (q >= 2) return { beat1: 12_000, beat2: 12_000, beat3: 28_000 };
  if (q >= 1) return { beat1: 15_000, beat2: 15_000, beat3: 32_000 };
  return { beat1: 18_000, beat2: 18_000, beat3: 40_000 };
}
