import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireActor } from "@/lib/auth/authorization";
import { VerificationCountdown } from "./verification-countdown";

export default async function VerifyAccessPage() {
  await requireActor();
  const session = await auth();
  if (!session?.temporaryGoogleOnboarding) redirect("/dashboard");
  return <VerificationCountdown />;
}
