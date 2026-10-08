import { logout } from "@/app/login/actions";

export default function AccessDenied() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">BROS INTERNAL</p>
        <h1>Access not provisioned</h1>
        <p className="sub">Your authenticated account has not been granted BCI operator membership. An administrator must verify your user ID and register it using the protected database admin channel.</p>
        <form action={logout}><button type="submit">Sign out</button></form>
      </section>
    </main>
  );
}
