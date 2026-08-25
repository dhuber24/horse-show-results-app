// Pin the timezone so date formatting is deterministic wherever the suite runs
// — a developer's machine, a container, or a CI runner in another region.
//
// The helpers under test parse local-midnight (`new Date('2026-06-01T00:00:00')`)
// and format in local time, so they happen to be timezone-independent today.
// This keeps them that way rather than relying on it.
process.env.TZ = 'UTC';
