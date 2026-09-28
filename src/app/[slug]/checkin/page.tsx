import { redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import CheckinScanner from "./CheckinScanner";

export default async function CheckinPage({ params }: { params: { slug: string } }) {
  try {
    await requireTenantSession(params.slug);
  } catch (err) {
    if (err instanceof SessionError) redirect(`/${params.slug}/login`);
    throw err;
  }

  return <CheckinScanner slug={params.slug} />;
}
