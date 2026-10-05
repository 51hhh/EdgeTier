import type { RoomSnapshot } from '../observer/types';

/** Same-room fetch errors may retain data; changing rooms cannot retain that identity. */
export function roomForSelection(snapshot: RoomSnapshot | null, selected: string | null): RoomSnapshot | null {
  return snapshot && selected && snapshot.roomId === selected ? snapshot : null;
}

export interface SelectionTicket { selection: string | null; revision: number }

/** A revision also rejects an old request after selecting A -> B -> A. */
export function createSelectionGuard() {
  let selection: string | null = null;
  let revision = 0;
  return {
    select(next: string | null): void {
      if (next !== selection) { selection = next; revision += 1; }
    },
    capture(): SelectionTicket { return { selection, revision }; },
    isCurrent(ticket: SelectionTicket): boolean { return ticket.selection === selection && ticket.revision === revision; },
  };
}
