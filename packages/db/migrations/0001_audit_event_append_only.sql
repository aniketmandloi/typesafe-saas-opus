-- ADR-0008: the audit log is append-only in the database, not by convention.
--
-- A trigger rather than a permission, because it has to hold against the raw
-- handle — the one path that could otherwise rewrite history. The only mutation
-- Postgres will accept is scrubbing the denormalised *_display columns, which
-- is exactly the erasure path ADR-0007 needs: an erasure request hollows out
-- the identifiers without destroying the record of what happened.
--
-- Guarded by an integration test that asserts behaviour rather than existence.
-- Checking pg_trigger membership would pass for a trigger that exists but was
-- rewritten wrongly.

CREATE OR REPLACE FUNCTION audit_event_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_event is append-only: DELETE is not permitted';
  END IF;

  -- Every column except the two display fields must be identical. Listing them
  -- explicitly rather than comparing whole rows: a row comparison would also
  -- reject an UPDATE that changed nothing, and would silently start allowing a
  -- new column to be rewritten the day one is added.
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.actor_type IS DISTINCT FROM OLD.actor_type
    OR NEW.action IS DISTINCT FROM OLD.action
    OR NEW.subject_type IS DISTINCT FROM OLD.subject_type
    OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'audit_event is append-only: only actor_display and subject_display may be updated';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_event_append_only_delete
  BEFORE DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_event_append_only_update
  BEFORE UPDATE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();
