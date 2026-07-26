import Link from "next/link";
import { CelestialPageShell } from "@/components/layout/CelestialPageShell";
import { MaterialLibrary } from "@/components/materials/MaterialLibrary";

export default function MaterialsPage() {
  return (
    <CelestialPageShell contentClassName="mx-auto w-full max-w-6xl">
      <header className="mb-8">
        <h1 className="illuminated-header display-lg">
          <span className="illuminated-header__glyph" aria-hidden>✦</span>
          万象藏库
        </h1>
        <p className="mt-3 text-center text-ink-soft">
          往昔诸界的神明、众生、能力与法则，皆可成为下一次创世的种子。
        </p>
        <p className="mt-3 text-center">
          <Link href="/" className="text-sm tracking-[0.18em] text-gilt transition hover:text-gilt-strong">
            ← 回到原初
          </Link>
        </p>
      </header>
      <MaterialLibrary />
    </CelestialPageShell>
  );
}
