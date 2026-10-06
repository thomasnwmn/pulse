import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Pulse — System telemetry", description: "Your system, in sight. Local real-time hardware telemetry in 2D and 3D." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
