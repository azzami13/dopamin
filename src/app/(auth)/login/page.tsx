import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.email) redirect("/dashboard");

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-kicker">dopamin coffee & workspace</div>
        <h1>Dopamin Cafe</h1>
        <p>Accounting & Inventory System</p>
        <p className="muted">Masuk menggunakan akun Google yang sudah didaftarkan oleh Owner/Director.</p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/dashboard" });
          }}
        >
          <button className="primary-button" type="submit">Masuk dengan Google</button>
        </form>
      </section>
    </main>
  );
}
