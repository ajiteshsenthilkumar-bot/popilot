import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "POPilot",
  description: "Forward or connect your vendor's chat. See which PO moved and whether you'll run out of stock.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
