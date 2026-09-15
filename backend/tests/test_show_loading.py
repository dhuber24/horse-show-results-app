"""Which Show relationships have to survive a second loader in the same request.

The incident these pin: `GET /shows/{id}/desk` 500'd on every show whose classes
carry no `class_associations` rows -- which is every show built by hand, and so
every brand-new one.

Two routers load the same Show row in one desk request, both with
`populate_existing=True` and *different* loader options: `show_desk` asks for
`show_type`, `show_financials._get_show_or_404` asks for `fees`, `judges` and
`sanctioning`. A refresh erases every relationship the second query did not
name, so the desk's own eager load was thrown away and
`show.show_type.code` at the end of the handler was lazy IO inside an async
request -- `MissingGreenlet`, a 500 with an empty body, and a desk screen
reading "Could not load the desk."

It looked like it worked because `ClassAssociation.show_type` is `lazy="selectin"`:
at a show whose classes came from an association catalog import, the ShowType
stayed reachable through the session's identity map and the lazy load resolved
without touching the database. That is a weak reference and an accident, and it
held at exactly the shows nobody was setting up for the first time.
"""
from sqlalchemy import inspect

from models import Show


# ── The eager relationships ───────────────────────────────────────────────────


def test_show_type_is_eagerly_loaded():
    """The desk reads `show.show_type` after `_load_financials` has refreshed
    the row. `selectin` rides along on that refresh; `select` does not."""
    assert inspect(Show).relationships["show_type"].lazy == "selectin"


def test_the_show_payload_relationships_are_eagerly_loaded():
    """`routers/shows._serialize` builds the payload by hand for every row of
    the show list, so a lazy one here is N+1 IO at best and a MissingGreenlet
    inside an async request at worst."""
    relationships = inspect(Show).relationships
    for name in ("show_type", "show_category", "affiliations", "sanctioning"):
        assert relationships[name].lazy == "selectin", name
