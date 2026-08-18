interface Props { label: string; value: string; }
export function MetricCard({ label, value }: Props) {
  return (
    <div style={{ flex: 1, padding: "16px" }}>
      <p style={{ fontSize: "0.75rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "#6b7280" }}>{label}</p>
      <p style={{ marginTop: "4px", fontSize: "1.5rem", fontWeight: 700, color: "#f9fafb", fontVariantNumeric: "tabular-nums" }}>{value}</p>
    </div>
  );
}
