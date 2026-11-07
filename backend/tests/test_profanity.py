"""What the discussion board's profanity filter refuses, and what it must not.

The second half matters more. A filter that refuses "spicy" or "a donkey class
for the jacks and the asses" is one a show's own people trip over at the rail,
and they have no way to know why.
"""
import pytest

from profanity import find_profanity, refusal_message


@pytest.mark.parametrize(
    "typed, found",
    [
        ("this is shit", ["shit"]),
        ("What the FUCK", ["fuck"]),
        ("fucking ridiculous", ["fucking"]),
        ("you motherfucker", ["motherfucker"]),
        ("bitches be like", ["bitches"]),
        ("a shitty draw", ["shitty"]),
        ("total bullshit", ["bullshit"]),
        ("what an asshole", ["asshole"]),
    ],
)
def test_the_common_words_are_found(typed, found):
    assert find_profanity(typed) == found


@pytest.mark.parametrize(
    "typed",
    ["sh1t", "$hit", "5h!t", "shiiiit", "s.h.i.t", "s h i t", "f-u-c-k", "fuuuuck"],
)
def test_the_usual_dodges_are_seen_through(typed):
    assert find_profanity(typed) != []


@pytest.mark.parametrize(
    "typed",
    [
        "Scunthorpe and Essex are both lovely",
        "the donkey class has jacks, jennies and an ass or two",
        "my jackass won the halter class",
        "a rooster -- the old cock -- woke the barn",
        "Dick Smith is judging ring 2",
        "it was hot as hell and damn dusty",
        "a chink in the arena fence",
        "spicy chili at the concession stand",
        "pricked my hand on a thistle",
        "shiitake mushrooms with the brisket",
        "the stud and the mare are both entered",
        "breeding stock halter, 2-year-old fillies",
        "Class A B C D results posted",
        "1st place $500 added money",
    ],
)
def test_ordinary_show_talk_passes(typed):
    assert find_profanity(typed) == []


def test_each_word_is_named_once_in_the_order_typed():
    assert find_profanity("shit, fuck, shit") == ["shit", "fuck"]


def test_the_refusal_names_what_to_reword():
    message = refusal_message(["shit"])
    assert "“shit”" in message
    assert message.startswith("Please reword your post")
