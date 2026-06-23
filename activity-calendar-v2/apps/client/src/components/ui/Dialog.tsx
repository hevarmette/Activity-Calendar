import { useEffect, useRef, type ReactNode } from "react";

interface Props {
	open: boolean;
	onClose: () => void;
	title: string;
	subtitle?: string;
	children: ReactNode;
}

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
				<div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
					<div>
						<h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#f3f4f6" }}>{title}</h2>
						{subtitle && <p style={{ fontSize: "0.8rem", fontStyle: "italic", color: "#9ca3af", marginTop: "4px" }}>{subtitle}</p>}
					</div>
					<button
						onClick={onClose}
						style={{ color: "#6b7280", fontSize: "1.5rem", lineHeight: 1, background: "none", border: "none", cursor: "pointer" }}
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
