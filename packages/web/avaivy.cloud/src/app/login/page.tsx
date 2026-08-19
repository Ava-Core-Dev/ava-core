import blog from "../blog/blog.module.css";

export const metadata = {
  title: "Log in — Ava Ivy",
  description: "Log in to talk with Ava on avaivy.cloud.",
};

export default function LoginPage() {
  return (
    <section className={blog.wrap}>
      <p className={blog.eyebrow}>Account</p>
      <h1 className={blog.title}>Log in to talk</h1>
      <p className={blog.lead}>
        The chat panel stays visible. Typed live talk needs an account. Free: 1 live use per IP,
        unlimited canned answers, 3 resources.
      </p>
      <article className={blog.card}>
        <h2>Continue</h2>
        <p>Use your RootMC web account (Discord). Same login unlocks Ava on avaivy.cloud.</p>
        <p style={{ marginTop: 16 }}>
          <a href="https://rootmc.net/login/">Log in at rootmc.net →</a>
        </p>
      </article>
    </section>
  );
}
