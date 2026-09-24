"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { errorMessage } from "@/lib/api-error";
import type { ShowBillImport } from "@/lib/showbill-import";

const STATUS_LABEL: Record<ShowBillImport["status"], string> = {
  pending: "Reading…",
  succeeded: "Ready to review",
  failed: "Could not be read",
  unsupported_media: "Could not be read",
};

export default function UploadClient({
  recent,
  canUpload,
}: {
  recent: ShowBillImport[];
  canUpload: boolean;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/show-bill-imports", {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorMessage(body, "The show bill could not be uploaded."));
        setBusy(false);
        return;
      }
      router.push(`/admin/shows/new/from-showbill/${body.id}`);
    } catch {
      setError("The show bill could not be uploaded.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {canUpload && (
        <section
          className="p-4 rounded-lg border space-y-3"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface)",
          }}
        >
          <label className="block">
            <span
              className="block text-xs mb-1"
              style={{ color: "var(--muted)" }}
            >
              Show bill (PDF, or a photo of each page — JPEG, PNG or WebP; up to
              10 MB)
            </span>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm"
            />
          </label>

          {error && (
            <div
              className="rounded border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--error)",
                backgroundColor: "var(--error-bg)",
                color: "var(--error-strong)",
              }}
              role="alert"
            >
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Reading a full bill takes a few minutes. You can leave this page
              and come back — it will be listed below.
            </p>
            <button
              type="button"
              onClick={upload}
              disabled={!file || busy}
              title={!file ? "Choose the show bill file first" : undefined}
              className="text-sm rounded px-4 py-2 disabled:opacity-50"
              style={{
                backgroundColor: "var(--primary)",
                color: "var(--primary-foreground)",
              }}
            >
              {busy ? "Uploading…" : "Read this show bill"}
            </button>
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section
          className="p-4 rounded-lg border space-y-2"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface)",
          }}
        >
          <h2
            className="text-base font-semibold"
            style={{ color: "var(--foreground)" }}
          >
            Your recent show bills
          </h2>
          <ul
            className="divide-y"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            {recent.map((imp) => (
              <li
                key={imp.id}
                className="py-2 flex items-center justify-between gap-3 flex-wrap text-sm"
              >
                <div className="min-w-0">
                  <div
                    className="truncate"
                    style={{ color: "var(--foreground)" }}
                  >
                    {imp.original_filename}
                  </div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    {imp.created_at
                      ? new Date(imp.created_at).toLocaleString()
                      : ""}{" "}
                    · {imp.show_id ? "Show created" : STATUS_LABEL[imp.status]}
                  </div>
                </div>
                {imp.show_id ? (
                  <Link
                    href={`/admin/shows/${imp.show_id}/setup`}
                    className="underline"
                    style={{ color: "var(--primary)" }}
                  >
                    Open the show →
                  </Link>
                ) : imp.status === "pending" || imp.status === "succeeded" ? (
                  <Link
                    href={`/admin/shows/new/from-showbill/${imp.id}`}
                    className="underline"
                    style={{ color: "var(--primary)" }}
                  >
                    {imp.status === "pending" ? "Check on it →" : "Review →"}
                  </Link>
                ) : (
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {imp.message}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
