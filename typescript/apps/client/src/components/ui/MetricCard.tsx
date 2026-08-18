/**
 * Bare label + value metric display. No card wrapper, no borders, no padding.
 * Parent controls layout (flex, grid, spacing). Pass `className` for positioning tweaks.
 */
interface Props {
	label: string;
	value: string;
	className?: string;
}

export function MetricCard({ label, value, className }: Props) {
	return (
		<div className={className}>
			<p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
			<p className="mt-1 text-2xl font-bold text-gray-50 tabular-nums">{value}</p>
		</div>
	);
}
