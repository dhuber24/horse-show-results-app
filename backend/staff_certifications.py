"""What a show manager or secretary says they are carded with.

Stored in `show_secretary_certifications` -- one row per (user, association),
with the association's own identifier for that person where they have one.

**The table is named for the secretary because that was the only role that
could record one when it was added.** It is keyed on `users.id` and carries no
role of its own, so a manager's certification is the same fact in the same
shape; renaming the table is a backward-incompatible migration of exactly the
kind that has taken this site down once already (see migration 133), in
exchange for no behaviour anybody would notice.

**Nothing here is verified, and nothing is refused over it.** A certification
number is a claim about a body this app has no standing with -- it cannot tell
a real one from a typo, and asking the association would mean trusting a list
this app does not own to decide who may create a show. It is the same call
`exhibitor_registrations` makes about a membership card, and the same one the
health-paperwork flags make about a Coggins: record it, show it, and let the
people who can actually check it do the checking.

That matters more than it sounds. The show-staff signup screens used to look up
APHA's certified list by email and, on the secretary's screen, **refuse the
registration** without a hit -- which turned an unverifiable claim into a hard
stop, made APHA the one body a show could be run under in an app that also
serves AQHA, ApHC, FQHR and unaffiliated shows, and turned away any real
secretary whose email on APHA's list was not the one they signed up with.
"""
from typing import Iterable, Optional


def normalize_id_number(value: Optional[str]) -> Optional[str]:
    """A blank is not an identifier.

    An empty box and an untyped one mean the same thing, and storing `""` for
    one of them would have the desk render an association row with an
    identifier field that is present and says nothing.
    """
    if value is None:
        return None
    return value.strip() or None


def plan_certification_changes(
    existing: dict,
    requested: Iterable[tuple],
) -> dict:
    """Work out the writes that turn `existing` into `requested`.

    `existing` is `{association_id: id_number}` already on file; `requested` is
    `(association_id, id_number)` pairs the caller ticked. Returns
    `{"remove": set, "upsert": dict}` -- ids to delete, and the full desired
    state for everything else, so the caller updates a row it finds and creates
    one it does not.

    **A replace, not a delta.** The questionnaire that writes this shows every
    association at once, so unticking one is how somebody corrects a mistake --
    and with an add-only endpoint that correction would have nowhere to go.

    **A repeated association is one row, last one winning.** The unique
    constraint is on `(user_id, association_id)`, and a client that sent the
    same body twice meant one certification rather than an error.
    """
    desired: dict = {}
    for association_id, id_number in requested:
        desired[association_id] = normalize_id_number(id_number)

    return {
        "remove": {aid for aid in existing if aid not in desired},
        "upsert": desired,
    }
