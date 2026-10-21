import React, { useEffect, useMemo, useState } from 'react';

const OUTCOMES = [
  ['playoff', 'Makes playoffs'],
  ['bye', 'Earns a bye'],
  ['divisionWinner', 'Wins division'],
  ['last', 'Finishes last']
];
const percent = value => `${Number(value || 0).toFixed(1)}%`;
const decimal = value => Number(value || 0).toFixed(3);

export default function HistoricalBacktest() {
  const [data, setData] = useState(null);
  const [outcome, setOutcome] = useState('playoff');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/data/historical_backtest.json')
      .then(response => {
        if (!response.ok) throw new Error('Historical backtest data is unavailable.');
        return response.json();
      })
      .then(value => active && setData(value))
      .catch(reason => active && setError(reason.message));
    return () => { active = false; };
  }, []);

  const metric = data?.metrics?.[outcome];
  const calibrationError = useMemo(() => {
    if (!metric) return null;
    const total = metric.calibration.reduce((sum, bucket) => sum + bucket.forecasts, 0);
    return total ? metric.calibration.reduce((sum, bucket) => (
      sum + bucket.forecasts * Math.abs(bucket.observedRate - bucket.meanPrediction)
    ), 0) / total : null;
  }, [metric]);
  const label = OUTCOMES.find(([key]) => key === outcome)?.[1] || outcome;

  if (error) return <section className="card explorer-warning">{error}</section>;
  if (!data || !metric) return <section className="card explorer-empty">Loading historical model backtest…</section>;

  return (
    <section className="card backtest-card">
      <div className="backtest-header">
        <div>
          <div className="card-title">Historical model backtest</div>
          <h2>Did probabilities behave like probabilities?</h2>
          <p>{data.checkpoints} reconstructed weekly checkpoints from {data.seasons[0]}–{data.seasons.at(-1)}, using only information available through each historical week.</p>
        </div>
        <label>Outcome
          <select value={outcome} onChange={event => setOutcome(event.target.value)}>
            {OUTCOMES.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
          </select>
        </label>
      </div>

      <div className="backtest-summary-grid">
        <div><span>Brier score</span><strong>{decimal(metric.brier)}</strong><small>Lower is better · 0 is perfect</small></div>
        <div><span>Uninformed baseline</span><strong>{decimal(metric.uninformedBrier)}</strong><small>Always predicts the league-wide rate</small></div>
        <div><span>Error reduction</span><strong>{percent(metric.brierSkillScore * 100)}</strong><small>Versus the uninformed baseline</small></div>
        <div><span>Calibration error</span><strong>{percent(calibrationError)}</strong><small>Average forecast-versus-result gap</small></div>
      </div>

      <div className="backtest-verdict">
        <strong>{label}:</strong> the model reduced squared probability error by {percent(metric.brierSkillScore * 100)} versus a constant {percent(metric.observedBaseRate)} forecast.
        {' '}Its average calibration gap was {percent(calibrationError)}; individual probability bands below show where it was over- or underconfident.
      </div>

      <div className="table-container">
        <table className="data-table backtest-table">
          <thead><tr><th>Displayed range</th><th>Average forecast</th><th>Actually happened</th><th>Gap</th><th>Reading</th><th>Forecasts</th></tr></thead>
          <tbody>
            {metric.calibration.map(bucket => {
              const gap = bucket.observedRate - bucket.meanPrediction;
              const reading = Math.abs(gap) < 5 ? 'Close'
                : gap > 0 ? 'Underestimated' : 'Overconfident';
              return <tr key={bucket.range}>
                <td>{bucket.range}</td>
                <td>{percent(bucket.meanPrediction)}</td>
                <td>{percent(bucket.observedRate)}</td>
                <td className={Math.abs(gap) < 5 ? '' : gap > 0 ? 'backtest-positive' : 'backtest-negative'}>{gap >= 0 ? '+' : ''}{gap.toFixed(1)} pts</td>
                <td><span className={`backtest-reading backtest-${reading.toLowerCase()}`}>{reading}</span></td>
                <td>{bucket.forecasts.toLocaleString()}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <p className="backtest-note">Reconstructed forecasts evaluate the current model fairly without future scores, but repeated weekly forecasts from the same team-season are related observations—not {data.teamForecasts.toLocaleString()} independent seasons.</p>
    </section>
  );
}
