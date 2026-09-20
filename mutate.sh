#!/usr/bin/env bash
# Each mutation is applied to the generated declaration, then checkSchema() is run.
# Every substitution asserts it matched: a silent no-op would fake a PASS.
set -u
cp auth-schema.orig.ts auth-schema.ts
run() { printf '%-48s ' "$1"; node probe.ts 2>&1 | grep -E '^RESULT:' | head -1; cp auth-schema.orig.ts auth-schema.ts; }
sub() { python3 -c "
import io,sys
s=io.open('auth-schema.ts').read()
old,new=sys.argv[1],sys.argv[2]
assert old in s, 'PATTERN NOT FOUND: '+repr(old)
io.open('auth-schema.ts','w').write(s.replace(old,new,1))
" "$1" "$2" || { echo '   !! substitution failed'; return 1; }; }

ORG='export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),'

run "baseline (CLI 1.4.x output, unmodified)"
sub "$ORG" "$ORG
    deletedAt: timestamp(\"deleted_at\")," && run "extra NULLABLE column (ADR-0007 deleted_at)"
sub "$ORG" "$ORG
    kitTier: text(\"kit_tier\").notNull()," && run "extra NOT NULL column, no default"
sub "$ORG" "$ORG
    kitTier: text(\"kit_tier\").notNull().default(\"free\")," && run "extra NOT NULL column, with default"
sub '  image: text("image"),
' '' && run "missing column (user.image)"
sub 'boolean("email_verified")' 'boolean("email_verified_x")' && run "renamed physical column"
sub 'name: text("name").notNull(),' 'name: boolean("name").notNull(),' && run "changed type (user.name text->boolean)"
sub 'email: text("email").notNull().unique(),' 'email: text("email").unique(),' && run "dropped .notNull() (user.email)"
sub '    index("member_organizationId_idx").on(table.organizationId),
' '' && run "removed index"
