/**
 * Basic and Pro side by side — the public plans page and the trainer's own
 * registry page both draw it. The rows are `planFeatures()` in
 * `lib/trainer-registry.ts`; `proAction` is where the trainer's page puts its
 * Upgrade buttons, under the Pro price.
 */
import { PRO_PRICES, planFeatures, type RegistryOptions } from '@/lib/trainer-registry';

function Cell({ value }: { value: boolean | string }) {
  if (value === true) {
    return <span aria-label="Included" style={{ color: 'var(--success)' }}>✓</span>;
  }
  if (value === false) {
    return <span aria-label="Not included" style={{ color: 'var(--muted)' }}>—</span>;
  }
  return <span className="text-xs font-medium" style={{ color: 'var(--text-deep)' }}>{value}</span>;
}

export default function PlanMatrix({
  limits,
  current,
  proAction,
}: {
  limits?: Pick<RegistryOptions, 'max_photos' | 'max_video_links'>;
  /** The trainer's own plan, marked in its column heading. */
  current?: 'basic' | 'pro';
  proAction?: React.ReactNode;
}) {
  const rows = planFeatures(limits);
  const headStyle = { borderColor: 'var(--border)' } as const;
  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
      <table className="w-full text-sm">
        <caption className="sr-only">Trainer Registry plans compared</caption>
        <thead>
          <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
            <th scope="col" className="text-left font-medium p-3 border-b" style={{ ...headStyle, color: 'var(--muted)' }}>
              <span className="sr-only">Feature</span>
            </th>
            <th scope="col" className="p-3 border-b border-l w-[28%] align-top" style={headStyle}>
              <div className="font-bold" style={{ color: 'var(--foreground)' }}>Basic</div>
              <div className="text-xs font-normal mt-0.5" style={{ color: 'var(--muted)' }}>Free</div>
              {current === 'basic' && <div className="text-[11px] font-semibold mt-1" style={{ color: 'var(--accent)' }}>Your plan</div>}
            </th>
            <th
              scope="col"
              className="p-3 border-b border-l w-[34%] align-top"
              style={{ ...headStyle, backgroundColor: 'var(--accent-bg)' }}
            >
              <div className="font-bold" style={{ color: 'var(--accent)' }}>Pro</div>
              <div className="text-xs font-normal mt-0.5" style={{ color: 'var(--text-deep)' }}>
                {PRO_PRICES.monthly.price}/{PRO_PRICES.monthly.per}
                <br />
                or {PRO_PRICES.annual.price}/{PRO_PRICES.annual.per}
                <br />
                paid up front
              </div>
              {current === 'pro' && <div className="text-[11px] font-semibold mt-1" style={{ color: 'var(--accent)' }}>Your plan</div>}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b last:border-b-0" style={headStyle}>
              <th scope="row" className="text-left font-normal p-3" style={{ color: 'var(--foreground)' }}>{row.label}</th>
              <td className="text-center p-3 border-l" style={headStyle}><Cell value={row.basic} /></td>
              <td className="text-center p-3 border-l" style={{ ...headStyle, backgroundColor: 'var(--accent-bg)' }}>
                <Cell value={row.pro} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {proAction && (
        <div className="p-3 border-t" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}>
          {proAction}
        </div>
      )}
    </div>
  );
}
