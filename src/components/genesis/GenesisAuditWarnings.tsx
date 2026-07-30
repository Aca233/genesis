import type { GenesisQualityReport } from "@/lib/genesis/semantic-audit";

export function GenesisAuditWarnings({
  report,
  severity = "warning",
}: {
  report: GenesisQualityReport | null;
  severity?: "warning" | "error";
}) {
  const issues = report?.issues.filter((issue) => issue.severity === severity) ?? [];
  if (issues.length === 0) return null;
  const blocking = severity === "error";

  return (
    <section aria-labelledby={`genesis-audit-${severity}-title`} className={blocking ? "mt-4" : "mb-8"}>
      <div className={`rounded-lg px-4 py-3 ${blocking ? "border border-cinnabar/30 bg-cinnabar/5" : "border border-gilt/30 bg-gilt/5"}`}>
        <h2 id={`genesis-audit-${severity}-title`} className={`letterpress text-sm ${blocking ? "text-cinnabar" : "text-gilt"}`}>
          {blocking ? "阻断详情" : "审计提醒"}
        </h2>
        <div className="mt-2 grid gap-2">
          {issues.map((issue, index) => (
            <details key={`${issue.path}-${index}`} className="text-sm text-ink-soft">
              <summary className="cursor-pointer text-ink">
                {issue.explanation}
              </summary>
              <dl className={`mt-2 grid gap-1 border-l pl-3 text-xs leading-relaxed ${blocking ? "border-cinnabar/20" : "border-gilt/20"}`}>
                <div>
                  <dt className="inline text-ink-faint">问题路径：</dt>
                  <dd className="inline">{issue.path}</dd>
                </div>
                <div>
                  <dt className="inline text-ink-faint">建议：</dt>
                  <dd className="inline">{issue.repairInstruction}</dd>
                </div>
              </dl>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
