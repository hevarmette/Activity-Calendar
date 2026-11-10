import { useEffect, useRef, useState } from "react";

interface Props {
	/** Current persisted value ("" when empty). */
	value: string;
	/** Called with the trimmed new value on commit. Not called when unchanged. */
	onSave: (next: string) => void;
	/** Accessible name for the control (used for the edit button and the input). */
	label: string;
	/** Muted text shown when the value is empty (and the field is editable). */
	placeholder: string;
	/** Render a textarea instead of a single-line input. Enter inserts a newline; Ctrl/Cmd+Enter commits. */
	multiline?: boolean;
	/** Read-only mode: renders plain text with no edit affordance. */
	disabled?: boolean;
	/** Subtle status shown next to the text. */
	status?: "idle" | "saving" | "error";
	/** Classes applied to the text and the input so both share the same typography. */
	textClassName?: string;
}

/**
 * Click-to-edit text. Shows plain text with a faint pencil on hover/focus; clicking
 * swaps it for an input (or textarea). Enter (or Ctrl/Cmd+Enter for multiline) and blur
 * commit, Escape cancels. Escape is stopped from bubbling so it won't close a parent dialog.
 * Calls `onSave` only if the trimmed value differs from `value`.
 */
export function EditableText({
	value,
	onSave,
	label,
	placeholder,
	multiline = false,
	disabled = false,
	status = "idle",
	textClassName = "",
}: Props) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(value);
	const finishedRef = useRef(false);
	const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

	useEffect(() => {
		if (editing) fieldRef.current?.focus();
	}, [editing]);

	const start = () => {
		finishedRef.current = false;
		setDraft(value);
		setEditing(true);
	};

	const finish = (commit: boolean) => {
		if (finishedRef.current) return;
		finishedRef.current = true;
		setEditing(false);
		const next = draft.trim();
		if (commit && next !== value.trim()) onSave(next);
	};

	const statusEl =
		status === "saving" ? (
			<output className="text-xs text-gray-500 animate-pulse">Saving…</output>
		) : status === "error" ? (
			<span role="alert" className="text-xs text-red-400">
				Couldn’t save
			</span>
		) : null;

	if (disabled) {
		return value ? <span className={textClassName}>{value}</span> : null;
	}

	if (editing) {
		const common = {
			ref: fieldRef,
			value: draft,
			"aria-label": label,
			placeholder,
			onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setDraft(e.target.value),
			onBlur: () => finish(true),
			onKeyDown: (e: React.KeyboardEvent) => {
				if (e.key === "Escape") {
					// Prevent the native <dialog> from closing on Escape.
					e.preventDefault();
					e.stopPropagation();
					finish(false);
				} else if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey)) {
					e.preventDefault();
					finish(true);
				}
			},
			className: `w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-red-500/50 placeholder:text-gray-600 ${textClassName}`,
		};
		return multiline ? (
			<textarea {...common} rows={3} className={`${common.className} resize-none`} />
		) : (
			<input type="text" {...common} />
		);
	}

	return (
		<span className="inline-flex items-baseline gap-2 max-w-full">
			<button
				type="button"
				onClick={start}
				aria-label={`Edit ${label.toLowerCase()}`}
				className="group inline-flex items-baseline gap-1.5 max-w-full text-left cursor-text rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
			>
				<span className={`${value ? textClassName : "text-gray-600 italic"} whitespace-pre-wrap break-words`}>
					{value || placeholder}
				</span>
				<svg
					aria-hidden="true"
					viewBox="0 0 20 20"
					fill="currentColor"
					className="h-3.5 w-3.5 shrink-0 self-center text-gray-600 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
				>
					<path d="M13.6 2.9a1.9 1.9 0 0 1 2.7 2.7l-9 9-3.6.9.9-3.6 9-9Z" />
				</svg>
			</button>
			{statusEl}
		</span>
	);
}
