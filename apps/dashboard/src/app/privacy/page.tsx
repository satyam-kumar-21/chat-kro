import Link from "next/link";

export default function PrivacyPage() {
  return <main className="mx-auto max-w-3xl px-6 py-12">
    <Link href="/" className="text-sm font-medium text-blue-700 hover:underline">Relay Chat</Link>
    <h1 className="mt-6 text-3xl font-semibold">Privacy Policy</h1>
    <p className="mt-4 text-sm leading-6 text-slate-600">Relay Chat stores account, workspace, website, and conversation information to provide the service. Widget visitor data is limited to fields supplied for the conversation and is subject to the workspace operator’s configuration. This development notice does not replace a complete, legally reviewed privacy policy.</p>
  </main>;
}
