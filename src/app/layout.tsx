import type { Metadata, Viewport } from "next";
import { NetworkStatus } from "../components/pwa/network-status";
import { RegisterServiceWorker } from "../components/pwa/register-service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dopamin Cafe",
  description: "Accounting & Inventory System",
  applicationName: "Dopamin Cafe",
};

export const viewport: Viewport = {
  themeColor: "#0F623E",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>
        <RegisterServiceWorker />
        <NetworkStatus />
        {children}
      </body>
    </html>
  );
}
