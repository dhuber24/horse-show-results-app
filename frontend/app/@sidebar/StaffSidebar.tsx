import { auth } from '@/auth';
import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import { activeNavHref } from '@/lib/active-nav';
import { cookies } from 'next/headers';
import { LAYOUT_COOKIE, layoutFor } from '@/lib/layout-mode';
import { adminSections, ROLE_LABELS } from '../admin/sections';
import { buildSteps, stepHrefs } from '../admin/shows/_wizard/steps';
import type { StepDef } from '../admin/shows/_wizard/WizardStepper';
import { fetchStepCounts } from '../admin/shows/[id]/setup/_lib/fetchStepCounts';
import { showSections, type ShowSection } from '../admin/shows/[id]/sections';
import CollapseButton from './CollapseButton';
import SetupStepsNav from './SetupStepsNav';
import SidebarLink from './SidebarLink';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ACTIVE: 'In Progress',
  COMPLETED: 'Completed',
};

// Collapsed to a rail (`collapsed:` in globals.css), a row is its icon,
// centred, and the label stays for screen readers.
const ITEM =
  'relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm collapsed:justify-center collapsed:px-0';
const LABEL = 'flex-1 truncate collapsed:sr-only';
const GROUP_HEADING =
  'px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide collapsed:sr-only';

/** The show a page is about, from its address: one of its office pages
 *  (`/admin/shows/{id}/…`) or one of its public ones (`/shows/{id}/…`). */
function showInPath(path: string[]): { showId: string; office: boolean } | null {
  if (path[0] === 'admin' && path[1] === 'shows' && UUID.test(path[2] ?? '')) {
    return { showId: path[2], office: true };
  }
  if (path[0] === 'shows' && UUID.test(path[1] ?? '')) return { showId: path[1], office: false };
  return null;
}

/** The show's unread count, or null when the inbox will not answer this person
 *  — which, because it checks `works_show` (`show_access.py`), is exactly
 *  "this person does not work this show". Read here for that answer only: the
 *  count itself is on the envelope in the top bar (`ShowMessagesButton`). */
async function fetchUnreadCount(showId: string): Promise<number | null> {
  try {
    const headers = await getAuthHeaders();
    if (!headers) return null;
    const res = await fetch(`${API_URL}/shows/${showId}/contact/messages/unread-count`, {
      headers,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.unread ?? 0;
  } catch {
    return null;
  }
}

type ShowContext = {
  showId: string;
  office: boolean;
  show: { name: string; status: string; start_date: string; end_date: string };
  steps: StepDef[] | null;
  /** The office section or setup step the page belongs to. */
  active: string | null;
  inSetup: boolean;
};

async function loadShowContext(
  { showId, office }: { showId: string; office: boolean },
  pathname: string,
): Promise<ShowContext | null> {
  const base = `/admin/shows/${showId}`;
  const sections = showSections(showId);
  const setupHrefs = office ? [`${base}/setup`, ...stepHrefs(showId)] : [];
  const officeHrefs = sections.filter((s) => !s.scoring && !s.publicScreen).map((s) => s.href);
  const active = office ? activeNavHref(pathname, [...officeHrefs, ...setupHrefs]) : null;
  // Futurities is a section *and* Step 6, at one address. Inside setup the step
  // is what lights up, so one page never highlights two entries.
  const inSetup = active !== null && setupHrefs.includes(active);
  try {
    const [show, unread, steps] = await Promise.all([
      fetchShow(showId),
      fetchUnreadCount(showId),
      // Ten reads, so only where the steps are shown. Memoised per request
      // with the step page's own call.
      inSetup ? fetchStepCounts(showId).then(buildSteps) : Promise.resolve(null),
    ]);
    // On an office page the page has already decided who may see it. On a
    // public one — Score Classes, the schedule — the show's office is offered
    // only to somebody who works this show, not to every manager who browses it.
    if (!office && unread === null) return null;
    return { showId, office, show, steps, active, inSetup };
  } catch {
    // A show that will not load has its own error on the page. The sidebar
    // falls back to the office list rather than taking the layout down.
    return null;
  }
}

/**
 * The office's sidebar: every page, on the desktop layout, for ADMIN,
 * SHOW_MANAGER and SHOW_SECRETARY, and nobody else (`lib/layout-mode.ts`).
 *
 * On a show's pages it leads with **that show's sections** — the dashboard's
 * own list (`sections.ts`) — and inside setup, **Setup opens into its steps**
 * with the tab bar's ticks. Below, always, the **office's own screens** — the
 * admin hub's tiles for this role (`admin/sections.ts`).
 *
 * Rendered by the root `@sidebar` slot rather than the root layout, because a
 * layout is not re-rendered between the pages under it and this has to be
 * current on each. **Not built at all on the mobile layout** — none of its
 * reads are made for an office browser switched to Mobile view, and pressing
 * Desktop view refreshes the page to fetch it.
 */
export default async function StaffSidebar({ path }: { path: string[] }) {
  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (layoutFor(role, cookieStore.get(LAYOUT_COOKIE)?.value) !== 'desktop') return null;

  const context = showInPath(path);
  // The Live Screens page and the boards behind it run full-screen on a TV.
  if (context?.office && path[3] === 'board') return null;

  const pathname = path.length > 0 ? `/${path.join('/')}` : '/';
  const show = context ? await loadShowContext(context, pathname) : null;

  const office = adminSections(role);
  const officeActive = show ? null : activeNavHref(pathname, ['/admin', ...office.map((s) => s.href)]);

  return (
    <aside
      className="hidden desktop:block w-64 collapsed:w-14 shrink-0 border-r print:hidden"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      {/* Sticky inside a column that runs the page's full height, so the
          border does too while the list stays in view. */}
      <div className="sticky top-0 max-h-screen overflow-y-auto px-3 collapsed:px-2 py-3 space-y-4">
        <CollapseButton />

        {show && <ShowBlock context={show} pathname={pathname} />}

        <nav aria-label={ROLE_LABELS[role ?? ''] ?? 'Office'} className="space-y-0.5">
          <p className={GROUP_HEADING} style={{ color: 'var(--text-dimmed)' }}>
            {ROLE_LABELS[role ?? ''] ?? 'Office'}
          </p>
          {show && <hr className="hidden collapsed:block mb-2" style={{ borderColor: 'var(--border)' }} />}
          <ul className="space-y-0.5">
            <li>
              <Item href="/admin" label="Home" icon={<Monogram letter="⌂" />} pathname={pathname} highlighted={officeActive === '/admin'} />
            </li>
            {office.map((section) => (
              <li key={section.href}>
                <Item
                  href={section.href}
                  label={section.title}
                  icon={<Monogram letter={section.icon} />}
                  pathname={pathname}
                  highlighted={officeActive === section.href}
                />
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </aside>
  );
}

function ShowBlock({ context, pathname }: { context: ShowContext; pathname: string }) {
  const { showId, show, steps, active, inSetup } = context;
  const base = `/admin/shows/${showId}`;
  const hubHref = `${base}/setup`;
  const sections = showSections(showId);
  const scoreHref = `/shows/${showId}`;

  const highlighted = (section: ShowSection): boolean => {
    if (section.scoring) return pathname === scoreHref || pathname.startsWith(`${scoreHref}/classes/`);
    if (section.publicScreen) return !section.newTab && pathname.startsWith(section.href);
    return active === section.href && (!inSetup || section.href === hubHref);
  };

  return (
    <nav aria-label={`${show.name} sections`} className="space-y-4">
      <div className="px-2 collapsed:sr-only">
        <p className="font-semibold leading-snug" style={{ color: 'var(--foreground)' }}>
          {show.name}
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          {show.start_date} – {show.end_date} · {STATUS_LABELS[show.status] ?? show.status}
        </p>
      </div>

      <ul className="space-y-0.5">
        <li>
          <Item href={base} label="Overview" icon={<Emoji icon="🏠" />} pathname={pathname} highlighted={pathname === base} />
        </li>
        {sections
          .filter((s) => !s.publicScreen)
          .map((section) => (
            <li key={section.href}>
              <SectionItem
                section={section}
                pathname={pathname}
                highlighted={highlighted(section)}
                open={section.href === hubHref && inSetup}
                status={show.status}
              />
              {section.href === hubHref && steps && (
                <SetupStepsNav steps={steps} pathname={pathname} activeHref={active} />
              )}
            </li>
          ))}
      </ul>

      <div>
        <p className={GROUP_HEADING} style={{ color: 'var(--text-dimmed)' }}>
          On screen
        </p>
        <hr className="hidden collapsed:block mb-2" style={{ borderColor: 'var(--border)' }} />
        <ul className="space-y-0.5">
          {sections
            .filter((s) => s.publicScreen)
            .map((section) => (
              <li key={section.href}>
                <SectionItem
                  section={section}
                  pathname={pathname}
                  highlighted={highlighted(section)}
                  open={false}
                  status={show.status}
                />
              </li>
            ))}
        </ul>
      </div>
    </nav>
  );
}

function SectionItem({
  section,
  pathname,
  highlighted,
  open,
  status,
}: {
  section: ShowSection;
  pathname: string;
  highlighted: boolean;
  /** Setup, while one of its steps is open below it. */
  open: boolean;
  status: string;
}) {
  const label = section.navLabel ?? section.title;

  // Score Classes: not a link until the show is In Progress, as on the
  // dashboard, and saying why rather than going missing.
  if (section.scoring && status !== 'ACTIVE') {
    const reason =
      status === 'COMPLETED'
        ? 'Score Classes — closed, this show is marked Completed.'
        : 'Score Classes — set the show to "In Progress" on the Overview to enable scoring.';
    return (
      <span className={`${ITEM} cursor-not-allowed`} style={{ color: 'var(--text-dimmed)' }} aria-disabled="true" title={reason}>
        <Emoji icon={section.icon} faded />
        <span className={LABEL}>{label}</span>
      </span>
    );
  }

  if (section.newTab) {
    return (
      <a
        href={section.href}
        target="_blank"
        rel="noopener"
        className={`${ITEM} hover:bg-bg-subtle`}
        style={{ color: 'var(--text-deep)' }}
        title={`${label} — opens in a new tab`}
      >
        <Emoji icon={section.icon} />
        <span className={LABEL}>{label}</span>
        <span aria-hidden className="collapsed:hidden" style={{ color: 'var(--text-dimmed)' }}>↗</span>
      </a>
    );
  }

  return (
    <Item
      href={section.href}
      label={label}
      icon={<Emoji icon={section.icon} />}
      pathname={pathname}
      highlighted={highlighted}
      open={open}
    />
  );
}

function Item({
  href,
  label,
  icon,
  pathname,
  highlighted,
  open = false,
  badge,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  pathname: string;
  highlighted: boolean;
  open?: boolean;
  badge?: string;
}) {
  const style: React.CSSProperties = highlighted
    ? { backgroundColor: 'var(--accent-bg)', color: 'var(--accent)', fontWeight: 600 }
    : { color: open ? 'var(--foreground)' : 'var(--text-deep)', fontWeight: open ? 600 : undefined };
  // The label is the tooltip: collapsed to a rail, the icon is all that shows.
  const title = badge ? `${label} — ${badge}` : label;
  const inner = (
    <>
      {icon}
      <span className={LABEL}>{label}</span>
      {badge && (
        <>
          <span
            className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full collapsed:hidden"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            {badge}
          </span>
          {/* On the rail the count has no room; a dot says there is one. */}
          <span
            aria-hidden
            className="hidden collapsed:block absolute top-1 right-1.5 w-2 h-2 rounded-full"
            style={{ backgroundColor: 'var(--accent)' }}
          />
        </>
      )}
    </>
  );

  // The page you are on is not a link: pressing it would only reload it.
  if (href === pathname) {
    return (
      <span className={ITEM} style={style} aria-current="page" title={title}>
        {inner}
      </span>
    );
  }
  return (
    <SidebarLink href={href} className={`${ITEM} ${highlighted ? '' : 'hover:bg-bg-subtle'}`} style={style} title={title}>
      {inner}
    </SidebarLink>
  );
}

function Emoji({ icon, faded = false }: { icon: string; faded?: boolean }) {
  return (
    <span aria-hidden className={`w-5 shrink-0 text-center text-base leading-none ${faded ? 'opacity-40' : ''}`}>
      {icon}
    </span>
  );
}

/** The admin hub draws its tiles with a letter; the sidebar keeps it, in a
 *  chip the width of an emoji so the two lists line up. */
function Monogram({ letter }: { letter: string }) {
  return (
    <span
      aria-hidden
      className="w-5 h-5 shrink-0 inline-flex items-center justify-center rounded text-[11px] font-bold"
      style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--muted)' }}
    >
      {letter}
    </span>
  );
}
