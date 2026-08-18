import { type ReactNode, useEffect, useRef } from "react";

interface Props {
	open: boolean;
	onClose: () => void;
	title: string;
	subtitle?: string;
	children: ReactNode;
}

/**
 * Accessible modal dialog using the native <dialog> element.
 * Styled with Tailwind — uses backdrop: modifier for the overlay.
 * Click outside or press Escape to close.
 */
export function Dialog({ open, onClose, title, subtitle, children }: Props) {
	const dialogRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const el = dialogRef.current;
		if (!el) return;
		if (open && !el.open) el.showModal();
		if (!open && el.open) el.close();
	}, [open]);

	useEffect(() => {
		const el = dialogRef.current;
		if (!el) return;
		const handleClick = (e: MouseEvent) => {
			const rect = el.getBoundingClientRect();
			if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
				onClose();
			}
		};
		el.addEventListener("click", handleClick);
		return () => el.removeEventListener("click", handleClick);
	}, [onClose]);

	return (
		<dialog
			ref={dialogRef}
			onClose={onClose}
			className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0 w-[min(720px,95vw)] max-h-[90vh] overflow-y-auto rounded-xl bg-[#1a1a1a] text-gray-100 border border-gray-700 p-6 shadow-[0_25px_60px_rgba(0,0,0,0.6)] backdrop:bg-black/65 backdrop:backdrop-blur-sm"
		>
			<div className="flex flex-row items-center justify-between mb-5">
				<div>
					<h2 className="text-xl font-semibold text-gray-100">{title}</h2>
					{subtitle && <p className="text-[0.8rem] italic text-gray-400 mt-1">{subtitle}</p>}
				</div>
				<button
					type="button"
					onClick={onClose}
					className="text-gray-500 text-2xl leading-none bg-transparent border-none cursor-pointer hover:text-gray-300 transition-colors"
					aria-label="Close"
				>
					✕
				</button>
			</div>
			{children}
		</dialog>
	);
}
