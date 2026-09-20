import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Deliberately has no foreign keys at all (ADR-0007). Purge CASCADEs every
// tenant table off the organization row, and a FK here would cascade the
// evidence away with it. organization_id is a plain column.
//
// It is also null for platform-scoped events — an auth event belongs to the
// installation, not to an Organization, which is what stops one org's admins
// reading a member's sign-ins (ADR-0008).
//
// Entries are intent-grained and never carry field values: "member.role.changed",
// not a before/after diff. Roles are a CSV column, so a diff would read as
// `"member" -> "member,admin"`, and storing values would make every staff read
// of the log a read of tenant content, against ADR-0005.
//
// A Postgres trigger rejects every DELETE and any UPDATE outside the *_display
// columns. Those columns are denormalised copies kept for readability after the
// subject is gone, and scrubbing them is the one accepted mutation — the
// erasure path ADR-0007 needs.
export const auditEvent = pgTable(
  "audit_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id"),
    actorId: text("actor_id"),
    actorType: text("actor_type").notNull(),
    actorDisplay: text("actor_display"),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id"),
    subjectDisplay: text("subject_display"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_event_organization_id_created_at_idx").on(table.organizationId, table.createdAt),
    index("audit_event_actor_id_idx").on(table.actorId),
  ],
);
