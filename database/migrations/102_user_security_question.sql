-- Migration 102: a security question, so "forgot password" can mean forgot.
--
-- The existing unauthenticated reset (POST /auth/reset-password) proves identity
-- with the *current* password. That is a sound check and a useless one on a page
-- called "Forgot Password": someone who has the current password has not
-- forgotten it. Anyone genuinely locked out had exactly one route back in, an
-- admin typing a new password for them (PATCH /users/{id}/password) — fine for a
-- staff account, hopeless for an exhibitor at 6am on a show morning trying to
-- check what ring they are in.
--
-- Email would be the ordinary answer and this app cannot rely on it: mailer.py
-- returns None whenever SMTP_HOST is unset and never raises, so a mailed-token
-- reset would accept the request, say "check your email", and drop it. Every
-- other flow here that mails a link also hands the link back for copy/paste —
-- there is no such fallback for a reset token that must not be shown to whoever
-- asked for it.
--
-- So: one question, written by the user, answered by the user.
--
--   security_question       the prompt, in their own words
--   security_answer_hash    bcrypt over the *normalized* answer (see auth.py) —
--                           hashed, not encrypted, because nothing ever needs to
--                           read it back; the only question asked of it is
--                           "does this match".
--   security_answer_set_at  when it was last set, shown on the profile screen so
--                           an answer chosen years ago is visibly old.
--
-- The pair is all-or-nothing, like show_fees' early-bird rate: a question with no
-- answer hash is not a half-configured account, it is an account whose reset
-- would accept anything. The CHECK makes that state unrepresentable rather than
-- something every caller has to remember to guard.
--
-- One question is weaker than two and the user asked for one, so the throttle
-- carries the weight instead. A self-written question at a horse show may well be
-- guessable ("first horse's name" is on the entry form), and unlimited guesses
-- against a guessable question is not authentication at all:
--
--   security_answer_failed_attempts  consecutive misses, cleared on success
--   security_answer_locked_until     set once they pile up; while it is in the
--                                    future the answer route refuses to look at
--                                    the answer at all
--
-- Both live on users rather than in a challenge table because the counter *is*
-- the account's state — a lockout that a new session could clear by starting
-- over would not be a lockout. Note this locks the reset route only; the account
-- itself stays usable, because someone who remembers their password should never
-- be locked out by a stranger guessing at their security question.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS security_question TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_answer_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_answer_set_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_answer_failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_answer_locked_until TIMESTAMPTZ;

ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_security_question_pair;
ALTER TABLE users ADD CONSTRAINT ck_users_security_question_pair
    CHECK ((security_question IS NULL) = (security_answer_hash IS NULL));

COMMENT ON COLUMN users.security_question IS
    'User-written prompt for the self-serve password reset. NULL means no question is set and that route is closed for this account.';
COMMENT ON COLUMN users.security_answer_hash IS
    'bcrypt hash of the normalized answer (trimmed, lowercased, inner whitespace collapsed). Never read back — only compared.';
COMMENT ON COLUMN users.security_answer_failed_attempts IS
    'Consecutive wrong answers on the reset route. Cleared on a correct answer, on a successful login, and whenever the question is reset.';
COMMENT ON COLUMN users.security_answer_locked_until IS
    'While in the future, the reset route refuses the answer outright. Locks the reset route only, never the password login.';

INSERT INTO _migrations (name) VALUES ('102_user_security_question.sql')
ON CONFLICT DO NOTHING;

COMMIT;
