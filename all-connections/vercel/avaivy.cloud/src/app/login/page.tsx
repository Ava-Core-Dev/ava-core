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
        Public answers on the home panel are free and include links. A live custom talk uses your
        RootMC web account (Discord) — one free live turn per IP.
      </p>
      <article className={blog.card}>
        <h2>Continue</h2>
        <p>Same Discord login as RootMC. After you sign in, come back here and type.</p>
        <p style={{ marginTop: 16 }}>
          <a href="https://rootmc.net/login/">Log in at rootmc.net →</a>
        </p>
      </article>
    </section>
  );
}
