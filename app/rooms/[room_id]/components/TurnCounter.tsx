export default function TurnCounter({
  today,
  dailyMax,
}: {
  today: number;
  dailyMax: number;
}) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="metric">
      <span className="k">TURN TODAY</span>
      <span className="v">
        {pad(today)}
        <span className="sub"> / {pad(dailyMax)}</span>
      </span>
    </div>
  );
}
