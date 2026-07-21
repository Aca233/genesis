import { buildMaterialContentView } from "./material-content-view";

export function MaterialContentView({ content }: { content: unknown }) {
  const view = buildMaterialContentView(content);

  if (view.sections.length === 0) {
    return <p className="py-5 text-sm text-ink-faint">此版本没有可展示的正文内容。</p>;
  }

  return (
    <div className="grid gap-4">
      {view.origin && <p className="text-xs text-ink-faint">档案来源：{view.origin}</p>}
      {view.sections.map((section, sectionIndex) => (
        <section key={`${section.title}-${sectionIndex}`} className={`rounded-lg border p-4 ${section.private ? "border-gilt/30 bg-gilt/5" : "border-line bg-paper-sunken/40"}`}>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-gilt">{section.title}</h4>
            {section.private && <span className="rounded-full border border-gilt/30 px-2 py-0.5 text-[10px] text-gilt">幕后档案</span>}
          </div>
          {section.text && <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink-soft">{section.text}</p>}
          {section.values && (
            <ul className="mt-2 grid gap-1 text-sm leading-7 text-ink-soft">
              {section.values.map((value, index) => <li key={`${value}-${index}`} className="before:mr-2 before:text-gilt before:content-['◆']">{value}</li>)}
            </ul>
          )}
          {section.fields && (
            <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {section.fields.map((field, index) => (
                <div key={`${field.label}-${index}`}>
                  <dt className="text-xs text-ink-faint">{field.label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-soft">{field.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {section.items && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {section.items.map((item, index) => (
                <article key={`${item.title}-${index}`} className="rounded-md border border-line bg-paper-raised p-3">
                  <h5 className="text-sm text-ink">{item.title}</h5>
                  {item.subtitle && <p className="mt-0.5 text-xs text-gilt">{item.subtitle}</p>}
                  {item.fields.length > 0 && (
                    <dl className="mt-3 grid gap-2">
                      {item.fields.map((field, fieldIndex) => (
                        <div key={`${field.label}-${fieldIndex}`}>
                          <dt className="text-xs text-ink-faint">{field.label}</dt>
                          <dd className="mt-0.5 whitespace-pre-wrap text-sm leading-6 text-ink-soft">{field.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
