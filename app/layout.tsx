import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LAB and OFFICE Environmental Monitor",
  description: "Near-real-time LAB-priority environmental status display.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
