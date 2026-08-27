'use client';

import { useState } from 'react';
import {
  COLORS,
  centsToDollars,
  dollarsToCents,
  formatCents,
  type ClassItem,
  type Futurity,
} from './futurity-shared';

/**
 * Every question a futurity entry form asks, in one place.
 *
 * Adding a futurity and editing one are the same conversation — a paper entry
 * form does not have a short version — so Create and Settings render this and
 * differ only in what they do with the payload. The alternative was two
 * four-hundred-line forms that would drift the first time a field was added to
 * one of them.
 *
 * The sections follow the order a printed entry form runs in, because that is
 * the document the person filling this in is holding: deadline, awards, rules,
 * the categories, the office fee, the optional membership, the refund note, the
 * release. Placeholders show the shape of each answer with an example rather
 * than pre-filling one club's wording, which would end up published by somebody
 * who never read it.
 *
 * The release is not written here. It is a `show_waivers` row scoped to this
 * futurity, so it goes through the waiver endpoints that already know about
 * paper signatures, guardians and the outstanding count — this form just
 * collects the words and hands them to the caller.
 */

export type TierDraft = { name: string; description: string; amount: string };
export type MembershipDraft = { name: string; description: string; amount: string };

export type FuturityFormValue = {
  name: string;
  description: string;
  deadline: string;
  deadlineTime: string;
  deadlineZone: string;
  lateFee: string;
  officeMember: string;
  officeNonmember: string;
  requiresPedigree: boolean;
  awardNotice: string;
  rulesNotice: string;
  entryInstructions: string;
  refundPolicy: string;
  tiers: TierDraft[];
  memberships: MembershipDraft[];
  classIds: Set<string>;
  waiverTitle: string;
  waiverBody: string;
  waiverRequired: boolean;
};

/** The shape the futurity endpoints take, minus the waiver — that is posted
 *  separately because it is a waiver row, not a futurity column. */
export function toFuturityPayload(value: FuturityFormValue) {
  return {
    name: value.name.trim(),
    description: value.description.trim() || null,
    entry_deadline: value.deadline || null,
    entry_deadline_time: value.deadline && value.deadlineTime ? value.deadlineTime : null,
    entry_deadline_timezone: value.deadlineZone.trim() || null,
    late_fee_cents: dollarsToCents(value.lateFee),
    office_fee_member_cents: dollarsToCents(value.officeMember),
    office_fee_nonmember_cents: dollarsToCents(value.officeNonmember),
    entry_instructions: value.entryInstructions.trim() || null,
    award_notice: value.awardNotice.trim() || null,
    rules_notice: value.rulesNotice.trim() || null,
    refund_policy: value.refundPolicy.trim() || null,
    requires_horse_pedigree: value.requiresPedigree,
    class_ids: [...value.classIds],
    fee_tiers: value.tiers
      .filter((t) => t.name.trim() !== '')
      .map((t, i) => ({
        name: t.name.trim(),
        description: t.description.trim() || null,
        amount_cents: dollarsToCents(t.amount),
        sort_order: i,
      })),
    membership_options: value.memberships
      .filter((m) => m.name.trim() !== '')
      .map((m, i) => ({
        name: m.name.trim(),
        description: m.description.trim() || null,
        amount_cents: dollarsToCents(m.amount),
        sort_order: i,
      })),
  };
}

/** Caught in the form as well as server-side so the message can name the field
 *  rather than arriving as a validation error against a key nobody typed. */
export function validate(value: FuturityFormValue): string | null {
  if (value.name.trim() === '') return 'Give the futurity a name.';
  if (value.lateFee.trim() !== '' && value.deadline === '') {
    return 'A late fee needs an entry deadline — without one there is nothing for it to be late against.';
  }
  if (value.deadlineTime !== '' && value.deadline === '') {
    return 'A deadline time needs a deadline date to qualify.';
  }
  if (value.waiverBody.trim() !== '' && value.waiverTitle.trim() === '') {
    return 'Give the release a title — it is what entrants see before they open it.';
  }
  return null;
}

export function emptyFuturityForm(): FuturityFormValue {
  return {
    name: '',
    description: '',
    deadline: '',
    deadlineTime: '',
    deadlineZone: '',
    lateFee: '',
    officeMember: '',
    officeNonmember: '',
    // A futurity is judged in age divisions off a registration paper, so this
    // is what a futurity form asks for by default.
    requiresPedigree: true,
    awardNotice: '',
    rulesNotice: '',
    entryInstructions: '',
    refundPolicy: '',
    // Three rows because a tiered entry fee is the normal case and an empty
    // repeater reads as an optional extra. Blank rows are dropped.
    tiers: [
      { name: '', description: '', amount: '' },
      { name: '', description: '', amount: '' },
      { name: '', description: '', amount: '' },
    ],
    memberships: [{ name: '', description: '', amount: '' }],
    classIds: new Set(),
    waiverTitle: '',
    waiverBody: '',
    waiverRequired: true,
  };
}

export function futurityToForm(futurity: Futurity): FuturityFormValue {
  const waiver = futurity.waivers[0] ?? null;
  return {
    name: futurity.name,
    description: futurity.description ?? '',
    deadline: futurity.entry_deadline ?? '',
    // Postgres hands back "19:00:00"; <input type="time"> wants "19:00".
    deadlineTime: (futurity.entry_deadline_time ?? '').slice(0, 5),
    deadlineZone: futurity.entry_deadline_timezone ?? '',
    lateFee: futurity.late_fee_cents ? centsToDollars(futurity.late_fee_cents) : '',
    officeMember: futurity.office_fee_member_cents
      ? centsToDollars(futurity.office_fee_member_cents)
      : '',
    officeNonmember: futurity.office_fee_nonmember_cents
      ? centsToDollars(futurity.office_fee_nonmember_cents)
      : '',
    requiresPedigree: futurity.requires_horse_pedigree,
    awardNotice: futurity.award_notice ?? '',
    rulesNotice: futurity.rules_notice ?? '',
    entryInstructions: futurity.entry_instructions ?? '',
    refundPolicy: futurity.refund_policy ?? '',
    tiers: futurity.fee_tiers.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      amount: centsToDollars(t.amount_cents),
    })),
    memberships: futurity.membership_options.map((m) => ({
      name: m.name,
      description: m.description ?? '',
      amount: centsToDollars(m.amount_cents),
    })),
    classIds: new Set(futurity.classes.map((c) => c.class_id)),
    waiverTitle: waiver?.title ?? '',
    waiverBody: waiver?.body ?? '',
    waiverRequired: waiver?.is_required ?? true,
  };
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="p-4 rounded-lg border space-y-3"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <div>
        <h3 className="font-semibold" style={{ color: COLORS.text }}>
          {title}
        </h3>
        {hint && (
          <p className="text-xs mt-1" style={{ color: COLORS.muted }}>
            {hint}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="block text-xs mt-1" style={{ color: COLORS.muted }}>
          {hint}
        </span>
      )}
    </label>
  );
}

const inputStyle = { borderColor: COLORS.border } as const;
const inputClass = 'w-full border rounded px-3 py-2';

export default function FuturityForm({
  value,
  onChange,
  classes,
  /** Categories and memberships with entries against them cannot be removed —
   *  they are prices somebody was quoted — so the settings screen says so
   *  rather than letting the save fail with a 409. */
  hasEntries = false,
  /** Signatures already on the release. Editing the wording deliberately does
   *  not void them, so the count is shown next to the text being edited. */
  waiverSignatureCount = 0,
}: {
  value: FuturityFormValue;
  onChange: (patch: Partial<FuturityFormValue>) => void;
  classes: ClassItem[];
  hasEntries?: boolean;
  waiverSignatureCount?: number;
}) {
  const [showWaiver, setShowWaiver] = useState(value.waiverBody.trim() !== '');

  function setTier(index: number, patch: Partial<TierDraft>) {
    onChange({
      tiers: value.tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    });
  }

  function setMembership(index: number, patch: Partial<MembershipDraft>) {
    onChange({
      memberships: value.memberships.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    });
  }

  function toggleClass(classId: string) {
    const next = new Set(value.classIds);
    if (next.has(classId)) next.delete(classId);
    else next.add(classId);
    onChange({ classIds: next });
  }

  return (
    <div className="space-y-4">
      <Section title="The futurity">
        <Field label="Name">
          <input
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. North Star Futurity"
            className={inputClass}
            style={inputStyle}
          />
        </Field>
        <Field
          label="Description (optional)"
          hint="A line or two under the heading on the entry form."
        >
          <textarea
            value={value.description}
            onChange={(e) => onChange({ description: e.target.value })}
            rows={2}
            className={inputClass}
            style={inputStyle}
          />
        </Field>
      </Section>

      <Section
        title="Entry deadline"
        hint="The late fee is charged per class entered, and only on enrollments taken after the deadline — an entry booked in April keeps its price however late the bill is read. The time and zone are printed on the form; what an entry is charged is decided by the day it was taken."
      >
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Entries close">
            <input
              type="date"
              value={value.deadline}
              onChange={(e) => onChange({ deadline: e.target.value })}
              className={inputClass}
              style={inputStyle}
            />
          </Field>
          <Field label="By (time, optional)">
            <input
              type="time"
              value={value.deadlineTime}
              onChange={(e) => onChange({ deadlineTime: e.target.value })}
              className={inputClass}
              style={inputStyle}
            />
          </Field>
          <Field label="Time zone as printed">
            <input
              value={value.deadlineZone}
              onChange={(e) => onChange({ deadlineZone: e.target.value })}
              placeholder="e.g. central time"
              className={inputClass}
              style={inputStyle}
            />
          </Field>
        </div>
        <Field label="Late fee, per class entered ($)">
          <input
            type="text"
            inputMode="decimal"
            value={value.lateFee}
            onChange={(e) => onChange({ lateFee: e.target.value })}
            placeholder="e.g. 150.00"
            className={inputClass}
            style={inputStyle}
          />
        </Field>
      </Section>

      <Section
        title="Entry categories"
        hint="What one class costs. The entrant picks one category when they enter, and it is multiplied by however many of the futurity's classes their horse is in — which is why a futurity class carries no entry fee of its own."
      >
        {value.tiers.map((tier, i) => (
          <div key={i} className="grid sm:grid-cols-[1fr_2fr_7rem] gap-2">
            <input
              value={tier.name}
              onChange={(e) => setTier(i, { name: e.target.value })}
              placeholder={`Category #${i + 1}`}
              className="border rounded px-3 py-2 text-sm"
              style={inputStyle}
            />
            <input
              value={tier.description}
              onChange={(e) => setTier(i, { description: e.target.value })}
              placeholder="who qualifies for it"
              className="border rounded px-3 py-2 text-sm"
              style={inputStyle}
            />
            <input
              type="text"
              inputMode="decimal"
              value={tier.amount}
              onChange={(e) => setTier(i, { amount: e.target.value })}
              placeholder="$ / class"
              className="border rounded px-3 py-2 text-sm"
              style={inputStyle}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({
              tiers: [...value.tiers, { name: '', description: '', amount: '' }],
            })
          }
          className="text-sm hover:underline"
          style={{ color: COLORS.accent }}
        >
          + Add a category
        </button>
        {hasEntries && (
          <p className="text-xs" style={{ color: COLORS.muted }}>
            Clearing a category&rsquo;s name removes it. One that still has entries
            against it cannot be removed — it is a price somebody was quoted.
          </p>
        )}
        <Field
          label="Entry instructions (optional)"
          hint="The PLEASE READ block above the category picker, explaining which one an entrant is eligible for."
        >
          <textarea
            value={value.entryInstructions}
            onChange={(e) => onChange({ entryInstructions: e.target.value })}
            rows={4}
            placeholder={
              'e.g. All class entries are in three categories. You must choose which category you are eligible for.\n\n#1 — stallion owner that donated a service, or mare owner with the winning bid.'
            }
            className={inputClass}
            style={inputStyle}
          />
        </Field>
      </Section>

      <Section
        title="Office fee, per horse"
        hint="Charged once per horse enrolled, whether or not it ends up in a class — the club took the paperwork. Which rate applies follows the card the entrant already holds."
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Member ($)">
            <input
              type="text"
              inputMode="decimal"
              value={value.officeMember}
              onChange={(e) => onChange({ officeMember: e.target.value })}
              placeholder="e.g. 10.00"
              className={inputClass}
              style={inputStyle}
            />
          </Field>
          <Field label="Non-member ($)">
            <input
              type="text"
              inputMode="decimal"
              value={value.officeNonmember}
              onChange={(e) => onChange({ officeNonmember: e.target.value })}
              placeholder="e.g. 20.00"
              className={inputClass}
              style={inputStyle}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Club membership (optional)"
        hint="A membership the futurity sells alongside the entry. Charged once per enrollment, and separate from the office fee above: that follows the card an entrant already holds, this is one they are buying. Somebody joining on the day pays both, which is what the paper form charges them."
      >
        {value.memberships.map((membership, i) => (
          <div key={i} className="grid sm:grid-cols-[1fr_2fr_7rem] gap-2">
            <input
              value={membership.name}
              onChange={(e) => setMembership(i, { name: e.target.value })}
              placeholder="e.g. Single Membership"
              className="border rounded px-3 py-2 text-sm"
              style={inputStyle}
            />
            <input
              value={membership.description}
              onChange={(e) => setMembership(i, { description: e.target.value })}
              placeholder="what it covers (optional)"
              className="border rounded px-3 py-2 text-sm"
              style={inputStyle}
            />
            <input
              type="text"
              inputMode="decimal"
              value={membership.amount}
              onChange={(e) => setMembership(i, { amount: e.target.value })}
              placeholder="$"
              className="border rounded px-3 py-2 text-sm"
              style={inputStyle}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({
              memberships: [
                ...value.memberships,
                { name: '', description: '', amount: '' },
              ],
            })
          }
          className="text-sm hover:underline"
          style={{ color: COLORS.accent }}
        >
          + Add a membership
        </button>
      </Section>

      <Section
        title="Classes in this futurity"
        hint="The futurity's classes are ordinary classes on the schedule, entered the ordinary way. What makes them futurity classes is being listed here — and their price then comes from the category above, so each one should carry a $0 entry fee of its own."
      >
        <p className="text-xs" style={{ color: COLORS.muted }}>
          {value.classIds.size} selected
        </p>
        <div
          className="max-h-72 overflow-y-auto border rounded p-2 space-y-1"
          style={{ borderColor: COLORS.border }}
        >
          {classes.length === 0 ? (
            <p className="text-sm" style={{ color: COLORS.muted }}>
              This show has no classes yet — build the schedule in Step 6 first.
            </p>
          ) : (
            classes.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={value.classIds.has(c.id)}
                  onChange={() => toggleClass(c.id)}
                />
                <span className="font-mono text-xs">#{c.class_number}</span>
                <span style={{ color: COLORS.text }}>{c.class_name}</span>
                {c.entry_fee_cents > 0 && (
                  <span className="text-xs" style={{ color: '#922' }}>
                    (has its own {formatCents(c.entry_fee_cents)} fee)
                  </span>
                )}
              </label>
            ))
          )}
        </div>
      </Section>

      <Section
        title="What the entry form asks for"
        hint="A futurity is judged in age divisions off a registration paper, so its form asks for the horse's foaling date, sire and dam."
      >
        <label className="flex items-start gap-2 text-sm" style={{ color: COLORS.text }}>
          <input
            type="checkbox"
            className="mt-1"
            checked={value.requiresPedigree}
            onChange={(e) => onChange({ requiresPedigree: e.target.checked })}
          />
          <span>
            Require date of birth, sire and dam
            <span className="block text-xs" style={{ color: COLORS.muted }}>
              An exhibitor entering online is asked to fill these in on the horse
              first. The office is never blocked by them — a horse missing any is
              flagged on the entries screen instead, because refusing an entry at
              the counter does not produce the sire&rsquo;s name.
            </span>
          </span>
        </label>
      </Section>

      <Section
        title="Notices printed on the entry form"
        hint="Free text, because the words belong to the club running the futurity. Anything here appears on the show bill and on the exhibitor's entry screen."
      >
        <Field
          label="Award notice"
          hint="What is won and who is eligible."
        >
          <textarea
            value={value.awardNotice}
            onChange={(e) => onChange({ awardNotice: e.target.value })}
            rows={3}
            placeholder="e.g. Hi-Point saddle and Reserve Hi-Point buckle. Both Yearlings and 2 Year Olds are eligible; points are tabulated from three classes in each division."
            className={inputClass}
            style={inputStyle}
          />
        </Field>
        <Field label="Rules notice">
          <textarea
            value={value.rulesNotice}
            onChange={(e) => onChange({ rulesNotice: e.target.value })}
            rows={2}
            placeholder="e.g. Breed association rules for crossing over do not apply to the futurity classes. Horses may cross over."
            className={inputClass}
            style={inputStyle}
          />
        </Field>
        <Field label="Refund policy">
          <textarea
            value={value.refundPolicy}
            onChange={(e) => onChange({ refundPolicy: e.target.value })}
            rows={2}
            placeholder="e.g. An entry paid for a horse that is not shown will not be refunded, unless documentation is provided from a veterinarian prior to the futurity."
            className={inputClass}
            style={inputStyle}
          />
        </Field>
      </Section>

      <Section
        title="Release"
        hint="The waiver on the entry form. Signed once by each entrant — typed here, or handed across the counter on paper and recorded at the desk. Only this futurity's entrants are asked for it."
      >
        {!showWaiver && value.waiverBody.trim() === '' ? (
          <button
            type="button"
            onClick={() => setShowWaiver(true)}
            className="text-sm hover:underline"
            style={{ color: COLORS.accent }}
          >
            + Add a release to sign
          </button>
        ) : (
          <>
            <Field label="Title">
              <input
                value={value.waiverTitle}
                onChange={(e) => onChange({ waiverTitle: e.target.value })}
                placeholder="e.g. North Star Futurity release and waiver"
                className={inputClass}
                style={inputStyle}
              />
            </Field>
            <Field label="Wording">
              <textarea
                value={value.waiverBody}
                onChange={(e) => onChange({ waiverBody: e.target.value })}
                rows={6}
                placeholder="Paste the release exactly as it appears on the entry form."
                className={inputClass}
                style={inputStyle}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm" style={{ color: COLORS.text }}>
              <input
                type="checkbox"
                checked={value.waiverRequired}
                onChange={(e) => onChange({ waiverRequired: e.target.checked })}
              />
              Required — chase entrants who have not signed
            </label>
            {waiverSignatureCount > 0 && (
              <p className="text-xs" style={{ color: COLORS.muted }}>
                {waiverSignatureCount} signed already. Editing the wording does not
                void those signatures — the app cannot tell a typo from a change of
                terms, and voiding a hundred signatures over a typo would be worse
                than either. To ask everyone again, remove the release and add it
                back.
              </p>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
