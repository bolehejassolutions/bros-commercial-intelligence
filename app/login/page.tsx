import { login } from "./actions";

const messages: Record<string, string> = {
  missing_credentials: "Enter your email and password.",
  invalid_credentials: "The email or password is incorrect.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error ? messages[params.error] : undefined;

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">BROS INTERNAL APPLICATION</p>
        <h1>Commercial Intelligence</h1>
        <p className="sub">Sign in to the internal intelligence workspace.</p>

        <form action={login} className="auth-form">
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>

          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>

          {error ? <p className="form-error">{error}</p> : null}

          <button type="submit">Sign in</button>
        </form>
      </section>
    </main>
  );
}
