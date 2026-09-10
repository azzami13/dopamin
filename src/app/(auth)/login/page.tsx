import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { googleLogin } from "./google-actions";
import { LoginForm } from "@/components/auth/login-form";
import { LOGIN_ERROR } from "@/lib/auth/password";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth();
  if (session?.user?.email) redirect("/dashboard");

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-kicker">dopamin coffee & workspace</div>
        <h1>Dopamin Cafe</h1>
        <p>Accounting & Inventory System</p>
        <p className="muted">Masuk dengan akun Anda untuk mengelola operasional Dopamin Cafe.</p>
        <LoginForm initialError={(await searchParams).error ? LOGIN_ERROR : ""} />
        <p className="muted login-divider">atau</p>
        <form
          action={googleLogin}
        >
          <button className="secondary-button" type="submit" style={{ width: "100%" }}>Continue with Google</button>
        </form>
      </section>
    </main>
  );
}
