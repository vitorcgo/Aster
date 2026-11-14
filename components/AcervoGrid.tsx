import { memo } from "react";
import type { LectureSource, Material } from "@/lib/aster";

/** Mapa do acervo: uma linha por aula, uma célula por página. As páginas encontradas acendem. */
export const AcervoGrid = memo(function AcervoGrid({ materials, hits, focus }: { materials: Material[]; hits: LectureSource[] | null; focus: string | null }) {
  const lit = new Set((hits ?? []).map((hit) => `${hit.document_id}:${hit.page}`));
  const longest = Math.max(1, ...materials.map((material) => material.pages));
  return (
    <div className={`acervo ${hits ? "is-done" : "is-scanning"}`} role="img" aria-label={hits ? `${hits.length} trechos encontrados em ${new Set(hits.map((hit) => hit.document_id)).size} aulas` : "Varrendo as aulas"}>
      {materials.map((material, row) => {
        const number = material.id.match(/\d+/)?.[0] ?? String(row + 1);
        const dimmed = focus && focus !== material.id;
        return (
          <div className={`acervo-row ${dimmed ? "is-dimmed" : ""}`} key={material.id} style={{ ["--row" as string]: row }}>
            <span className="acervo-label">{number}</span>
            <span className="acervo-cells" style={{ gridTemplateColumns: `repeat(${longest}, 1fr)` }}>
              {Array.from({ length: material.pages }, (_, index) => {
                const on = lit.has(`${material.id}:${index + 1}`);
                return <i key={index} className={on ? "is-hit" : undefined} />;
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
});
