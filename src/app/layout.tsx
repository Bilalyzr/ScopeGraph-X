import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScopeGraph X — Editorial Security Instrument",
  description: "Enterprise scope-controlled vulnerability discovery & security research platform (Signal Press Design System)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="paper">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Epilogue:wght@400;500;600;700;800&family=Violet+Sans&family=Roboto+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('sgx-signal-theme');if(t==='paper'||t==='ledger'){document.documentElement.dataset.theme=t;}}catch(e){}try{var m=window.matchMedia('(max-width: 860px)').matches;var c=m?true:localStorage.getItem('sgx-sidebar-collapsed')==='1';document.documentElement.dataset.sidebar=c?'collapsed':'expanded';}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
