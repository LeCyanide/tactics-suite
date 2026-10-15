import { useMemo } from 'react';
import { getRulesets, useStore } from '@/state/store';
import { rulesetBreaches } from '@/lib/shipFilters';
import type { Page } from '@/types/model';

/**
 * A red "!" after a page's name when its lineup breaks the ruleset applied to
 * the page. Hovering it lists what is broken.
 */
export function RulesetFlag({ page }: { page: Page }) {
  const ships = useStore((s) => s.ships);
  const teams = useStore((s) => s.project?.teams);
  const rulesets = useStore(getRulesets);
  const ruleset = rulesets.find((r) => r.id === page.rulesetId) ?? null;

  const breaches = useMemo(
    () => (ruleset ? rulesetBreaches(ruleset, page.objects, ships, teams ?? []) : []),
    [ruleset, page.objects, ships, teams],
  );
  if (!ruleset || !breaches.length) return null;

  return (
    <span className="ruleset-flag" title={`Breaks ${ruleset.name}:\n${breaches.join('\n')}`}>
      !
    </span>
  );
}
