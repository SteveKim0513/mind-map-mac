// Field-level reconcile between a node and its mirrored macOS reminder.
//
// The previous logic compared the whole record and chose ONE side (pull or push)
// by recency. That loses a concurrent edit: complete a task in the app while its
// title is edited in Reminders, and whichever side "wins" the recency tiebreak
// silently discards the other field's change. Here each field (title / due / done)
// is resolved independently against the last-synced `base`, so non-conflicting
// edits on opposite sides both survive. Only a TRUE conflict on the SAME field
// (both changed) falls back to the recency tiebreak.

export type Base = { title: string; due: string | null; done: boolean };

export interface Resolution {
  /** merged value for every field — becomes the new sync baseline */
  resolved: Base;
  /** a field resolved to the local value that the reminder doesn't have yet */
  needPush: boolean;
  /** a field resolved to the remote value that the node doesn't have yet */
  needPull: boolean;
}

const FIELDS = ['title', 'due', 'done'] as const;

/**
 * @param base    last-synced snapshot (undefined on first contact)
 * @param cur     the node's current values
 * @param remote  the reminder's current values
 * @param localMs node.updatedAt — when the local side last changed
 * @param remoteMs reminder.modifiedAt — when the remote side last changed
 */
export function resolveReminder(
  base: Base | undefined,
  cur: Base,
  remote: Base,
  localMs: number,
  remoteMs: number,
): Resolution {
  const remoteNewer = remoteMs >= localMs;
  const resolved = { ...cur };
  let needPush = false;
  let needPull = false;

  for (const f of FIELDS) {
    const localChanged = !base || cur[f] !== base[f];
    const remoteChanged = !base || remote[f] !== base[f];

    let winner: Base[typeof f];
    if (remoteChanged && (!localChanged || remoteNewer)) winner = remote[f];
    else if (localChanged) winner = cur[f];
    else winner = cur[f]; // unchanged on both sides (cur === base === remote)

    (resolved as Record<string, unknown>)[f] = winner;
    if (winner !== remote[f]) needPush = true; // reminder lacks this value
    if (winner !== cur[f]) needPull = true; // node lacks this value
  }

  return { resolved, needPush, needPull };
}
