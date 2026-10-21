import Link from "next/link";
import { ArrowRight, MessagesSquare } from "lucide-react";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6 sm:px-10">
        <Link className="flex items-center gap-2 font-semibold tracking-tight text-slate-900" href="/">
          <span className="flex size-8 items-center justify-center rounded-lg bg-blue-600 text-white">
            <MessagesSquare aria-hidden="true" size={18} />
          </span>
          Relay Chat
        </Link>
        <nav aria-label="Main navigation" className="flex items-center gap-5 text-sm">
          <Link className="font-medium text-slate-600 hover:text-slate-900" href="/login">
            Log in
          </Link>
          <Link
            className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            href="/signup"
          >
            Get started
          </Link>
        </nav>
      </header>
      <section className="mx-auto flex w-full max-w-6xl flex-1 items-center px-6 py-20 sm:px-10">
        <div className="max-w-2xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-blue-700">
            Customer conversations, made clear
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
            A better way to be there for your customers.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">
            Bring website conversations into one focused workspace. Relay Chat is the foundation for
            a thoughtful, real-time support experience.
          </p>
          <Link
            className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            href="/signup"
          >
            Create your workspace
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </div>
      </section>
      <footer className="border-t border-slate-200 bg-white px-6 py-5 text-center text-sm text-slate-500">
        Relay Chat
      </footer>
    </main>
  );
}
