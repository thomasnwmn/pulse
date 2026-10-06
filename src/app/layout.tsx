import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Pulse - System telemetry", description: "Real-time System Telemetry at a glance, in 2D and 3D.", referrer: "no-referrer" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
