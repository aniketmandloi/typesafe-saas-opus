import { AcceptInvitation } from "./accept.tsx";

/**
 * Where an invitation link lands.
 *
 * The page itself reads nothing: an invitation id is a bearer token that
 * arrived by email, and the server deliberately tells an unauthenticated caller
 * nothing about it — not even that it exists. So this renders a client
 * component that tries to accept, and routes on what comes back. "Sign up
 * first, then accept" is that routing, and it belongs here rather than in the
 * contract (#12).
 */
export default async function InvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AcceptInvitation invitationId={id} />;
}
