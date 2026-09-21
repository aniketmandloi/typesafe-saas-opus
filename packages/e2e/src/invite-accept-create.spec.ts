import { expect, test } from "@playwright/test";
import { createDb } from "@repo/db";
import { invitation, member, organization, user } from "@repo/schema";
import { and, eq, inArray } from "drizzle-orm";

// The third of #8's three example tests: one spec over invite → accept →
// create a Project, in a real browser, against a real database.
//
// Two browser contexts rather than one with a sign-out, because there is no
// sign-out in the slice's UI and because two cookie jars is what two people
// actually are.

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/typesafe_saas_kit";

const db = createDb({ connectionString: DATABASE_URL, max: 1 });

const unique = () => crypto.randomUUID().slice(0, 8);

test.afterAll(async () => {
  await db.$client.end();
});

test("an owner invites, the invitee accepts, and both see the Project", async ({ browser }) => {
  const suffix = unique();
  const ownerEmail = `owner-${suffix}@example.com`;
  const inviteeEmail = `invitee-${suffix}@example.com`;
  const password = "correct-horse-battery-staple";
  const projectName = `Apollo ${suffix}`;

  const owner = await browser.newContext();
  const invitee = await browser.newContext();

  try {
    // ---- the owner signs up, and lands somewhere without choosing an org ----
    const ownerPage = await owner.newPage();
    await ownerPage.goto("/");
    await ownerPage.getByLabel("Name (sign up only)").fill("Olive");
    await ownerPage.getByLabel("Email").fill(ownerEmail);
    await ownerPage.getByLabel("Password").fill(password);
    await ownerPage.getByRole("button", { name: "Sign up" }).click();

    // #3's promise, in a browser: a solo user never chooses an Organization and
    // never sees a switcher. The redirect is the whole of "optional for
    // individuals", delivered in the UI rather than in the schema.
    await ownerPage.waitForURL(/\/o\/[^/]+\/projects$/, { timeout: 30_000 });
    const orgSlug = new URL(ownerPage.url()).pathname.split("/")[2] ?? "";
    expect(orgSlug).not.toBe("");

    // ---- create a Project, through the contract and not a Server Action ----
    await ownerPage.getByLabel("New project").fill(projectName);
    await ownerPage.getByRole("button", { name: "Create" }).click();
    await expect(ownerPage.getByText(projectName)).toBeVisible({ timeout: 15_000 });

    // ---- invite ----
    await ownerPage.getByRole("link", { name: "Members" }).click();
    await ownerPage.waitForURL(/\/members$/);
    await ownerPage.getByLabel("Invite by email").fill(inviteeEmail);
    await ownerPage.getByRole("button", { name: "Invite" }).click();

    // The invitation id is read from the database, not from the UI: the link
    // lives in an email, and the fake's outbox is in the server's process.
    // Polling because the click is a mutation the page does not block on.
    let invitationId = "";
    await expect
      .poll(
        async () => {
          const rows = await db
            .select({ id: invitation.id })
            .from(invitation)
            .where(eq(invitation.email, inviteeEmail));
          invitationId = rows[0]?.id ?? "";
          return invitationId;
        },
        { timeout: 15_000 },
      )
      .not.toBe("");

    // The first invite promotes the owner's Personal Organization in place —
    // no new Organization, no data moved (#3).
    const [promoted] = await db
      .select({ isPersonal: organization.isPersonal })
      .from(organization)
      .where(eq(organization.slug, orgSlug));
    expect(promoted?.isPersonal).toBe(false);

    // ---- the invitee signs up, then accepts ----
    const inviteePage = await invitee.newPage();
    await inviteePage.goto(`/invitations/${invitationId}`);

    // No session yet, so the server answers UNAUTHORIZED and the page offers
    // signup rather than describing an invitation to whoever holds the link.
    await inviteePage.getByRole("button", { name: "Accept invitation" }).click();
    await expect(inviteePage.getByRole("link", { name: /Sign in or sign up first/ })).toBeVisible({
      timeout: 15_000,
    });

    await inviteePage.goto("/");
    await inviteePage.getByLabel("Name (sign up only)").fill("Ivy");
    await inviteePage.getByLabel("Email").fill(inviteeEmail);
    await inviteePage.getByLabel("Password").fill(password);
    await inviteePage.getByRole("button", { name: "Sign up" }).click();
    await inviteePage.waitForURL(/\/o\/[^/]+\/projects$/, { timeout: 30_000 });

    await inviteePage.goto(`/invitations/${invitationId}`);
    await inviteePage.getByRole("button", { name: "Accept invitation" }).click();

    // Wait for the membership itself, not for a rendered string.
    //
    // The first version of this test navigated straight after the click and
    // was flaky: `click()` resolves when the button was pressed, not when the
    // mutation it fired has landed, so navigating away cancelled the in-flight
    // request. Polling the row removes the race *and* asserts the thing that
    // actually matters — the membership exists — rather than a redirect having
    // happened.
    await expect
      .poll(
        async () => {
          const rows = await db
            .select({ id: member.id })
            .from(member)
            .innerJoin(user, eq(user.id, member.userId))
            .innerJoin(organization, eq(organization.id, member.organizationId))
            .where(and(eq(user.email, inviteeEmail), eq(organization.slug, orgSlug)));
          return rows.length;
        },
        { timeout: 20_000 },
      )
      .toBe(1);

    // ---- the invitee can now read the owner's Organization ----
    await inviteePage.goto(`/o/${orgSlug}/projects`);
    await expect(inviteePage.getByText(projectName)).toBeVisible({ timeout: 15_000 });

    // And the member list now names both people.
    await inviteePage.goto(`/o/${orgSlug}/members`);
    await expect(inviteePage.getByText(ownerEmail, { exact: false })).toBeVisible();
    await expect(inviteePage.getByText(inviteeEmail, { exact: false })).toBeVisible();
  } finally {
    await owner.close();
    await invitee.close();

    // Committed rows, so they are cleaned up rather than rolled back. Purge
    // cascades every tenant table off the organization row, which is the one
    // place ON DELETE CASCADE is meant to fire (ADR-0007).
    const users = await db
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.email, [ownerEmail, inviteeEmail]));
    const ids = users.map((one) => one.id);
    if (ids.length > 0) {
      const owned = await db
        .select({ id: member.organizationId })
        .from(member)
        .where(inArray(member.userId, ids));
      if (owned.length > 0) {
        await db.delete(organization).where(
          inArray(
            organization.id,
            owned.map((one) => one.id),
          ),
        );
      }
      await db.delete(user).where(inArray(user.id, ids));
    }
  }
});
