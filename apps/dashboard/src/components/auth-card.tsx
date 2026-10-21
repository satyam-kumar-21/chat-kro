import Link from "next/link";
import type { ReactNode } from "react";
import { MessagesSquare } from "lucide-react";

export function AuthCard({
  title,
  description,
  children,
  footer
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-7">
        <Link href="/" className="mb-7 inline-flex items-center gap-2 font-semibold text-slate-900">
          <span className="flex size-8 items-center justify-center rounded-lg bg-blue-600 text-white">
            <MessagesSquare size={18} aria-hidden="true" />
          </span>
          Relay Chat
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
        <div className="mt-6">{children}</div>
        {footer ? <div className="mt-6 border-t border-slate-100 pt-5 text-sm">{footer}</div> : null}
      </section>
    </main>
  );
}
