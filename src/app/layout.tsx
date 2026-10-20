import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScopeGraph X",
  description: "Enterprise scope-controlled vulnerability discovery & security research platform (authorized testing only)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('sgx-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
