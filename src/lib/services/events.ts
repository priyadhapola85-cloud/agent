import type { Db } from "../db/client";
import { statusEvents, type EntityType } from "../db/schema";
import { newId } from "../ids";

/** Appends one line to the status history log. */
export async function recordEvent(
  db: Db,
  entityType: EntityType,
  entityId: string,
  fromStatus: string | null,
  toStatus: string,
  message = "",
) {
  await db.insert(statusEvents).values({
    id: newId("evt"),
    entityType,
    entityId,
    fromStatus,
    toStatus,
    message: message.slice(0, 1000),
  });
}
