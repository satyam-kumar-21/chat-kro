import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relay Chat",
  description: "A simple home for your customer conversations."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
