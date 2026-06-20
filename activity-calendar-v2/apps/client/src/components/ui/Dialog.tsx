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

	useEffect(() => {
		const el = dialogRef.current;
		if (!el) return;
		const handleClick = (e: MouseEvent) => {
			const rect = el.getBoundingClientRect();
			if (
				e.clientX < rect.left ||
				e.clientX > rect.right ||
				e.clientY < rect.top ||
				e.clientY > rect.bottom
			) {
				onClose();
			}
		};
		el.addEventListener("click", handleClick);
		return () => el.removeEventListener("click", handleClick);
	}, [onClose]);

	return (
		<>
			<style>{`
				dialog.activity-dialog {
					position: fixed;
					top: 50%;
					left: 50%;
					transform: translate(-50%, -50%);
					margin: 0;
					width: min(720px, 95vw);
					max-height: 90vh;
					overflow-y: auto;
					border-radius: 12px;
					background: #1a1a1a;
					color: #f3f4f6;
					border: 1px solid #374151;
					padding: 1.5rem;
					box-shadow: 0 25px 60px rgba(0,0,0,0.6);
				}
				dialog.activity-dialog::backdrop {
					background: rgba(0, 0, 0, 0.65);
					backdrop-filter: blur(2px);
				}
			`}</style>
			<dialog
				ref={dialogRef}
				onClose={onClose}
				className="activity-dialog"
			>
				<div className="flex items-center justify-between mb-5">
					<h2 className="text-xl font-semibold text-gray-100">{title}</h2>
					<button
						onClick={onClose}
						className="text-gray-500 hover:text-gray-200 transition-colors text-2xl leading-none"
						aria-label="Close"
					>
						✕
					</button>
				</div>
				{children}
			</dialog>
		</>
	);
}
