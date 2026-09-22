# Should the rate limit bucket table be `UNLOGGED`?

Research for [#45](https://github.com/aniketmandloi/typesafe-saas-opus/issues/45), feeding
[ADR-0022](../adr/0022-rate-limiting-is-keyed-on-verified-identity.md). Verified 2026-09-22 against
primary sources only: Neon's own documentation repository and the `neondatabase/neon` source tree,
the AWS RDS and Aurora user guides, the PostgreSQL manual and `postgres/postgres` at `master`, and
the installed `drizzle-orm` / `drizzle-kit` packages in this repo.

**Answer: no — keep the table ordinary, on a single schema for both targets.** Not because the
failure mode is dangerous (it is not; truncation empties the table and the `INSERT … ON CONFLICT`
keeps working), but because **the saving does not exist on one of the two mandated targets.** AWS
states outright that Aurora's storage layer does not use the PostgreSQL WAL for durability, that
Aurora's unlogged tables are crash-safe, and that the usual performance benefit "may not be as
significant" there. On Neon the saving is genuine and verifiable in the source. So `UNLOGGED` buys
a real win on Neon and RDS, nothing measurable on Aurora, and ADR-0022 requires one answer that
holds on both. The conditional that would flip this is stated at the end.

## Summary table

| | Neon | RDS for PostgreSQL | Aurora PostgreSQL |
|---|---|---|---|
| Wiped by the platform's idle-suspend cycle? | **Yes**, on every scale to zero — default 5 min idle | n/a (no scale to zero) | **Not documented**; mechanically should survive |
| Wiped by crash / failover? | Yes (compute restart of any kind) | **Yes** — Multi-AZ failover, PITR, major upgrade | **No** — AWS documents them as crash-safe |
| Wiped by a *clean* restart? | **Yes** | No (PostgreSQL only resets `InRecovery`) | No |
| WAL / write saving real? | **Yes** — pages never enter the WAL, never reach the pageserver | **Yes** — vanilla semantics | **No, largely illusory** — AWS's own wording |
| Truncate or drop? | **Truncate.** Relation stays valid, rows gone | Truncate | n/a |
| Readable from a replica? | No (inference — undocumented) | No (not replicated) | **No** — documented error |

## 1. Does Neon's suspend/resume cycle truncate unlogged relations?

**Yes — and more aggressively than vanilla Postgres, by Neon's own admission.**
[`compatibility.md`](https://github.com/neondatabase/website/blob/main/content/docs/reference/compatibility.md),
§ Unlogged tables, verbatim:

> Unlogged tables are tables that do not write to the Postgres write-ahead log (WAL). In Neon, these
> tables are stored on compute local storage and are not persisted across compute restarts or when a
> compute scales to zero. **This is unlike standard Postgres, where unlogged tables are only truncated
> in the event of abnormal process termination.** Additionally, unlogged tables are limited by compute
> local disk space. Computes allocate 20 GiB of local disk space or 15 GiB x the maximum compute size
> (whichever is highest) for temporary files used by Postgres.

The same statement appears in Neon's engineering notes,
[`docs/core_changes.md`](https://github.com/neondatabase/neon/blob/main/docs/core_changes.md):

> Currently in Neon, unlogged tables live on local disk in the compute node, and are wiped away on
> compute node restart.

**How quickly an idle branch suspends.** Default is **5 minutes** of inactivity
([Scale to Zero](https://github.com/neondatabase/website/blob/main/content/docs/introduction/scale-to-zero.md)).
The configurability matrix from the
[scale-to-zero guide](https://github.com/neondatabase/website/blob/main/content/docs/guides/scale-to-zero-guide.md):

| Plan | Scale to zero after | Can be disabled? |
| --- | --- | --- |
| Free | 5 minutes | no |
| Launch | 5 minutes | yes |
| Scale | Configurable, 1 minute to always on | yes |

Two things follow that matter more than the 5 minutes itself.

**First, the suspend is harmless by construction.** A compute suspends only after five minutes with
no active query. A rate limit bucket's life is seconds. So at the precise moment Neon wipes the
table, every row in it has already expired and is already being ignored by ADR-0022's
`WHERE count < max` clause. Scale to zero is *not* the risk here.

**Second, there is no Neon configuration that makes the table durable.** Disabling scale to zero
does not remove compute restarts — the guide says so explicitly:

> If you disable scale to zero entirely, your compute will remain active, and you will have to
> manually restart your compute to pick up the latest updates to Neon's compute images. Neon
> typically releases compute-related updates weekly.

Autoscaling is *not* a restart source:
[Autoscaling](https://github.com/neondatabase/website/blob/main/content/docs/introduction/autoscaling.md)
says it adjusts compute "eliminating the need for manual intervention or restarts." The real,
unavoidable wipe events are therefore platform maintenance and unplanned compute moves — restarts
that can land in the middle of live traffic, unlike the idle suspend.

## 2. Does Neon's storage architecture actually deliver the WAL saving?

**Yes. The saving is real on Neon, not illusory.** This is the one place the intuition holds, and
the ticket's worry — that the pageserver does the same work either way — is wrong.

The evidence is in Neon's Postgres extension rather than its docs.
[`pgxn/neon/pagestore_smgr.c`](https://github.com/neondatabase/neon/blob/main/pgxn/neon/pagestore_smgr.c)
dispatches every storage-manager entry point on `smgr_relpersistence`, and routes
`RELPERSISTENCE_UNLOGGED` (and `RELPERSISTENCE_TEMP`) to the stock `md*` local-file manager while
permanent relations go to the pageserver. From `neon_exists`:

```c
case RELPERSISTENCE_TEMP:
case RELPERSISTENCE_UNLOGGED:
    return mdexists(reln, forkNum);
```

The file header comment states the division directly, in the course of explaining the
`relpersistence == 0` fallback used during buffer eviction:

> If smgrwrite() is called and smgr_relpersistence == 0, we check if the relation file exists locally
> or not. If it does exist, we assume it's an unlogged relation and write the page there. Otherwise it
> must be a permanent relation, **WAL-logged and stored on the page server**, and we ignore the write
> like we do for permanent relations.

So on Neon an unlogged write produces no WAL record. No WAL record means nothing streamed to the
safekeepers, nothing ingested by the pageserver, and nothing to retain. That is a strictly larger
saving than on vanilla Postgres, where the only saving is the local WAL write.

**It is also a metered saving.** Neon bills `instant_restore_bytes_month` — point-in-time restore
history in GB-months — as a first-class line item
([usage calculations](https://github.com/neondatabase/website/blob/main/content/docs/introduction/usage-calculations.md)).
Restore history is WAL-derived, so a logged table written on every counted request accrues billed
restore history for rows that are worthless within seconds. Neon's docs do not quantify the
per-write contribution, and nothing here measures it, so treat this as a real but unsized cost.

**Cost of the local-disk placement.** The unlogged table shares the compute's temp-file disk (20 GiB
or 15 GiB × max compute size). The bucket table is one narrow row per active key, so this is not a
practical constraint — but it is a shared budget with `work_mem` spill files, which is worth knowing.

## 3. RDS and Aurora

### RDS for PostgreSQL — vanilla semantics, saving real, wipe on recovery

RDS for PostgreSQL is stock Postgres on block storage, and AWS documents stock behaviour.
[Managing high object counts in Amazon RDS for PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.HighObjectCount.html),
§ Unlogged tables:

> Unlogged tables can offer performance gains as they won't generate any WAL information. They must be
> used carefully as they offer no durability during database crash recovery as they will be truncated.

and, on which operations trigger it:

> During any database state that involves database crash recovery such as **Multi-AZ reboot with
> failover, Amazon RDS point-in-time recovery, and Amazon RDS major version upgrade**, the serialized
> operation of truncating the unlogged tables will occur.

Note what is *not* on that list: a clean restart. PostgreSQL resets unlogged relations only when it
went through recovery. From
[`src/backend/access/transam/xlog.c`](https://github.com/postgres/postgres/blob/master/src/backend/access/transam/xlog.c)
in `StartupXLOG`:

```c
if (InRecovery)
    ResetUnloggedRelations(UNLOGGED_RELATION_INIT);
```

So on RDS the contents survive a planned reboot and are lost on any recovery-involving event. AWS's
own recommendation in the same section: "Minimize the use of unlogged tables only to data which is
acceptable to lose during database crash recovery operations." A rate limit bucket qualifies.

### Aurora PostgreSQL — no wipe, and no saving either

This is the finding that decides the ticket.
[Working with unlogged tables in Aurora PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-postgresql-unlogged-tables.html),
verbatim:

> Amazon Aurora PostgreSQL supports unlogged tables that are **crash-safe and maintain data integrity
> even after writer instance failures or failovers.** […] In contrast, Aurora PostgreSQL handles
> unlogged tables differently due to its distributed storage architecture. This is because the Aurora
> storage system does not rely on the traditional PostgreSQL WAL for durability. **However, the
> performance benefits typically associated with unlogged tables in standard PostgreSQL may not be as
> significant in Aurora.** This is because of the Aurora distributed storage architecture, which can
> introduce additional overhead compared to the local storage used in standard PostgreSQL.

Read that as one statement rather than two: Aurora's unlogged pages are durable, which means they
still reach the Aurora storage volume, which is fed by the redo stream. Durability and "skips the
write path" cannot both be true. **On Aurora the saving is illusory, and AWS says so in its own
hedged wording.** AWS does not quantify the residual benefit, and does not document the mechanism —
only the outcome. It also does not state a minimum engine version for the crash-safe behaviour;
nothing in the Aurora PostgreSQL release notes surfaced a version gate, so treat "which versions"
as undocumented.

**Aurora auto-pause is not documented for unlogged tables.** The
[scale-to-zero / auto-pause page](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html)
never mentions them. It sets `SecondsUntilAutoPause` with a minimum and default of 300 seconds and a
maximum of 86,400, notes a typical ~15 s resume, and warns that after 24 h paused the resume is
"roughly equivalent to doing a reboot of the instance." Since Aurora's durability for unlogged
relations comes from the storage volume and not the WAL, they should survive a pause/resume —
**but that is an inference from the architecture, not a documented guarantee.** AWS does not settle
this sub-question.

### Costs `UNLOGGED` carries on both AWS targets

- **Writer-only access.** "You can access unlogged tables only from the writer node in the Aurora DB
  cluster. Reader nodes can access unlogged tables only when promoted to writer status," producing
  `cannot access temporary or unlogged relations during recovery`. The limiter always writes, so this
  does not bite today; it forecloses ever reading a bucket from a replica.
- **Excluded from logical replication by default on PG 15+.** Aurora's
  `rds.logically_replicate_unlogged_tables` "is set by default to 1 (on) in versions 14 and earlier,
  and to 0 (off) in versions 15 and later."
- **Excluded from Blue/Green deployments,** which are built on logical replication (RDS high-object-count
  page, same section).
- **Must be converted before creating a read replica:** "Convert unlogged tables to logged tables or
  drop them if they are not being used before creating an Aurora read replica." The conversion,
  `ALTER TABLE … SET LOGGED`, "rewrites the entire table and places an exclusive lock on it until the
  operation completes."

None of these break a disposable counter. All of them are operational sharp edges the kit would be
shipping to every fork in exchange for a saving one of its two reference targets does not provide.

## 4. Failure behaviour: does the `INSERT … ON CONFLICT` break noisily?

**It does not break at all. It fails open, silently, for exactly one window — and that is the honest
answer to the ticket's question.**

**Truncate, not drop.** PostgreSQL's reset is a file-level operation against the relation's forks;
the catalog row is a logged relation and is untouched. From
[`src/backend/storage/file/reinit.c`](https://github.com/postgres/postgres/blob/master/src/backend/storage/file/reinit.c):

> Reset unlogged relations from before the last restart.
>
> If op includes UNLOGGED_RELATION_CLEANUP, we remove all forks of any relation with an "init" fork,
> except for the "init" fork itself.
>
> If op includes UNLOGGED_RELATION_INIT, we copy the "init" fork to the main fork.

The table, its columns, its indexes, its constraints and its grants all survive. Only the rows go.

**Neon reaches the same end state by a different route, and tests it.** From
[`test_runner/regress/test_unlogged.py`](https://github.com/neondatabase/neon/blob/main/test_runner/regress/test_unlogged.py):

> Test UNLOGGED tables/relations. Postgres copies init fork contents to main fork to reset them during
> recovery. **In Neon, pageserver directly sends init fork contents as main fork during basebackup.**

The init fork *is* WAL-logged, so it lives in the pageserver and survives; a fresh compute is handed
an empty-but-valid main fork. The test then starts a second compute and asserts the exact behaviour
this ticket asks about, with the comment `# after restart table should be empty but valid`:

```python
cur2.execute("PREPARE iut_plan (int) AS INSERT INTO iut (id) VALUES ($1)")
cur2.execute("EXECUTE iut_plan (43);")
cur2.execute("SELECT * FROM iut")
```

A prepared `INSERT` plan executes successfully against the reset relation and the row lands. Applied
to ADR-0022's statement: the `INSERT … ON CONFLICT DO UPDATE … WHERE count < max` finds no conflicting
row, takes the `INSERT` arm, and returns an allowed verdict. **No error, no exception, no log line.**
Every caller gets a fresh budget for one window.

This is semantically fine — the window rolling over early is indistinguishable from the window
rolling over on time — but it is worth stating plainly that the answer to "does anything break
noisily" is **nothing breaks at all**, which also means nothing tells you it happened. On Neon, the
one wipe event that can land mid-traffic is a platform compute restart, and that is also when a
short fail-open is least welcome.

**One detail worth carrying:** on PG 15 and later, a sequence created for an identity or serial
column on an unlogged table is itself unlogged and resets to 1 on truncation (asserted in the same
Neon test). ADR-0022's bucket is keyed on `userId` / `organizationId`, not a surrogate sequence, so
this does not apply — but it would if the table ever gained one.

## Flagged: things not asked that bear on the decision

**Drizzle cannot express `UNLOGGED`, which puts it outside ADR-0012's migration path.** Grepping the
installed packages in this repo for the string `UNLOGGED` returns nothing in either
`drizzle-orm@0.45.2` or `drizzle-kit@0.31.10`. The feature request,
[drizzle-team/drizzle-orm#5347](https://github.com/drizzle-team/drizzle-orm/issues/5347) — "Add
.unlogged() method to pgTable() builder" — is open and unlabelled beyond `enhancement`, filed
2026-02-07. So the persistence would live only in a hand-edited migration, invisible to the schema
the rest of the kit type-checks against, and invisible to any drizzle-kit diff. ADR-0012 makes the
bucket table "a Drizzle table under the migration path, like every other"; `UNLOGGED` would be the
one property that is not.

**There is a materially better Postgres-native lever for this table, and it works identically on all
three platforms: `fillfactor` plus per-table autovacuum settings.** ADR-0022's write path is an
`ON CONFLICT DO UPDATE` hammering the same small set of rows, plus opportunistic `DELETE`s of expired
rows. Every one of those produces a dead tuple. The cost that actually scales here is bloat and index
churn, not WAL. From the PostgreSQL manual on
[Heap-Only Tuples](https://www.postgresql.org/docs/current/storage-hot.html), a HOT update requires
that "the update does not modify any columns referenced by the table's indexes" and that "there is
sufficient free space on the page containing the old row for the updated row", and in exchange:

> New index entries are not needed to represent updated rows […] When a row is updated multiple times,
> row versions other than the oldest and the newest can be completely removed during normal operation,
> including `SELECT`s, instead of requiring periodic vacuum operations.

and directly:

> You can increase the likelihood of sufficient page space for HOT updates by decreasing a table's
> `fillfactor`.

The bucket table's UPDATE touches `count` and a timestamp, neither of which needs to be indexed —
the index is on the key. That is the textbook HOT shape. A lowered `fillfactor` plus an aggressive
per-table `autovacuum_vacuum_scale_factor` / `autovacuum_vacuum_threshold` is expressible in a
migration, portable to Neon, RDS and Aurora alike, carries no truncation semantics, and is very
likely a larger win than `UNLOGGED` would have been on any of them. This was not measured here and
should be, but it is the lever worth measuring first.

**`UNLOGGED` is a property of a deployment, not of a schema.** If ADR-0022 ever wants it, the honest
shape is not a schema flag but a per-target migration note: correct on Neon, correct on RDS, pointless
on Aurora. That is a three-way divergence in the one table every fork provisions, in exchange for an
unmeasured saving.

## The conditional that would flip this

`UNLOGGED` becomes right if **a measurement on Neon shows the bucket table's WAL is a material share
of billed restore history or write throughput.** The Neon saving is real and metered — that is
established above, not speculation — it is simply unsized. If it turns out to be large, the honest
resolution is not an `UNLOGGED` schema but a Neon-profile-specific migration, accepting the
drizzle-kit divergence and the mid-traffic fail-open window as a documented cost. Nothing found here
supports paying that on Aurora.

## Bearing on ADR-0022

ADR-0022 currently says:

> Whether it should be `UNLOGGED` — skipping WAL for counters worthless after ten seconds — is
> unanswered: Neon's handling of unlogged relations across compute suspend has not been verified, and
> [#45](https://github.com/aniketmandloi/typesafe-saas-opus/issues/45) owns that question. The table is
> ordinary until that returns.

The Neon half is now verified and the answer is benign: Neon wipes unlogged relations on every compute
restart including scale to zero, the wipe truncates rather than drops, and the write path keeps working
against the reset relation — Neon's own regression suite asserts it. Had Neon been the only target,
`UNLOGGED` would be defensible.

What actually blocks it is the target the ticket treated as the easier one. **Aurora does not deliver
the saving**, by AWS's own documentation, while charging writer-only access and logical-replication
exclusion for the privilege. ADR-0022's constraint — "Postgres is mandatory on every deployment, so
the answer has to hold for Neon *and* RDS, not one of them" — is what decides it.

The paragraph can be rewritten from "unanswered" to a settled *no*, with the `fillfactor` / autovacuum
lever recorded as the thing to reach for instead, and the Neon-measurement conditional recorded as the
only thing that would reopen it.

## Sources

- https://github.com/neondatabase/website/blob/main/content/docs/reference/compatibility.md (§ Unlogged tables, § Temporary tables, § Session context)
- https://github.com/neondatabase/website/blob/main/content/docs/introduction/scale-to-zero.md
- https://github.com/neondatabase/website/blob/main/content/docs/guides/scale-to-zero-guide.md
- https://github.com/neondatabase/website/blob/main/content/docs/introduction/compute-lifecycle.md
- https://github.com/neondatabase/website/blob/main/content/docs/introduction/autoscaling.md
- https://github.com/neondatabase/website/blob/main/content/docs/introduction/usage-calculations.md
- https://github.com/neondatabase/neon/blob/main/docs/core_changes.md
- https://github.com/neondatabase/neon/blob/main/pgxn/neon/pagestore_smgr.c
- https://github.com/neondatabase/neon/blob/main/test_runner/regress/test_unlogged.py
- https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-postgresql-unlogged-tables.html
- https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.HighObjectCount.html (§ Unlogged tables)
- https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html
- https://www.postgresql.org/docs/current/sql-createtable.html (UNLOGGED)
- https://www.postgresql.org/docs/current/storage-hot.html
- https://github.com/postgres/postgres/blob/master/src/backend/access/transam/xlog.c (`StartupXLOG`)
- https://github.com/postgres/postgres/blob/master/src/backend/storage/file/reinit.c (`ResetUnloggedRelations`)
- https://github.com/drizzle-team/drizzle-orm/issues/5347 (open, 2026-02-07)
- `grep -r UNLOGGED` over the installed `drizzle-orm@0.45.2` and `drizzle-kit@0.31.10` in this repo — no matches, 2026-09-22
