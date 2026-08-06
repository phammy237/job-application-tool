import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-20">
      <section className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Apply faster, without your applications lying for you.
        </h1>
        <p className="text-muted-foreground mt-6 text-lg">
          Career OS keeps one approve-before-use record of your real background, then
          helps you tailor applications from it — never inventing an employer, a title, or
          a result you didn&apos;t approve.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/join"
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-5 py-2.5 text-sm font-medium"
          >
            Create an account
          </Link>
          <Link
            href="/login"
            className="border-input hover:bg-accent hover:text-accent-foreground rounded-md border px-5 py-2.5 text-sm font-medium"
          >
            Log in
          </Link>
        </div>
      </section>

      <section className="mt-20 grid gap-8 sm:grid-cols-3">
        <Feature
          title="Approve every fact"
          description="Résumé-extracted or hand-entered, nothing is used in a suggestion or an autofill until you've explicitly approved it."
        />
        <Feature
          title="No fabrication"
          description="When there isn't enough approved information to answer a question, Career OS says so instead of guessing."
        />
        <Feature
          title="You click submit"
          description="The Chrome extension fills only the fields you approved. It never submits an application on its own."
        />
      </section>

      <section className="border-border bg-card mx-auto mt-20 max-w-2xl rounded-lg border p-8">
        <h2 className="text-xl font-semibold">Privacy, in short</h2>
        <ul className="text-muted-foreground mt-4 space-y-2 text-sm">
          <li>Your data is isolated per account, enforced by the database itself.</li>
          <li>
            The extension only ever inspects a page after you click Analyze — no
            background monitoring, no screen recording, no keystroke capture.
          </li>
          <li>Gmail sync is optional, manual, and never stores full email content.</li>
          <li>Every application, résumé, and connection can be deleted individually.</li>
        </ul>
      </section>
    </div>
  );
}

function Feature({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="font-medium">{title}</h3>
      <p className="text-muted-foreground mt-2 text-sm">{description}</p>
    </div>
  );
}
