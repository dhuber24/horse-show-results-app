/**
 * The pieces a Trainer Registry listing is drawn from, shared by the list at
 * `/trainers` and one trainer's page at `/trainers/[id]`. No hooks, so they
 * render on either side. A Basic listing arrives with its Pro fields empty
 * (`backend/trainer_registry.public_card`), so each piece simply has nothing
 * to draw for one.
 */
import {
  affiliationLabel,
  initials,
  mediaUrl,
  safeWebUrl,
  socialUrl,
  telHref,
  type TrainerListing,
} from '@/lib/trainer-registry';

export function TrainerAvatar({ trainer, size }: { trainer: TrainerListing; size: 'sm' | 'lg' }) {
  const box = size === 'lg' ? 'w-28 h-28 text-3xl' : 'w-16 h-16 text-lg';
  // A headshot, else the logo, else initials.
  const pictureId = trainer.headshot_id ?? trainer.logo_id;
  return (
    <div
      className={`${box} rounded-full border flex items-center justify-center overflow-hidden shrink-0 font-semibold`}
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)', color: 'var(--muted)' }}
    >
      {pictureId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mediaUrl(trainer.id, pictureId)}
          alt={trainer.name}
          className={trainer.headshot_id ? 'w-full h-full object-cover' : 'w-full h-full object-contain p-1'}
          loading="lazy"
        />
      ) : (
        <span aria-hidden="true">{initials(trainer)}</span>
      )}
    </div>
  );
}

export function ProBadge() {
  return (
    <span
      className="inline-block text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
      style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
    >
      Pro
    </span>
  );
}

function Badge({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      className="inline-block text-xs font-medium px-2 py-0.5 rounded-full border"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-deep)' }}
      title={title}
    >
      {children}
    </span>
  );
}

/** What they train — on every listing, both plans. */
export function DisciplineList({ trainer }: { trainer: TrainerListing }) {
  if (trainer.disciplines.length === 0) return null;
  return (
    <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
      {trainer.disciplines.join(' · ')}
    </p>
  );
}

/** Association cards, then compliance — current status only, never a date. Pro only. */
export function ListingBadges({ trainer }: { trainer: TrainerListing }) {
  const hasAny =
    trainer.affiliations.length > 0 ||
    trainer.safesport_current ||
    trainer.background_check_current ||
    trainer.has_liability_insurance;
  if (!hasAny) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {trainer.affiliations.map((a) => (
        <Badge key={a.id} title={a.association_name}>{affiliationLabel(a)}</Badge>
      ))}
      {trainer.safesport_current && <Badge title="SafeSport training completed within the last year">✓ SafeSport</Badge>}
      {trainer.background_check_current && <Badge title="Background check on file and not expired">✓ Background check</Badge>}
      {trainer.has_liability_insurance && <Badge title="Says they carry commercial equine liability insurance">✓ Insured</Badge>}
    </div>
  );
}

export const linkButtonClass = 'inline-flex items-center gap-1 text-sm font-medium px-3 py-1.5 rounded border';
export const linkButtonStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--accent)' } as const;

/**
 * The Call button, and with `full` the website and socials. Pro only. The
 * Contact Trainer form sits beside these; the email address itself is never
 * printed, since the form routes to it.
 */
export function ContactLinks({ trainer, full }: { trainer: TrainerListing; full?: boolean }) {
  const links: { href: string; label: string; external?: boolean }[] = [];
  const tel = telHref(trainer.public_phone);
  if (tel) links.push({ href: tel, label: `📞 ${full ? trainer.public_phone : 'Call'}` });
  if (full) {
    const website = safeWebUrl(trainer.website);
    const facebook = socialUrl('facebook', trainer.social_facebook);
    const instagram = socialUrl('instagram', trainer.social_instagram);
    const tiktok = socialUrl('tiktok', trainer.social_tiktok);
    if (website) links.push({ href: website, label: '🌐 Website', external: true });
    if (facebook) links.push({ href: facebook, label: 'Facebook', external: true });
    if (instagram) links.push({ href: instagram, label: 'Instagram', external: true });
    if (tiktok) links.push({ href: tiktok, label: 'TikTok', external: true });
  }
  if (links.length === 0) return null;
  return (
    <>
      {links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          className={linkButtonClass}
          style={linkButtonStyle}
          {...(l.external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
        >
          {l.label}
        </a>
      ))}
    </>
  );
}
