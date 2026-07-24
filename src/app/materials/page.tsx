import Link from "next/link";
import { CelestialPageShell } from "@/components/layout/CelestialPageShell";
import { MaterialLibrary } from "@/components/materials/MaterialLibrary";

export default function MaterialsPage() {
  return (
    <CelestialPageShell contentClassName="mx-auto w-full max-w-6xl">
      <header className="mb-8">
        <h1
          className="text-4xl text-ink"
          style={{ fontFamily: "var(--font-display)" }}
        >
          ✦ 万象藏库
        </h1>
        <p className="mt-2 text-ink-soft">
          往昔诸界的神明、众生、能力与法则，皆可成为下一次创世的种子。
        </p>
        <Link href="/" className="mt-3 inline-block text-sm text-gilt">
          ← 回到原初
        </Link>
      </header>
      <MaterialLibrary />
    </CelestialPageShell>
  );
}
