import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = { title: "ERCOT demand forecasting", description: "Day-ahead load forecasts for the Texas grid" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;800&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen">
        <div className="flex min-h-screen">
          <Nav />
          <main className="flex-1 px-8 py-10 lg:px-14 max-w-[1320px]">{children}</main>
        </div>
      </body>
    </html>
  );
}
