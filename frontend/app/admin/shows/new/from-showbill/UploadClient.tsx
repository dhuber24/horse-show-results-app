"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { errorMessage } from "@/lib/api-error";
import type { ShowBillImport } from "@/lib/showbill-import";

// What the backend's magic-byte check accepts (`show_documents._detect_mime`).
const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Why a file will be refused, said before it is uploaded rather than after a
 * round trip. The backend checks the bytes themselves; this only catches the
 * obvious cases a browser can see -- a Word file, a 40 MB scan.
 */
function fileProblem(file: File): string | null {
  if (file.type && !ACCEPTED_TYPES.includes(file.type)) {
    return `${file.name} isn't a PDF or an image. Save the show bill as a PDF and choose that.`;
  }
  if (file.size > MAX_BYTES) {
    return `${file.name} is ${formatSize(file.size)}, over the 10 MB limit. Try the class schedule pages on their own.`;
  }
  return null;
}

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
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function choose(chosen: File | null) {
    setError(null);
    if (!chosen) return;
    const problem = fileProblem(chosen);
    if (problem) {
      setError(problem);
      return;
    }
    setFile(chosen);
  }

  function clear() {
    setFile(null);
    setError(null);
    // So choosing the same file again still fires onChange.
    if (input.current) input.current.value = "";
  }

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
          {/* The browser's own file input says "Choose file / No file chosen" in
              small grey type, which is easy to miss as the thing to press. The
              input stays in the label -- hidden, not removed -- so a click, the
              keyboard and a screen reader all still reach it, and a file can
              also be dropped on the area. One file is read per upload, which is
              why the hint asks for a PDF rather than a photo of each page. */}
          <input
            ref={input}
            id="showbill-file"
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            className="sr-only peer"
          />
          {file ? (
            <div
              className="flex items-center gap-3 rounded-lg border p-3 peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-[color:var(--accent)]"
              style={{ borderColor: "var(--accent-border)", backgroundColor: "var(--accent-bg)" }}
            >
              <FileIcon />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>
                  {file.name}
                </p>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {formatSize(file.size)} · ready to read
                </p>
              </div>
              <label
                htmlFor="showbill-file"
                className="shrink-0 text-sm font-medium underline cursor-pointer"
                style={{ color: "var(--accent)" }}
              >
                Change
              </label>
              <button
                type="button"
                onClick={clear}
                disabled={busy}
                title={busy ? "Uploading…" : "Remove this file"}
                className="shrink-0 text-sm font-medium hover:underline disabled:opacity-50"
                style={{ color: "var(--muted)" }}
              >
                Remove
              </button>
            </div>
          ) : (
            <label
              htmlFor="showbill-file"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                choose(e.dataTransfer.files?.[0] ?? null);
              }}
              className="flex flex-col items-center justify-center gap-2 w-full rounded-lg border-2 border-dashed px-4 py-8 text-center cursor-pointer transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-[color:var(--accent)]"
              style={{
                borderColor: dragging ? "var(--accent)" : "var(--border-strong)",
                backgroundColor: dragging ? "var(--accent-bg)" : "var(--background)",
              }}
            >
              <UploadIcon />
              <span
                className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold"
                style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
              >
                Choose your show bill
              </span>
              <span className="text-sm" style={{ color: "var(--text-deep)" }}>
                or drag it here
              </span>
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                A PDF of the whole bill works best. A photo works for a one-page bill. Up to 10 MB.
              </span>
            </label>
          )}

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
              title={!file ? "Choose the show bill file first" : busy ? "Uploading…" : undefined}
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


function UploadIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="w-8 h-8" style={{ color: "var(--accent)" }}>
      <path
        fill="currentColor"
        d="M12 3 6.5 8.5l1.4 1.4L11 6.8V16h2V6.8l3.1 3.1 1.4-1.4zM5 18h14v2H5z"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="w-7 h-7 shrink-0" style={{ color: "var(--accent)" }}>
      <path
        fill="currentColor"
        d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V9h5.5zM8 13h8v1.6H8zm0 3.4h8V18H8z"
      />
    </svg>
  );
}
