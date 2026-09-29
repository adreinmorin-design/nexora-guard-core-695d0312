import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { PublicFooter } from "@/components/public-footer";

export function LegalPage({
  eyebrow,
  title,
  summary,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5 lg:px-8">
          <Link to="/" className="font-display text-sm font-semibold tracking-[0.2em]">
            NEXORA
          </Link>
          <Link to="/pricing" className="text-sm text-muted-foreground hover:text-foreground">
            Pricing
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14 lg:px-8 lg:py-20">
        <p className="label-caps">{eyebrow}</p>
        <h1 className="mt-3 font-display text-4xl font-semibold">{title}</h1>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">{summary}</p>
        <p className="mt-2 text-xs text-muted-foreground">Effective September 29, 2026</p>

        <div className="mt-10 space-y-9 text-sm leading-7 text-muted-foreground [&_a]:text-primary [&_a]:hover:underline [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_p+p]:mt-3">
          {children}
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
