import type { GenesisQualityReport } from "@/lib/genesis/semantic-audit";

export function GenesisAuditWarnings({ report }: { report: GenesisQualityReport | null }) {
  const warnings = report?.issues.filter((issue) => issue.severity === "warning") ?? [];
  if (warnings.length === 0) return null;

  return (
    <section aria-labelledby="genesis-audit-warnings-title" className="mb-8">
      <div className="rounded-lg border border-gilt/30 bg-gilt/5 px-4 py-3">
        <h2 id="genesis-audit-warnings-title" className="letterpress text-sm text-gilt">
          审计提醒
        </h2>
        <div className="mt-2 grid gap-2">
          {warnings.map((warning, index) => (
            <details key={`${warning.path}-${index}`} className="text-sm text-ink-soft">
              <summary className="cursor-pointer text-ink">
                {warning.explanation}
              </summary>
              <dl className="mt-2 grid gap-1 border-l border-gilt/20 pl-3 text-xs leading-relaxed">
                <div>
                  <dt className="inline text-ink-faint">问题路径：</dt>
                  <dd className="inline">{warning.path}</dd>
                </div>
                <div>
                  <dt className="inline text-ink-faint">建议：</dt>
                  <dd className="inline">{warning.repairInstruction}</dd>
                </div>
              </dl>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
