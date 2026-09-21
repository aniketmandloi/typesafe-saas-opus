import type { Auth } from "@repo/auth";
import type { Database } from "@repo/db";
import type { JobQueue } from "@repo/jobs";
import type { StorageAdapter } from "@repo/storage";

/**
 * Everything the contract needs in order to run, handed in rather than
 * imported.
 *
 * Composition happens in a deployment profile (ADR-0006), so this package
 * names the capabilities and never chooses the implementations — which is what
 * lets the tests run the same router against fakes that production runs against
 * S3 and pg-boss.
 */
export type ApiDeps = {
  /**
   * The raw handle, present because two paths legitimately predate the tenant
   * boundary: resolving a membership in order to open a TenantDb, and
   * accepting an invitation, which is the mutation that creates the membership
   * the boundary is made of. Every other use case receives a TenantDb.
   */
  db: Database;
  auth: Auth;
  storage: StorageAdapter;
  queue: JobQueue;
};
