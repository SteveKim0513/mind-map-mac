// macOS Reminders bridge via AppleScript (osascript). No native target / signing
// needed — only a one-time Automation permission grant the first time we run.
//
// All reminders we manage live in a dedicated "MindMap" list so reads stay bounded
// and we never touch the user's other reminders. Titles/ids are passed as argv (not
// interpolated into the script) so arbitrary text can't break or inject AppleScript.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

const LIST = 'MindMap';
// Field / record separators: ASCII unit (31) and record (30) separators. These
// control chars can't appear in a reminder title, so parsing stays unambiguous.
const US = '';
const RS = '';

export interface ReminderInfo {
  id: string;
  title: string;
  completed: boolean;
  dueDate: string | null; // local-time ISO, or null
  modifiedAt: string; // local-time ISO
  tag: string | null; // owning node id (stamped in the reminder body), or null
}

const TAG_PREFIX = 'mindmap:';

// Shared AppleScript handlers: format a date as local-time ISO and pad numbers.
const SUFFIX = `
on pad(n)
  set n to n as integer
  if n < 10 then return "0" & n
  return n as string
end pad
on isoOf(d)
  return (year of d as integer as string) & "-" & pad(month of d as integer) & "-" & pad(day of d) & "T" & pad(hours of d) & ":" & pad(minutes of d) & ":" & pad(seconds of d)
end isoOf
`;

export type OsaErrorKind = 'timeout' | 'denied' | 'error';

/** Classify an execFile failure so the renderer can react (retry vs prompt vs back off).
 * The kind is encoded as a message prefix because Error fields don't survive IPC. */
function classify(err: unknown): { kind: OsaErrorKind; detail: string } {
  const e = err as { killed?: boolean; signal?: string; stderr?: string; message?: string };
  const stderr = String(e?.stderr ?? '');
  if (e?.killed && e?.signal === 'SIGTERM') return { kind: 'timeout', detail: 'osascript timed out' };
  if (/-1743|not authoriz|not allowed|-10004|Application isn.t running/i.test(stderr))
    return { kind: 'denied', detail: stderr };
  return { kind: 'error', detail: stderr || e?.message || 'unknown' };
}

// Reminders' AppleScript bridge wedges (hangs → SIGTERM timeout) when hit by
// concurrent osascript processes. Serialize every call through one chain so at most
// one osascript talks to Reminders at a time, regardless of caller.
let osaChain: Promise<unknown> = Promise.resolve();

async function osa(script: string, args: string[], timeout = 6000): Promise<string> {
  const task = osaChain.then(async () => {
    try {
      const { stdout } = await pexec('osascript', ['-e', script, ...args], {
        timeout,
        maxBuffer: 1024 * 1024 * 8,
      });
      return stdout.replace(/\n$/, '');
    } catch (err) {
      const { kind, detail } = classify(err);
      throw new Error(`OSA_${kind.toUpperCase()}: ${detail}`);
    }
  });
  // keep the chain alive even if this call rejects
  osaChain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

/** Cheap liveness probe with a short timeout. Returns ok=false + kind on failure,
 * never throwing — drives the renderer's heartbeat/backoff health loop. */
export async function heartbeat(): Promise<{ ok: boolean; kind?: OsaErrorKind }> {
  try {
    await osa(`tell application "Reminders" to count lists`, [], 5000);
    return { ok: true };
  } catch (err) {
    const msg = (err as Error).message || '';
    const kind: OsaErrorKind = msg.includes('OSA_DENIED')
      ? 'denied'
      : msg.includes('OSA_TIMEOUT')
        ? 'timeout'
        : 'error';
    return { ok: false, kind };
  }
}

/** ISO → [year, month, day, hours, minutes] as strings (local time). */
function dateParts(iso: string): string[] {
  const d = new Date(iso);
  return [
    String(d.getFullYear()),
    String(d.getMonth() + 1),
    String(d.getDate()),
    String(d.getHours()),
    String(d.getMinutes()),
  ];
}

/** Probe access (and trigger the Automation prompt on first run). */
export async function remindersAvailable(): Promise<boolean> {
  try {
    const out = await osa(
      `on run argv
        try
          tell application "Reminders" to count lists
          return "OK"
        on error
          return "NO"
        end try
      end run`,
      [],
      120000, // allow time for the permission dialog
    );
    return out.trim() === 'OK';
  } catch {
    return false;
  }
}

export async function createReminder(opts: {
  title: string;
  dueDate: string | null;
  nodeId: string;
}): Promise<ReminderInfo> {
  const hasDate = opts.dueDate ? '1' : '0';
  const [y, mo, d, h, mi] = opts.dueDate ? dateParts(opts.dueDate) : ['0', '0', '0', '0', '0'];
  const out = await osa(
    `on run argv
      set theTitle to item 1 of argv
      set hasDate to item 2 of argv
      set theTag to item 8 of argv
      tell application "Reminders"
        if not (exists list "${LIST}") then make new list with properties {name:"${LIST}"}
        set newR to make new reminder at end of list "${LIST}" with properties {name:theTitle, body:theTag}
        if hasDate is "1" then
          set dd to current date
          set day of dd to 1
          set year of dd to (item 3 of argv as integer)
          set month of dd to (item 4 of argv as integer)
          set day of dd to (item 5 of argv as integer)
          set hours of dd to (item 6 of argv as integer)
          set minutes of dd to (item 7 of argv as integer)
          set seconds of dd to 0
          set due date of newR to dd
        end if
        set rid to id of newR
        set md to modification date of newR
      end tell
      return rid & (character id 31) & my isoOf(md)
    end run
    ${SUFFIX}`,
    [opts.title, hasDate, y, mo, d, h, mi, TAG_PREFIX + opts.nodeId],
  );
  const [id, modifiedAt] = out.split(US);
  return {
    id,
    title: opts.title,
    completed: false,
    dueDate: opts.dueDate,
    modifiedAt,
    tag: opts.nodeId,
  };
}

/** Update an existing reminder. Returns the new modification ISO, or null if it
 * no longer exists (deleted externally). */
export async function updateReminder(opts: {
  id: string;
  title: string;
  completed: boolean;
  dueDate: string | null;
}): Promise<string | null> {
  const dueMode = opts.dueDate ? 'set' : 'clear';
  const [y, mo, d, h, mi] = opts.dueDate ? dateParts(opts.dueDate) : ['0', '0', '0', '0', '0'];
  const compMode = opts.completed ? '1' : '0';
  const out = await osa(
    `on run argv
      set theId to item 1 of argv
      set theTitle to item 2 of argv
      set dueMode to item 3 of argv
      set compMode to item 9 of argv
      tell application "Reminders"
        if not (exists list "${LIST}") then return "MISSING"
        set matches to (reminders of list "${LIST}" whose id is theId)
        if (count of matches) is 0 then return "MISSING"
        set r to item 1 of matches
        set name of r to theTitle
        if dueMode is "set" then
          set dd to current date
          set day of dd to 1
          set year of dd to (item 4 of argv as integer)
          set month of dd to (item 5 of argv as integer)
          set day of dd to (item 6 of argv as integer)
          set hours of dd to (item 7 of argv as integer)
          set minutes of dd to (item 8 of argv as integer)
          set seconds of dd to 0
          set due date of r to dd
        else
          set due date of r to missing value
        end if
        if compMode is "1" then
          set completed of r to true
        else
          set completed of r to false
        end if
        set md to modification date of r
      end tell
      return my isoOf(md)
    end run
    ${SUFFIX}`,
    [opts.id, opts.title, dueMode, y, mo, d, h, mi, compMode],
  );
  const trimmed = out.trim();
  return trimmed === 'MISSING' ? null : trimmed;
}

export async function deleteReminder(id: string): Promise<void> {
  await osa(
    `on run argv
      set theId to item 1 of argv
      tell application "Reminders"
        if not (exists list "${LIST}") then return "OK"
        set matches to (reminders of list "${LIST}" whose id is theId)
        repeat with r in matches
          delete r
        end repeat
      end tell
      return "OK"
    end run`,
    [id],
  );
}

/** All reminders currently in the MindMap list. */
export async function queryReminders(): Promise<ReminderInfo[]> {
  const out = await osa(
    `on run argv
      set outStr to ""
      tell application "Reminders"
        if not (exists list "${LIST}") then return ""
        set rs to reminders of list "${LIST}"
        repeat with r in rs
          set rid to id of r
          set nm to name of r
          set comp to completed of r
          set md to modification date of r
          set dueStr to ""
          set dd to due date of r
          if dd is not missing value then set dueStr to my isoOf(dd)
          set bodyStr to ""
          set bd to body of r
          if bd is not missing value then set bodyStr to bd
          set outStr to outStr & rid & (character id 31) & nm & (character id 31) & (comp as string) & (character id 31) & (my isoOf(md)) & (character id 31) & dueStr & (character id 31) & bodyStr & (character id 30)
        end repeat
      end tell
      return outStr
    end run
    ${SUFFIX}`,
    [],
  );
  if (!out) return [];
  return out
    .split(RS)
    .filter((rec) => rec.length > 0)
    .map((rec) => {
      const [id, title, comp, modifiedAt, dueStr, bodyStr] = rec.split(US);
      const tag = bodyStr && bodyStr.startsWith(TAG_PREFIX) ? bodyStr.slice(TAG_PREFIX.length) : null;
      return {
        id,
        title: title ?? '',
        completed: comp === 'true',
        dueDate: dueStr ? dueStr : null,
        modifiedAt: modifiedAt ?? '',
        tag,
      };
    });
}
