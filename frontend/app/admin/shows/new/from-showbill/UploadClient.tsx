"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { errorMessage } from "@/lib/api-error";
import {
  MAX_SUPPORTING_DOCUMENTS,
  readFilesLabel,
  uploadSetProblem,
  type ShowBillImport,
} from "@/lib/showbill-import";
import CancelUploadButton from "./CancelUploadButton";

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
function fileProblem(file: File, what = "the show bill"): string | null {
  if (file.type && !ACCEPTED_TYPES.includes(file.type)) {
    return `${file.name} isn't a PDF or an image. Save ${what} as a PDF and choose that.`;
  }
  if (file.size > MAX_BYTES) {
    return `${file.name} is ${formatSize(file.size)}, over the 10 MB limit. Try the pages that matter on their own.`;
  }
  return null;
}

const STATUS_LABEL: Record<ShowBillImport["status"], string> = {
  pending: "Reading…",
  succeeded: "Ready to create",
  failed: "Could not be read",
  unsupported_media: "Could not be read",
};

export default function UploadClient({
  recent: initialRecent,
  canUpload,
}: {
  recent: ShowBillImport[];
  canUpload: boolean;
}) {
  const router = useRouter();
  // Local so a cancelled upload leaves the list at once.
  const [recent, setRecent] = useState(initialRecent);
  const [file, setFile] = useState<File | null>(null);
  // The show's other papers, read together with the bill (migration 201): a
  // rules and information sheet, a futurity sheet, a stall form.
  const [supporting, setSupporting] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const supportingInput = useRef<HTMLInputElement>(null);

  function choose(chosen: File | null) {
    setError(null);
    if (!chosen) return;
    const problem =
      fileProblem(chosen) ?? uploadSetProblem([chosen.size, ...supporting.map((f) => f.size)]);
    if (problem) {
      setError(problem);
      return;
    }
    setFile(chosen);
  }

  function addSupporting(chosen: File[]) {
    setError(null);
    if (supportingInput.current) supportingInput.current.value = "";
    if (chosen.length === 0) return;
    const next = [...supporting, ...chosen];
    const problem =
      chosen.map((f) => fileProblem(f, "it")).find(Boolean) ??
      uploadSetProblem([file?.size ?? 0, ...next.map((f) => f.size)]);
    if (problem) {
      setError(problem);
      return;
    }
    setSupporting(next);
  }

  function removeSupporting(index: number) {
    setError(null);
    setSupporting(supporting.filter((_, i) => i !== index));
  }

  /** Several files dropped on the bill's area: the first is the bill, the rest
   * are read with it. */
  function dropped(files: File[]) {
    if (files.length === 0) return;
    choose(files[0]);
    if (files.length > 1) addSupporting(files.slice(1));
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
    for (const extra of supporting) form.append("supporting", extra);
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
              also be dropped on the area. The bill is one file, which is why
              the hint asks for a PDF rather than a photo of each page; the
              show's other papers go under "Anything the bill leaves out?". */}
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
                dropped(Array.from(e.dataTransfer.files ?? []));
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

          <SupportingDocuments
            files={supporting}
            busy={busy}
            inputRef={supportingInput}
            onAdd={addSupporting}
            onRemove={removeSupporting}
          />

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
              {busy
                ? "Uploading…"
                : supporting.length
                  ? `Read the show bill and ${supporting.length} more`
                  : "Read this show bill"}
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
                    {readFilesLabel(imp)}
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
                ) : (
                  <div className="flex items-center gap-4 flex-wrap">
                    {imp.status === "pending" || imp.status === "succeeded" ? (
                      <Link
                        href={`/admin/shows/new/from-showbill/${imp.id}`}
                        className="underline"
                        style={{ color: "var(--primary)" }}
                      >
                        {imp.status === "pending" ? "Check on it →" : "Create →"}
                      </Link>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--muted)" }}>
                        {imp.message}
                      </span>
                    )}
                    <CancelUploadButton
                      importId={imp.id}
                      label={readFilesLabel(imp)}
                      onCancelled={() => setRecent((rs) => rs.filter((r) => r.id !== imp.id))}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * The show's other papers, read with the bill as one show: a rules and
 * information sheet is where a bill's refund policy, health papers, arrival
 * rules and high-point awards often are, and what the reader cannot see it can
 * only leave blank. Optional, and below the bill so the bill stays the one
 * thing the page asks for.
 */
function SupportingDocuments({
  files,
  busy,
  inputRef,
  onAdd,
  onRemove,
}: {
  files: File[];
  busy: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  const full = files.length >= MAX_SUPPORTING_DOCUMENTS;
  return (
    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: "var(--border)" }}>
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
          Anything the bill leaves out?{" "}
          <span className="font-normal" style={{ color: "var(--muted)" }}>
            Optional
          </span>
        </p>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Add the show&apos;s rules and information sheet, a futurity sheet or a stall form, and
          we&apos;ll read them together with the bill. Where they disagree with the bill, the
          bill&apos;s value is used and your office notes say so.
        </p>
      </div>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center gap-3 rounded border px-3 py-2"
              style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--background)" }}
            >
              <FileIcon />
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate" style={{ color: "var(--foreground)" }}>
                  {f.name}
                </p>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {formatSize(f.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(i)}
                disabled={busy}
                className="shrink-0 text-sm font-medium hover:underline disabled:opacity-50"
                style={{ color: "var(--muted)" }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        id="showbill-supporting"
        type="file"
        multiple
        accept={ACCEPTED_TYPES.join(",")}
        onChange={(e) => onAdd(Array.from(e.target.files ?? []))}
        disabled={full || busy}
        className="sr-only peer"
      />
      {full ? (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          That&apos;s the most one read takes ({MAX_SUPPORTING_DOCUMENTS} beside the bill).
        </p>
      ) : (
        <label
          htmlFor="showbill-supporting"
          className="inline-block text-sm font-medium underline cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-[color:var(--accent)] rounded"
          style={{ color: "var(--accent)" }}
        >
          + Add a supporting document
        </label>
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
