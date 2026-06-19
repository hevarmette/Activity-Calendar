import { useEffect, useRef, type ReactNode } from "react";

interface Props {
	open: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
}

export function Dialog({ open, onClose, title, children }: Props) {
	const dialogRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const el = dialogRef.current;
		if (!el) return;
		if (open && !el.open) el.showModal();
		if (!open && el.open) el.close();
	}, [open]);

	return (
		<dialog
			ref={dialogRef}
			onClose={onClose}
			className="w-full max-w-2xl rounded-xl bg-gray-900 text-gray-100 border border-gray-700 p-6 backdrop:bg-black/60"
		>
			<div className="flex items-center justify-between mb-4">
				<h2 className="text-xl font-bold">{title}</h2>
				<button onClick={onClose} className="text-gray-400 hover:text-white text-xl" aria-label="Close">
					✕
				</button>
			</div>
			{children}
		</dialog>
	);
}
