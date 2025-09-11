import "./globals.css";
import { ReactNode } from "react";
import { SessionProvider } from "../lib/session";

export const metadata = {
  title: "Readerly",
  description: "Google Reader clone",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          name="theme-color"
          content="#ffffff"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#0b1220"
          media="(prefers-color-scheme: dark)"
        />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function(){try{
  var stored=localStorage.getItem('theme');
  var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;
  var theme=stored|| (prefersDark ? 'dark' : 'light');
  if(theme==='dark'){document.documentElement.classList.add('dark');}
}catch(e){}})();
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:bg-blue-600 focus:text-white focus:px-3 focus:py-1 rounded"
        >
          Skip to content
        </a>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
