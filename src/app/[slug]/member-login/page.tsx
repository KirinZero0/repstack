import { redirect } from "next/navigation";

/** Staff and member login were merged into one form. Kept so old WhatsApp/activation links still work. */
export default function MemberLoginRedirect({ params }: { params: { slug: string } }) {
  redirect(`/${params.slug}/login`);
}
