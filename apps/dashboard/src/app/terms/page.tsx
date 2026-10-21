import Link from "next/link";

export default function TermsPage() {
  return <main className="mx-auto max-w-3xl px-6 py-12">
    <Link href="/" className="text-sm font-medium text-blue-700 hover:underline">Relay Chat</Link>
    <h1 className="mt-6 text-3xl font-semibold">Terms of Service</h1>
    <p className="mt-4 text-sm leading-6 text-slate-600">Relay Chat is currently in an early development phase. By creating an account, you agree to use the service lawfully, protect your account credentials, and only add websites and visitor information you are authorized to manage. This page is a development notice and is not a substitute for reviewed legal terms.</p>
  </main>;
}
