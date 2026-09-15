"""The bodies a show runs under, in one place.

The breed body the show is approved by and every club sanctioning it. Three
screens ask this question and they must not answer it differently:

  * **The exhibitor's registration screen** decides whether to prompt for a
    membership number (`exhibitor_profile.profile_checklist`).
  * **The horse picker** decides whether to flag a horse's missing papers
    (`horse_eligibility.horse_registration_flags`).
  * **The registration desk** decides which memberships and which registration
    papers the office is asked to inspect (`routers/show_office`).

The first two were built against this list from the start. The desk was not: it
listed every membership on the exhibitor's profile and every registration on the
horse's, so an **Open show with no club sanctioning** put APHA, WSCA and MNSPHC
sign-offs in front of the office and counted them in the outstanding total. A
show cannot ask somebody to produce a card for a body it does not run under, and
a check nobody can ever clear is one staff learn to scroll past -- which spends
the credibility of the checks that do matter.

Read against `associations` rather than `show_types`, because a membership
number is a property of the person and that is where those live. There is
deliberately no `associations` row for OPEN, so **an Open show with no clubs
returns an empty list**, and every caller treats that as "nothing to ask about"
rather than as "ask about everything".
"""
from __future__ import annotations

from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Association


async def show_associations(show, db: AsyncSession) -> list[tuple]:
    """`(association_id, code)` for the breed body and every sanctioning club.

    `show` needs `show_type` and `sanctioning` loaded; both are `lazy="selectin"`
    on the model, so an ordinary read of the Show row carries them.
    """
    pairs: list[tuple] = []
    if show.show_type and show.show_type.code and show.show_type.code != "OPEN":
        breed = await db.execute(
            select(Association.id, Association.code).where(
                Association.code == show.show_type.code
            )
        )
        pairs.extend(breed.all())
    club_ids = [row.association_id for row in (show.sanctioning or [])]
    if club_ids:
        clubs = await db.execute(
            select(Association.id, Association.code).where(Association.id.in_(club_ids))
        )
        pairs.extend(clubs.all())
    seen: set = set()
    return [(aid, code) for aid, code in pairs if not (aid in seen or seen.add(aid))]


def asked_of(records: Iterable, association_ids: set) -> list:
    """The `(exhibitor|horse)_registrations` rows this show may ask about.

    `records` is everything on file -- every card the person holds, every body
    the horse is papered with. `association_ids` is what `show_associations`
    returned. An empty set returns nothing at all, which is the Open show with
    no clubs: it has no standing to ask for anybody's card.

    A function rather than a comprehension at each call site because the desk
    asks it twice, of two different tables, and the two must not diverge -- the
    person's card and the horse's papers are the same question about the same
    show.
    """
    return [r for r in records if r.association_id in association_ids]
