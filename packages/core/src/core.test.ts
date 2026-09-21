import { describe, expect, it } from "vitest";

import { invitationExpiresAt, invitationRefusal } from "./invitation.ts";
import {
  isDark,
  isPurgeDue,
  isPurgeWarningDue,
  owners,
  purgeDueAt,
  wouldStrandOnRoleChange,
  wouldStrandOrganization,
} from "./organization.ts";
import { hasOrgPermission, hasPlatformPermission, parseRoles } from "./permissions.ts";

// One of the kit's three example tests (#8): a pure rule, no I/O, no database.

describe("roles are a CSV column, not a join", () => {
  it("parses multiple roles from one value", () => {
    expect(parseRoles("member,admin")).toEqual(["member", "admin"]);
  });

  it("tolerates spacing and empties", () => {
    expect(parseRoles(" owner , member ")).toEqual(["owner", "member"]);
    expect(parseRoles(null)).toEqual([]);
    expect(parseRoles("")).toEqual([]);
  });

  it("drops values outside the closed set rather than trusting them", () => {
    expect(parseRoles("admin,superuser")).toEqual(["admin"]);
  });
});

describe("permission checks, never role checks", () => {
  it("grants what the map grants", () => {
    expect(hasOrgPermission(["member"], { project: ["create", "read"] })).toBe(true);
    expect(hasOrgPermission(["admin"], { member: ["invite"] })).toBe(true);
    expect(hasOrgPermission(["owner"], { billing: ["manage"] })).toBe(true);
  });

  it("refuses what it does not", () => {
    expect(hasOrgPermission(["member"], { project: ["delete"] })).toBe(false);
    expect(hasOrgPermission(["member"], { billing: ["read"] })).toBe(false);
    expect(hasOrgPermission(["admin"], { member: ["changeRole"] })).toBe(false);
    expect(hasOrgPermission(["admin"], { organization: ["delete"] })).toBe(false);
  });

  it("requires every action in the query, not any", () => {
    expect(hasOrgPermission(["member"], { project: ["read", "delete"] })).toBe(false);
  });

  it("unions across multiple roles", () => {
    expect(hasOrgPermission(["member", "admin"], { member: ["invite"] })).toBe(true);
  });

  it("refuses everything for no roles", () => {
    expect(hasOrgPermission([], { project: ["read"] })).toBe(false);
  });

  it("keeps platform RBAC separate from org RBAC", () => {
    expect(hasPlatformPermission(["platformAdmin"], { organization: ["impersonate"] })).toBe(true);
    expect(hasPlatformPermission(["platformSupport"], { organization: ["impersonate"] })).toBe(
      false,
    );
    // Platform staff read metadata, never tenant content (ADR-0005). There is
    // no org permission a platform role can satisfy: the sets do not overlap.
    expect(hasPlatformPermission(["platformAdmin"], { user: ["readMetadata"] })).toBe(true);
  });
});

describe("Dark Organizations and the purge clock", () => {
  const deletedAt = new Date("2026-01-01T00:00:00Z");

  it("is dark only once soft-deleted", () => {
    expect(isDark({ deletedAt: null })).toBe(false);
    expect(isDark({ deletedAt })).toBe(true);
  });

  it("purges 30 days later, not before", () => {
    expect(purgeDueAt(deletedAt).toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(isPurgeDue({ deletedAt }, new Date("2026-01-30T23:59:59Z"))).toBe(false);
    expect(isPurgeDue({ deletedAt }, new Date("2026-01-31T00:00:00Z"))).toBe(true);
  });

  it("never purges a live Organization", () => {
    expect(isPurgeDue({ deletedAt: null }, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });

  it("warns at T-7", () => {
    expect(isPurgeWarningDue({ deletedAt }, new Date("2026-01-23T23:59:59Z"))).toBe(false);
    expect(isPurgeWarningDue({ deletedAt }, new Date("2026-01-24T00:00:00Z"))).toBe(true);
    expect(isPurgeWarningDue({ deletedAt: null }, new Date("2026-01-24T00:00:00Z"))).toBe(false);
  });
});

describe("an Organization cannot be stranded without an owner", () => {
  const members = [
    { userId: "u1", role: "owner" },
    { userId: "u2", role: "admin,member" },
    { userId: "u3", role: "member" },
  ];

  it("finds owners through the CSV column", () => {
    expect(owners(members)).toEqual(["u1"]);
    expect(owners([{ userId: "u9", role: "member,owner" }])).toEqual(["u9"]);
  });

  it("blocks removing the last owner", () => {
    expect(wouldStrandOrganization(members, "u1")).toBe(true);
    expect(wouldStrandOrganization(members, "u2")).toBe(false);
  });

  it("allows removing an owner when another remains", () => {
    const two = [...members, { userId: "u4", role: "owner" }];
    expect(wouldStrandOrganization(two, "u1")).toBe(false);
  });

  it("blocks demoting the last owner, but not promoting one", () => {
    expect(wouldStrandOnRoleChange(members, "u1", ["admin"])).toBe(true);
    expect(wouldStrandOnRoleChange(members, "u1", ["owner", "admin"])).toBe(false);
    expect(wouldStrandOnRoleChange(members, "u2", ["member"])).toBe(false);
  });
});

describe("an invitation says why it cannot be accepted, in an order that leaks nothing", () => {
  const now = new Date("2026-09-21T12:00:00Z");
  const pending = {
    status: "pending",
    email: "ada@example.com",
    expiresAt: new Date("2026-09-25T12:00:00Z"),
  };

  it("accepts the recipient it was addressed to", () => {
    expect(invitationRefusal(pending, "ada@example.com", now)).toBeNull();
  });

  it("folds case, because neither side of the comparison is normalised for us", () => {
    expect(invitationRefusal(pending, "Ada@Example.com ", now)).toBeNull();
  });

  it("refuses an invitation that is no longer pending", () => {
    expect(invitationRefusal({ ...pending, status: "accepted" }, "ada@example.com", now)).toBe(
      "not-pending",
    );
  });

  it("refuses an expired invitation", () => {
    const expired = { ...pending, expiresAt: new Date("2026-09-20T12:00:00Z") };
    expect(invitationRefusal(expired, "ada@example.com", now)).toBe("expired");
  });

  // The order is the assertion. An invitation id arrives by email and is a
  // bearer token, so answering "not yours" to someone holding an expired link
  // would tell them whose it is.
  it("checks the recipient last", () => {
    const expired = { ...pending, expiresAt: new Date("2026-09-20T12:00:00Z") };
    expect(invitationRefusal(expired, "grace@example.com", now)).toBe("expired");
    expect(invitationRefusal(pending, "grace@example.com", now)).toBe("wrong-recipient");
  });

  it("expires seven days out", () => {
    expect(invitationExpiresAt(now).toISOString()).toBe("2026-09-28T12:00:00.000Z");
  });
});
