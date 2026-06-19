interface Props {
	label: string;
	value: string;
}

export function MetricCard({ label, value }: Props) {
	return (
		<div className="rounded-lg bg-gray-800 p-3 text-center">
			<p className="text-xs text-gray-400 uppercase">{label}</p>
			<p className="text-lg font-semibold">{value}</p>
		</div>
	);
}
